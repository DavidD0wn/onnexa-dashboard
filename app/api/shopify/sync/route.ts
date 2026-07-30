import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchShopifyPaginated,
  getShopifyStore,
  shopifyRestUrl,
  type ShopifyStoreConfig,
} from "@/lib/integrations/shopify";
import { calculateProfit } from "@/lib/metrics";

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

// Country code → DB IDs (used when splitByCountry=true)
const COUNTRY_ID_MAP: Record<string, string> = {
  US: "country_us",
  MX: "country_mx",
  CL: "country_cl",
};

type StoreConfig = ShopifyStoreConfig & { shopCurrencyRate: number };

function locationFor(
  cfg: StoreConfig,
  rawCountryCode: string,
): { countryId: string; storeId: string; countryCode: string } {
  const countryCode = COUNTRY_ID_MAP[rawCountryCode] ? rawCountryCode : "MX";
  return {
    countryCode,
    countryId: COUNTRY_ID_MAP[countryCode],
    storeId: `store_${cfg.key}_${countryCode.toLowerCase()}`,
  };
}

// ─── Fetch paid orders (revenue) ─────────────────────────────────────────────
async function fetchOrders(
  store: StoreConfig,
  since: string,
  until?: string,
): Promise<any[]> {
  return fetchShopifyPaginated(
    store,
    shopifyRestUrl(store, "orders.json") +
    `?status=any&financial_status=paid,partially_paid,partially_refunded,refunded` +
    `&created_at_min=${encodeURIComponent(since)}` +
    (until ? `&created_at_max=${encodeURIComponent(until)}` : "") +
    `&limit=250` +
    // line_items para contar unidades físicas reales (qty × bundle_size)
    `&fields=id,created_at,total_price,total_discounts,total_tax,shipping_lines,shipping_address,line_items`,
    "orders",
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
async function fetchRefunds(
  store: StoreConfig,
  since: string,
  until?: string,
): Promise<any[]> {
  return fetchShopifyPaginated(
    store,
    shopifyRestUrl(store, "orders.json") +
    `?status=any&financial_status=refunded,partially_refunded` +
    `&updated_at_min=${encodeURIComponent(since)}` +
    (until ? `&updated_at_max=${encodeURIComponent(until)}` : "") +
    `&limit=250` +
    `&fields=id,created_at,updated_at,refunds`,
    "orders",
  );
}

/**
 * Extracts the LOCAL date string (YYYY-MM-DD) from a Shopify `created_at` timestamp.
 *
 * Shopify REST API returns timestamps in TWO formats:
 *   - Local timezone: "2026-05-19T23:30:00-05:00"  → date part IS already local, use it directly.
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
  return (
    flatCosts[`${base} x1`] ?? flatCosts[`${nBase} x1`] ??
    flatCosts[`${title} x1`] ?? flatCosts[`${nTitle} x1`] ??
    flatCosts[title] ?? flatCosts[base] ?? flatCosts[nTitle] ?? flatCosts[nBase] ?? 0
  );
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
        ? locationFor(cfg, countryCode)
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
  const STORE_OFFSET_MS = (cfg.storeUtcOffset ?? -5) * 60 * 60 * 1000;

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
  const {
    store = "glowmmi",
    days = 30,
    from: requestedFrom,
    to: requestedTo,
  } = body as {
    store?: string;
    days?: number;
    from?: string;
    to?: string;
  };
  const isExplicitRange = Boolean(requestedFrom && requestedTo);

  let baseCfg: ShopifyStoreConfig;
  try {
    baseCfg = getShopifyStore(store);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  // ── Exchange rates: fetch live rate (fallback) + historical per-day rates ────
  // We start with the live rate as safety net, then try to get per-day history.
  // Both run in parallel so historical fetch doesn't slow down the sync.
  const nowMxMs = Date.now() - 5 * 60 * 60 * 1000;
  const todayMx = new Date(nowMxMs).toISOString().slice(0, 10);
  const defaultFrom = new Date(
    nowMxMs - (Math.max(1, days) - 1) * 86_400_000,
  ).toISOString().slice(0, 10);
  const dateFrom = requestedFrom ?? defaultFrom;
  const dateTo = requestedTo ?? todayMx;
  const rangeFrom = new Date(dateFrom + "T00:00:00Z");
  const rangeTo = new Date(dateTo + "T23:59:59Z");
  if (
    Number.isNaN(rangeFrom.getTime()) ||
    Number.isNaN(rangeTo.getTime()) ||
    rangeFrom > rangeTo
  ) {
    return NextResponse.json(
      { error: "Rango de fechas inválido" },
      { status: 400 },
    );
  }

  const [liveMxnRate, dailyRates] = await Promise.all([
    fetchLiveMxnRate(),
    fetchHistoricalRates(dateFrom, dateTo),
  ]);

  // Stamp today's live rate into dailyRates for any orders placed today
  if (!dailyRates[dateTo]) dailyRates[dateTo] = liveMxnRate;

  const cfg: StoreConfig = { ...baseCfg, shopCurrencyRate: liveMxnRate };
  const rateCount = Object.keys(dailyRates).length;
  console.log(`[sync:${store}] Exchange rates: live=${liveMxnRate} | historical=${rateCount} days loaded`);

  try {
    const since = `${dateFrom}T00:00:00-05:00`;
    const until = `${dateTo}T23:59:59-05:00`;
    const [orders, refundOrders, costsByCountry] = await Promise.all([
      fetchOrders(cfg, since, until),
      fetchRefunds(cfg, since, until),
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

        // ── Upsert defensivo ──────────────────────────────────────────────
        // Si ya hay datos en BD para esta (fecha+país) Y el sync nuevo trae
        // significativamente menos órdenes (>50% bajada), saltar el upsert.
        // Es señal de fetch parcial (rate limit, timezone, etc.) — preferimos
        // dejar los datos viejos antes que degradarlos. Las cancelaciones reales
        // suben máximo unas pocas órdenes al día.
        const prevShopifyRow = await prisma.dailyMetric.findUnique({
          where: { id: shopifyId },
        });
        if (!isExplicitRange && prevShopifyRow && prevShopifyRow.ordersCount > 0) {
          const dropRatio = 1 - (metrics.ordersCount / prevShopifyRow.ordersCount);
          if (dropRatio > 0.5) {
            console.warn(`[sync:${store}] SKIP defensivo ${bucketKey}: nuevo=${metrics.ordersCount} ord vs existente=${prevShopifyRow.ordersCount} (bajada ${(dropRatio*100).toFixed(0)}%)`);
            synced++;
            continue;
          }
        }

        const currentMetric = existing ?? prevShopifyRow;
        const profit = calculateProfit({
          netRevenue,
          cogs: metrics.cogs,
          shippingCost: metrics.shippingCharged,
          fees: metrics.fees,
          handlingFees: currentMetric?.handlingFees ?? 0,
          taxes: metrics.taxes,
          otherCosts: currentMetric?.otherCosts ?? 0,
          adSpend: currentMetric?.adSpend ?? 0,
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
          netProfit:     profit.netProfit,
          netMargin:     profit.netMargin,
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

    // Con un rango explícito y una descarga completa, cualquier bucket
    // shopify_* ausente es realmente obsoleto. Se elimina para que cancelaciones,
    // cambios de país y días sin ventas no dejen cifras fantasma.
    let staleToDelete: { id: string }[] = [];
    if (isExplicitRange && errors.length === 0) {
      const candidates = await prisma.dailyMetric.findMany({
        where: {
          brandId: cfg.brandId,
          id: { startsWith: `shopify_${store}_` },
          date: { gte: rangeFrom, lte: rangeTo },
        },
        select: { id: true, date: true, countryId: true },
      });
      staleToDelete = candidates.filter((row) => {
        const key = `${row.date.toISOString().slice(0, 10)}|${row.countryId}`;
        return !syncedKeys.has(key);
      });
      if (staleToDelete.length > 0) {
        await prisma.dailyMetric.deleteMany({
          where: { id: { in: staleToDelete.map((row) => row.id) } },
        });
      }
    }

    // Log the sync in Import table
    await prisma.import.create({
      data: {
        type: "shopify",
        filename: `${cfg.shop} — ${dateFrom} a ${dateTo}`,
        status: errors.length === 0 ? "success" : "partial",
        totalRows: Object.keys(byKey).length,
        importedRows: synced,
        errorRows: errors.length,
        errors: errors.length > 0 ? errors.slice(0, 10).join("\n") : null,
      },
    });

    const base = process.env.NEXT_PUBLIC_BASE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    // ── Override estimated fees with REAL Shopify Balance Transaction fees ──
    // Uses processed_at per transaction (= order date), NOT payout date.
    // Fees distributed proportionally between US/MX rows by gross revenue.
    let paymentsResult: any = null;
    try {
      const pr = await fetch(`${base}/api/shopify/payments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ store, days, from: dateFrom, to: dateTo }),
      });
      paymentsResult = await pr.json().catch(() => null);
    } catch { /* non-critical — estimated fees remain if this fails */ }

    // ── Auto: rollup Meta Ads adSpend → DailyMetric ──
    try {
      await fetch(`${base}/api/meta-ads/rollup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateFrom, to: dateTo }),
      });
    } catch { /* non-critical */ }

    return NextResponse.json({
      store: cfg.shop,
      ordersTotal: orders.length,
      refundOrdersTotal: refundOrders.length,
      synced,
      daysSynced: synced,
      days,
      from: dateFrom,
      to: dateTo,
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
