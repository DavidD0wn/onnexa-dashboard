/**
 * import-sheet5.mjs
 * Importa el P&L diario del Google Sheet (Sheet5 gid=1448601766)
 * al dashboard → DailyMetric (reemplaza data existente para esas fechas)
 *
 * Uso: node import-sheet5.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'file:C:/Users/hamle/Desktop/onnexa-dashboard/prisma/dev.db' } }
});

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1YECNTC0sQ7gzQl-dGn3CiPj4MYfdzkNAkOLyhBhEyrU/export?format=csv&gid=1448601766';

// ── Mapeo ProductID → brandId ──────────────────────────────────────────────
const PRODUCT_BRAND = {
  'HB01':  'brand_glowmmi',   // Holy Basil
  'RS01':  'brand_glowmmi',   // Retinal Shot
  'INS01': 'brand_glowmmi',   // InstantLift
  'DC01':  'brand_glowmmi',   // Deep Collagen
  'RE01':  'brand_glowmmi',   // Revive Eye
  'TP01':  'brand_glowmmi',   // Toner Pads / Jiyu Toner Pads
  'GF01':  'brand_glowmmi',   // Glowfill
  'DB01':  'brand_glowmmi',   // Debloted
  'JTP01': 'brand_glowmmi',   // Jiyu Toner Pads alt ID
  'CTX01': 'brand_balancea',  // Cutting Mix
  'HR01':  'brand_balancea',  // HerBiotic
  'ST01':  'brand_balancea',  // ClearStem
  'FL01':  'brand_balancea',  // Flexi
  'IN01':  'brand_balancea',  // Inositol
  'AX01':  'brand_balancea',  // Astaxanthin
  'MW01':  'brand_balancea',  // Mouthwash / SMYLE
  'CAE01': 'brand_glowmmi',   // Collar amor eterno (jewelry → Glowmmi store)
  'CLM01': 'brand_glowmmi',   // Collar libro mama
  'CCM01': 'brand_glowmmi',   // Collar corazon mama
};

// Fallback por nombre de producto si el ID no está mapeado
function detectBrand(productId, productName) {
  if (PRODUCT_BRAND[productId]) return PRODUCT_BRAND[productId];
  const name = (productName || '').toLowerCase();
  if (name.includes('cutting') || name.includes('herbiotic') || name.includes('clearstem') ||
      name.includes('flexi') || name.includes('inositol') || name.includes('astaxanthin') ||
      name.includes('smyle') || name.includes('mouthwash') || name.includes('airi') ||
      name.includes('curva') || name.includes('fertil')) {
    return 'brand_balancea';
  }
  return 'brand_glowmmi'; // default
}

const STORE_FOR_BRAND = {
  'brand_glowmmi':  'store_glowmmi_mx',
  'brand_balancea': 'store_balancea_mx',
};

// ── Helpers ────────────────────────────────────────────────────────────────
function parseNum(val) {
  if (!val || val === '' || val === '#REF!' || val === '#DIV/0!' || val === '—') return 0;
  return parseFloat(String(val).replace(/[$,%\s]/g, '').replace(/,/g, '')) || 0;
}

function parseDate(str) {
  // Formato: "22/01" o "22/01/26" → 2026-01-22
  if (!str || str.trim() === '') return null;
  const parts = str.trim().split('/');
  if (parts.length < 2) return null;
  const day = parseInt(parts[0]);
  const month = parseInt(parts[1]);
  const year = parts[2] ? (parseInt(parts[2]) < 100 ? 2000 + parseInt(parts[2]) : parseInt(parts[2])) : 2026;
  if (isNaN(day) || isNaN(month)) return null;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

// ── Fetch CSV con follow-redirect ──────────────────────────────────────────
async function fetchCSV(url) {
  console.log('Fetching CSV from Google Sheets...');
  let res = await fetch(url, { redirect: 'follow' });
  // Some environments need manual redirect follow
  if (res.status === 307 || res.status === 302 || res.status === 301) {
    const location = res.headers.get('location');
    if (location) res = await fetch(location);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching sheet`);
  return await res.text();
}

// ── Parse CSV ──────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return [];

  // Find header row (contains "Fecha" and "ProductID")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    if (lines[i].toLowerCase().includes('fecha') && lines[i].toLowerCase().includes('pedidos')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) { console.log('Header not found, using row 0'); headerIdx = 0; }

  const headers = lines[headerIdx].split(',').map(h => h.replace(/"/g, '').trim());
  console.log('Headers found:', headers.slice(0, 8).join(' | '));

  // Column indices
  const idx = {
    fecha:      headers.findIndex(h => h.toLowerCase().includes('fecha')),
    productId:  headers.findIndex(h => h.toLowerCase().includes('productid') || h.toLowerCase() === 'id'),
    producto:   headers.findIndex(h => h.toLowerCase() === 'producto'),
    pedidos:    headers.findIndex(h => h.toLowerCase() === 'pedidos'),
    ventasMxn:  headers.findIndex(h => h.toLowerCase().includes('ventas mxn') || h.toLowerCase() === 'ventas mxn'),
    ventasUsd:  headers.findIndex(h => h.toLowerCase().includes('ventas usd') || h.toLowerCase() === 'ventas usd'),
    adsMxn:     headers.findIndex(h => h.toLowerCase().includes('ads mxn')),
    adsUsd:     headers.findIndex(h => h.toLowerCase().includes('ads usd')),
    cpaReal:    headers.findIndex(h => h.toLowerCase().includes('cpa real')),
    roas:       headers.findIndex(h => h.toLowerCase() === 'roas'),
    costoTotal: headers.findIndex(h => h.toLowerCase().includes('costo total usd')),
    feePasarela:headers.findIndex(h => h.toLowerCase().includes('fee pasarela usd')),
    utilidad:   headers.findIndex(h => h.toLowerCase().includes('utilidad usd') || h.toLowerCase() === 'utilidad usd'),
    rentable:   headers.findIndex(h => h.toLowerCase().includes('rentable')),
  };

  console.log('Column mapping:', idx);

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.replace(/,/g, '').trim() === '') continue;

    // Simple CSV split (handles quoted fields)
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of line + ',') {
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

    rows.push({
      date,
      productId,
      producto,
      pedidos:     parseNum(idx.pedidos     >= 0 ? cols[idx.pedidos]     : '0'),
      ventasMxn:   parseNum(idx.ventasMxn   >= 0 ? cols[idx.ventasMxn]   : '0'),
      ventasUsd:   parseNum(idx.ventasUsd   >= 0 ? cols[idx.ventasUsd]   : '0'),
      adsUsd:      parseNum(idx.adsUsd      >= 0 ? cols[idx.adsUsd]      : '0'),
      cpaReal:     parseNum(idx.cpaReal     >= 0 ? cols[idx.cpaReal]     : '0'),
      roas:        parseNum(idx.roas        >= 0 ? cols[idx.roas]        : '0'),
      costoTotal:  parseNum(idx.costoTotal  >= 0 ? cols[idx.costoTotal]  : '0'),
      feePasarela: parseNum(idx.feePasarela >= 0 ? cols[idx.feePasarela] : '0'),
      utilidad:    parseNum(idx.utilidad    >= 0 ? cols[idx.utilidad]    : '0'),
    });
  }

  return rows;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // 1. Fetch & parse
  const csv = await fetchCSV(SHEET_URL);
  const rows = parseCSV(csv);
  console.log(`\nParsed ${rows.length} rows from sheet`);

  if (rows.length === 0) {
    console.log('No rows parsed — check the sheet format');
    return;
  }

  // Show sample
  console.log('\nSample rows:');
  rows.slice(0, 3).forEach(r => console.log(
    r.date.toISOString().slice(0,10), '|', r.productId, '|', r.producto.slice(0,20),
    '| orders:', r.pedidos, '| usd:', r.ventasUsd, '| ads:', r.adsUsd, '| profit:', r.utilidad
  ));

  // 2. Aggregate by date + brand
  const byDateBrand = new Map(); // key: "2026-01-22|brand_glowmmi"

  for (const row of rows) {
    const brand = detectBrand(row.productId, row.producto);
    const dateStr = row.date.toISOString().slice(0,10);
    const key = `${dateStr}|${brand}`;

    if (!byDateBrand.has(key)) {
      byDateBrand.set(key, {
        date: row.date,
        brandId: brand,
        countryId: 'country_mx',
        storeId: STORE_FOR_BRAND[brand],
        ordersCount: 0,
        unitsSold: 0,
        grossRevenue: 0,
        netRevenue: 0,
        adSpend: 0,
        cogs: 0,
        fees: 0,
        netProfit: 0,
        roas: 0,
        cpa: 0,
        roasCount: 0,
        cpaCount: 0,
      });
    }

    const agg = byDateBrand.get(key);
    agg.ordersCount  += row.pedidos;
    agg.unitsSold    += row.pedidos;
    agg.grossRevenue += row.ventasUsd;
    agg.netRevenue   += row.ventasUsd;
    agg.adSpend      += row.adsUsd;
    agg.cogs         += (row.costoTotal - row.feePasarela); // product+shipping cost
    agg.fees         += row.feePasarela;
    agg.netProfit    += row.utilidad;
    if (row.roas > 0)    { agg.roas += row.roas; agg.roasCount++; }
    if (row.cpaReal > 0) { agg.cpa  += row.cpaReal; agg.cpaCount++; }
  }

  console.log(`\nAggregated into ${byDateBrand.size} date+brand buckets`);

  // 3. Upsert into DailyMetric
  let inserted = 0, updated = 0, skipped = 0;

  for (const [key, agg] of byDateBrand) {
    if (agg.grossRevenue === 0 && agg.adSpend === 0) { skipped++; continue; }

    const dayStart = new Date(agg.date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(agg.date);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const avgRoas = agg.roasCount > 0 ? agg.roas / agg.roasCount : (agg.adSpend > 0 ? agg.netRevenue / agg.adSpend : 0);
    const avgCpa  = agg.cpaCount  > 0 ? agg.cpa  / agg.cpaCount  : (agg.ordersCount > 0 && agg.adSpend > 0 ? agg.adSpend / agg.ordersCount : null);
    const netMargin = agg.netRevenue > 0 ? (agg.netProfit / agg.netRevenue) * 100 : 0;
    const aov = agg.ordersCount > 0 ? agg.netRevenue / agg.ordersCount : 0;

    // Delete any existing sheet5_* row for this date+brand (avoid dupes)
    await prisma.dailyMetric.deleteMany({
      where: {
        id: { startsWith: 'sheet5_' },
        brandId: agg.brandId,
        date: { gte: dayStart, lte: dayEnd },
      }
    });

    // Check if a canonical CUID row exists — if so, update it
    const existing = await prisma.dailyMetric.findFirst({
      where: {
        brandId: agg.brandId,
        countryId: agg.countryId,
        date: { gte: dayStart, lte: dayEnd },
        id: { not: { startsWith: 'shopify_' } },
      },
      orderBy: { grossRevenue: 'desc' },
    });

    const payload = {
      ordersCount:  agg.ordersCount,
      unitsSold:    agg.unitsSold,
      grossRevenue: agg.grossRevenue,
      netRevenue:   agg.netRevenue,
      cogs:         agg.cogs,
      fees:         agg.fees,
      adSpend:      agg.adSpend,
      netProfit:    agg.netProfit,
      netMargin,
      aov,
      roas:  avgRoas > 0 ? avgRoas : null,
      cpa:   avgCpa,
      notes: `Sheet5 import — ${agg.ordersCount} órdenes USD`,
    };

    if (existing) {
      await prisma.dailyMetric.update({ where: { id: existing.id }, data: payload });
      updated++;
    } else {
      const id = `sheet5_${agg.brandId.replace('brand_','')}_${agg.date.toISOString().slice(0,10)}`;
      await prisma.dailyMetric.create({
        data: {
          id,
          date: agg.date,
          brandId: agg.brandId,
          countryId: agg.countryId,
          storeId: agg.storeId,
          ...payload,
        }
      });
      inserted++;
    }
  }

  console.log(`\n✅ Import completado:`);
  console.log(`   Insertados: ${inserted}`);
  console.log(`   Actualizados: ${updated}`);
  console.log(`   Saltados (vacíos): ${skipped}`);

  // 4. Quick verification
  const stats = await prisma.dailyMetric.aggregate({
    where: { date: { gte: new Date('2026-01-01') } },
    _sum: { grossRevenue: true, netProfit: true, adSpend: true, cogs: true },
    _count: { id: true },
  });
  console.log(`\n📊 DailyMetric total 2026:`);
  console.log(`   Rows: ${stats._count.id}`);
  console.log(`   Revenue USD: $${stats._sum.grossRevenue?.toFixed(0)}`);
  console.log(`   Net Profit USD: $${stats._sum.netProfit?.toFixed(0)}`);
  console.log(`   AdSpend USD: $${stats._sum.adSpend?.toFixed(0)}`);
  console.log(`   COGS USD: $${stats._sum.cogs?.toFixed(0)}`);
}

main().catch(e => { console.error('ERROR:', e.message, e.stack); })
  .finally(() => prisma.$disconnect());
