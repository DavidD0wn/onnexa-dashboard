// scripts/fix-today.js
// Corrige manualmente los números de HOY en Glowmmi MX.
// Edita las variables de INPUTS y corre: node scripts/fix-today.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ── EDITA ESTOS VALORES CADA VEZ QUE LO CORRAS ──────────────────
const INPUTS = {
  ordersGlowmmiMX: 25,          // Órdenes reales hoy en Glowmmi MX
  ordersGlowmmiUS: 3,           // Órdenes reales hoy en Glowmmi US (pon 0 si no tienes)
  ordersBalanceaMX: 0,          // Balancea MX
  adSpendMXN: 0,                // Gasto en ads hoy en MXN (0 si no lo tienes aún)
  adSpendUSD: 0,                // Gasto en ads hoy en USD (Glowmmi US)
};

// Constantes de costo (no cambiar a menos que cambien tus condiciones)
const MXN = 17.2;
const GLOWMMI_PRICE_MXN = 600;   // precio promedio Glowmmi MX en MXN
const GLOWMMI_COGS_USD  = 6.5;
const GLOWMMI_SHIP_MXN  = 90;
const GLOWMMI_FEE_PCT   = 0.036;
const GLOWMMI_FEE_FIX_MXN = 3;

const GLOWMMI_US_PRICE  = 34.99;
const GLOWMMI_US_COGS   = 6.2;
const GLOWMMI_US_SHIP   = 6.5;
const GLOWMMI_US_FEE_PCT  = 0.029;
const GLOWMMI_US_FEE_FIX  = 0.3;

async function upsertDay(dateStart, brandId, countryId, storeId, data) {
  const existing = await prisma.dailyMetric.findFirst({
    where: { date: dateStart, brandId, countryId },
  });
  if (existing) {
    await prisma.dailyMetric.update({ where: { id: existing.id }, data: { ...data, date: dateStart, brandId, countryId, storeId } });
    console.log(`  ↻ Actualizado: ${brandId} / ${countryId}`);
  } else {
    await prisma.dailyMetric.create({ data: { ...data, date: dateStart, brandId, countryId, storeId } });
    console.log(`  ✅ Creado: ${brandId} / ${countryId}`);
  }
}

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log(`📅 Corrigiendo datos de hoy: ${today.toISOString().split("T")[0]}\n`);

  // ── Glowmmi MX ──────────────────────────────────────────────
  if (INPUTS.ordersGlowmmiMX > 0) {
    const o     = INPUTS.ordersGlowmmiMX;
    const gross = (o * GLOWMMI_PRICE_MXN) / MXN;
    const net   = gross * 0.93;
    const cogs  = o * GLOWMMI_COGS_USD;
    const ship  = o * (GLOWMMI_SHIP_MXN / MXN);
    const fees  = gross * GLOWMMI_FEE_PCT + o * (GLOWMMI_FEE_FIX_MXN / MXN);
    const ad    = INPUTS.adSpendMXN / MXN;
    const profit = net - cogs - ship - fees - ad;

    await upsertDay(today, "brand_glowmmi", "country_mx", "store_glowmmi_mx", {
      ordersCount: o, unitsSold: o,
      grossRevenue: +gross.toFixed(4), netRevenue: +net.toFixed(4),
      adSpend: +ad.toFixed(4), cogs: +cogs.toFixed(4),
      shippingCost: +ship.toFixed(4), fees: +fees.toFixed(4),
      netProfit: +profit.toFixed(4),
      netMargin: +(profit / gross * 100).toFixed(2),
      aov: +(gross / o).toFixed(4),
      cpa: ad > 0 && o > 0 ? +(ad / o).toFixed(4) : 0,
      roas: ad > 0 ? +(net / ad).toFixed(4) : 0,
      mer:  ad > 0 ? +(gross / ad).toFixed(4) : 0,
    });
    console.log(`     ${o} órdenes | $${gross.toFixed(2)} USD revenue | $${profit.toFixed(2)} USD utilidad`);
  }

  // ── Glowmmi US ──────────────────────────────────────────────
  if (INPUTS.ordersGlowmmiUS > 0) {
    const o     = INPUTS.ordersGlowmmiUS;
    const gross = o * GLOWMMI_US_PRICE;
    const net   = gross * 0.92;
    const cogs  = o * GLOWMMI_US_COGS;
    const ship  = o * GLOWMMI_US_SHIP;
    const fees  = gross * GLOWMMI_US_FEE_PCT + o * GLOWMMI_US_FEE_FIX;
    const ad    = INPUTS.adSpendUSD;
    const profit = net - cogs - ship - fees - ad;

    await upsertDay(today, "brand_glowmmi", "country_us", "store_glowmmi_us", {
      ordersCount: o, unitsSold: o,
      grossRevenue: +gross.toFixed(4), netRevenue: +net.toFixed(4),
      adSpend: +ad.toFixed(4), cogs: +cogs.toFixed(4),
      shippingCost: +ship.toFixed(4), fees: +fees.toFixed(4),
      netProfit: +profit.toFixed(4),
      netMargin: +(profit / gross * 100).toFixed(2),
      aov: GLOWMMI_US_PRICE,
      cpa: ad > 0 && o > 0 ? +(ad / o).toFixed(4) : 0,
      roas: ad > 0 ? +(net / ad).toFixed(4) : 0,
      mer:  ad > 0 ? +(gross / ad).toFixed(4) : 0,
    });
    console.log(`     ${o} órdenes | $${gross.toFixed(2)} USD revenue | $${profit.toFixed(2)} USD utilidad`);
  }

  console.log("\n✅ Datos de hoy actualizados. Recarga el dashboard.");
}

main()
  .catch(e => { console.error("❌", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
