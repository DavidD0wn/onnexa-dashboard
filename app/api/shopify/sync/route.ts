import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfDay } from "date-fns";

// ─── Exchange rate helpers (MXN → USD) ───────────────────────────────────────
// The peso/dollar rate moves ±5% over a 30-day window, so using a single
// "rate of the sync day" understates or overstates revenue depending on
// which direction the peso moved.  We load per-day historical rates so each
// order is converted at the rate that was in effect on its own date.
//
// Sources (tried in order, most accurate first):
//   1. Frankfurter.app  — ECB-based, daily, historical, free, no key
//   2. fawazahmed0 CDN  — daily, historical, free, no key
//   3. open.er-api.com  — live rate only (used as today's fallback)
//   4. Hard-coded guard  — last resort
const FALLBACK_MXN_RATE = 17.30;   // Updated May 2026 (was 18.7 — stale)

/** Fetch the live MXN/USD rate (for today / very recent orders). */
async function fetchLiveMxnRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return FALLBACK_MXN_RATE;
    const data = await res.json();
    const mxn = data?.rates?.MXN;
    return typeof mxn === "number" && mxn > 10 ? Math.round(mxn * 100) / 100 : FALLBACK_MXN_RATE;
  } catch {
    return FALLBACK_MXN_RATE;
  }
}

/**
 * Build a map of { "YYYY-MM-DD": MXN_per_USD } for every date between
 * `from` and `to` (inclusive).  Dates missing from the API (weekends,
 * holidays) inherit the most recent known rate.
 *
 * Returns an empty map on total failure — callers fall back to a single rate.
 */
async function fetchHistoricalRates(from: string, to: string): Promise<Record<string, number>> {
  const rates: Record<string, number> = {};

  // ── Source 1: Frankfurter.app (ECB, most reliable) ─────────────────────────
  try {
    const url = `https://api.frankfurter.app/${from}..${to}?from=USD&to=MXN`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (data?.rates && typeof data.rates === "object") {
        for (const [date, day] of Object.entries(data.rates as Record<string, any>)) {
          const mxn = day?.MXN;
          if (typeof mxn === "number" && mxn > 10) rates[date] = Math.round(mxn * 100) / 100;
        }
        if (Object.keys(rates).length > 0) {
          console.log(`[exchange] Frankfurter: loaded ${Object.keys(rates).length} days (${from}→${to})`);
          return fillGaps(rates, from, to);
        }
      }
    }
  } catch { /* try next source */ }

  // ── Source 2: fawazahmed0 CDN (daily snapshot, fallback) ───────────────────
  // Only practical for recent short ranges (one call per day is too slow for 90d)
  // so only use it when Frankfurter fails and range ≤ 7 days.
  try {
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
    if (days <= 7) {
      let cursor = new Date(from);
      const end  = new Date(to);
      while (cursor <= end) {
        const d   = cursor.toISOString().slice(0, 10);
        const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/usd.json`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const data = await res.json();
          const mxn  = data?.usd?.mxn;
          if (typeof mxn === "number" && mxn > 10) rates[d] = Math.round(mxn * 100) / 100;
        }
        cursor = new Date(cursor.getTime() + 86_400_000);
      }
      if (Object.keys(rates).length > 0) {
        console.log(`[exchange] fawazahmed0: loaded ${Object.keys(rates).length} days`);
        return fillGaps(rates, from, to);
      }
    }
  } catch { /* fall through */ }

  console.warn("[exchange] All historical sources failed — will use single live rate");
  return {};
}

/**
 * Fill in weekend/holiday gaps by carrying the last known rate forward.
 * Also back-fills the start if the first available date is after `from`.
 */
function fillGaps(rates: Record<string, number>, from: string, to: string): Record<string, number> {
  const filled: Record<string, number> = {};
  let last = FALLBACK_MXN_RATE;
  let cursor = new Date(from);
  const end   = new Date(to);
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    if (rates[d] !== undefined) last = rates[d];
    filled[d] = last;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return filled;
}

// ─── Store configs ───────────────────────────────────────────────────────────
const STORES = {
  glowmmi: {
    shop: "glm-1694.myshopify.com",
    clientId: "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType: "json" as const,
    brandId: "brand_glowmmi",
    countryId: "country_us",   // default — overridden per-order when splitByCountry=true
    storeId: "store_glowmmi_us",
    currency: "USD",
    // glm-1694 shop default currency is MXN → Shopify API returns amounts in MXN → divide by live rate to store USD.
    shopCurrencyRate: FALLBACK_MXN_RATE,  // overridden with live rate at sync time
    gatewayPct: 0.029,
    gatewayFixed: 0.30,
    splitByCountry: true,      // Glowmmi sells US + MX + CL → split into country rows
    // Store timezone offset in hours from UTC (Mexico City = UTC-6 CDT, UTC-5 CST)
    // Used to bucket orders by LOCAL date (matching Shopify Analytics date attribution)
    storeUtcOffset: -6,
  },
  balancea: {
    shop: "mp0vab-bw.myshopify.com",
    clientId: "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType: "urlencoded" as const,
    brandId: "brand_balancea",
    countryId: "country_mx",
    storeId: "store_balancea_mx",
    currency: "MXN",
    shopCurrencyRate: FALLBACK_MXN_RATE,  // overridden with live rate at sync time
    // gatewayFixed was 3.0 USD (wrong — that's ~MX$56 per order).
    // Set to 0: real fees come from the Shopify Payments payouts sync.
    gatewayPct: 0.036,
    gatewayFixed: 0.0,
    splitByCountry: false,
    storeUtcOffset: -6,
  },
};

// Country code → DB IDs (used when splitByCountry=true)
const COUNTRY_ID_MAP: Record<string, { countryId: string; storeId: string }> = {
  US: { countryId: "country_us", storeId: "store_glowmmi_us" },
  MX: { countryId: "country_mx", storeId: "store_glowmmi_mx" },
  CL: { countryId: "country_cl", storeId: "store_glowmmi_cl" },
  // fallback for unknown countries → US bucket
};

// ─── Types ───────────────────────────────────────────────────────────────────
type StoreConfig = {
  shop: string; clientId: string; clientSecret: string;
  authType: "json" | "urlencoded";
  brandId: string; countryId: string; storeId: string;
  currency: string; shopCurrencyRate: number;
  gatewayPct: number; gatewayFixed: number;
  splitByCountry: boolean;
  storeUtcOffset: number;  // hours from UTC; used to derive local date from UTC timestamp
};

// ─── Auth ────────────────────────────────────────────────────────────────────
async function getToken(store: StoreConfig): Promise<string> {
  const url = `https://${store.shop}/admin/oauth/access_token`;
  let body: string;
  let contentType: string;

  if (store.authType === "urlencoded") {
    const qs = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: store.clientId,
      client_secret: store.clientSecret,
    });
    body = qs.toString();
    contentType = "application/x-www-form-urlencoded";
  } else {
    body = JSON.stringify({
      client_id: store.clientId,
      client_secret: store.clientSecret,
      grant_type: "client_credentials",
    });
    contentType = "application/json";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Auth error ${store.shop} (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error(`No access_token in response: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

// ─── Fetch paginated helper ───────────────────────────────────────────────────
// "TODO O NADA": si la paginación no llega al final (rate limit persistente,
// error de red, error de servidor), LANZA un error. El caller aborta el sync sin
// escribir nada, conservando los datos buenos en vez de corromperlos con datos
// parciales. NUNCA devuelve un resultado incompleto silenciosamente.
async function fetchPaginated(startUrl: string, token: string, key: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = startUrl;
  while (url) {
    let res: Response | null = null;
    let attempt = 0;
    // Reintentar ESTA página con backoff exponencial hasta lograrla.
    while (true) {
      try {
        res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
      } catch (e: any) {
        // Error de red — backoff y reintentar
        if (++attempt > 8) throw new Error(`Red falló tras ${attempt} intentos: ${e.message}`);
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 20000)));
        continue;
      }
      // Rate limit (429) o error de servidor (5xx): esperar y reintentar la MISMA página.
      if (res.status === 429 || res.status >= 500) {
        if (++attempt > 8) throw new Error(`Shopify ${res.status} persistente tras ${attempt} intentos — sync abortado para no perder datos`);
        const retryAfter = parseFloat(res.headers.get("Retry-After") ?? "0");
        const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 20000);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`Shopify respondió ${res.status} — sync abortado`);
      break; // página OK
    }
    const data: any = await res!.json();
    all.push(...(data[key] ?? []));
    const next: RegExpMatchArray | null = (res!.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
    // Pausa entre páginas para respetar el bucket de Shopify (2 req/s).
    if (url) await new Promise((r) => setTimeout(r, 400));
  }
  return all;
}

// ─── Fetch paid orders (revenue) ─────────────────────────────────────────────
async function fetchOrders(shop: string, token: string, since: string): Promise<any[]> {
  return fetchPaginated(
    `https://${shop}/admin/api/2024-01/orders.json` +
    `?status=any&financial_status=paid,partially_paid,partially_refunded,authorized,refunded` +
    `&created_at_min=${since}&limit=250` +
    // line_items para contar unidades físicas reales (qty × bundle_size)
    `&fields=id,created_at,total_price,total_discounts,total_tax,shipping_lines,shipping_address,line_items`,
    token, "orders"
  );
}

/** Extrae cuántas unidades físicas hay en un bundle a partir del título y variante */
function calcBundleSize(title: string, variantTitle: string): number {
  const v = variantTitle && variantTitle !== "Default Title" ? variantTitle : "";
  const vm = v.match(/\bx(\d+)\b/i) ?? v.match(/^(\d+)\s*(unidades?|pcs?|units?)?$/i);
  if (vm) return Math.max(1, parseInt(vm[1]));
  const nm = title.match(/\bx(\d+)\b/i);
  if (nm) return Math.max(1, parseInt(nm[1]));
  return 1;
}

// ─── Fetch refunded orders (returns) ─────────────────────────────────────────
async function fetchRefunds(shop: string, token: string, since: string): Promise<any[]> {
  return fetchPaginated(
    `https://${shop}/admin/api/2024-01/orders.json` +
    `?status=any&financial_status=refunded,partially_refunded` +
    `&updated_at_min=${since}&limit=250` +
    `&fields=id,created_at,updated_at,refunds`,
    token, "orders"
  );
}

/**
 * Extracts the LOCAL date string (YYYY-MM-DD) from a Shopify `created_at` timestamp.
 *
 * Shopify REST API returns timestamps in TWO formats:
 *   - Local timezone: "2026-05-19T23:30:00-06:00"  → date part IS already local, use it directly.
 *   - UTC:            "2026-05-20T05:30:00Z"         → no offset, apply storeOffsetMs to convert.
 *
 * Applying the offset blindly to local-timezone timestamps double-shifts the time and can
 * move boundary orders to the wrong day.
 */
function localDateKey(createdAt: string, storeOffsetMs: number): string {
  // Detect whether the timestamp carries an explicit UTC offset ("+HH:MM" or "-HH:MM").
  // If it does, the date portion is already in the store's local time.
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(createdAt.trimEnd());
  if (hasOffset) {
    // Date part is already local — extract directly.
    return createdAt.slice(0, 10);
  }
  // No offset (Z or bare) → timestamp is UTC → shift to store local time.
  const localMs = new Date(createdAt).getTime() + storeOffsetMs;
  return new Date(localMs).toISOString().slice(0, 10);
}

// ─── Group orders by date (and optionally country) ───────────────────────────
// ─── COGS helpers (same logic as product-analytics route) ────────────────────
function normName(n: string): string {
  return n.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim();
}
function baseOf(n: string): string {
  return n.split(/\s*[|—–]\s*/)[0].replace(/[™®]/g, "").trim();
}
function lookupCostSync(
  title: string, variant: string,
  flatCosts: Record<string, number>
): number {
  const base     = baseOf(title);
  const nTitle   = normName(title);
  const nBase    = normName(base);
  const nVariant = variant ? normName(variant) : "";
  if (nVariant) {
    return (
      flatCosts[`${base} ${variant}`]    ?? flatCosts[`${nBase} ${nVariant}`] ??
      flatCosts[`${title} ${variant}`]   ?? flatCosts[`${title} — ${variant}`] ??
      flatCosts[`${nTitle} ${nVariant}`] ?? flatCosts[title]  ??
      flatCosts[base]  ?? flatCosts[nTitle] ?? flatCosts[nBase] ?? 0
    );
  }
  return flatCosts[title] ?? flatCosts[base] ?? flatCosts[nTitle] ?? flatCosts[nBase] ?? 0;
}

// ─── Country-aware cost maps ─────────────────────────────────────────────────
// Returns { mx, us, cl } — each a flat { productName: costUSD } map.
// Callers select the right map based on the order's shipping country.
type CostsByCountry = { mx: Record<string, number>; us: Record<string, number>; cl: Record<string, number> };

function addToCostMap(map: Record<string, number>, key: string, val: number) {
  map[key] = val; map[normName(key)] = val;
}

async function loadCostsByCountry(): Promise<CostsByCountry> {
  const result: CostsByCountry = { mx: {}, us: {}, cl: {} };

  try {
    // 1. product-costs.json — read each country section separately
    const fs   = await import("fs");
    const path = await import("path");
    const p    = path.join(process.cwd(), "data", "product-costs.json");
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
      for (const cc of ["mx", "us", "cl"] as const) {
        const flat = (raw[cc] ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(flat)) {
          if (typeof v === "number" && v > 0) addToCostMap(result[cc], k, v);
        }
      }
    }
  } catch { /* optional file */ }

  try {
    // 2. Product.supplierCostUsd — generic fallback for all countries
    const products = await prisma.product.findMany({ select: { name: true, supplierCostUsd: true } });
    for (const prod of products) {
      if (prod.supplierCostUsd && prod.supplierCostUsd > 0) {
        for (const cc of ["mx", "us", "cl"] as const) {
          if (!result[cc][prod.name]) addToCostMap(result[cc], prod.name, prod.supplierCostUsd);
        }
      }
    }
    // 3. SupplierEscalon — use country-specific cost where available
    const escalones = await (prisma as any).supplierEscalon?.findMany({ orderBy: { units: "asc" } }) ?? [];
    for (const e of escalones) {
      const costs: Record<string, number | undefined> = { mx: e.costMx, us: e.costUs, cl: e.costCl };
      for (const cc of ["mx", "us", "cl"] as const) {
        const c = costs[cc] ?? e.costUs ?? e.costMx ?? 0;
        if (c > 0 && !result[cc][e.productName]) addToCostMap(result[cc], e.productName, c);
      }
    }
    // 4. ProductCogsByCountry (highest priority — most specific)
    const cogsByCountry = await (prisma as any).productCogsByCountry?.findMany({
      where: { isActive: true },
      select: { productBaseName: true, productCostUnitUsd: true, countryCode: true },
      orderBy: { updatedAt: "desc" },
    }) ?? [];
    for (const c of cogsByCountry) {
      if (c.productCostUnitUsd > 0) {
        const cc = ((c.countryCode as string | null)?.toLowerCase() ?? "mx") as "mx" | "us" | "cl";
        if (result[cc]) addToCostMap(result[cc], c.productBaseName, c.productCostUnitUsd);
      }
    }
  } catch { /* non-critical */ }

  return result;
}

type DayBucket = {
  date: Date;
  countryId: string;
  storeId: string;
  ordersCount: number;
  unitsSold: number;       // physical product units (x2 bundle = 2 units)
  grossRevenue: number;    // sum of line_item original prices (before discounts)
  shippingCharged: number;
  discounts: number;       // sum of all line-item + order-level discounts
  returns: number;
  taxes: number;
  fees: number;
  cogs: number;            // sum of (unit_cost × physical_units) per line item
};

function groupByDate(
  orders: any[],
  refundOrders: any[],
  cfg: StoreConfig,
  costsByCountry: CostsByCountry = { mx: {}, us: {}, cl: {} },
  dailyRates: Record<string, number> = {}   // { "YYYY-MM-DD": MXN_per_USD } — empty = use cfg.shopCurrencyRate
) {
  // key = "YYYY-MM-DD" or "YYYY-MM-DD||MX" when splitByCountry=true
  const byKey: Record<string, DayBucket> = {};

  const ensure = (dateKey: string, date: Date, countryCode: string): DayBucket => {
    const bucketKey = cfg.splitByCountry ? `${dateKey}||${countryCode}` : dateKey;
    if (!byKey[bucketKey]) {
      const loc = cfg.splitByCountry
        ? (COUNTRY_ID_MAP[countryCode] ?? COUNTRY_ID_MAP["US"])
        : { countryId: cfg.countryId, storeId: cfg.storeId };
      // Always use UTC midnight so the date matches CSV-imported rows (stored at 00:00:00Z)
      const [y, m, d] = dateKey.split("-").map(Number);
      byKey[bucketKey] = {
        date: new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)),
        countryId: loc.countryId,
        storeId:   loc.storeId,
        ordersCount: 0, unitsSold: 0, grossRevenue: 0, shippingCharged: 0,
        discounts: 0, returns: 0, taxes: 0, fees: 0, cogs: 0,
      };
    }
    return byKey[bucketKey];
  };

  // ─── Currency conversion ────────────────────────────────────────────────────
  // Shopify REST API ALWAYS returns monetary amounts in the shop's DEFAULT CURRENCY,
  // regardless of what the customer paid in (presentment_currency is irrelevant here).
  //
  // If dailyRates has data, each order uses the rate for its own date (most accurate).
  // Otherwise falls back to the single cfg.shopCurrencyRate set at sync time.
  const fallbackRate = cfg.shopCurrencyRate ?? 1;
  const rateFor = (dateKey: string): number =>
    dailyRates[dateKey] ?? fallbackRate;

  // Store UTC offset in ms — used to convert UTC order timestamp → store's local date.
  // Shopify Analytics attributes orders to the date in the STORE'S timezone, so we do the same.
  const STORE_OFFSET_MS = (cfg.storeUtcOffset ?? -6) * 60 * 60 * 1000;

  // ── Paid orders ──
  for (const order of orders) {
    const dateKey     = localDateKey(order.created_at, STORE_OFFSET_MS);
    const countryCode = (order.shipping_address?.country_code ?? "US").toUpperCase();
    const d             = ensure(dateKey, new Date(order.created_at), countryCode);

    // Select cost map for this order's shipping country (MX/US/CL); fall back to MX
    const ccKey = countryCode === "US" ? "us" : countryCode === "CL" ? "cl" : "mx";
    const flatCosts = costsByCountry[ccKey] ?? costsByCountry.mx ?? {};

    // Use the exchange rate for this order's specific date
    const RATE          = rateFor(dateKey);
    const netPaid       = (parseFloat(order.total_price)     || 0) / RATE;
    const shipping      = (order.shipping_lines ?? []).reduce(
      (s: number, l: any) => s + (parseFloat(l.price) || 0), 0
    ) / RATE;

    // Gross = sum of (item.price × item.quantity) for ALL line items.
    // item.price is the LISTED unit price before any discount_allocations —
    // this is exactly the methodology Shopify Analytics uses for "gross_sales".
    // Using total_price + total_discounts would MISS bundle/promo discounts where
    // the free item has its full original price + a discount_allocation to $0.
    let lineItemGross = 0;
    for (const item of order.line_items ?? []) {
      lineItemGross += (parseFloat(item.price ?? "0")) * (parseInt(item.quantity) || 1);
    }
    const gross    = lineItemGross / RATE;
    // Discount = gross product revenue minus net product revenue (excl. shipping)
    const discount = Math.max(0, gross - (netPaid - shipping));

    d.ordersCount     += 1;
    for (const item of (order.line_items ?? [])) {
      const qty       = parseInt(item.quantity) || 1;
      const bSize     = calcBundleSize(item.title ?? "", item.variant_title ?? "");
      const physUnits = qty * bSize;
      d.unitsSold += physUnits;
      // COGS per line item — use the country-specific cost map for this order
      const variant  = (item.variant_title && item.variant_title !== "Default Title") ? item.variant_title : "";
      // Escalón por cantidad: los pedidos llegan como título base + qty (sin variante),
      // así que primero probamos el costo del escalón "xN" del proveedor.
      let unitCost = 0;
      if (!variant && physUnits > 1) {
        unitCost = lookupCostSync(item.title ?? "", `x${physUnits}`, flatCosts);
      }
      if (unitCost <= 0) unitCost = lookupCostSync(item.title ?? "", variant, flatCosts);
      d.cogs += unitCost * physUnits;
    }
    d.grossRevenue    += gross;
    d.shippingCharged += shipping;
    d.discounts       += discount;
    d.taxes           += (parseFloat(order.total_tax) || 0) / RATE;
    d.fees            += netPaid * cfg.gatewayPct + cfg.gatewayFixed;
  }

  // ── Returns: sum refund amounts by refund created_at date ──
  for (const order of refundOrders) {
    const countryCode = (order.shipping_address?.country_code ?? "US").toUpperCase();
    for (const refund of (order.refunds ?? [])) {
      const rawRefundTs = refund.created_at ?? order.updated_at ?? order.created_at;
      const refundDate  = localDateKey(rawRefundTs, STORE_OFFSET_MS);
      const d = ensure(refundDate, new Date(refundDate), countryCode);
      const RATE = rateFor(refundDate);
      const refundAmount = (refund.transactions ?? []).reduce(
        (s: number, t: any) => t.kind === "refund" ? s + (parseFloat(t.amount) || 0) : s, 0
      ) / RATE;
      d.returns += refundAmount;
    }
  }

  return byKey;
}

// ─── POST — sync a specific store ────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { store = "glowmmi", days = 30 } = body as { store?: string; days?: number };

  const baseCfg = STORES[store as keyof typeof STORES] as StoreConfig | undefined;
  if (!baseCfg) return NextResponse.json({ error: "Tienda no válida. Usa 'glowmmi' o 'balancea'" }, { status: 400 });

  // ── Exchange rates: fetch live rate (fallback) + historical per-day rates ────
  // We start with the live rate as safety net, then try to get per-day history.
  // Both run in parallel so historical fetch doesn't slow down the sync.
  const sinceForRates = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const dateFrom = sinceForRates.toISOString().slice(0, 10);
  const dateTo   = new Date().toISOString().slice(0, 10);

  const [liveMxnRate, dailyRates] = await Promise.all([
    fetchLiveMxnRate(),
    // Only fetch historical rates for MXN stores — USD stores don't need conversion
    baseCfg.shopCurrencyRate !== 1 ? fetchHistoricalRates(dateFrom, dateTo) : Promise.resolve({} as Record<string, number>),
  ]);

  // Stamp today's live rate into dailyRates for any orders placed today
  if (!dailyRates[dateTo]) dailyRates[dateTo] = liveMxnRate;

  const cfg: StoreConfig = { ...baseCfg, shopCurrencyRate: liveMxnRate };
  const rateCount = Object.keys(dailyRates).length;
  console.log(`[sync:${store}] Exchange rates: live=${liveMxnRate} | historical=${rateCount} days loaded`);

  try {
    const token = await getToken(cfg);
    const since = sinceForRates.toISOString();
    const [orders, refundOrders, costsByCountry] = await Promise.all([
      fetchOrders(cfg.shop, token, since),
      fetchRefunds(cfg.shop, token, since),
      loadCostsByCountry(),
    ]);

    if (orders.length === 0 && refundOrders.length === 0) {
      return NextResponse.json({ store: cfg.shop, synced: 0, days, message: "Sin órdenes en este período" });
    }

    const byKey = groupByDate(orders, refundOrders, cfg, costsByCountry, dailyRates);
    let synced = 0;
    const errors: string[] = [];

    // Track which (date × countryId) combinations the sync produced
    // so we can zero-out any stale rows that weren't produced this run
    const syncedKeys = new Set<string>(); // "dateISO|countryId"

    for (const [bucketKey, metrics] of Object.entries(byKey)) {
      const aov        = metrics.ordersCount > 0 ? metrics.grossRevenue / metrics.ordersCount : 0;
      const netRevenue = metrics.grossRevenue - metrics.discounts - metrics.returns;
      const netProfit  = netRevenue - metrics.fees;
      const netMargin  = metrics.grossRevenue > 0 ? (netProfit / metrics.grossRevenue) * 100 : 0;

      // Unique ID for upsert: embed country so each bucket gets its own row
      const dateStr   = metrics.date.toISOString().slice(0, 10);
      const shopifyId = `shopify_${store}_${dateStr}_${metrics.countryId}`;
      syncedKeys.add(`${dateStr}|${metrics.countryId}`);

      try {
        // Check if a canonical (CUID) row already exists for this date+brand+country.
        // Use a 1-day range to handle timezone differences (CSV rows stored at 00:00Z,
        // date-fns startOfDay may produce 05:00Z on UTC-5 servers).
        const dayStart = new Date(Date.UTC(
          metrics.date.getUTCFullYear(), metrics.date.getUTCMonth(), metrics.date.getUTCDate()
        ));
        const dayEnd = new Date(Date.UTC(
          metrics.date.getUTCFullYear(), metrics.date.getUTCMonth(), metrics.date.getUTCDate() + 1
        ));
        const existing = await prisma.dailyMetric.findFirst({
          where: {
            date:      { gte: dayStart, lt: dayEnd },
            brandId:   cfg.brandId,
            countryId: metrics.countryId,
            id:        { not: { startsWith: "shopify_" } },
          },
        });

        const updatePayload = {
          ordersCount:  metrics.ordersCount,
          unitsSold:    metrics.unitsSold,
          grossRevenue: metrics.grossRevenue,
          netRevenue,
          discounts:    metrics.discounts,
          returns:      metrics.returns,
          shippingCost: metrics.shippingCharged,
          fees:         metrics.fees,
          taxes:        metrics.taxes,
          cogs:         metrics.cogs,
          netProfit,
          netMargin,
          aov,
          notes: `Shopify sync — ${metrics.ordersCount} órdenes`,
        };

        if (existing) {
          await prisma.dailyMetric.update({
            where: { id: existing.id },
            data:  updatePayload,
          });
        } else {
          await prisma.dailyMetric.upsert({
            where: { id: shopifyId },
            create: {
              id:        shopifyId,
              date:      metrics.date,
              brandId:   cfg.brandId,
              countryId: metrics.countryId,
              storeId:   metrics.storeId,
              adSpend: 0, roas: 0,
              ...updatePayload,
            },
            update: updatePayload,
          });
        }
        synced++;
      } catch (e: any) {
        errors.push(`${bucketKey}: ${e.message}`);
      }
    }

    // ── Zero-out stale rows for dates the sync DID cover but produced no orders ──
    // For splitByCountry stores: if the sync produced "MX" rows but not "CL" rows on a date,
    // any pre-existing "CL" canonical rows for that date are left untouched intentionally.
    // We only delete/zero stale shopify_* rows that are clearly superseded.
    const oldShopifyRows = await prisma.dailyMetric.findMany({
      where: {
        brandId: cfg.brandId,
        id:      { startsWith: "shopify_" },
        NOT:     { id: { in: [...syncedKeys].map(k => {
          const [d, c] = k.split("|");
          return `shopify_${store}_${d}_${c}`;
        })}},
      },
      select: { id: true, date: true, countryId: true },
    });
    const syncDateRange = Array.from(syncedKeys).map(k => k.split("|")[0]);
    const minSyncDate = syncDateRange.sort()[0];
    const staleToDelete = oldShopifyRows.filter(r =>
      r.date.toISOString().slice(0, 10) >= (minSyncDate ?? "")
    );
    if (staleToDelete.length > 0) {
      await prisma.dailyMetric.deleteMany({
        where: { id: { in: staleToDelete.map(r => r.id) } },
      });
    }

    // Log the sync in Import table
    await prisma.import.create({
      data: {
        type: "shopify",
        filename: `${cfg.shop} — ${days}d`,
        status: errors.length === 0 ? "success" : "partial",
        totalRows: Object.keys(byKey).length,
        importedRows: synced,
        errorRows: errors.length,
        errors: errors.length > 0 ? errors.slice(0, 10).join("\n") : null,
      },
    });

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

    // ── Override estimated fees with REAL Shopify Balance Transaction fees ──
    // Uses processed_at per transaction (= order date), NOT payout date.
    // Fees distributed proportionally between US/MX rows by gross revenue.
    let paymentsResult: any = null;
    try {
      const pr = await fetch(`${base}/api/shopify/payments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ store, days }),
      });
      paymentsResult = await pr.json().catch(() => null);
    } catch { /* non-critical — estimated fees remain if this fails */ }

    // ── Auto: rollup Meta Ads adSpend → DailyMetric ──
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await fetch(`${base}/api/meta-ads/rollup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: since, to: new Date().toISOString().slice(0, 10) }),
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      store: cfg.shop,
      ordersTotal: orders.length,
      refundOrdersTotal: refundOrders.length,
      daysSynced: synced,
      days,
      mxnRateUsed: liveMxnRate,
      historicalRateDays: rateCount,
      paymentsSync: paymentsResult ? { daysUpdated: paymentsResult.daysUpdated } : null,
      errors: errors.slice(0, 5),
      staleDeleted: staleToDelete.length,
      preview: Object.entries(byKey)
        .slice(0, 5)
        .map(([key, m]) => ({
          key,
          country: m.countryId,
          orders: m.ordersCount,
          gross: m.grossRevenue.toFixed(2),
          discounts: m.discounts.toFixed(2),
          returns: m.returns.toFixed(2),
          fees: m.fees.toFixed(2),
        })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── GET — sync status ────────────────────────────────────────────────────────
export async function GET() {
  const imports = await prisma.import.findMany({
    where: { type: "shopify" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const lastMetrics = await prisma.dailyMetric.findMany({
    where: { id: { startsWith: "shopify_" } },
    orderBy: { date: "desc" },
    take: 5,
    include: { brand: true, country: true },
  });

  return NextResponse.json({
    lastSync: imports[0] ?? null,
    history: imports,
    recentMetrics: lastMetrics.map((m) => ({
      date: m.date,
      brand: m.brand.name,
      country: m.country.name,
      orders: m.ordersCount,
      revenue: m.grossRevenue,
    })),
  });
}
