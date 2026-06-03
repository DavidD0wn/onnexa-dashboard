/**
 * import-sheet5-products.mjs
 * Importa datos POR PRODUCTO del Sheet5 → ProductDailyStat
 * Uso: node import-sheet5-products.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:C:/Users/hamle/Desktop/onnexa-dashboard/prisma/dev.db' } }
});

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1YECNTC0sQ7gzQl-dGn3CiPj4MYfdzkNAkOLyhBhEyrU/export?format=csv&gid=1448601766';

const PRODUCT_BRAND = {
  'HB01':'brand_glowmmi','RS01':'brand_glowmmi','INS01':'brand_glowmmi',
  'DC01':'brand_glowmmi','RE01':'brand_glowmmi','TP01':'brand_glowmmi',
  'GF01':'brand_glowmmi','DB01':'brand_glowmmi','JTP01':'brand_glowmmi',
  'CAE01':'brand_glowmmi','CLM01':'brand_glowmmi','CCM01':'brand_glowmmi',
  'CTX01':'brand_balancea','HR01':'brand_balancea','ST01':'brand_balancea',
  'FL01':'brand_balancea','IN01':'brand_balancea','AX01':'brand_balancea','MW01':'brand_balancea',
};

function detectBrand(productId, productName) {
  if (PRODUCT_BRAND[productId]) return PRODUCT_BRAND[productId];
  const name = (productName || '').toLowerCase();
  if (name.includes('cutting') || name.includes('herbiotic') || name.includes('clearstem') ||
      name.includes('flexi') || name.includes('inositol') || name.includes('astaxanthin') ||
      name.includes('smyle') || name.includes('mouthwash') || name.includes('airi') ||
      name.includes('curva') || name.includes('fertil')) return 'brand_balancea';
  return 'brand_glowmmi';
}

function parseNum(val) {
  if (!val || val === '' || val === '#REF!' || val === '#DIV/0!' || val === '—') return 0;
  return parseFloat(String(val).replace(/[$,%\s]/g, '').replace(/,/g, '')) || 0;
}

function parseDate(str) {
  if (!str || str.trim() === '') return null;
  const parts = str.trim().split('/');
  if (parts.length < 2) return null;
  const day = parseInt(parts[0]), month = parseInt(parts[1]);
  const year = parts[2] ? (parseInt(parts[2]) < 100 ? 2000 + parseInt(parts[2]) : parseInt(parts[2])) : 2026;
  if (isNaN(day) || isNaN(month)) return null;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

async function main() {
  // Fetch CSV
  console.log('Fetching Sheet5...');
  const res = await fetch(SHEET_URL, { redirect: 'follow' });
  const text = await res.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Find header
  let headerIdx = -1;
  for (let i = 0; i < 10; i++) {
    if (lines[i].toLowerCase().includes('fecha') && lines[i].toLowerCase().includes('pedidos')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) headerIdx = 0;

  const headers = lines[headerIdx].split(',').map(h => h.replace(/"/g, '').trim());
  const idx = {
    fecha:       headers.findIndex(h => h.toLowerCase().includes('fecha')),
    productId:   headers.findIndex(h => h.toLowerCase().includes('productid') || h.toLowerCase() === 'id'),
    producto:    headers.findIndex(h => h.toLowerCase() === 'producto'),
    pedidos:     headers.findIndex(h => h.toLowerCase() === 'pedidos'),
    ventasMxn:   headers.findIndex(h => h.toLowerCase().includes('ventas mxn')),
    ventasUsd:   headers.findIndex(h => h.toLowerCase().includes('ventas usd')),
    adsUsd:      headers.findIndex(h => h.toLowerCase().includes('ads usd')),
    cpaReal:     headers.findIndex(h => h.toLowerCase().includes('cpa real')),
    roas:        headers.findIndex(h => h.toLowerCase() === 'roas'),
    costoTotal:  headers.findIndex(h => h.toLowerCase().includes('costo total usd')),
    feePasarela: headers.findIndex(h => h.toLowerCase().includes('fee pasarela usd')),
    utilidad:    headers.findIndex(h => h.toLowerCase().includes('utilidad usd') || h.toLowerCase() === 'utilidad usd'),
    rentable:    headers.findIndex(h => h.toLowerCase().includes('rentable')),
  };

  // Parse rows
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of lines[i] + ',') {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    const fecha = idx.fecha >= 0 ? cols[idx.fecha] : '';
    const date = parseDate(fecha);
    if (!date) continue;
    const productId = (idx.productId >= 0 ? cols[idx.productId] : '').replace(/"/g, '').trim();
    const producto  = (idx.producto  >= 0 ? cols[idx.producto]  : '').replace(/"/g, '').trim();
    if (!productId && !producto) continue;

    const rentableStr = (idx.rentable >= 0 ? cols[idx.rentable] : '').trim();
    rows.push({
      date, productId, productName: producto,
      brandId:     detectBrand(productId, producto),
      orders:      parseNum(idx.pedidos     >= 0 ? cols[idx.pedidos]     : '0'),
      revenueMxn:  parseNum(idx.ventasMxn   >= 0 ? cols[idx.ventasMxn]   : '0'),
      revenueUsd:  parseNum(idx.ventasUsd   >= 0 ? cols[idx.ventasUsd]   : '0'),
      adSpendUsd:  parseNum(idx.adsUsd      >= 0 ? cols[idx.adsUsd]      : '0'),
      cpaReal:     parseNum(idx.cpaReal     >= 0 ? cols[idx.cpaReal]     : '0'),
      roas:        parseNum(idx.roas        >= 0 ? cols[idx.roas]        : '0'),
      costoTotal:  parseNum(idx.costoTotal  >= 0 ? cols[idx.costoTotal]  : '0'),
      feePasarela: parseNum(idx.feePasarela >= 0 ? cols[idx.feePasarela] : '0'),
      profitUsd:   parseNum(idx.utilidad    >= 0 ? cols[idx.utilidad]    : '0'),
      isProfit:    rentableStr.includes('✅') || rentableStr.toLowerCase() === 'si' || rentableStr === '1',
    });
  }

  console.log(`Parsed ${rows.length} product-day rows`);

  // Clear existing and insert fresh
  const deleted = await prisma.productDailyStat.deleteMany({});
  console.log(`Cleared ${deleted.count} existing rows`);

  let inserted = 0;
  for (const r of rows) {
    const id = `pds_${r.productId}_${r.date.toISOString().slice(0,10)}`;
    const cogsUsd = r.costoTotal - r.feePasarela;
    await prisma.productDailyStat.upsert({
      where: { id },
      update: {
        orders: r.orders, revenueMxn: r.revenueMxn, revenueUsd: r.revenueUsd,
        adSpendUsd: r.adSpendUsd, cogsUsd: cogsUsd > 0 ? cogsUsd : 0,
        feesUsd: r.feePasarela, profitUsd: r.profitUsd,
        roas: r.roas > 0 ? r.roas : null, cpaReal: r.cpaReal > 0 ? r.cpaReal : null,
        isProfit: r.isProfit,
      },
      create: {
        id, date: r.date, productCode: r.productId, productName: r.productName,
        brandId: r.brandId, orders: r.orders, revenueMxn: r.revenueMxn, revenueUsd: r.revenueUsd,
        adSpendUsd: r.adSpendUsd, cogsUsd: cogsUsd > 0 ? cogsUsd : 0,
        feesUsd: r.feePasarela, profitUsd: r.profitUsd,
        roas: r.roas > 0 ? r.roas : null, cpaReal: r.cpaReal > 0 ? r.cpaReal : null,
        isProfit: r.isProfit,
      }
    });
    inserted++;
  }

  console.log(`✅ Inserted/updated ${inserted} product-day rows`);

  // Stats
  const top = await prisma.productDailyStat.groupBy({
    by: ['productCode', 'productName', 'brandId'],
    _sum: { revenueUsd: true, profitUsd: true, orders: true, adSpendUsd: true },
    orderBy: { _sum: { revenueUsd: 'desc' } },
    take: 10,
  });
  console.log('\n🏆 Top 10 productos por revenue (YTD):');
  top.forEach((p, i) => {
    const rev = p._sum.revenueUsd?.toFixed(0);
    const profit = p._sum.profitUsd?.toFixed(0);
    const orders = p._sum.orders;
    console.log(`  ${i+1}. ${p.productName.slice(0,30)} | $${rev} rev | $${profit} profit | ${orders} pedidos`);
  });
}

main().catch(e => console.error('ERROR:', e.message)).finally(() => prisma.$disconnect());
