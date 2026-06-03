/**
 * Sincroniza Meta Ads histórico desde Jan 1 2026 hasta hoy.
 * Ejecutar AHORA — el token expira mañana.
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const TOKEN = process.env.META_ADS_USER_TOKEN ?? '';

const FIELDS = [
  'campaign_name', 'adset_name', 'ad_name',
  'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
  'actions', 'action_values', 'cost_per_action_type',
].join(',');

function getPurchases(actions) {
  if (!actions) return 0;
  return actions.filter(a => ['purchase','omni_purchase'].includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || '0'), 0);
}
function getConvValue(actionValues) {
  if (!actionValues) return 0;
  return actionValues.filter(a => ['purchase','omni_purchase'].includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || '0'), 0);
}
function getCPA(costPerAction) {
  if (!costPerAction) return null;
  const pa = costPerAction.find(a => ['purchase','omni_purchase'].includes(a.action_type));
  return pa ? parseFloat(pa.value || '0') : null;
}

async function fetchInsights(accountId, dateFrom, dateTo) {
  const rows = [];
  let url = `https://graph.facebook.com/v19.0/${accountId}/insights` +
    `?fields=${FIELDS}&level=ad&time_increment=1&limit=500` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}` +
    `&access_token=${TOKEN}`;

  while (url) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) throw new Error(`${accountId}: ${data.error.message}`);
    rows.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return rows;
}

// Sync por chunks de 30 días para no saturar la API
const accounts = await prisma.metaAdsAccount.findMany({ where: { isActive: true } });
console.log(`Cuentas activas: ${accounts.length}`);
accounts.forEach(a => console.log(`  ${a.accountId} | ${a.accountName} | brand:${a.brandId}`));

const fullFrom = '2026-01-01';
const fullTo   = new Date().toISOString().slice(0, 10);

// Dividir en chunks de 30 días
const chunks = [];
let chunkStart = new Date(fullFrom);
while (chunkStart <= new Date(fullTo)) {
  const chunkEnd = new Date(chunkStart);
  chunkEnd.setDate(chunkEnd.getDate() + 29);
  const end = chunkEnd > new Date(fullTo) ? fullTo : chunkEnd.toISOString().slice(0, 10);
  chunks.push({ from: chunkStart.toISOString().slice(0, 10), to: end });
  chunkStart.setDate(chunkStart.getDate() + 30);
}
console.log(`\nChunks: ${chunks.map(c => `${c.from}→${c.to}`).join(', ')}`);

let totalSaved = 0;
let totalErrors = 0;

for (const account of accounts) {
  const countryId = account.currency === 'USD' ? 'country_us' : 'country_mx';
  console.log(`\n--- ${account.accountName} (${account.brandId}) ---`);

  // Delete all existing Meta Ads rows for this brand (full re-sync)
  const deleted = await prisma.adSpend.deleteMany({
    where: {
      brandId:      account.brandId,
      platform:     'facebook',
      campaignName: { not: null },
    }
  });
  console.log(`  Borrados ${deleted.count} registros anteriores`);

  for (const chunk of chunks) {
    try {
      const rows = await fetchInsights(account.accountId, chunk.from, chunk.to);
      if (rows.length === 0) { process.stdout.write('.'); continue; }

      for (const row of rows) {
        const spend     = parseFloat(row.spend || '0');
        if (spend === 0) continue;

        const purchases  = getPurchases(row.actions ?? []);
        const convValue  = getConvValue(row.action_values ?? []);
        const cpa        = getCPA(row.cost_per_action_type ?? []);

        await prisma.adSpend.create({
          data: {
            brandId:         account.brandId,
            countryId,
            date:            new Date(row.date_start),
            platform:        'facebook',
            campaignName:    row.campaign_name ?? null,
            adsetName:       row.adset_name    ?? null,
            adName:          row.ad_name       ?? null,
            spend,
            impressions:     parseInt(row.impressions || '0'),
            clicks:          parseInt(row.clicks || '0'),
            purchases:       Math.round(purchases),
            conversionValue: convValue,
            ctr:             parseFloat(row.ctr || '0'),
            cpc:             parseFloat(row.cpc || '0'),
            cpm:             parseFloat(row.cpm || '0'),
            cpa,
            roas:            spend > 0 && convValue > 0 ? convValue / spend : null,
          }
        });
        totalSaved++;
      }
      process.stdout.write(`[${chunk.from}: ${rows.length} ads] `);
    } catch(e) {
      console.log(`\n  ⚠ Error ${chunk.from}→${chunk.to}: ${e.message}`);
      totalErrors++;
    }
  }
  console.log('');
}

console.log(`\n✅ Total guardados: ${totalSaved} registros | Errores: ${totalErrors}`);

// Ahora rollup: pasar AdSpend → DailyMetric
console.log('\n=== ROLLUP → DailyMetric ===');
const grouped = await prisma.adSpend.groupBy({
  by: ['brandId', 'date'],
  _sum: { spend: true },
  where: { date: { gte: new Date(fullFrom), lte: new Date(fullTo + 'T23:59:59Z') } }
});

let rollupUpdated = 0, rollupSkipped = 0;
for (const row of grouped) {
  const adSpend  = row._sum.spend ?? 0;
  const d        = row.date;
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const dayEnd   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));

  const metric = await prisma.dailyMetric.findFirst({
    where: { brandId: row.brandId, date: { gte: dayStart, lte: dayEnd } }
  });
  if (!metric) { rollupSkipped++; continue; }

  const netRevenue = metric.netRevenue || metric.grossRevenue;
  const netProfit  = netRevenue - metric.cogs - metric.shippingCost - metric.fees
                   - metric.handlingFees - metric.taxes - metric.otherCosts - adSpend;
  const netMargin  = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
  const roas       = adSpend > 0 ? netRevenue / adSpend : 0;
  const cpa        = metric.ordersCount > 0 && adSpend > 0 ? adSpend / metric.ordersCount : 0;

  await prisma.dailyMetric.update({
    where: { id: metric.id },
    data:  { adSpend, netProfit, netMargin, roas: roas > 0 ? roas : 0, cpa: cpa > 0 ? cpa : null }
  });
  rollupUpdated++;
}
console.log(`Rollup: ${rollupUpdated} días actualizados | ${rollupSkipped} sin DailyMetric`);

// Resumen por mes
console.log('\n=== RESUMEN MENSUAL AD SPEND ===');
const monthly = await prisma.adSpend.groupBy({
  by: ['brandId'],
  _sum: { spend: true },
  where: { date: { gte: new Date('2026-01-01') } }
});
monthly.forEach(m => console.log(`  ${m.brandId}: $${m._sum.spend?.toFixed(2)} total`));

const byMonth = await prisma.adSpend.groupBy({
  by: ['brandId'],
  _sum: { spend: true },
  where: { date: { gte: new Date('2026-05-01'), lte: new Date('2026-05-31') } }
});
byMonth.forEach(m => console.log(`  ${m.brandId} (Mayo 2026): $${m._sum.spend?.toFixed(2)}`));

await prisma.$disconnect();
