// scripts/sync-shopify.js
// Sincroniza órdenes REALES de Shopify → DailyMetric en SQLite.
// Genera el token automáticamente desde client_id + client_secret (se renueva solo).
// Hace upsert por (fecha + brandId + countryId) — seguro de correr varias veces.
//
// Run completo (90 días): node scripts/sync-shopify.js
// Solo hoy:               node scripts/sync-shopify.js --days=1
// Últimos 7 días:         node scripts/sync-shopify.js --days=7

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ── Constantes de costo (en USD) ─────────────────────────────────
const MXN = 17.2;   // tipo de cambio
const CLP = 920;

const COST = {
  glowmmi: {
    mx: { cogsUsd: 6.5, shippingUsd: 90 / MXN, gatewayPct: 0.036, gatewayFixed: 3 / MXN, refundRate: 0.07 },
    us: { cogsUsd: 6.2, shippingUsd: 6.5,       gatewayPct: 0.029, gatewayFixed: 0.3,       refundRate: 0.08 },
    cl: { cogsUsd: 6.5, shippingUsd: 4500 / CLP, gatewayPct: 0.0349, gatewayFixed: 0,        refundRate: 0.07 },
  },
  balancea: {
    mx: { cogsUsd: 7.1, shippingUsd: 85 / MXN,  gatewayPct: 0.036, gatewayFixed: 3 / MXN,  refundRate: 0.07 },
    us: { cogsUsd: 9.4, shippingUsd: 6.0,        gatewayPct: 0.029, gatewayFixed: 0.3,       refundRate: 0.08 },
  },
};

const DB_IDS = {
  glowmmi: {
    brandId: "brand_glowmmi",
    mx: { countryId: "country_mx", storeId: "store_glowmmi_mx", rateToUsd: MXN },
    us: { countryId: "country_us", storeId: "store_glowmmi_us", rateToUsd: 1 },
    cl: { countryId: "country_cl", storeId: "store_glowmmi_cl", rateToUsd: CLP },
  },
  balancea: {
    brandId: "brand_balancea",
    mx: { countryId: "country_mx", storeId: "store_balancea_mx", rateToUsd: MXN },
    us: { countryId: "country_us", storeId: "store_balancea_us", rateToUsd: 1 },
  },
};

const DAYS_BACK = parseInt(
  (process.argv.find(a => a.startsWith("--days=")) || "--days=90").split("=")[1]
);

// ── Auth: genera token desde client_credentials ──────────────────
async function getToken(shop, clientId, clientSecret) {
  // Glowmmi usa JSON body, Balancea usa URL-encoded
  const isBalancea = shop.includes("mp0vab");
  let res;
  if (isBalancea) {
    const params = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
    res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } else {
    res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("No se pudo obtener token: " + JSON.stringify(data));
  return data.access_token;
}

// ── Tasa de conversión por código de moneda ──────────────────────
const CURRENCY_RATE = { MXN: 17.2, USD: 1.0, CLP: 920 };
function toUsd(amount, currency) {
  return amount / (CURRENCY_RATE[currency] || 1);
}

// ── Shopify: trae órdenes con paginación ────────────────────────
async function fetchOrders(shop, token, sinceDate) {
  const orders = [];
  let url = `https://${shop}/admin/api/2024-01/orders.json?` +
    `status=any&created_at_min=${sinceDate.toISOString()}&limit=250` +
    `&fields=id,created_at,total_price,currency,financial_status,shipping_address,billing_address`;

  while (url) {
    const res  = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    const data = await res.json();
    if (data.errors) throw new Error("Shopify error: " + JSON.stringify(data.errors));
    orders.push(...(data.orders || []));

    // Paginación via Link header
    const link = res.headers.get("Link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return orders;
}

// ── Detectar país de la orden ───────────────────────────────────
function getCountryCode(order) {
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return "US";
  const code = (addr.country_code || "").toUpperCase();
  if (code === "MX") return "MX";
  if (code === "CL") return "CL";
  return "US";
}

// ── Fecha local (hora Colombia UTC-5, sin DST) ───────────────────
// Shopify devuelve created_at en UTC. Convertimos a fecha local del
// sistema (PC en Colombia) para que "ayer" coincida con el Shopify.
function getLocalDateStr(isoStr) {
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Upsert métrica diaria ────────────────────────────────────────
async function upsertMetric(dateStr, brandId, countryId, storeId, data) {
  const date = new Date(dateStr + "T00:00:00.000Z");
  const existing = await prisma.dailyMetric.findFirst({ where: { date, brandId, countryId } });
  if (existing) {
    await prisma.dailyMetric.update({ where: { id: existing.id }, data: { ...data, date, brandId, countryId, storeId } });
  } else {
    await prisma.dailyMetric.create({ data: { ...data, date, brandId, countryId, storeId } });
  }
}

// ── Sync de una tienda ───────────────────────────────────────────
async function syncStore(storeName, shop, clientId, clientSecret) {
  const ids   = DB_IDS[storeName];
  const costs = COST[storeName];

  console.log(`\n🔑 Obteniendo token para ${shop}...`);
  const token = await getToken(shop, clientId, clientSecret);
  console.log(`   Token OK (${token.slice(0,12)}...)`);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (DAYS_BACK - 1));
  since.setUTCHours(0, 0, 0, 0);

  console.log(`📬 Descargando órdenes desde ${since.toISOString().split("T")[0]}...`);
  const orders = await fetchOrders(shop, token, since);
  console.log(`   ${orders.length} órdenes descargadas`);

  // Agrupar por fecha + país + moneda de la orden
  const grouped = {};
  for (const order of orders) {
    if (order.financial_status === "voided") continue;
    const dateStr     = getLocalDateStr(order.created_at);
    const countryCode = getCountryCode(order).toLowerCase();
    const currency    = (order.currency || "MXN").toUpperCase(); // moneda real de la orden
    const key         = `${dateStr}|${countryCode}|${currency}`;
    if (!grouped[key]) grouped[key] = { dateStr, countryCode, currency, orders: 0, totalLocal: 0 };
    grouped[key].orders++;
    grouped[key].totalLocal += parseFloat(order.total_price || 0);
  }

  let saved = 0;
  for (const { dateStr, countryCode, currency, orders: ordersCount, totalLocal } of Object.values(grouped)) {
    const cc    = costs[countryCode];
    const dbIds = ids[countryCode];
    if (!cc || !dbIds) {
      console.log(`   ⚠️  País no configurado: ${countryCode} — omitiendo`);
      continue;
    }

    // Usar la moneda REAL de la orden para convertir a USD (no el país del cliente)
    const grossUsd = toUsd(totalLocal, currency);
    const netUsd   = grossUsd * (1 - cc.refundRate);
    const cogs     = ordersCount * cc.cogsUsd;
    const shipping = ordersCount * cc.shippingUsd;
    const fees     = grossUsd * cc.gatewayPct + ordersCount * cc.gatewayFixed;
    const profit   = netUsd - cogs - shipping - fees; // adSpend se deja en 0 — viene de Meta
    const aov      = ordersCount > 0 ? grossUsd / ordersCount : 0;

    await upsertMetric(dateStr, ids.brandId, dbIds.countryId, dbIds.storeId, {
      ordersCount, unitsSold: ordersCount,
      grossRevenue: +grossUsd.toFixed(4),
      netRevenue:   +netUsd.toFixed(4),
      adSpend:      0,
      cogs:         +cogs.toFixed(4),
      shippingCost: +shipping.toFixed(4),
      fees:         +fees.toFixed(4),
      netProfit:    +profit.toFixed(4),
      netMargin:    +(grossUsd > 0 ? (profit / grossUsd) * 100 : 0).toFixed(2),
      aov:          +aov.toFixed(4),
      cpa: 0, roas: 0, mer: 0,
    });

    console.log(`   ✅ ${dateStr} | ${countryCode.toUpperCase()} | ${ordersCount} órd | $${grossUsd.toFixed(2)} USD`);
    saved++;
  }

  return saved;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔄 Sync Shopify → Dashboard (últimos ${DAYS_BACK} días)\n`);

  let total = 0;

  // Glowmmi
  if (process.env.SHOPIFY_GLOWMMI_CLIENT_ID) {
    total += await syncStore(
      "glowmmi",
      process.env.SHOPIFY_GLOWMMI_SHOP,
      process.env.SHOPIFY_GLOWMMI_CLIENT_ID,
      process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET
    );
  } else {
    console.log("⚠️  Sin credenciales de Glowmmi en .env");
  }

  // Balancea
  if (process.env.SHOPIFY_BALANCEA_CLIENT_ID) {
    total += await syncStore(
      "balancea",
      process.env.SHOPIFY_BALANCEA_SHOP,
      process.env.SHOPIFY_BALANCEA_CLIENT_ID,
      process.env.SHOPIFY_BALANCEA_CLIENT_SECRET
    );
  } else {
    console.log("⚠️  Sin credenciales de Balancea en .env");
  }

  console.log(`\n🎉 Sync completo: ${total} registros guardados`);
  console.log("💡 Nota: adSpend queda en 0 — se sincroniza por separado desde Meta Ads.");
}

main()
  .catch(e => { console.error("\n❌", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
