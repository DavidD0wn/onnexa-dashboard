/**
 * ONNEXA — Sync Daemon v2
 *
 * Sincroniza Shopify → SQLite de forma autónoma.
 * NO necesita que Next.js esté corriendo.
 * Se registra en Windows al arrancar con INSTALAR-DAEMON.bat
 *
 * Comportamiento:
 *   - Al iniciar: historial COMPLETO (todos los pedidos de siempre)
 *   - Cada 1 hora: sincroniza los últimos 3 días (pedidos nuevos de hoy + ayer)
 *   - Cada 24 horas: sincroniza los últimos 30 días (cobertura amplia)
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { PrismaClient } = require("@prisma/client");
const fs   = require("fs");
const path = require("path");

const prisma  = new PrismaClient();
const LOG_DIR = path.join(__dirname, "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "sync.log");

// ── Configuración de costos (todo en USD) ────────────────────────
const MXN = 17.2;
const CLP = 920;

const COST_MAP = {
  brand_glowmmi: {
    mx: { cogsUsd: 6.5, shippingUsd: 90 / MXN, gPct: 0.036, gFix: 3 / MXN, refund: 0.07 },
    us: { cogsUsd: 6.2, shippingUsd: 6.5,       gPct: 0.029, gFix: 0.3,      refund: 0.08 },
    cl: { cogsUsd: 6.5, shippingUsd: 4500 / CLP, gPct: 0.035, gFix: 0,       refund: 0.07 },
  },
  brand_balancea: {
    mx: { cogsUsd: 7.1, shippingUsd: 85 / MXN,  gPct: 0.036, gFix: 3 / MXN, refund: 0.07 },
    us: { cogsUsd: 9.4, shippingUsd: 6.0,        gPct: 0.029, gFix: 0.3,     refund: 0.08 },
  },
};

const DB_MAP = {
  brand_glowmmi: {
    mx: { countryId: "country_mx", storeId: "store_glowmmi_mx" },
    us: { countryId: "country_us", storeId: "store_glowmmi_us" },
    cl: { countryId: "country_cl", storeId: "store_glowmmi_cl" },
  },
  brand_balancea: {
    mx: { countryId: "country_mx", storeId: "store_balancea_mx" },
    us: { countryId: "country_us", storeId: "store_balancea_us" },
  },
};

const CURRENCY_RATE = { MXN, USD: 1, CLP };

const STORES = [
  {
    name:         "Glowmmi",
    shop:         process.env.SHOPIFY_GLOWMMI_SHOP      || "glm-1694.myshopify.com",
    clientId:     process.env.SHOPIFY_GLOWMMI_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET,
    brandId:      "brand_glowmmi",
    authType:     "json",
  },
  {
    name:         "Balancea",
    shop:         process.env.SHOPIFY_BALANCEA_SHOP      || "mp0vab-bw.myshopify.com",
    clientId:     process.env.SHOPIFY_BALANCEA_CLIENT_ID,
    clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET,
    brandId:      "brand_balancea",
    authType:     "urlencoded",
  },
];

// ── Logger ───────────────────────────────────────────────────────
function log(msg) {
  const ts   = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

// Rotación de log (máx 5 MB)
function rotateLogs() {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, LOG_FILE + ".old");
    }
  } catch {}
}

// ── Shopify Auth ─────────────────────────────────────────────────
async function getToken(store) {
  if (!store.clientId || !store.clientSecret) {
    throw new Error(`Sin credenciales para ${store.name}`);
  }
  const url = `https://${store.shop}/admin/oauth/access_token`;
  let body, contentType;

  if (store.authType === "urlencoded") {
    body        = new URLSearchParams({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret }).toString();
    contentType = "application/x-www-form-urlencoded";
  } else {
    body        = JSON.stringify({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret });
    contentType = "application/json";
  }

  const res  = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data).slice(0, 100)}`);
  return data.access_token;
}

// ── Shopify Orders (con paginación completa) ─────────────────────
async function fetchOrders(shop, token, sinceIso) {
  const orders = [];
  let url = `https://${shop}/admin/api/2024-01/orders.json?status=any&limit=250` +
    `&fields=id,created_at,total_price,currency,financial_status,shipping_address,billing_address` +
    (sinceIso ? `&created_at_min=${sinceIso}` : "");

  while (url) {
    const res  = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${shop}`);
    const data = await res.json();
    orders.push(...(data.orders || []));

    const link = res.headers.get("Link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return orders;
}

// ── Detectar país ────────────────────────────────────────────────
function getCC(order) {
  const addr = order.shipping_address || order.billing_address || {};
  const code = (addr.country_code || "MX").toUpperCase();
  if (code === "CL") return "cl";
  if (code === "US") return "us";
  return "mx";
}

// ── Fecha local del sistema (PC en Colombia, UTC-5 sin DST) ──────
// new Date(isoStr).getDate() etc. usan la hora LOCAL del sistema,
// así "ayer en Colombia" queda registrado como ayer, no como hoy UTC.
function getLocalDateStr(isoStr) {
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Upsert métrica ───────────────────────────────────────────────
async function upsertMetric(dateStr, brandId, countryId, storeId, payload) {
  const date     = new Date(dateStr + "T00:00:00.000Z");
  const existing = await prisma.dailyMetric.findFirst({ where: { date, brandId, countryId } });
  if (existing) {
    await prisma.dailyMetric.update({ where: { id: existing.id }, data: { ...payload, date, brandId, countryId, storeId } });
  } else {
    await prisma.dailyMetric.create({ data: { ...payload, date, brandId, countryId, storeId } });
  }
}

// ── Sync de una tienda ───────────────────────────────────────────
async function syncStore(store, sinceIso) {
  const costs = COST_MAP[store.brandId];
  const dbIds = DB_MAP[store.brandId];

  const token  = await getToken(store);
  const orders = await fetchOrders(store.shop, token, sinceIso);

  if (orders.length === 0) return 0;

  // Agrupar por fecha + país + moneda
  const grouped = {};
  for (const order of orders) {
    if (order.financial_status === "voided") continue;
    const dateStr  = getLocalDateStr(order.created_at);
    const cc       = getCC(order);
    const currency = (order.currency || "MXN").toUpperCase();
    const key      = `${dateStr}|${cc}|${currency}`;
    if (!grouped[key]) grouped[key] = { dateStr, cc, currency, count: 0, totalLocal: 0 };
    grouped[key].count++;
    grouped[key].totalLocal += parseFloat(order.total_price || 0);
  }

  let saved = 0;
  for (const { dateStr, cc, currency, count, totalLocal } of Object.values(grouped)) {
    const cost = costs?.[cc];
    const ids  = dbIds?.[cc];
    if (!cost || !ids) continue;

    const rate     = CURRENCY_RATE[currency] || MXN;
    const grossUsd = totalLocal / rate;
    const netUsd   = grossUsd * (1 - cost.refund);
    const cogs     = count * cost.cogsUsd;
    const shipping = count * cost.shippingUsd;
    const fees     = grossUsd * cost.gPct + count * cost.gFix;
    const profit   = netUsd - cogs - shipping - fees;

    await upsertMetric(dateStr, store.brandId, ids.countryId, ids.storeId, {
      ordersCount: count, unitsSold: count,
      grossRevenue: +grossUsd.toFixed(4), netRevenue: +netUsd.toFixed(4),
      adSpend: 0, cogs: +cogs.toFixed(4), shippingCost: +shipping.toFixed(4),
      fees: +fees.toFixed(4), netProfit: +profit.toFixed(4),
      netMargin: +(grossUsd > 0 ? (profit / grossUsd) * 100 : 0).toFixed(2),
      aov: +(count > 0 ? grossUsd / count : 0).toFixed(4),
      cpa: 0, roas: 0, mer: 0,
    });
    saved++;
  }
  return saved;
}

// ── Sync completo (sin fecha = todo el historial) ─────────────────
async function runSync(sinceIso, label) {
  log(`🔄 Sync ${label}...`);
  let total = 0;
  for (const store of STORES) {
    if (!store.clientId) { log(`  ⚠️  Sin credenciales: ${store.name}`); continue; }
    try {
      const saved = await syncStore(store, sinceIso);
      log(`  ✅ ${store.name}: ${saved} registros guardados`);
      total += saved;
    } catch (e) {
      log(`  ❌ ${store.name}: ${e.message}`);
    }
  }
  log(`  📊 Total: ${total} registros`);
  return total;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  rotateLogs();
  log("═══════════════════════════════════════════");
  log("  ONNEXA Sync Daemon v2 — Iniciando");
  log("═══════════════════════════════════════════");

  // 1. HISTORIAL COMPLETO al arrancar (sin fecha = todo desde siempre)
  log("📚 Primer sync: descargando historial COMPLETO...");
  await runSync(null, "historial completo");

  log("✅ Historial completo sincronizado.");
  log("⏱️  Próximo sync rápido en 1 hora.");

  let ciclo = 0;

  setInterval(async () => {
    ciclo++;
    if (ciclo % 24 === 0) {
      // Cada 24 ciclos (24 h): sync profundo de 30 días
      const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await runSync(since30, "profundo 30 días");
    } else {
      // Cada hora: solo los últimos 3 días
      const since3 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      await runSync(since3, "rápido 3 días");
    }
  }, 60 * 60 * 1000); // cada 1 hora
}

main().catch(e => {
  log(`❌ Error crítico: ${e.message}`);
  prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT",  () => { log("👋 Daemon detenido."); prisma.$disconnect(); process.exit(0); });
process.on("SIGTERM", () => { log("👋 Daemon detenido."); prisma.$disconnect(); process.exit(0); });
