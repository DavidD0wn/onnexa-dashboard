import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

const FALLBACK_RATE = 17.30;  // Updated May 2026 — keep in sync with sync/route.ts

async function fetchLiveMxnRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return FALLBACK_RATE;
    const data = await res.json();
    const mxn = data?.rates?.MXN;
    return typeof mxn === "number" && mxn > 10 ? Math.round(mxn * 100) / 100 : FALLBACK_RATE;
  } catch {
    return FALLBACK_RATE;
  }
}

/**
 * Fetch daily MXN/USD rates from Frankfurter.app for a date range.
 * Returns { "YYYY-MM-DD": rate } — weekends/holidays carry the last known rate.
 * Same logic as in sync/route.ts so product analytics uses the same rates as the dashboard.
 */
function fillRateGaps(rates: Record<string, number>, from: string, to: string): Record<string, number> {
  const filled: Record<string, number> = {};
  let last = FALLBACK_RATE;
  let cursor = new Date(from + "T12:00:00Z");
  const end   = new Date(to   + "T12:00:00Z");
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    if (rates[d] !== undefined) last = rates[d];
    filled[d] = last;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return filled;
}

async function fetchHistoricalRates(from: string, to: string): Promise<Record<string, number>> {
  try {
    const url = `https://api.frankfurter.app/${from}..${to}?from=USD&to=MXN`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const rates: Record<string, number> = {};
      for (const [date, day] of Object.entries(data?.rates ?? {} as Record<string, any>)) {
        const mxn = (day as any)?.MXN;
        if (typeof mxn === "number" && mxn > 10) rates[date] = Math.round(mxn * 100) / 100;
      }
      if (Object.keys(rates).length > 0) return fillRateGaps(rates, from, to);
    }
  } catch { /* fall through */ }
  return {}; // callers use FALLBACK_RATE
}

const STORES = {
  glowmmi: {
    shop:         "glm-1694.myshopify.com",
    clientId:     "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    brandId:      "brand_glowmmi",
    brandName:    "Glowmmi",
    color:        "#EC4899",
    currency:     "MXN",
    exchangeRate: FALLBACK_RATE,  // overridden with live rate at request time
  },
  balancea: {
    shop:         "mp0vab-bw.myshopify.com",
    clientId:     "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    brandId:      "brand_balancea",
    brandName:    "Balancea",
    color:        "#10B981",
    currency:     "MXN",
    exchangeRate: FALLBACK_RATE,  // overridden with live rate at request time
  },
};

/**
 * Campaign product-code → normalized product name keywords.
 * Ensures campaign names like "INS01 - CBO mx" match product rows like "InstantLift™".
 * Keys must be lowercase (extractAdKeywords lowercases everything).
 */
const CAMPAIGN_CODE_KEYWORDS: Record<string, string[]> = {
  // Glowmmi
  "tp01":  ["jiyu", "toner", "pads"],
  "gf01":  ["glowfill", "glow fill"],
  "ins01": ["instantlift", "instant lift"],
  "dp01":  ["deep collagen", "collagen"],
  "re01":  ["retinal", "retinal shot"],
  "rv01":  ["revivelift", "revive lift"],
  // HB01 covers two brands:
  //   • Glowmmi  → "Mascarilla coreana para puntos negros" (keyword: "mascarilla")
  //   • Balancea → Holy Basil suplemento (keyword: "holy basil")
  // brandId filter in the loop ensures cross-brand isolation.
  // Removed "holy", "coreana", "korean mask" — too broad, caused false matches
  // with "Korean Toner Pads" and "Agenda Glow Coreana".
  "hb01":  ["holy basil", "mascarilla coreana", "mascarilla"],
  "hr01":  ["herbiotic"],
  "st01":  ["clearstem"],
  "ct01":  ["cutting"],
  "fx01":  ["curva"],
  "ino01": ["fertil"],
  "db01":  ["airi"],
};

/**
 * Manual aliases: when the Shopify product name in orders differs from the URL handle.
 * Key = lowercase keyword from product name (partial match OK)
 * Value = funnelMap handle key (after hyphen→space conversion)
 * Format: { brandId: { productNameKeyword: funnelMapKey } }
 */
const FUNNEL_ALIASES: Record<string, Record<string, string>> = {
  brand_glowmmi: {
    "mascarilla coreana":           "holy basil mask",   // URL: /products/holy-basil-mask
    "toner pads":                   "kr toner pads",     // URL: /products/kr-toner-pads
    "jiyu toner pads":              "kr toner pads",     // same URL
    "jiyu korean toner pads":       "kr toner pads",
    "revive eye":                   "crema de ojos",     // URL: /products/crema-de-ojos (if exists)
  },
  brand_balancea: {},
};

/** Configuración por país: gateway, flete, moneda, tasa de display local */
const COUNTRY_CFG: Record<string, {
  name: string; currency: string;
  gatewayPct: number; gatewayFixed: number;
  shipping: number; displayRate: number;
}> = {
  // gatewayPct: Shopify Payments real average ~2.9% (US domestic) to ~3.5% (international).
  // Using 2.9% + $0.30 as the baseline — close to actual balance transaction data.
  MX: { name: "México",  currency: "MXN", gatewayPct: 0.029, gatewayFixed: 0.30, shipping: 5.00, displayRate: 17.30 },
  US: { name: "EE.UU.",  currency: "USD", gatewayPct: 0.029, gatewayFixed: 0.30, shipping: 8.00, displayRate: 1.0   },
  CL: { name: "Chile",   currency: "CLP", gatewayPct: 0.029, gatewayFixed: 0.30, shipping: 6.00, displayRate: 900   },
};

async function getToken(store: typeof STORES["glowmmi"]) {
  const isBalancea = store.shop.includes("mp0vab");
  const body = isBalancea
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret }).toString()
    : JSON.stringify({ client_id: store.clientId, client_secret: store.clientSecret, grant_type: "client_credentials" });
  const res = await fetch(`https://${store.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": isBalancea ? "application/x-www-form-urlencoded" : "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Auth error ${store.shop}`);
  return (await res.json()).access_token as string;
}

function bundleSize(name: string, variant: string): number {
  const vm = variant.match(/\bx(\d+)\b/i) ?? variant.match(/^(\d+)\s*(unidades?|pcs?|units?)?$/i);
  if (vm) return Math.max(1, parseInt(vm[1]));
  const nm = name.match(/\bx(\d+)\b/i);
  if (nm) return Math.max(1, parseInt(nm[1]));
  return 1;
}

function isSkippableItem(item: any): boolean {
  const price = parseFloat(item.price ?? "0");
  const name  = (item.title ?? "").toLowerCase();
  // Skip $0 items (free add-ons, complimentary gifts, etc.)
  if (price <= 0) return true;
  // Skip items that are explicitly free/bonus/non-product even if priced nominally
  if (
    name.includes("gratis")               || name.includes("free")               ||
    name.includes("regalo")               || name.includes("gift")               ||
    name.includes("bonus")                ||
    name.includes("protección de pedido") || name.includes("proteccion de pedido")
  ) return true;
  // Allow all other items (including paid digital products, supplements, etc.)
  return false;
}

function extractAdKeywords(row: { campaignName?: string | null; adsetName?: string | null; adName?: string | null }): string[] {
  const text = [row.campaignName, row.adsetName, row.adName]
    .filter(Boolean).join(" ").toLowerCase().replace(/[-_|]/g, " ");
  const stopWords = new Set(["the", "and", "for", "con", "para", "del", "de", "la", "el", "en", "un", "una", "ads", "meta", "retargeting", "ret", "prosp", "prospecting", "lookalike", "lal", "cold", "warm", "hot", "v1", "v2", "v3", "v4", "top", "bot", "mid", "mof", "tof", "bof"]);
  return text.split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
}

// ─── Shopify ShopifyQL — funnel por producto ────────────────────────────────
// Uses shopifyqlQuery (not analyticsReport) — available without Shopify Plus.
// Rows are returned as objects with named keys.
type FunnelRow = { sessions: number; addToCart: number; reachedCheckout: number; conversionRate: number };

async function fetchFunnelData(
  shop: string, token: string, since: string, until: string
): Promise<Record<string, FunnelRow>> {
  const sinceDate = since.slice(0, 10);
  const untilDate = until.slice(0, 10);

  const ql = `FROM sessions
SHOW landing_page_path, sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout, conversion_rate
WHERE human_or_bot_session IN ('human', 'bot')
GROUP BY landing_page_path
SINCE ${sinceDate} UNTIL ${untilDate}
ORDER BY sessions DESC
LIMIT 500`;

  try {
    const res = await fetch(`https://${shop}/admin/api/unstable/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) { parseErrors tableData { columns { name } rows } } }`,
      }),
    });
    if (!res.ok) {
      console.warn(`[funnel] ${shop} HTTP ${res.status}`);
      return {};
    }
    const json = await res.json();
    if (json?.errors) {
      console.warn(`[funnel] ${shop} GQL errors:`, JSON.stringify(json.errors).slice(0, 200));
      return {};
    }
    const result = json?.data?.shopifyqlQuery;
    // parseErrors can be [] (empty array = no errors) or a string — only bail if it actually has content
    const pe = result?.parseErrors;
    const hasParseErrors = Array.isArray(pe) ? pe.length > 0
      : typeof pe === "string" ? (pe.trim() !== "" && pe.trim() !== "[]" && pe.trim() !== "null")
      : !!pe;
    if (hasParseErrors) {
      console.warn(`[funnel] ${shop} parse errors:`, pe);
      return {};
    }
    const rawRows = result?.tableData?.rows;
    if (!rawRows) {
      console.log(`[funnel] ${shop} — sin datos`);
      return {};
    }

    // rows is a JSON scalar — parse if string, use directly if already object
    const rows: Record<string, string>[] = typeof rawRows === "string" ? JSON.parse(rawRows) : rawRows;

    const out: Record<string, FunnelRow> = {};
    for (const row of rows) {
      const path = decodeURIComponent(String(row.landing_page_path ?? ""));
      if (!path.startsWith("/products/")) continue;
      // /products/deep-collagen → "deep collagen"
      const handle = path.replace("/products/", "").split("?")[0].split("/")[0]
        .replace(/-/g, " ").toLowerCase().trim();
      if (!handle) continue;
      const sessions  = parseFloat(row.sessions  ?? "0") || 0;
      const atc       = parseFloat(row.sessions_with_cart_additions    ?? "0") || 0;
      const chk       = parseFloat(row.sessions_that_reached_checkout  ?? "0") || 0;
      const comp      = parseFloat(row.sessions_that_completed_checkout ?? "0") || 0;
      // Merge handles pointing to same product (e.g. with/without trailing slash)
      if (!out[handle] || sessions > out[handle].sessions) {
        out[handle] = {
          sessions,
          addToCart:       atc,
          reachedCheckout: chk,
          conversionRate:  sessions > 0 ? (comp / sessions) * 100 : 0,
        };
      }
    }
    console.log(`[funnel] ${shop} → ${Object.keys(out).length} productos con sesiones`);
    return out;
  } catch (e: any) {
    console.warn(`[funnel] ${shop} error:`, e?.message);
    return {};
  }
}

async function fetchOrders(shop: string, token: string, since: string, until: string) {
  const seen = new Set<string>();
  const all: any[] = [];

  let url: string | null =
    `https://${shop}/admin/api/2024-01/orders.json` +
    `?status=any&financial_status=paid,partially_paid,partially_refunded` +
    `&created_at_min=${since}&created_at_max=${until}&limit=250` +
    `&fields=id,created_at,line_items,shipping_address,shipping_lines`;
  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data = await res.json();
    for (const o of (data.orders ?? [])) {
      if (!seen.has(String(o.id))) { seen.add(String(o.id)); all.push(o); }
    }
    const next = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

/**
 * Fetch specific orders by ID (used to pull in orders that were CHARGED in the
 * period but created earlier — Shopify Analytics attributes these to the charge date).
 */
async function fetchOrdersByIds(shop: string, token: string, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return [];
  const out: any[] = [];
  // Shopify allows comma-separated id filter; chunk to stay under URL limits
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join(",");
    const url =
      `https://${shop}/admin/api/2024-01/orders.json` +
      `?status=any&ids=${chunk}&limit=250` +
      `&fields=id,created_at,line_items,shipping_address,shipping_lines,total_price`;
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) continue;
    const data = await res.json();
    out.push(...(data.orders ?? []));
  }
  return out;
}

/**
 * Fetch Shopify Payments balance transactions for the period.
 * Returns a map of orderId → USD settlement amount.
 * This is the exact amount Shopify collected in USD — no market-rate conversion needed.
 */
async function fetchOrderUsdAmounts(
  shop: string, token: string, sinceDate: string, untilDate: string
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  let url: string | null =
    `https://${shop}/admin/api/2024-01/shopify_payments/balance/transactions.json?limit=250`;

  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data = await res.json();
    const txs: any[] = data.transactions ?? data.balance_transactions ?? [];

    let pastRange = false;
    for (const tx of txs) {
      const date = (tx.processed_at as string)?.slice(0, 10) ?? "";
      if (date < sinceDate) { pastRange = true; break; }
      if (date > untilDate) continue;
      if (tx.type !== "charge") continue;
      const orderId = String(tx.source_order_id ?? "");
      if (!orderId) continue;
      map[orderId] = (map[orderId] ?? 0) + parseFloat(tx.amount ?? "0");
    }
    if (pastRange) break;
    const next = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return map;
}

type CostsByCountry = { mx: Record<string, number>; us: Record<string, number>; cl: Record<string, number> };

function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim();
}

function loadCosts(): CostsByCountry {
  const p = path.join(process.cwd(), "data", "product-costs.json");
  const parseCountry = (obj: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "number") {
          out[k] = v;
          const nk = normalizeName(k);
          if (!(nk in out)) out[nk] = v;
        }
      }
    }
    return out;
  };
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
      if (raw.mx && typeof raw.mx === "object") {
        return { mx: parseCountry(raw.mx), us: parseCountry(raw.us ?? raw.mx), cl: parseCountry(raw.cl ?? raw.mx) };
      }
      const flat: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("_") && typeof v === "number") flat[k] = v;
      }
      const flatNorm = parseCountry(flat);
      return { mx: flatNorm, us: { ...flatNorm }, cl: { ...flatNorm } };
    }
  } catch {}
  return { mx: {}, us: {}, cl: {} };
}

async function loadCostsFromDb(): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  try {
    const products = await prisma.product.findMany({ select: { name: true, supplierCostUsd: true } });
    for (const p of products) {
      if (p.supplierCostUsd && p.supplierCostUsd > 0) {
        map[p.name] = p.supplierCostUsd;
        map[normalizeName(p.name)] = p.supplierCostUsd;
      }
    }
    const escalones = await (prisma as any).supplierEscalon?.findMany({ orderBy: { units: "asc" } }) ?? [];
    for (const e of escalones) {
      const cost = e.costUs ?? e.costMx ?? e.costCl ?? 0;
      if (cost > 0 && !map[e.productName]) {
        map[e.productName] = cost;
        map[normalizeName(e.productName)] = cost;
      }
    }
    // Also load from ProductCogsByCountry table (per-country cost entries)
    const cogsByCountry = await (prisma as any).productCogsByCountry?.findMany({
      where: { isActive: true },
      select: { productBaseName: true, productCostUnitUsd: true, countryCode: true },
      orderBy: { updatedAt: "desc" },
    }) ?? [];
    for (const c of cogsByCountry) {
      if (c.productCostUnitUsd > 0) {
        const key  = c.productBaseName;
        const norm = normalizeName(key);
        // Prefer MX cost as default; don't overwrite if already set from higher-priority source
        if (!map[key])  map[key]  = c.productCostUnitUsd;
        if (!map[norm]) map[norm] = c.productCostUnitUsd;
      }
    }
  } catch {}
  return map;
}

function extractBase(name: string): string {
  return name.split(/\s*[|—–]\s*/)[0].replace(/[™®]/g, "").trim();
}

function lookupCost(name: string, countryCosts: Record<string, number>, dbCosts: Record<string, number>, variant?: string): number {
  const base        = extractBase(name);
  const normName    = normalizeName(name);
  const normBase    = normalizeName(base);
  const normVariant = variant ? normalizeName(variant) : "";
  if (variant) {
    return (
      countryCosts[`${base} ${variant}`]       ?? countryCosts[`${normBase} ${normVariant}`] ??
      countryCosts[`${name} ${variant}`]        ?? countryCosts[`${name} — ${variant}`]       ??
      countryCosts[`${name} - ${variant}`]      ?? countryCosts[`${normName} ${normVariant}`]  ??
      countryCosts[name]  ?? countryCosts[base]  ?? countryCosts[normName] ?? countryCosts[normBase] ??
      dbCosts[name]       ?? dbCosts[normName]   ?? 0
    );
  }
  return (
    countryCosts[name]  ?? countryCosts[base]  ?? countryCosts[normName] ?? countryCosts[normBase] ??
    dbCosts[name]       ?? dbCosts[normName]   ?? 0
  );
}

// ─── Status + Data Quality ─────────────────────────────────────────────────────
function calcStatus(
  netProfit: number, netMargin: number, cogsUsd: number,
  adSpendUsd: number, _cpa: number | null, _cpaBE: number | null,
  isDigital: boolean,
): string {
  if (isDigital)                   return "Digital 100%";   // ebooks/upsells: pure margin
  if (cogsUsd === 0)               return "Datos incompletos";
  if (adSpendUsd === 0)            return "Sin pauta";
  if (netMargin >= 25 && netProfit > 0) return "Escalable";
  if (netProfit > 0)               return "Rentable";
  if (netMargin > -10)             return "Rentable justo"; // within 10% loss
  return "No rentable";
}

function calcDataQuality(cogsUsd: number, adSpendUsd: number, isDigital: boolean): string {
  if (isDigital)          return "OK";                // ebooks: no COGS expected
  if (cogsUsd === 0)      return "Falta COGS";
  if (adSpendUsd === 0)   return "Sin pauta registrada";
  return "OK";
}

// ─── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeKey      = searchParams.get("store") ?? "all";
  const countryParam  = (searchParams.get("country") ?? "all").toUpperCase();

  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  let since: string, until: string, dateFrom: Date, dateTo: Date;

  if (fromParam && toParam) {
    // Custom date range
    since    = `${fromParam}T00:00:00-06:00`;
    until    = `${toParam}T23:59:59-06:00`;
    // AdSpend rows are stored as UTC midnight — use UTC boundaries so first/last day aren't skipped
    dateFrom = new Date(fromParam + "T00:00:00Z");
    dateTo   = new Date(toParam   + "T23:59:59Z");
  } else {
    const days = parseInt(searchParams.get("days") ?? "7");
    // Fix: use Mexico time (UTC-6) to determine today's date — NOT UTC.
    // Without this, after 6 PM Mexico time the UTC date flips to tomorrow,
    // so "Hoy" queries a future date and returns 0 orders.
    const MX_OFFSET_MS = 6 * 60 * 60 * 1000; // 6 hours in ms
    const nowMxMs      = Date.now() - MX_OFFSET_MS;
    const todayMx      = new Date(nowMxMs).toISOString().slice(0, 10);
    const startMx      = new Date(nowMxMs - (days - 1) * 86400000).toISOString().slice(0, 10);
    since    = `${startMx}T00:00:00-06:00`;
    until    = `${todayMx}T23:59:59-06:00`;
    // AdSpend rows are stored as UTC midnight — use UTC boundaries so first day isn't skipped
    // (using -06:00 offset would make dateFrom = startMxT06:00Z, excluding the midnight UTC row)
    dateFrom = new Date(startMx + "T00:00:00Z");
    dateTo   = new Date(todayMx + "T23:59:59Z");
  }

  const targetStores = storeKey === "all"
    ? Object.entries(STORES)
    : Object.entries(STORES).filter(([k]) => k === storeKey);

  // Use live MXN/USD rate so product revenue matches the dashboard sync
  const liveMxnRate = await fetchLiveMxnRate();
  for (const [, store] of targetStores) {
    if (store.currency === "MXN") store.exchangeRate = liveMxnRate;
  }

  const costs   = loadCosts();
  const costsDb = await loadCostsFromDb();

  // ── Historical MXN/USD rates — one per day so each order uses the rate from its own date ──
  // This matches how the dashboard sync route works and eliminates discrepancies caused by
  // using today's live rate for all historical orders.
  const fromDateStr = fromParam ?? (since.slice(0, 10));
  const toDateStr   = toParam   ?? (until.slice(0, 10));
  const historicalRates = await fetchHistoricalRates(fromDateStr, toDateStr);

  // Load country id → code mapping for ad spend
  let codeById: Record<string, string> = {};
  try {
    const dbCountries = await prisma.country.findMany({ select: { id: true, code: true } });
    for (const c of dbCountries) codeById[c.id] = c.code.toUpperCase();
  } catch {}

  // funnel data per store (fetched in parallel with orders)
  const funnelByStore: Record<string, Record<string, FunnelRow>> = {};

  const products: Record<string, {
    name: string; variant: string;
    brandId: string; brandName: string; brandColor: string;
    storeKey: string; storeName: string;
    countryCode: string; countryName: string;
    revenueUsd: number; revenueLocal: number;
    units: number; orders: number; lastSeen: string;
    cogsUsd: number;
  }> = {};

  // Revenue per brand+country for proportional ad spend distribution
  const brandCountryRevenue: Record<string, number> = {};
  // Unique order IDs per brand+country — used to allocate order-level costs proportionally
  const brandCountryOrderIds: Record<string, Set<string>> = {};
  // Per-product, per brand+country+day revenue — used to calibrate fees/shipping/returns
  // from DailyMetric so totals match the dashboard exactly.
  // Key: productKey → { "brandId||YYYY-MM-DD||countryCode": revenueUsd }
  const productDayRevenue: Record<string, Record<string, number>> = {};

  for (const [, store] of targetStores) {
    try {
      const token  = await getToken(store);
      const [ordersCreated, funnel, orderUsdMap] = await Promise.all([
        fetchOrders(store.shop, token, since, until),
        fetchFunnelData(store.shop, token, since, until),
        // Actual USD settlement amounts from Balance Transactions (charges in the period).
        // Used both to fix the exchange rate AND to find orders charged-today-created-earlier.
        fetchOrderUsdAmounts(store.shop, token, fromDateStr, toDateStr),
      ]);
      funnelByStore[store.brandId] = funnel;

      // Shopify Analytics attributes revenue to the CHARGE date. Some orders were
      // created before the period but charged within it — pull those in by ID so
      // our totals match Shopify (no missing/extra orders).
      const createdIds = new Set(ordersCreated.map((o: any) => String(o.id)));
      const chargedButMissing = Object.keys(orderUsdMap).filter(id => !createdIds.has(id));
      const extraOrders = await fetchOrdersByIds(store.shop, token, chargedButMissing);
      const orders = [...ordersCreated, ...extraOrders];

      for (const order of orders) {
        const rawCC = ((order.shipping_address?.country_code ?? "MX") as string).toUpperCase();
        const countryCode: string = ["US", "CL"].includes(rawCC) ? rawCC : "MX";

        // Apply country filter
        if (countryParam !== "ALL" && countryCode !== countryParam) continue;

        const countryKey   = countryCode.toLowerCase() as "mx" | "us" | "cl";
        const countryCosts = costs[countryKey];
        const cCfg         = COUNTRY_CFG[countryCode] ?? COUNTRY_CFG.MX;
        const storeName    = `${store.brandName} ${cCfg.name}`;
        const storeKeyStr  = `${store.brandId}_${countryCode}`;

        // Use the per-day historical rate for this order's date (fallback only)
        const orderDate  = order.created_at?.slice(0, 10) ?? toDateStr;
        const orderRate  = store.currency === "MXN"
          ? (historicalRates[orderDate] ?? store.exchangeRate)
          : 1;

        // USD settlement amount from Shopify Balance Transactions.
        // This is the EXACT amount Shopify collected — no exchange rate error.
        // Falls back to MXN total_price / market rate if not in balance txs.
        const orderTotalMxn   = parseFloat(order.total_price ?? "0");
        const orderSettledUsd = orderUsdMap[String(order.id)];
        // If we have the settlement amount, compute an order-level rate for proportional distribution
        const orderEffectiveRate = orderSettledUsd && orderTotalMxn > 0
          ? orderTotalMxn / orderSettledUsd
          : orderRate;

        // Real shipping charged to customer for this order (converted to USD)
        const orderShippingUsd = (order.shipping_lines ?? []).reduce(
          (s: number, l: any) => s + (parseFloat(l.price ?? "0") || 0), 0
        ) / orderEffectiveRate;

        for (const item of (order.line_items ?? [])) {
          if (isSkippableItem(item)) continue;

          const name    = item.title ?? "Producto sin nombre";
          const variant = (item.variant_title && item.variant_title !== "Default Title") ? item.variant_title : "";
          // Key now includes country so each product×country is a separate row
          const key     = `${name}||${variant}||${store.brandId}||${countryCode}`;
          const qty     = parseInt(item.quantity) || 1;
          const bSize   = bundleSize(name, variant);
          const physicalUnits = qty * bSize;
          // item.price is unit price BEFORE line-item discounts; subtract discount_allocations
          const totalDiscount = (item.discount_allocations as Array<{ amount: string }> ?? [])
            .reduce((sum, d) => sum + parseFloat(d.amount ?? "0"), 0);
          // Convert using the order's actual USD settlement rate (matches Shopify exactly)
          const priceUsd      = (parseFloat(item.price) * qty - totalDiscount) / orderEffectiveRate;
          const priceLocal    = priceUsd * cCfg.displayRate;
          const date          = orderDate;

          const unitCost    = lookupCost(name, countryCosts, costsDb, variant);
          // Use physicalUnits (qty × bundleSize) so bundles like "x3" cost 3× per order line
          const itemCogsUsd = unitCost * physicalUnits;

          // Unit price (before discount, per single item) in USD — for display in products table
          const unitPriceUsd = parseFloat(item.price) / orderEffectiveRate;

          if (!products[key]) {
            products[key] = {
              name, variant,
              brandId: store.brandId, brandName: store.brandName, brandColor: store.color,
              storeKey: storeKeyStr, storeName,
              countryCode, countryName: cCfg.name,
              revenueUsd: 0, revenueLocal: 0,
              units: 0, orders: 0, lastSeen: date,
              cogsUsd: 0,
              unitPriceUsd: 0,
            };
          }
          products[key].revenueUsd   += priceUsd;
          products[key].revenueLocal += priceLocal;
          products[key].units        += physicalUnits;
          products[key].orders       += 1;          // 1 por pedido, no por cantidad
          products[key].cogsUsd      += itemCogsUsd;
          // Keep the latest unit price seen (most recent order wins)
          if (date >= products[key].lastSeen) products[key].unitPriceUsd = unitPriceUsd;
          if (date > products[key].lastSeen) products[key].lastSeen = date;

          const bck = `${store.brandId}||${countryCode}`;
          brandCountryRevenue[bck] = (brandCountryRevenue[bck] ?? 0) + priceUsd;
          if (!brandCountryOrderIds[bck]) brandCountryOrderIds[bck] = new Set();
          brandCountryOrderIds[bck].add(order.id);

          // Track per-product, per-day revenue for DailyMetric calibration
          const dayKey = `${store.brandId}||${orderDate}||${countryCode}`;
          if (!productDayRevenue[key]) productDayRevenue[key] = {};
          productDayRevenue[key][dayKey] = (productDayRevenue[key][dayKey] ?? 0) + priceUsd;
        }
      }
    } catch (e: any) {
      console.error(`[product-analytics] ${store.shop}:`, e.message);
    }
  }

  // ── DailyMetric calibration — real fees, shipping, returns from the synced DB ──
  // Instead of estimating these costs per product, we read the REAL values from
  // DailyMetric (which has real Shopify Payments fees, actual shipping collected,
  // and actual returns) and distribute them proportionally to products by their
  // revenue share within each brand+country+day.
  // This makes product analytics totals match the dashboard exactly.
  const brandIds = targetStores.map(([, s]) => s.brandId);
  // "brandId||YYYY-MM-DD||countryCode" → { fees, shipping, returns, gross }
  const dailyCalib: Record<string, { fees: number; shipping: number; returns: number; gross: number }> = {};
  // Effective rates per brand+country over the full period.
  // Used instead of per-day shares to avoid the gross-vs-net-revenue mismatch:
  // DailyMetric.grossRevenue = BEFORE discounts, but PA revenueUsd = AFTER discounts.
  // If we use per-day shares (productRevOnDay / cal.gross), the sum < 1 and calibrated
  // fees come out too low. The effective rate approach avoids this by applying a single
  // period-level rate to each product's revenue, so totals match the dashboard.
  // calibTotals: period-level aggregates per "brandId||countryCode"
  // Use netRevenue (already discounted) as the denominator for effective rates,
  // since PA revenueUsd ≈ netRevenue (both post-discount), so applying the rate
  // to PA revenue gives totals that match the dashboard.
  const calibTotals: Record<string, { fees: number; shipping: number; returns: number; taxes: number; netRevenue: number }> = {};
  try {
    const dmRows = await prisma.dailyMetric.findMany({
      where: { brandId: { in: brandIds }, date: { gte: dateFrom, lte: dateTo } },
      select: { date: true, brandId: true, countryId: true, grossRevenue: true, netRevenue: true, fees: true, shippingCost: true, returns: true, taxes: true },
    });
    for (const dm of dmRows) {
      const dateStr  = dm.date.toISOString().slice(0, 10);
      const cc       = codeById[dm.countryId] ?? "MX";
      const dk       = `${dm.brandId}||${dateStr}||${cc}`;
      if (!dailyCalib[dk]) dailyCalib[dk] = { fees: 0, shipping: 0, returns: 0, gross: 0 };
      dailyCalib[dk].fees     += dm.fees        ?? 0;
      dailyCalib[dk].shipping += dm.shippingCost ?? 0;
      dailyCalib[dk].returns  += dm.returns      ?? 0;
      dailyCalib[dk].gross    += dm.grossRevenue ?? 0;

      // Period-level totals — use netRevenue as denominator
      const bck = `${dm.brandId}||${cc}`;
      if (!calibTotals[bck]) calibTotals[bck] = { fees: 0, shipping: 0, returns: 0, taxes: 0, netRevenue: 0 };
      calibTotals[bck].fees       += dm.fees        ?? 0;
      calibTotals[bck].shipping   += dm.shippingCost ?? 0;
      calibTotals[bck].returns    += dm.returns      ?? 0;
      calibTotals[bck].taxes      += dm.taxes        ?? 0;
      calibTotals[bck].netRevenue += dm.netRevenue   ?? 0;
    }
  } catch { /* non-critical — falls back to estimates */ }

  // ── Ad spend — per country when available ──────────────────────────────────
  const adRows   = await prisma.adSpend.findMany({
    where: { brandId: { in: brandIds }, platform: "facebook", date: { gte: dateFrom, lte: dateTo } },
    select: { brandId: true, countryId: true, spend: true, purchases: true, conversionValue: true, campaignName: true, adsetName: true, adName: true },
  });

  const productAdSpend: Record<string, number> = {};
  const productCampaignPurchases: Record<string, number> = {};
  const productCampaignConversionValue: Record<string, number> = {};
  const unmatchedBrandCountrySpend: Record<string, number> = {};

  const productKeys = Object.keys(products);
  // Exclude digital products (cogsUsd === 0) from ad matching.
  // Ebooks and upsells are never the target of paid campaigns — they ride along with
  // the physical product purchase. Matching them causes two bugs:
  //   1. Short words like "glow" in ebook names match "glowfill" campaign keywords
  //      (substring match), stealing spend from the physical GlowFill product.
  //   2. Digital products accumulate ad spend, which makes their profit appear negative
  //      even though they are 100% margin items with zero cost.
  const nameToKey = productKeys
    .filter(k => products[k].cogsUsd > 0)          // physical products only
    .map(k => {
      const p = products[k];
      const norm = normalizeName(p.name);
      const kws  = norm.split(" ").filter((w: string) => w.length >= 4);
      return { keywords: [norm, ...kws], key: k, brandId: p.brandId, countryCode: p.countryCode };
    });

  for (const row of adRows) {
    let adKws = extractAdKeywords(row);
    // If campaign contains a known product code (e.g. "INS01", "TP01"), expand adKws
    // with that product's name keywords so it can match product rows correctly.
    for (const kw of [...adKws]) {
      const resolved = CAMPAIGN_CODE_KEYWORDS[kw];
      if (resolved) { adKws = [...adKws, ...resolved]; break; }
    }
    // Map countryId → code. If no countryId or not found → null (unspecified)
    const cc: string | null = row.countryId ? (codeById[row.countryId] ?? null) : null;
    const bck = `${row.brandId}||${cc ?? "ALL"}`;

    if (cc) {
      // ── Campaign has a specific country → assign to first matching product of that country ──
      let matched = false;
      for (const { keywords, key, brandId, countryCode } of nameToKey) {
        if (brandId !== row.brandId) continue;
        if (countryCode !== cc) continue;
        if (keywords.some(kw => adKws.includes(kw) || adKws.some(ak => ak.includes(kw) || kw.includes(ak)))) {
          productAdSpend[key] = (productAdSpend[key] ?? 0) + row.spend;
          productCampaignPurchases[key] = (productCampaignPurchases[key] ?? 0) + (row.purchases ?? 0);
          productCampaignConversionValue[key] = (productCampaignConversionValue[key] ?? 0) + (row.conversionValue ?? 0);
          matched = true;
          break;
        }
      }
      if (!matched) {
        unmatchedBrandCountrySpend[bck] = (unmatchedBrandCountrySpend[bck] ?? 0) + row.spend;
      }
    } else {
      // ── Campaign has NO country → distribute proportionally by revenue across ALL matching products ──
      // This prevents a single country from arbitrarily absorbing spend for global campaigns.
      const matchingKeys: string[] = [];
      for (const { keywords, key, brandId } of nameToKey) {
        if (brandId !== row.brandId) continue;
        if (keywords.some(kw => adKws.includes(kw) || adKws.some(ak => ak.includes(kw) || kw.includes(ak)))) {
          matchingKeys.push(key);
        }
      }
      if (matchingKeys.length === 0) {
        unmatchedBrandCountrySpend[bck] = (unmatchedBrandCountrySpend[bck] ?? 0) + row.spend;
      } else {
        const totalMatchRevenue = matchingKeys.reduce((s, k) => s + (products[k]?.revenueUsd ?? 0), 0);
        for (const k of matchingKeys) {
          const share = totalMatchRevenue > 0 ? (products[k]?.revenueUsd ?? 0) / totalMatchRevenue : 1 / matchingKeys.length;
          productAdSpend[k] = (productAdSpend[k] ?? 0) + row.spend * share;
          productCampaignPurchases[k] = (productCampaignPurchases[k] ?? 0) + (row.purchases ?? 0) * share;
          productCampaignConversionValue[k] = (productCampaignConversionValue[k] ?? 0) + (row.conversionValue ?? 0) * share;
        }
      }
    }
  }

  // ── Build final rows ────────────────────────────────────────────────────────
  const rows = Object.values(products).map(p => {
    const cogsUsd  = p.cogsUsd;
    const costPerUnit = p.units > 0 ? cogsUsd / p.units : 0;
    const cCfg     = COUNTRY_CFG[p.countryCode] ?? COUNTRY_CFG.MX;

    const key         = `${p.name}||${p.variant}||${p.brandId}||${p.countryCode}`;
    // Digital products (ebooks, upsells): cogsUsd === 0 → 100% margin, zero ad spend.
    // Their sales ride on physical product campaigns — they never have their own ads.
    const isDigital   = cogsUsd === 0;

    // Proportional: unmatched for this brand+country PLUS unmatched with no country
    const bck         = `${p.brandId}||${p.countryCode}`;
    const bckAll      = `${p.brandId}||ALL`;
    const unmatched   = (unmatchedBrandCountrySpend[bck] ?? 0) + (unmatchedBrandCountrySpend[bckAll] ?? 0);
    const bcRevenue   = brandCountryRevenue[bck] ?? 0;
    const revShare    = bcRevenue > 0 ? p.revenueUsd / bcRevenue : 0;
    // Digital products get 0 ad spend — never direct-matched (excluded from nameToKey)
    // and never prorated (they don't drive ad spend).
    const directSpend = isDigital ? 0 : (productAdSpend[key] ?? 0);
    const proratSpend = (!isDigital && p.orders > 1) ? unmatched * revShare : 0;
    const adSpendUsd  = directSpend + proratSpend;

    // ── Calibrate fees, shipping, returns from DailyMetric (effective rate approach) ──
    // Uses period-level effective rates (total_fees / total_gross) per brand+country.
    // This avoids the per-day share mismatch where PA post-discount revenue < DailyMetric
    // pre-discount grossRevenue, which caused calibrated fees to come out too low.
    const ct = calibTotals[bck];
    // Use netRevenue as denominator: PA revenueUsd ≈ netRevenue (both post-discount),
    // so applying the rate to PA revenue gives calibrated totals ≈ dashboard totals.
    const calibHasData = !!(ct && ct.netRevenue > 0);
    const effectiveFeeRate      = calibHasData ? ct!.fees     / ct!.netRevenue : cCfg.gatewayPct;
    const effectiveShippingRate = calibHasData ? ct!.shipping / ct!.netRevenue : 0;
    const effectiveReturnRate   = calibHasData ? ct!.returns  / ct!.netRevenue : 0;
    const effectiveTaxRate      = calibHasData ? ct!.taxes    / ct!.netRevenue : 0;

    const feesUsd    = p.revenueUsd * effectiveFeeRate;
    const shippingUsd = p.revenueUsd * effectiveShippingRate;
    const returnsUsd  = p.revenueUsd * effectiveReturnRate;
    const taxesUsd    = p.revenueUsd * effectiveTaxRate;

    const bcRevShare    = bcRevenue > 0 ? p.revenueUsd / bcRevenue : 0;

    // Net revenue = gross - returns (consistent with dashboard's netRevenue = grossRevenue - discounts - returns)
    // Note: discounts are already subtracted from p.revenueUsd (via discount_allocations)
    const netRevenueUsd = Math.max(0, p.revenueUsd - returnsUsd);

    const aov              = p.orders > 0 ? netRevenueUsd / p.orders : 0;
    const cogsPerOrder     = p.orders > 0 ? cogsUsd / p.orders : 0;
    const gatewayPerOrder  = aov * cCfg.gatewayPct + cCfg.gatewayFixed;
    const cpaBE            = aov > 0 ? Math.max(0, aov - cogsPerOrder - gatewayPerOrder - (feesUsd / Math.max(p.orders,1))) : null;

    const grossProfit  = netRevenueUsd - cogsUsd;
    const grossMargin  = netRevenueUsd > 0 ? (grossProfit / netRevenueUsd) * 100 : 0;
    // netProfit = Net Revenue − COGS − AdSpend − Fees − Shipping − Taxes
    // (matches dashboard: net - cogs - shipping - fees - taxes - other - adSpend)
    const netProfit    = grossProfit - adSpendUsd - feesUsd - shippingUsd - taxesUsd;
    const netMargin    = netRevenueUsd > 0 ? (netProfit / netRevenueUsd) * 100 : 0;
    const roas         = adSpendUsd > 0 ? netRevenueUsd / adSpendUsd : null;
    const cpa          = adSpendUsd > 0 && p.orders > 0 ? adSpendUsd / p.orders : null;
    const campaignPurchases       = productCampaignPurchases[key] ?? 0;
    const campaignConversionValue = productCampaignConversionValue[key] ?? 0;
    const cpaAds  = adSpendUsd > 0 && campaignPurchases > 0 ? adSpendUsd / campaignPurchases : null;
    const roasAds = adSpendUsd > 0 && campaignConversionValue > 0 ? campaignConversionValue / adSpendUsd : null;
    // totalCost = COGS + AdSpend + Fees + Shipping + Returns + Taxes (all-in, consistent with dashboard)
    const totalCost    = cogsUsd + adSpendUsd + feesUsd + shippingUsd + returnsUsd + taxesUsd;
    const status       = calcStatus(netProfit, netMargin, cogsUsd, adSpendUsd, cpa, cpaBE, isDigital);
    const dataQuality  = calcDataQuality(cogsUsd, adSpendUsd, isDigital);

    // Funnel data — matched by product name (normalized, multiple fallback keys)
    const funnelMap  = funnelByStore[p.brandId] ?? {};

    // Strip diacritics for accent-insensitive comparison
    const stripAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

    // Normalize product name: remove trademark symbols, lowercase, no accents
    const funnelKey  = stripAccents(p.name.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim());
    // Handle-style key (as derived from URL handle)
    const handleKey  = stripAccents(p.name.toLowerCase().replace(/[™®–—\-\s]+/g, " ").trim().replace(/ /g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, " ").trim());
    // Base name: part before | or — separator
    const baseKey    = funnelKey.split(/\s*[|—]\s*/)[0].trim();

    // Normalize all funnelMap keys for accent-insensitive matching
    const funnelEntries = Object.entries(funnelMap).map(([k, v]) => ({
      key: k,
      norm: stripAccents(k.replace(/[™®]/g, "").replace(/\s+/g, " ").trim()),
      val: v,
    }));

    const findFunnel = (query: string) => {
      if (!query || query.length < 2) return null;
      // 1. Exact match
      const exact = funnelEntries.find(e => e.norm === query || e.key === query);
      if (exact) return exact.val;
      // 2. Query starts with the funnelMap key (product name longer than URL)
      const prefixMatch = funnelEntries.find(e => query.startsWith(e.norm + " ") || query === e.norm);
      if (prefixMatch) return prefixMatch.val;
      // 3. funnelMap key starts with query (URL longer than product name)
      const suffixMatch = funnelEntries.find(e => e.norm.startsWith(query + " ") || e.norm === query);
      if (suffixMatch) return suffixMatch.val;
      return null;
    };

    let funnel = findFunnel(funnelKey) ?? findFunnel(handleKey) ?? findFunnel(baseKey) ?? null;

    if (!funnel) {
      // Last resort: first word of base name that's ≥4 chars (catches brand names like "curva", "airi", etc.)
      const words = baseKey.split(" ");
      for (const word of words) {
        if (word.length >= 4) {
          const wordMatch = funnelEntries.find(e =>
            e.norm.startsWith(word + " ") || e.norm === word || e.norm.split(" ")[0] === word
          );
          if (wordMatch) { funnel = wordMatch.val; break; }
        }
      }
    }

    // Manual alias fallback: product name in orders ≠ URL handle (e.g. "Mascarilla" sold via /products/holy-basil-mask)
    if (!funnel) {
      const storeAliases = FUNNEL_ALIASES[p.brandId] ?? {};
      for (const [keyword, targetHandle] of Object.entries(storeAliases)) {
        if (funnelKey.includes(keyword) || baseKey.includes(keyword)) {
          const aliasEntry = funnelEntries.find(e => e.key === targetHandle || e.norm === targetHandle);
          if (aliasEntry) { funnel = aliasEntry.val; break; }
        }
      }
    }
    const sessions        = funnel?.sessions        ?? null;
    const addToCart       = funnel?.addToCart       ?? null;
    const reachedCheckout = funnel?.reachedCheckout ?? null;
    const addToCartRate   = sessions && sessions > 0 && addToCart !== null ? (addToCart / sessions) * 100 : null;
    const conversionRate  = funnel?.conversionRate  ?? (sessions && sessions > 0 ? (p.orders / sessions) * 100 : null);

    return {
      ...p,
      priceUsd: p.unitPriceUsd,   // unit selling price for products table display
      costPerUnit, cogsUsd, adSpendUsd, totalCost,
      aov, cpaBE, isDigital,
      grossProfit, grossMargin,
      netProfit, netMargin,
      roas, cpa, cpaAds, roasAds, campaignPurchases, campaignConversionValue,
      status, dataQuality,
      sessions, addToCart, reachedCheckout, addToCartRate, conversionRate,
    };
  }).sort((a, b) => b.revenueUsd - a.revenueUsd);

  const totals = rows.reduce((acc, r) => ({
    revenueUsd:  acc.revenueUsd  + r.revenueUsd,
    units:       acc.units       + r.units,
    orders:      acc.orders      + r.orders,
    cogsUsd:     acc.cogsUsd     + r.cogsUsd,
    adSpendUsd:  acc.adSpendUsd  + r.adSpendUsd,
    totalCost:   acc.totalCost   + r.totalCost,
    grossProfit: acc.grossProfit + r.grossProfit,
    netProfit:   acc.netProfit   + r.netProfit,
  }), { revenueUsd: 0, units: 0, orders: 0, cogsUsd: 0, adSpendUsd: 0, totalCost: 0, grossProfit: 0, netProfit: 0 });

  // Unique order count — sum of distinct order IDs across all brand+country buckets.
  // (totals.orders above counts product-line appearances, so an order with 3 products
  //  inflates it 3×. uniqueOrders is the real Shopify order count.)
  const uniqueOrders = Object.values(brandCountryOrderIds).reduce((s, set) => s + set.size, 0);

  return NextResponse.json({
    rows,
    totals: {
      ...totals,
      uniqueOrders,
      grossMargin: totals.revenueUsd > 0 ? (totals.grossProfit / totals.revenueUsd) * 100 : 0,
      netMargin:   totals.revenueUsd > 0 ? (totals.netProfit   / totals.revenueUsd) * 100 : 0,
      roas:        totals.adSpendUsd > 0 ? totals.revenueUsd / totals.adSpendUsd : null,
    },
  });
}
