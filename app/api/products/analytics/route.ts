import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchShopifyPaginated,
  getShopifyAccessToken,
  getShopifyStore,
  shopifyRestUrl,
} from "@/lib/integrations/shopify";
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
    key:          "glowmmi" as const,
    shop:         "glm-1694.myshopify.com",
    clientId:     process.env.SHOPIFY_GLOWMMI_CLIENT_ID ?? "",
    clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET ?? "",
    brandId:      "brand_glowmmi",
    brandName:    "Glowmmi",
    color:        "#EC4899",
    currency:     "MXN",
    exchangeRate: FALLBACK_RATE,  // overridden with live rate at request time
  },
  balancea: {
    key:          "balancea" as const,
    shop:         "mp0vab-bw.myshopify.com",
    clientId:     process.env.SHOPIFY_BALANCEA_CLIENT_ID ?? "",
    clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET ?? "",
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
  "rt01":  ["retinal", "retinal shot"],
  "cd01":  ["cleardot", "clear dot"],
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
  "mw01":  ["mouthwash"],
  "ast01": ["astaxanthin"],
  "cg01":  ["gomfit", "creatina", "gomita"],
};

// Nombre canónico para conservar la pauta del producto incluso en períodos
// donde todavía no tuvo pedidos. Sin esta fila base, una campaña reconocida
// (por ejemplo RT01) terminaba como "pauta sin producto" solo porque Retinal
// no aparecía en las órdenes del rango consultado.
const CAMPAIGN_CODE_PRODUCTS: Record<string, Record<string, string>> = {
  brand_glowmmi: {
    tp01: "Toner Pads — K-Beauty Para Aclarar tus Zonas Íntimas",
    gf01: "GlowFill™ — La alternativa al filler sin agujas y desde casa",
    ins01: "InstantLift™ | Efecto tensor para ojeras y bolsas en 5 minutos",
    dp01: "Deep Collagen | Tu Bótox Natural Coreano",
    re01: "Retinal Shot – La fórmula nocturna para arrugas y poros marcados",
    rt01: "Retinal Shot – La fórmula nocturna para arrugas y poros marcados",
    rv01: "ReviveLift™ — Borrador de ojeras y arrugas",
    hb01: "Mascarilla coreana para puntos negros — sin irritar piel sensible",
    cd01: "ClearDot™ — Deja de Cubrir el Granito. Se Va en 24 Horas.",
  },
  brand_balancea: {
    hb01: "Holy Basil",
    hr01: "HerBiotic™ | Controla el mal olor y restaura la humedad íntima",
    st01: "Clearstem™",
    ct01: "Cutting Mix – Control del apetito, energía y apoyo al metabolismo",
    fx01: "CURVA™ — Glúteos más llenos, piel más firme, sin agujas",
    ino01: "FERTIL™ — Equilibra tus Hormonas, Optimiza tu Fertilidad",
    db01: "AiRi – Elimina la hinchazón y deja de sentirte inflamada todo el día",
    mw01: "MOUTHWASH — Limpieza profunda en 30 segundos",
    ast01: "Astaxanthin™ — El Rey Antioxidante que Protege tu Piel desde Adentro",
    cg01: "GOMFIT™ — Creatina en gomita para glúteos más firmes",
  },
};

// productId is assigned during the Meta sync from the campaign code. Prefer
// this deterministic mapping over fuzzy text matching whenever it exists.
const PRODUCT_ID_KEYWORDS: Record<string, string[]> = {
  prod_glw_7966465949744: ["jiyu", "toner pads"],
  prod_glw_7959152361520: ["glowfill"],
  prod_glw_7909382848560: ["instantlift"],
  prod_glw_7931502067760: ["deep collagen"],
  prod_glw_7885424525360: ["retinal shot", "retinal"],
  prod_glw_7901472784432: ["revivelift"],
  prod_glw_7810722168880: ["mascarilla coreana"],
  bal_holy_basil: ["holy basil"],
  bal_herbiotic: ["herbiotic"],
  bal_clearstem: ["clearstem"],
  bal_cutting: ["cutting"],
  bal_curva: ["curva"],
  bal_fertil: ["fertil"],
  bal_airi: ["airi"],
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

type AnalyticsStore = (typeof STORES)[keyof typeof STORES];

async function getToken(store: AnalyticsStore) {
  return getShopifyAccessToken(getShopifyStore(store.key));
}

function bundleSize(name: string, variant: string): number {
  const vm = variant.match(/\bx(\d+)\b/i) ?? variant.match(/^(\d+)\s*(unidades?|pcs?|units?)?$/i);
  if (vm) return Math.max(1, parseInt(vm[1]));
  const nm = name.match(/\bx(\d+)\b/i);
  if (nm) return Math.max(1, parseInt(nm[1]));
  return 1;
}

function localDateKey(createdAt: string, storeOffsetHours: number): string {
  // Shopify puede devolver la fecha con el offset de la tienda o normalizada a UTC.
  // Si ya incluye offset, la parte YYYY-MM-DD es la fecha local correcta.
  if (/[+-]\d{2}:\d{2}$/.test(createdAt.trimEnd())) {
    return createdAt.slice(0, 10);
  }
  const localMs =
    new Date(createdAt).getTime() + storeOffsetHours * 60 * 60 * 1000;
  return new Date(localMs).toISOString().slice(0, 10);
}

function isSkippableItem(item: any): boolean {
  // Dashboard y Shopify cuentan todas las líneas: regalos, productos digitales
  // y protección de pedido incluidos. Excluirlas aquí descuadraba unidades,
  // revenue y utilidad por producto. Solo ignoramos líneas inválidas.
  return (parseInt(item.quantity) || 0) <= 0;
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
    const res = await fetch(`https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) { parseErrors tableData { columns { name } rows } } }`,
      }),
      signal: AbortSignal.timeout(20_000),
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

async function fetchOrders(store: AnalyticsStore, since: string, until: string) {
  const sharedStore = getShopifyStore(store.key);
  return fetchShopifyPaginated<any>(
    sharedStore,
    shopifyRestUrl(sharedStore, "orders.json") +
    `?status=any&financial_status=paid,partially_paid,partially_refunded,refunded` +
    `&created_at_min=${encodeURIComponent(since)}` +
    `&created_at_max=${encodeURIComponent(until)}&limit=250` +
    `&fields=id,created_at,line_items,shipping_address,shipping_lines`,
    "orders",
  );
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
      `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/orders.json` +
      `?status=any&ids=${chunk}&limit=250` +
      `&fields=id,created_at,line_items,shipping_address,shipping_lines,total_price`;
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
      signal: AbortSignal.timeout(30_000),
    });
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
    `https://${shop}/admin/api/${process.env.SHOPIFY_API_VERSION || "2026-07"}/shopify_payments/balance/transactions.json?limit=250`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
      signal: AbortSignal.timeout(30_000),
    });
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
    const next: RegExpMatchArray | null = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
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
    countryCosts[`${base} x1`] ?? countryCosts[`${normBase} x1`] ??
    countryCosts[`${name} x1`] ?? countryCosts[`${normName} x1`] ??
    countryCosts[name]  ?? countryCosts[base]  ?? countryCosts[normName] ?? countryCosts[normBase] ??
    dbCosts[name]       ?? dbCosts[normName]   ?? 0
  );
}

// ─── Clasificación físico vs digital ──────────────────────────────────────────
// Sincronizado con la regex del filtro en /costos y /productos.
// Un producto sin COGS cargados sigue siendo "físico" — no confundir con digital.
function isDigitalProduct(name: string): boolean {
  // Solo contenido descargable/no físico.
  return /ebook|eook|guía|guia|protocolo|recetario|calendario|hábitos|habitos|menú|menu|plan\s+\d+\s+d[ií]as|plan de gym|plan anti|método|metodo|ritual|agenda|21d|reto |challenge|poros bajo|poros abiertos|glow desde adentro|lifting desde dentro|rutina anti|tracker|c[oó]mo usarlo sin errores|despierta tu mejor versi[oó]n/i.test(name);
}

// Upsells y complementos sin pauta propia: se venden o entregan junto al producto principal.
// Características: 0 ad spend (la campaña ya se pagó), 0 envío extra (va en la misma caja),
// COGS mínimo o nulo según el producto. Son margen casi puro — no mostrar como "Datos incompletos".
function isUpsellProduct(name: string): boolean {
  return /rendimiento extendido|rendimiento m[aá]ximo|pureza extendida|reafirmante|vitamina c|youtful|fórmula pro|formula pro|protección de pedido|proteccion de pedido|brocha|brush|limpiador de lengua/i.test(name);
}

// ─── Status + Data Quality ─────────────────────────────────────────────────────
function calcStatus(
  netProfit: number, netMargin: number, cogsUsd: number,
  adSpendUsd: number, _cpa: number | null, _cpaBE: number | null,
  isDigital: boolean, isUpsell: boolean,
): string {
  if (isDigital)                   return "Digital 100%";
  if (isUpsell)                    return netMargin >= 60 ? "Upsell ✓" : "Upsell";
  if (cogsUsd === 0)               return "Datos incompletos";
  if (adSpendUsd === 0)            return "Sin pauta";
  if (netMargin >= 25 && netProfit > 0) return "Escalable";
  if (netProfit > 0)               return "Rentable";
  if (netMargin > -10)             return "Rentable justo"; // within 10% loss
  return "No rentable";
}

function calcDataQuality(cogsUsd: number, adSpendUsd: number, isDigital: boolean, isUpsell: boolean): string {
  if (isDigital || isUpsell) return "OK";             // ebooks y upsells: no COGS esperado
  if (cogsUsd === 0)      return "Falta COGS";
  if (adSpendUsd === 0)   return "Sin pauta registrada";
  return "OK";
}

// ─── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const requestedStore = searchParams.get("store");
  const requestedBrand = searchParams.get("brandId");
  const includeDaily = searchParams.get("includeDaily") === "1";
  const storeKey =
    requestedStore && requestedStore !== "all"
      ? requestedStore
      : requestedBrand === "brand_glowmmi"
        ? "glowmmi"
        : requestedBrand === "brand_balancea"
          ? "balancea"
          : "all";
  const countryParam  = (searchParams.get("country") ?? "all").toUpperCase();

  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  let since: string, until: string, dateFrom: Date, dateTo: Date;

  if (fromParam && toParam) {
    // Custom date range
    since    = `${fromParam}T00:00:00-05:00`;
    until    = `${toParam}T23:59:59-05:00`;
    // AdSpend rows are stored as UTC midnight — use UTC boundaries so first/last day aren't skipped
    dateFrom = new Date(fromParam + "T00:00:00Z");
    dateTo   = new Date(toParam   + "T23:59:59Z");
  } else {
    const days = parseInt(searchParams.get("days") ?? "7");
    // Use the stores' configured local time (UTC-5) to determine today's date.
    // Without this, after 7 PM local time the UTC date flips to tomorrow,
    // so "Hoy" queries a future date and returns 0 orders.
    const STORE_OFFSET_MS = 5 * 60 * 60 * 1000;
    const nowMxMs      = Date.now() - STORE_OFFSET_MS;
    const todayMx      = new Date(nowMxMs).toISOString().slice(0, 10);
    const startMx      = new Date(nowMxMs - (days - 1) * 86400000).toISOString().slice(0, 10);
    since    = `${startMx}T00:00:00-05:00`;
    until    = `${todayMx}T23:59:59-05:00`;
    // AdSpend rows are stored as UTC midnight — use UTC boundaries so first day isn't skipped
    // (using a local offset here would exclude the AdSpend row stored at UTC midnight)
    dateFrom = new Date(startMx + "T00:00:00Z");
    dateTo   = new Date(todayMx + "T23:59:59Z");
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return NextResponse.json(
      {
        error:
          "La base de datos no está disponible. Product Analytics no mostrará cifras parciales.",
      },
      { status: 503 },
    );
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
    cogsUsd: number; unitPriceUsd: number;
  }> = {};

  // El mismo detalle anterior, separado por fecha. Testeos lo usa para
  // comparar el rendimiento diario sin recalcular ni estimar los totales.
  const productDailyRaw: Record<string, Record<string, {
    revenueUsd: number;
    units: number;
    orders: number;
    cogsUsd: number;
  }>> = {};

  // Revenue per brand+country for proportional ad spend distribution
  const brandCountryRevenue: Record<string, number> = {};
  // Unique order IDs per brand+country — used to allocate order-level costs proportionally
  const brandCountryOrderIds: Record<string, Set<string>> = {};
  // Per-product, per brand+country+day revenue — used to calibrate fees/shipping/returns
  // from DailyMetric so totals match the dashboard exactly.
  // Key: productKey → { "brandId||YYYY-MM-DD||countryCode": revenueUsd }
  const productDayRevenue: Record<string, Record<string, number>> = {};
  const storeErrors: Array<{ brandId: string; shop: string; error: string }> = [];

  for (const [, store] of targetStores) {
    try {
      const token  = await getToken(store);
      const sharedStore = getShopifyStore(store.key);
      const storeOffsetHours = sharedStore.storeUtcOffset ?? -5;
      const [orders, funnel] = await Promise.all([
        fetchOrders(store, since, until),
        fetchFunnelData(store.shop, token, since, until),
      ]);
      funnelByStore[store.brandId] = funnel;

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
        const orderDate = order.created_at
          ? localDateKey(order.created_at, storeOffsetHours)
          : toDateStr;
        const orderRate  = store.currency === "MXN"
          ? (historicalRates[orderDate] ?? store.exchangeRate)
          : 1;

        // Dashboard and Product Analytics both attribute by order creation date
        // and use the same historical daily MXN/USD rate.
        const orderEffectiveRate = orderRate;

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

          // Escalón por cantidad: los pedidos llegan como título base + qty (sin variante),
          // así que primero probamos el costo del escalón "xN" del proveedor.
          let unitCost = 0;
          if (!variant && physicalUnits > 1) {
            unitCost = lookupCost(name, countryCosts, costsDb, `x${physicalUnits}`);
          }
          if (unitCost <= 0) unitCost = lookupCost(name, countryCosts, costsDb, variant);
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

          if (includeDaily) {
            if (!productDailyRaw[key]) productDailyRaw[key] = {};
            const daily = productDailyRaw[key][date] ?? {
              revenueUsd: 0,
              units: 0,
              orders: 0,
              cogsUsd: 0,
            };
            daily.revenueUsd += priceUsd;
            daily.units += physicalUnits;
            daily.orders += 1;
            daily.cogsUsd += itemCogsUsd;
            productDailyRaw[key][date] = daily;
          }

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
      storeErrors.push({
        brandId: store.brandId,
        shop: store.shop,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (storeErrors.length > 0) {
    return NextResponse.json(
      {
        error:
          "No fue posible cargar todas las tiendas. Se descartó la respuesta parcial para evitar cifras incorrectas.",
        stores: storeErrors,
      },
      { status: 502 },
    );
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
  const calibTotals: Record<string, {
    fees: number; shipping: number; returns: number; taxes: number;
    cogs: number; netRevenue: number;
  }> = {};
  try {
    const dmRows = await prisma.dailyMetric.findMany({
      where: { brandId: { in: brandIds }, date: { gte: dateFrom, lte: dateTo } },
      select: {
        date: true, brandId: true, countryId: true, grossRevenue: true,
        netRevenue: true, fees: true, shippingCost: true, returns: true,
        taxes: true, cogs: true,
      },
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
      if (!calibTotals[bck]) {
        calibTotals[bck] = {
          fees: 0, shipping: 0, returns: 0, taxes: 0, cogs: 0,
          netRevenue: 0,
        };
      }
      calibTotals[bck].fees       += dm.fees        ?? 0;
      calibTotals[bck].shipping   += dm.shippingCost ?? 0;
      calibTotals[bck].returns    += dm.returns      ?? 0;
      calibTotals[bck].taxes      += dm.taxes        ?? 0;
      calibTotals[bck].cogs       += dm.cogs         ?? 0;
      calibTotals[bck].netRevenue += dm.netRevenue   ?? 0;
    }
  } catch { /* non-critical — falls back to estimates */ }

  // ── Ad spend — per country when available ──────────────────────────────────
  const adRows   = await prisma.adSpend.findMany({
    where: { brandId: { in: brandIds }, platform: "facebook", date: { gte: dateFrom, lte: dateTo } },
    select: { date: true, brandId: true, countryId: true, productId: true, spend: true, purchases: true, conversionValue: true, campaignName: true, adsetName: true, adName: true },
  });
  const adCountryCode = (row: (typeof adRows)[number]): string | null => {
    return row.countryId ? (codeById[row.countryId] ?? null) : null;
  };
  const relevantAdRows =
    countryParam === "ALL"
      ? adRows
      : adRows.filter((row) => adCountryCode(row) === countryParam);

  const productAdSpend: Record<string, number> = {};
  const productCampaignPurchases: Record<string, number> = {};
  const productCampaignConversionValue: Record<string, number> = {};
  const unmatchedBrandCountrySpend: Record<string, number> = {};
  const productDailyAdSpend: Record<string, Record<string, number>> = {};
  const unmatchedDailySpend: Record<string, number> = {};

  const addDailySpend = (productKey: string, date: string, spend: number) => {
    if (!includeDaily) return;
    if (!productDailyAdSpend[productKey]) productDailyAdSpend[productKey] = {};
    productDailyAdSpend[productKey][date] =
      (productDailyAdSpend[productKey][date] ?? 0) + spend;
  };
  const addUnmatchedSpend = (
    brandCountryKey: string,
    date: string,
    spend: number,
  ) => {
    unmatchedBrandCountrySpend[brandCountryKey] =
      (unmatchedBrandCountrySpend[brandCountryKey] ?? 0) + spend;
    if (!includeDaily) return;
    const dailyKey = `${brandCountryKey}||${date}`;
    unmatchedDailySpend[dailyKey] =
      (unmatchedDailySpend[dailyKey] ?? 0) + spend;
  };

  const productKeys = Object.keys(products);
  // Exclude digital products and upsells from ad matching.
  // Ebooks and upsells are never the target of paid campaigns — they ride along with
  // the physical product purchase. Matching them causes two bugs:
  //   1. Short words like "glow" in ebook names match "glowfill" campaign keywords
  //      (substring match), stealing spend from the physical GlowFill product.
  //   2. Digital products accumulate ad spend, which makes their profit appear negative
  //      even though they are 100% margin items with zero cost.
  const nameToKey = productKeys
    .filter(
      (key) =>
        !isDigitalProduct(products[key].name) &&
        !isUpsellProduct(products[key].name),
    )
    .map(k => {
      const p = products[k];
      const norm = normalizeName(p.name);
      const kws  = norm.split(" ").filter((w: string) => w.length >= 4);
      return {
        normalizedName: norm,
        keywords: [norm, ...kws],
        key: k,
        brandId: p.brandId,
        countryCode: p.countryCode,
      };
    });

  for (const row of relevantAdRows) {
    const adDate = row.date.toISOString().slice(0, 10);
    let adKws = extractAdKeywords(row);
    // If campaign contains a known product code (e.g. "INS01", "TP01"), expand adKws
    // with that product's name keywords so it can match product rows correctly.
    for (const kw of [...adKws]) {
      const resolved = CAMPAIGN_CODE_KEYWORDS[kw];
      if (resolved) { adKws = [...adKws, ...resolved]; break; }
    }
    // Map countryId → code. If no countryId or not found → null (unspecified)
    const cc = adCountryCode(row);
    const bck = `${row.brandId}||${cc ?? "ALL"}`;
    const deterministicKeywords = row.productId
      ? PRODUCT_ID_KEYWORDS[row.productId] ?? []
      : [];
    const matchesProduct = (entry: (typeof nameToKey)[number]) => {
      if (deterministicKeywords.length > 0) {
        return deterministicKeywords.some((keyword) =>
          entry.normalizedName.includes(normalizeName(keyword)),
        );
      }
      return entry.keywords.some(
        (keyword) =>
          adKws.includes(keyword) ||
          adKws.some(
            (adKeyword) =>
              adKeyword.includes(keyword) || keyword.includes(adKeyword),
          ),
      );
    };

    if (cc) {
      // A country-specific campaign belongs to exactly one product row.
      const countryMatches = nameToKey.filter(
        (entry) =>
          entry.brandId === row.brandId &&
          entry.countryCode === cc &&
          matchesProduct(entry),
      );
      // Algunas campañas antiguas quedaron con país inferido por la moneda de
      // la cuenta aunque el nombre no incluía país (p. ej. DB01 / INO01). Si el
      // producto no tiene ventas en ese país, preservamos la atribución al
      // producto usando sus filas de otros países en vez de mandarlo a
      // "Meta Ads sin producto identificado".
      let matches = countryMatches.length > 0
        ? countryMatches
        : nameToKey.filter(
            (entry) => entry.brandId === row.brandId && matchesProduct(entry),
          );
      if (matches.length === 0) {
        const campaignProducts = CAMPAIGN_CODE_PRODUCTS[row.brandId] ?? {};
        const campaignCode = adKws.find((keyword) => campaignProducts[keyword]);
        const canonicalName = campaignCode ? campaignProducts[campaignCode] : undefined;
        if (canonicalName) {
          const store = targetStores.find(
            ([, value]) => value.brandId === row.brandId,
          )?.[1];
          const country = COUNTRY_CFG[cc] ?? COUNTRY_CFG.MX;
          const syntheticKey = `${canonicalName}||||${row.brandId}||${cc}`;
          if (!products[syntheticKey]) {
            products[syntheticKey] = {
              name: canonicalName,
              variant: "",
              brandId: row.brandId,
              brandName: store?.brandName ?? row.brandId,
              brandColor: store?.color ?? "#64748B",
              storeKey: `${row.brandId}_${cc}`,
              storeName: `${store?.brandName ?? row.brandId} ${country.name}`,
              countryCode: cc,
              countryName: country.name,
              revenueUsd: 0,
              revenueLocal: 0,
              units: 0,
              orders: 0,
              lastSeen: adDate,
              cogsUsd: 0,
              unitPriceUsd: 0,
            };
          }
          const normalizedName = normalizeName(canonicalName);
          const syntheticEntry = {
            normalizedName,
            keywords: [
              normalizedName,
              ...normalizedName.split(" ").filter((word) => word.length >= 4),
            ],
            key: syntheticKey,
            brandId: row.brandId,
            countryCode: cc,
          };
          nameToKey.push(syntheticEntry);
          matches = [syntheticEntry];
        }
      }
      if (matches.length > 0) {
        const matchRevenue = matches.reduce(
          (sum, entry) => sum + (products[entry.key]?.revenueUsd ?? 0),
          0,
        );
        for (const match of matches) {
          const share =
            matchRevenue > 0
              ? (products[match.key]?.revenueUsd ?? 0) / matchRevenue
              : 1 / matches.length;
          productAdSpend[match.key] =
            (productAdSpend[match.key] ?? 0) + row.spend * share;
          addDailySpend(match.key, adDate, row.spend * share);
          productCampaignPurchases[match.key] =
            (productCampaignPurchases[match.key] ?? 0) +
            (row.purchases ?? 0) * share;
          productCampaignConversionValue[match.key] =
            (productCampaignConversionValue[match.key] ?? 0) +
            (row.conversionValue ?? 0) * share;
        }
      } else {
        addUnmatchedSpend(bck, adDate, row.spend);
      }
    } else {
      // ── Campaign has NO country → distribute proportionally by revenue across ALL matching products ──
      // This prevents a single country from arbitrarily absorbing spend for global campaigns.
      const matchingKeys: string[] = [];
      for (const entry of nameToKey) {
        if (entry.brandId !== row.brandId) continue;
        if (matchesProduct(entry)) matchingKeys.push(entry.key);
      }
      if (matchingKeys.length === 0) {
        addUnmatchedSpend(bck, adDate, row.spend);
      } else {
        const totalMatchRevenue = matchingKeys.reduce((s, k) => s + (products[k]?.revenueUsd ?? 0), 0);
        for (const k of matchingKeys) {
          const share = totalMatchRevenue > 0 ? (products[k]?.revenueUsd ?? 0) / totalMatchRevenue : 1 / matchingKeys.length;
          productAdSpend[k] = (productAdSpend[k] ?? 0) + row.spend * share;
          addDailySpend(k, adDate, row.spend * share);
          productCampaignPurchases[k] = (productCampaignPurchases[k] ?? 0) + (row.purchases ?? 0) * share;
          productCampaignConversionValue[k] = (productCampaignConversionValue[k] ?? 0) + (row.conversionValue ?? 0) * share;
        }
      }
    }
  }

  const cogsByBrandCountry: Record<string, number> = {};
  for (const product of Object.values(products)) {
    const countryKey = `${product.brandId}||${product.countryCode}`;
    cogsByBrandCountry[countryKey] =
      (cogsByBrandCountry[countryKey] ?? 0) + product.cogsUsd;
  }

  // Factores usados tanto en el total del período como en cada día. Compartir
  // estos factores garantiza que la tabla diaria sume exactamente el total.
  const productFinancialConfig: Record<string, {
    revenueScale: number;
    cogsScale: number;
    feeRate: number;
    shippingRate: number;
    taxRate: number;
    isDigital: boolean;
    isUpsell: boolean;
  }> = {};

  // ── Build final rows ────────────────────────────────────────────────────────
  const rows: any[] = Object.values(products).map(p => {
    const cCfg     = COUNTRY_CFG[p.countryCode] ?? COUNTRY_CFG.MX;

    const key         = `${p.name}||${p.variant}||${p.brandId}||${p.countryCode}`;
    // Clasificación por nombre, nunca por COGS = 0.
    const isDigital   = isDigitalProduct(p.name);
    const isUpsell    = !isDigital && isUpsellProduct(p.name);

    const bck         = `${p.brandId}||${p.countryCode}`;
    const bcRevenue   = brandCountryRevenue[bck] ?? 0;
    // Digitales y upsells: 0 ad spend — no tienen campaña propia.
    const directSpend = (isDigital || isUpsell) ? 0 : (productAdSpend[key] ?? 0);
    // Nunca inventar atribución: la pauta sin producto verificable se presenta
    // en una fila separada, en lugar de prorratearla por ingresos.
    const adSpendUsd  = directSpend;

    // ── Calibrate fees, shipping, returns from DailyMetric (effective rate approach) ──
    // Uses period-level effective rates (total_fees / total_gross) per brand+country.
    // This avoids the per-day share mismatch where PA post-discount revenue < DailyMetric
    // pre-discount grossRevenue, which caused calibrated fees to come out too low.
    const ct = calibTotals[bck];
    const calibHasData = !!(ct && ct.netRevenue > 0);
    const revenueScale =
      calibHasData && bcRevenue > 0 ? ct!.netRevenue / bcRevenue : 1;
    const netRevenueUsd = Math.max(0, p.revenueUsd * revenueScale);
    const rawCountryCogs = cogsByBrandCountry[bck] ?? 0;
    const cogsScale =
      ct && rawCountryCogs > 0 ? ct.cogs / rawCountryCogs : 1;
    const cogsUsd = p.cogsUsd * cogsScale;
    const costPerUnit = p.units > 0 ? cogsUsd / p.units : 0;

    const effectiveFeeRate      = calibHasData ? ct!.fees     / ct!.netRevenue : cCfg.gatewayPct;
    const effectiveShippingRate = calibHasData ? ct!.shipping / ct!.netRevenue : 0;
    const effectiveTaxRate      = calibHasData ? ct!.taxes    / ct!.netRevenue : 0;

    productFinancialConfig[key] = {
      revenueScale,
      cogsScale,
      feeRate: effectiveFeeRate,
      shippingRate: effectiveShippingRate,
      taxRate: effectiveTaxRate,
      isDigital,
      isUpsell,
    };

    const feesUsd      = netRevenueUsd * effectiveFeeRate;
    const shippingUsd  = netRevenueUsd * effectiveShippingRate;
    const taxesUsd     = netRevenueUsd * effectiveTaxRate;
    const returnsUsd   =
      ct && bcRevenue > 0 ? ct.returns * (p.revenueUsd / bcRevenue) : 0;

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
    // revenueUsd ya queda neto de devoluciones; no incluimos returns otra vez
    // en totalCost para evitar descontarlas dos veces.
    const totalCost    = cogsUsd + adSpendUsd + feesUsd + shippingUsd + taxesUsd;
    const status       = calcStatus(netProfit, netMargin, cogsUsd, adSpendUsd, cpa, cpaBE, isDigital, isUpsell);
    const dataQuality  = calcDataQuality(cogsUsd, adSpendUsd, isDigital, isUpsell);

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
      revenueUsd: netRevenueUsd,
      revenueLocal: netRevenueUsd * cCfg.displayRate,
      priceUsd: p.unitPriceUsd,   // unit selling price for products table display
      costPerUnit, cogsUsd, adSpendUsd, feesUsd, shippingUsd, taxesUsd,
      totalCost, returnsUsd,
      aov, cpaBE, isDigital, isUpsell,
      productType: isDigital ? "digital" : isUpsell ? "upsell" : "físico",
      grossProfit, grossMargin,
      netProfit, netMargin,
      roas, cpa, cpaAds, roasAds, campaignPurchases, campaignConversionValue,
      status, dataQuality,
      sessions, addToCart, reachedCheckout, addToCartRate, conversionRate,
    };
  });

  // Conserva la conciliación total sin atribuir gasto a productos al azar.
  // Esta fila hace visible cuánto gasto de Meta todavía necesita un mapeo.
  for (const [brandCountryKey, spend] of Object.entries(
    unmatchedBrandCountrySpend,
  )) {
    if (Math.abs(spend) < 0.000001) continue;
    const [brandId, countryCode] = brandCountryKey.split("||");
    const store = targetStores.find(
      ([, value]) => value.brandId === brandId,
    )?.[1];
    const country = COUNTRY_CFG[countryCode];
    const brandName = store?.brandName ?? brandId;
    const brandColor = store?.color ?? "#64748B";
    const countryName = country?.name ?? "Global";

    rows.push({
      name: "Meta Ads sin producto identificado",
      variant: "",
      brandId,
      brandName,
      brandColor,
      storeKey: `${brandId}_${countryCode}`,
      storeName: `${brandName} ${countryName}`,
      countryCode,
      countryName,
      revenueUsd: 0,
      revenueLocal: 0,
      units: 0,
      orders: 0,
      lastSeen: toDateStr,
      cogsUsd: 0,
      unitPriceUsd: 0,
      priceUsd: 0,
      costPerUnit: 0,
      adSpendUsd: spend,
      feesUsd: 0,
      shippingUsd: 0,
      taxesUsd: 0,
      totalCost: spend,
      returnsUsd: 0,
      aov: 0,
      cpaBE: null,
      isDigital: false,
      isUpsell: false,
      productType: "pauta sin asignar",
      grossProfit: 0,
      grossMargin: 0,
      netProfit: -spend,
      netMargin: 0,
      roas: null,
      cpa: null,
      cpaAds: null,
      roasAds: null,
      campaignPurchases: 0,
      campaignConversionValue: 0,
      status: "Revisar campaña",
      dataQuality: "Pauta sin producto identificado",
      sessions: null,
      addToCart: null,
      reachedCheckout: null,
      addToCartRate: null,
      conversionRate: null,
    });
  }

  const dailyRows: any[] = [];
  if (includeDaily) {
    for (const [productKey, product] of Object.entries(products)) {
    const finance = productFinancialConfig[productKey];
    if (!finance) continue;
    const dates = new Set([
      ...Object.keys(productDailyRaw[productKey] ?? {}),
      ...Object.keys(productDailyAdSpend[productKey] ?? {}),
    ]);
    const country = COUNTRY_CFG[product.countryCode] ?? COUNTRY_CFG.MX;

    for (const date of dates) {
      const raw = productDailyRaw[productKey]?.[date] ?? {
        revenueUsd: 0,
        units: 0,
        orders: 0,
        cogsUsd: 0,
      };
      const revenueUsd = Math.max(0, raw.revenueUsd * finance.revenueScale);
      const cogsUsd = raw.cogsUsd * finance.cogsScale;
      const adSpendUsd =
        finance.isDigital || finance.isUpsell
          ? 0
          : (productDailyAdSpend[productKey]?.[date] ?? 0);
      const feesUsd = revenueUsd * finance.feeRate;
      const shippingUsd = revenueUsd * finance.shippingRate;
      const taxesUsd = revenueUsd * finance.taxRate;
      const grossProfit = revenueUsd - cogsUsd;
      const netProfit =
        grossProfit - adSpendUsd - feesUsd - shippingUsd - taxesUsd;
      const netMargin = revenueUsd > 0 ? (netProfit / revenueUsd) * 100 : 0;

      dailyRows.push({
        id: `${productKey}||${date}`,
        date,
        name: product.name,
        variant: product.variant,
        brandId: product.brandId,
        brandName: product.brandName,
        brandColor: product.brandColor,
        countryCode: product.countryCode,
        countryName: product.countryName,
        productType: finance.isDigital
          ? "digital"
          : finance.isUpsell
            ? "upsell"
            : "físico",
        orders: raw.orders,
        units: raw.units,
        revenueUsd,
        cogsUsd,
        adSpendUsd,
        feesUsd,
        shippingUsd,
        taxesUsd,
        totalCost: cogsUsd + adSpendUsd + feesUsd + shippingUsd + taxesUsd,
        grossProfit,
        netProfit,
        netMargin,
        roas: adSpendUsd > 0 ? revenueUsd / adSpendUsd : null,
        cpa:
          adSpendUsd > 0 && raw.orders > 0
            ? adSpendUsd / raw.orders
            : null,
        displayRevenue: revenueUsd * country.displayRate,
      });
    }
    }

    // El gasto sin producto también se conserva por día para que el total diario
    // concilie con Meta sin adjudicarlo a un producto al azar.
    for (const [dailyKey, spend] of Object.entries(unmatchedDailySpend)) {
    if (Math.abs(spend) < 0.000001) continue;
    const [brandId, countryCode, date] = dailyKey.split("||");
    const store = targetStores.find(
      ([, value]) => value.brandId === brandId,
    )?.[1];
    const country = COUNTRY_CFG[countryCode];
    const brandName = store?.brandName ?? brandId;
    const countryName = country?.name ?? "Global";

    dailyRows.push({
      id: `${dailyKey}||unmatched-meta`,
      date,
      name: "Meta Ads sin producto identificado",
      variant: "",
      brandId,
      brandName,
      brandColor: store?.color ?? "#64748B",
      countryCode,
      countryName,
      productType: "pauta sin asignar",
      orders: 0,
      units: 0,
      revenueUsd: 0,
      cogsUsd: 0,
      adSpendUsd: spend,
      feesUsd: 0,
      shippingUsd: 0,
      taxesUsd: 0,
      totalCost: spend,
      grossProfit: 0,
      netProfit: -spend,
      netMargin: 0,
      roas: null,
      cpa: null,
      displayRevenue: 0,
    });
    }

    dailyRows.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.revenueUsd - a.revenueUsd ||
        a.name.localeCompare(b.name),
    );
  }

  rows.sort((a, b) => b.revenueUsd - a.revenueUsd);

  const totals = rows.reduce((acc, r) => ({
    revenueUsd:  acc.revenueUsd  + r.revenueUsd,
    units:       acc.units       + r.units,
    orders:      acc.orders      + r.orders,
    cogsUsd:     acc.cogsUsd     + r.cogsUsd,
    adSpendUsd:  acc.adSpendUsd  + r.adSpendUsd,
    feesUsd:     acc.feesUsd     + r.feesUsd,
    shippingUsd: acc.shippingUsd + r.shippingUsd,
    taxesUsd:    acc.taxesUsd    + r.taxesUsd,
    totalCost:   acc.totalCost   + r.totalCost,
    grossProfit: acc.grossProfit + r.grossProfit,
    netProfit:   acc.netProfit   + r.netProfit,
  }), {
    revenueUsd: 0, units: 0, orders: 0, cogsUsd: 0, adSpendUsd: 0,
    feesUsd: 0, shippingUsd: 0, taxesUsd: 0, totalCost: 0,
    grossProfit: 0, netProfit: 0,
  });

  // Unique order count — sum of distinct order IDs across all brand+country buckets.
  // (totals.orders above counts product-line appearances, so an order with 3 products
  //  inflates it 3×. uniqueOrders is the real Shopify order count.)
  const uniqueOrders = Object.values(brandCountryOrderIds).reduce((s, set) => s + set.size, 0);
  const allocationByBrand = brandIds.map((brandId) => {
    const sourceAdSpend = relevantAdRows
      .filter((row) => row.brandId === brandId)
      .reduce((sum, row) => sum + row.spend, 0);
    const allocatedAdSpend = rows
      .filter((row) => row.brandId === brandId)
      .reduce((sum, row) => sum + row.adSpendUsd, 0);
    return {
      brandId,
      sourceAdSpend,
      allocatedAdSpend,
      difference: sourceAdSpend - allocatedAdSpend,
    };
  });
  const allocationDifference = allocationByBrand.reduce(
    (sum, brand) => sum + brand.difference,
    0,
  );
  const dailyTotals = dailyRows.reduce(
    (acc, row) => ({
      revenueUsd: acc.revenueUsd + row.revenueUsd,
      orders: acc.orders + row.orders,
      cogsUsd: acc.cogsUsd + row.cogsUsd,
      adSpendUsd: acc.adSpendUsd + row.adSpendUsd,
      netProfit: acc.netProfit + row.netProfit,
    }),
    { revenueUsd: 0, orders: 0, cogsUsd: 0, adSpendUsd: 0, netProfit: 0 },
  );

  return NextResponse.json({
    rows,
    ...(includeDaily ? { dailyRows } : {}),
    totals: {
      ...totals,
      uniqueOrders,
      grossMargin: totals.revenueUsd > 0 ? (totals.grossProfit / totals.revenueUsd) * 100 : 0,
      netMargin:   totals.revenueUsd > 0 ? (totals.netProfit   / totals.revenueUsd) * 100 : 0,
      roas:        totals.adSpendUsd > 0 ? totals.revenueUsd / totals.adSpendUsd : null,
    },
    adSpendReconciliation: {
      ok: allocationByBrand.every(
        (brand) => Math.abs(brand.difference) < 0.01,
      ),
      sourceAdSpend: relevantAdRows.reduce((sum, row) => sum + row.spend, 0),
      allocatedAdSpend: totals.adSpendUsd,
      difference: allocationDifference,
      byBrand: allocationByBrand,
    },
    ...(includeDaily
      ? {
          dailyReconciliation: {
            ok:
              Math.abs(dailyTotals.revenueUsd - totals.revenueUsd) < 0.01 &&
              Math.abs(dailyTotals.cogsUsd - totals.cogsUsd) < 0.01 &&
              Math.abs(dailyTotals.adSpendUsd - totals.adSpendUsd) < 0.01 &&
              Math.abs(dailyTotals.netProfit - totals.netProfit) < 0.01,
            dailyTotals,
            differences: {
              revenueUsd: dailyTotals.revenueUsd - totals.revenueUsd,
              orders: dailyTotals.orders - totals.orders,
              cogsUsd: dailyTotals.cogsUsd - totals.cogsUsd,
              adSpendUsd: dailyTotals.adSpendUsd - totals.adSpendUsd,
              netProfit: dailyTotals.netProfit - totals.netProfit,
            },
          },
        }
      : {}),
  });
}
