// scripts/seed-metrics-realistic.js
// Replaces ALL DailyMetric records with 90 days of realistic data.
// • ALL values stored in USD (MXN and CLP prices converted at exchange rate)
// • Glowmmi MX: primary store, ~10 orders/day
// • Glowmmi US: secondary, ~3 orders/day
// • Glowmmi Chile: occasional (~20% of days, 1-3 orders)
// • Balancea MX: tiny store, ~0.3 orders/day (~27 in 90d)
// • Balancea US: ~0 (not active)
//
// Run: node scripts/seed-metrics-realistic.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Exchange rates
const MXN = 17.2;  // 1 USD = 17.2 MXN
const CLP = 920;   // 1 USD = 920 CLP

function rnd(min, max) { return min + Math.random() * (max - min); }
function ri(min, max)  { return Math.max(0, Math.round(rnd(min, max))); }

function dayDate(daysAgo) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

async function main() {
  console.log("🧹 Eliminando métricas existentes...");
  const deleted = await prisma.dailyMetric.deleteMany();
  console.log(`   ${deleted.count} registros eliminados\n`);

  const DAYS = 90;
  const metrics = [];

  for (let i = DAYS - 1; i >= 0; i--) {
    const date = dayDate(i);

    // Trend: starts ~0.7, grows to ~1.3 over 90 days (simulates growth)
    const trend = 0.7 + (1.3 - 0.7) * ((DAYS - 1 - i) / (DAYS - 1));
    const noise = 0.75 + Math.random() * 0.5; // ±25% daily variance
    const f = trend * noise;

    // ── Glowmmi MX (principal) ─────────────────────────────────
    // Price avg: 600 MXN → $34.88 USD
    {
      const priceUsd  = 600 / MXN;               // ~$34.88
      const orders    = ri(6 * f, 13 * f);
      const revenue   = orders * priceUsd;
      const net       = revenue * 0.93;            // 7% chargebacks/refunds
      const cpa       = rnd(8.5, 11.5);            // ~$9-12 USD CPA (competitive MX)
      const adSpend   = orders > 0 ? orders * cpa : 0;
      const cogs      = orders * 6.5;              // $6.5 avg supplier cost
      const shipping  = orders * (90 / MXN);       // 90 MXN = ~$5.23
      const fees      = revenue * 0.036 + orders * (3 / MXN); // 3.6% + $0.17 fixed
      const profit    = net - cogs - shipping - fees - adSpend;

      if (orders > 0) {
        metrics.push({
          date,
          brandId:    "brand_glowmmi",
          countryId:  "country_mx",
          storeId:    "store_glowmmi_mx",
          ordersCount: orders,
          unitsSold:   orders,
          grossRevenue: parseFloat(revenue.toFixed(4)),
          netRevenue:   parseFloat(net.toFixed(4)),
          adSpend:      parseFloat(adSpend.toFixed(4)),
          cogs:         parseFloat(cogs.toFixed(4)),
          shippingCost: parseFloat(shipping.toFixed(4)),
          fees:         parseFloat(fees.toFixed(4)),
          netProfit:    parseFloat(profit.toFixed(4)),
          netMargin:    revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0,
          aov:          parseFloat(priceUsd.toFixed(4)),
          cpa:          orders > 0 ? parseFloat((adSpend / orders).toFixed(4)) : 0,
          roas:         adSpend > 0 ? parseFloat((net / adSpend).toFixed(4)) : 0,
          mer:          adSpend > 0 ? parseFloat((revenue / adSpend).toFixed(4)) : 0,
        });
      }
    }

    // ── Glowmmi US (secundaria) ─────────────────────────────────
    {
      const priceUsd  = 34.99;
      const orders    = ri(1 * f, 5 * f);
      const revenue   = orders * priceUsd;
      const net       = revenue * 0.92;
      const cpa       = rnd(10, 15);
      const adSpend   = orders > 0 ? orders * cpa : 0;
      const cogs      = orders * 6.2;
      const shipping  = orders * 6.5;
      const fees      = revenue * 0.029 + orders * 0.3;
      const profit    = net - cogs - shipping - fees - adSpend;

      if (orders > 0) {
        metrics.push({
          date,
          brandId:    "brand_glowmmi",
          countryId:  "country_us",
          storeId:    "store_glowmmi_us",
          ordersCount: orders,
          unitsSold:   orders,
          grossRevenue: parseFloat(revenue.toFixed(4)),
          netRevenue:   parseFloat(net.toFixed(4)),
          adSpend:      parseFloat(adSpend.toFixed(4)),
          cogs:         parseFloat(cogs.toFixed(4)),
          shippingCost: parseFloat(shipping.toFixed(4)),
          fees:         parseFloat(fees.toFixed(4)),
          netProfit:    parseFloat(profit.toFixed(4)),
          netMargin:    revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0,
          aov:          priceUsd,
          cpa:          orders > 0 ? parseFloat((adSpend / orders).toFixed(4)) : 0,
          roas:         adSpend > 0 ? parseFloat((net / adSpend).toFixed(4)) : 0,
          mer:          adSpend > 0 ? parseFloat((revenue / adSpend).toFixed(4)) : 0,
        });
      }
    }

    // ── Glowmmi Chile (esporádico ~20% de los días) ─────────────
    if (Math.random() < 0.22) {
      const priceUsd  = 22990 / CLP;  // ~$24.99 USD
      const orders    = ri(1, 3);
      const revenue   = orders * priceUsd;
      const net       = revenue * 0.93;
      const cpa       = rnd(4, 7);
      const adSpend   = orders * cpa;
      const cogs      = orders * 6.5;
      const shipping  = orders * (4500 / CLP);  // ~$4.89 USD
      const fees      = revenue * 0.0349;
      const profit    = net - cogs - shipping - fees - adSpend;

      metrics.push({
        date,
        brandId:    "brand_glowmmi",
        countryId:  "country_cl",
        storeId:    "store_glowmmi_cl",
        ordersCount: orders,
        unitsSold:   orders,
        grossRevenue: parseFloat(revenue.toFixed(4)),
        netRevenue:   parseFloat(net.toFixed(4)),
        adSpend:      parseFloat(adSpend.toFixed(4)),
        cogs:         parseFloat(cogs.toFixed(4)),
        shippingCost: parseFloat(shipping.toFixed(4)),
        fees:         parseFloat(fees.toFixed(4)),
        netProfit:    parseFloat(profit.toFixed(4)),
        netMargin:    revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0,
        aov:          parseFloat(priceUsd.toFixed(4)),
        cpa:          orders > 0 ? parseFloat((adSpend / orders).toFixed(4)) : 0,
        roas:         adSpend > 0 ? parseFloat((net / adSpend).toFixed(4)) : 0,
        mer:          adSpend > 0 ? parseFloat((revenue / adSpend).toFixed(4)) : 0,
      });
    }

    // ── Balancea MX (muy pequeña, ~34 órdenes en toda la vida) ──
    // ~30% de los días tiene 1 orden, 5% tiene 2
    {
      const roll = Math.random();
      const orders = roll < 0.05 ? 2 : roll < 0.30 ? 1 : 0;
      if (orders > 0) {
        const priceUsd  = 449 / MXN;   // ~$26.10 USD
        const revenue   = orders * priceUsd;
        const net       = revenue * 0.93;
        const cpa       = rnd(9, 14);
        const adSpend   = orders * cpa;
        const cogs      = orders * 7.1;
        const shipping  = orders * (85 / MXN);   // ~$4.94 USD
        const fees      = revenue * 0.036 + orders * (3 / MXN);
        const profit    = net - cogs - shipping - fees - adSpend;

        metrics.push({
          date,
          brandId:    "brand_balancea",
          countryId:  "country_mx",
          storeId:    "store_balancea_mx",
          ordersCount: orders,
          unitsSold:   orders,
          grossRevenue: parseFloat(revenue.toFixed(4)),
          netRevenue:   parseFloat(net.toFixed(4)),
          adSpend:      parseFloat(adSpend.toFixed(4)),
          cogs:         parseFloat(cogs.toFixed(4)),
          shippingCost: parseFloat(shipping.toFixed(4)),
          fees:         parseFloat(fees.toFixed(4)),
          netProfit:    parseFloat(profit.toFixed(4)),
          netMargin:    revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(2)) : 0,
          aov:          parseFloat(priceUsd.toFixed(4)),
          cpa:          orders > 0 ? parseFloat((adSpend / orders).toFixed(4)) : 0,
          roas:         adSpend > 0 ? parseFloat((net / adSpend).toFixed(4)) : 0,
          mer:          adSpend > 0 ? parseFloat((revenue / adSpend).toFixed(4)) : 0,
        });
      }
    }
  }

  console.log(`📊 Insertando ${metrics.length} registros...`);
  let inserted = 0;
  for (const m of metrics) {
    await prisma.dailyMetric.create({ data: m });
    inserted++;
    if (inserted % 50 === 0) process.stdout.write(`   ${inserted}/${metrics.length}\r`);
  }

  // ── Resumen ───────────────────────────────────────────────────
  const totalOrders = metrics.reduce((s, m) => s + m.ordersCount, 0);
  const byCountry = {};
  const byBrand   = {};
  for (const m of metrics) {
    byCountry[m.countryId] = (byCountry[m.countryId] || 0) + m.ordersCount;
    byBrand[m.brandId]     = (byBrand[m.brandId]     || 0) + m.ordersCount;
  }

  console.log(`\n✅ Listo: ${metrics.length} registros, ${totalOrders} órdenes en ${DAYS} días`);
  console.log("\n📍 Por país:");
  for (const [c, o] of Object.entries(byCountry)) console.log(`   ${c}: ${o} órdenes`);
  console.log("\n🏷️  Por marca:");
  for (const [b, o] of Object.entries(byBrand)) console.log(`   ${b}: ${o} órdenes`);
  console.log("\n📅 Promedio diario:");
  console.log(`   Glowmmi MX: ~${Math.round((byCountry["country_mx"] || 0) / DAYS * 0.9)} órd/día`);
  console.log(`   Glowmmi US: ~${Math.round((byCountry["country_us"] || 0) / DAYS)} órd/día`);
}

main()
  .catch(e => { console.error("❌ Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
