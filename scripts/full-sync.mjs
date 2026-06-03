import { PrismaClient } from '@prisma/client';
import { startOfDay } from 'date-fns';
const prisma = new PrismaClient();

const STORES = {
  glowmmi: {
    shop: 'glm-1694.myshopify.com', clientId: 'de9e81a11394aabe11272947a4da0da5', clientSecret: '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',
    authType: 'json', brandId: 'brand_glowmmi', countryId: 'country_us', storeId: 'store_glowmmi_us', currency: 'USD', gatewayPct: 0.029, gatewayFixed: 0.30,
  },
  balancea: {
    shop: 'mp0vab-bw.myshopify.com', clientId: 'b06d2c272b5428556744aa476b8467f1', clientSecret: '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',
    authType: 'urlencoded', brandId: 'brand_balancea', countryId: 'country_mx', storeId: 'store_balancea_mx', currency: 'MXN', gatewayPct: 0.036, gatewayFixed: 3.0,
  },
};

async function getToken(cfg) {
  const isJson = cfg.authType === 'json';
  const body = isJson
    ? JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' })
    : new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString();
  const res = await fetch(`https://${cfg.shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded' }, body
  });
  const d = await res.json();
  return d.access_token;
}

async function fetchPaginated(startUrl, token, key) {
  const all = [];
  let url = startUrl;
  while (url) {
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
    if (!r.ok) break;
    const d = await r.json();
    all.push(...(d[key] ?? []));
    const nxt = (r.headers.get('Link') ?? '').match(/<([^>]+)>;\s*rel="next"/);
    url = nxt ? nxt[1] : null;
  }
  return all;
}

const DAYS = 90;

for (const [storeName, cfg] of Object.entries(STORES)) {
  console.log(`\n=== SYNC ${storeName.toUpperCase()} (${DAYS}d) ===`);
  const token = await getToken(cfg);
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();

  const [orders, refundOrders] = await Promise.all([
    fetchPaginated(
      `https://${cfg.shop}/admin/api/2024-01/orders.json?status=any&financial_status=paid,partially_paid,partially_refunded&created_at_min=${since}&limit=250&fields=id,created_at,total_price,total_discounts,total_tax,shipping_lines`,
      token, 'orders'
    ),
    fetchPaginated(
      `https://${cfg.shop}/admin/api/2024-01/orders.json?status=any&financial_status=refunded,partially_refunded&updated_at_min=${since}&limit=250&fields=id,created_at,updated_at,refunds`,
      token, 'orders'
    ),
  ]);
  console.log(`  Ordenes pagadas: ${orders.length} | Con reembolsos: ${refundOrders.length}`);

  const byDate = {};
  const ensure = (dk, date) => {
    if (!byDate[dk]) byDate[dk] = { date: startOfDay(date), ordersCount:0, grossRevenue:0, shippingCharged:0, discounts:0, returns:0, taxes:0, fees:0 };
    return byDate[dk];
  };

  for (const o of orders) {
    const dk      = o.created_at.split('T')[0];
    const d       = ensure(dk, new Date(o.created_at));
    const netPaid = parseFloat(o.total_price)     || 0;  // lo que pagó el cliente
    const disc    = parseFloat(o.total_discounts) || 0;  // descuento dado
    const gross   = netPaid + disc;                       // precio lista antes de descuento
    const ship    = (o.shipping_lines ?? []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0);
    d.ordersCount++;
    d.grossRevenue    += gross;    // precio lista
    d.shippingCharged += ship;
    d.discounts       += disc;     // = gross - netPaid
    d.taxes           += parseFloat(o.total_tax) || 0;
    d.fees            += netPaid * cfg.gatewayPct + cfg.gatewayFixed;  // fees sobre lo cobrado
  }
  for (const o of refundOrders) {
    for (const ref of (o.refunds ?? [])) {
      const dk  = (ref.created_at ?? o.updated_at ?? o.created_at).split('T')[0];
      const d   = ensure(dk, new Date(dk));
      const amt = (ref.transactions ?? []).reduce((s, t) => t.kind === 'refund' ? s + (parseFloat(t.amount) || 0) : s, 0);
      d.returns += amt;
    }
  }

  let synced = 0;
  for (const [dateKey, metrics] of Object.entries(byDate)) {
    const aov        = metrics.ordersCount > 0 ? metrics.grossRevenue / metrics.ordersCount : 0;
    const netRevenue = metrics.grossRevenue - metrics.discounts - metrics.returns;
    const netProfit  = netRevenue - metrics.fees;
    const netMargin  = metrics.grossRevenue > 0 ? (netProfit / metrics.grossRevenue) * 100 : 0;
    const shopifyId  = `shopify_${storeName}_${dateKey}`;

    const existing = await prisma.dailyMetric.findFirst({
      where: {
        date: metrics.date, brandId: cfg.brandId, countryId: cfg.countryId,
        id: { not: { startsWith: 'shopify_' } }
      }
    });

    const payload = {
      ordersCount: metrics.ordersCount, unitsSold: metrics.ordersCount,
      grossRevenue: metrics.grossRevenue, netRevenue,
      discounts: metrics.discounts, returns: metrics.returns,
      shippingCost: metrics.shippingCharged, fees: metrics.fees,
      taxes: metrics.taxes, netProfit, netMargin, aov,
      notes: `Shopify sync 90d`,
    };

    if (existing) {
      await prisma.dailyMetric.update({ where: { id: existing.id }, data: payload });
    } else {
      await prisma.dailyMetric.upsert({
        where: { id: shopifyId },
        create: { id: shopifyId, date: metrics.date, brandId: cfg.brandId, countryId: cfg.countryId, storeId: cfg.storeId, adSpend: 0, cogs: 0, roas: 0, ...payload },
        update: payload,
      });
    }
    synced++;
  }

  const totalRev  = Object.values(byDate).reduce((s, d) => s + d.grossRevenue, 0);
  const totalDisc = Object.values(byDate).reduce((s, d) => s + d.discounts, 0);
  const totalRet  = Object.values(byDate).reduce((s, d) => s + d.returns, 0);
  console.log(`  Dias sincronizados: ${synced}`);
  console.log(`  Revenue: ${cfg.currency} ${totalRev.toFixed(2)}`);
  console.log(`  Descuentos: ${cfg.currency} ${totalDisc.toFixed(2)} (${totalRev > 0 ? (totalDisc / totalRev * 100).toFixed(1) : 0}%)`);
  console.log(`  Devoluciones: ${cfg.currency} ${totalRet.toFixed(2)}`);
}

// Re-rollup Meta Ads
console.log('\n=== RE-ROLLUP META ADS ===');
const from = new Date(Date.now() - 90 * 864e5);
const to   = new Date();

const grouped = await prisma.adSpend.groupBy({
  by: ['brandId', 'date'],
  _sum: { spend: true },
  where: { date: { gte: from, lte: to } }
});

let rollupUpdated = 0;
for (const row of grouped) {
  const adSpend  = row._sum.spend ?? 0;
  const d        = row.date;
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
  const dayEnd   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59));

  const metric = await prisma.dailyMetric.findFirst({
    where: { brandId: row.brandId, date: { gte: dayStart, lte: dayEnd } }
  });
  if (!metric) continue;

  const netRevenue = metric.netRevenue || metric.grossRevenue;
  const netProfit  = netRevenue - metric.cogs - metric.shippingCost - metric.fees
                   - metric.handlingFees - metric.taxes - metric.otherCosts - adSpend;
  const netMargin  = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
  const roas       = adSpend > 0 ? netRevenue / adSpend : 0;
  const cpa        = metric.ordersCount > 0 && adSpend > 0 ? adSpend / metric.ordersCount : 0;

  await prisma.dailyMetric.update({
    where: { id: metric.id },
    data: { adSpend, netProfit, netMargin, roas: roas > 0 ? roas : 0, cpa: cpa > 0 ? cpa : null }
  });
  rollupUpdated++;
}
console.log(`  ${rollupUpdated} dias actualizados con adSpend real`);

// Resumen Mayo 2026
console.log('\n=== RESUMEN MAYO 2026 ===');
const may = await prisma.dailyMetric.findMany({
  where: { date: { gte: new Date('2026-05-01'), lte: new Date('2026-05-31') } }
});
const byBrand = {};
for (const m of may) {
  if (!byBrand[m.brandId]) byBrand[m.brandId] = { gross:0, net:0, adSpend:0, fees:0, returns:0, profit:0, orders:0, discounts:0 };
  const b = byBrand[m.brandId];
  b.gross    += m.grossRevenue; b.net      += m.netRevenue;
  b.adSpend  += m.adSpend;     b.fees     += m.fees;
  b.returns  += m.returns;     b.profit   += m.netProfit;
  b.orders   += m.ordersCount; b.discounts += m.discounts;
}
for (const [brand, b] of Object.entries(byBrand)) {
  const margin = b.gross > 0 ? (b.profit / b.gross * 100).toFixed(1) : 0;
  const roas   = b.adSpend > 0 ? (b.net / b.adSpend).toFixed(2) : 'sin ads';
  console.log(`\n  ${brand}:`);
  console.log(`    Revenue bruto: ${b.gross.toFixed(2)}`);
  console.log(`    Descuentos:    ${b.discounts.toFixed(2)} (${b.gross > 0 ? (b.discounts/b.gross*100).toFixed(1) : 0}%)`);
  console.log(`    Devoluciones:  ${b.returns.toFixed(2)}`);
  console.log(`    Revenue neto:  ${b.net.toFixed(2)}`);
  console.log(`    Fees:          ${b.fees.toFixed(2)}`);
  console.log(`    Ad Spend:      ${b.adSpend.toFixed(2)}`);
  console.log(`    Net Profit:    ${b.profit.toFixed(2)}`);
  console.log(`    Net Margin:    ${margin}%`);
  console.log(`    ROAS:          ${roas}x`);
  console.log(`    Ordenes:       ${b.orders}`);
}

await prisma.$disconnect();
