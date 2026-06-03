import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtDate = (d: Date) =>
  d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

export async function POST(req: Request) {
  try {
    const body   = await req.json().catch(() => ({}));
    const period = parseInt(body.period ?? "30");
    const brand  = body.brand ?? "all";
    const type   = body.type  ?? "monthly";

    const today = new Date();
    const from  = new Date(Date.now() - (period - 1) * 864e5);

    const where: any = { date: { gte: from } };
    if (brand !== "all") where.brandId = `brand_${brand}`;

    const [metrics, adRows, products] = await Promise.all([
      prisma.dailyMetric.findMany({
        where,
        include: { brand: true, country: true },
        orderBy: { date: "asc" },
      }),
      prisma.adSpend.groupBy({
        by: ["brandId", "date"], _sum: { spend: true },
        where: { date: { gte: from }, ...(brand !== "all" ? { brandId: `brand_${brand}` } : {}) },
        orderBy: { date: "asc" },
      }),
      prisma.adSpend.groupBy({
        by: ["brandId"], _sum: { spend: true },
        where: { date: { gte: from } },
      }),
    ]);

    // ── Totals ────────────────────────────────────────────────────────────────
    const revenue  = metrics.reduce((s, m) => s + m.grossRevenue, 0);
    const net      = metrics.reduce((s, m) => s + m.netRevenue,   0);
    const orders   = metrics.reduce((s, m) => s + m.ordersCount,  0);
    const units    = metrics.reduce((s, m) => s + m.unitsSold,    0);
    const cogs     = metrics.reduce((s, m) => s + m.cogs,         0);
    const fees     = metrics.reduce((s, m) => s + m.fees,         0);
    const shipping = metrics.reduce((s, m) => s + m.shippingCost, 0);
    const adSpend  = adRows.reduce((s, r) => s + (r._sum.spend ?? 0), 0);
    const profit   = net - cogs - fees - shipping - adSpend;
    const margin   = net > 0 ? (profit / net) * 100 : 0;
    const roas     = adSpend > 0 ? net / adSpend : null;
    const cpa      = orders > 0 && adSpend > 0 ? adSpend / orders : null;
    const aov      = orders > 0 ? revenue / orders : 0;

    // ── Daily chart data ──────────────────────────────────────────────────────
    const byDate: Record<string, { revenue: number; profit: number; orders: number; adSpend: number }> = {};
    for (const m of metrics) {
      const d = m.date.toISOString().slice(0, 10);
      if (!byDate[d]) byDate[d] = { revenue: 0, profit: 0, orders: 0, adSpend: 0 };
      byDate[d].revenue += m.grossRevenue;
      byDate[d].profit  += m.netProfit;
      byDate[d].orders  += m.ordersCount;
    }
    for (const r of adRows) {
      const d = r.date.toISOString().slice(0, 10);
      if (byDate[d]) byDate[d].adSpend += r._sum.spend ?? 0;
    }
    const chartDays = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));

    // ── By brand ─────────────────────────────────────────────────────────────
    const byBrand: Record<string, { name: string; revenue: number; orders: number; adSpend: number }> = {};
    for (const m of metrics) {
      const k = m.brand.name;
      if (!byBrand[k]) byBrand[k] = { name: k, revenue: 0, orders: 0, adSpend: 0 };
      byBrand[k].revenue += m.grossRevenue;
      byBrand[k].orders  += m.ordersCount;
    }
    for (const r of products) {
      const entry = Object.values(byBrand).find((b) =>
        r.brandId === "brand_glowmmi" ? b.name === "Glowmmi" : b.name === "Balancea"
      );
      if (entry) entry.adSpend += r._sum.spend ?? 0;
    }

    const brandLabel = brand === "all" ? "Todas las marcas" : brand === "glowmmi" ? "Glowmmi" : "Balancea";
    const filename = `reporte-${type}-${today.toISOString().slice(0, 10)}.html`;

    // ── Bar chart SVG ─────────────────────────────────────────────────────────
    const maxRev = Math.max(...chartDays.map(([, v]) => v.revenue), 1);
    const barW   = Math.max(8, Math.min(24, Math.floor(560 / chartDays.length) - 2));
    const chartBars = chartDays.slice(-30).map(([date, v], i) => {
      const h = Math.round((v.revenue / maxRev) * 80);
      const x = 20 + i * (barW + 2);
      const dateShort = date.slice(5);
      return `<rect x="${x}" y="${100 - h}" width="${barW}" height="${h}" fill="#6366f1" rx="2" opacity="0.85"/>
              <title>${dateShort}: ${fmt(v.revenue)}</title>`;
    }).join("\n");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Reporte Onnexa — ${fmtDate(from)} – ${fmtDate(today)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
  .page { max-width: 900px; margin: 0 auto; padding: 48px 40px; }
  .header { background: linear-gradient(135deg, #12304A 0%, #1a4a6a 100%); color: #fff; padding: 40px; border-radius: 16px; margin-bottom: 32px; }
  .header h1 { font-size: 28px; font-weight: 800; margin-bottom: 6px; }
  .header p  { font-size: 14px; opacity: 0.7; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
  .kpi .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
  .kpi .value { font-size: 26px; font-weight: 800; color: #0f172a; line-height: 1; }
  .kpi .sub   { font-size: 12px; color: #64748b; margin-top: 4px; }
  .section { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .section h2 { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #f1f5f9; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  td.num { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .good { color: #059669; } .bad { color: #dc2626; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
  .pill-green { background: #d1fae5; color: #065f46; }
  .pill-yellow { background: #fef3c7; color: #92400e; }
  .pill-red { background: #fee2e2; color: #991b1b; }
  .footer { text-align: center; padding: 24px 0; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; margin-top: 32px; }
  @media print {
    body { background: #fff; }
    .page { padding: 20px; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <div class="no-print" style="text-align:right;margin-bottom:16px">
    <button onclick="window.print()" style="padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">
      🖨️ Imprimir / Guardar PDF
    </button>
  </div>

  <div class="header">
    <h1>📊 Reporte Onnexa — ${brandLabel}</h1>
    <p>${fmtDate(from)} → ${fmtDate(today)} · ${period} días · Generado el ${fmtDate(today)}</p>
  </div>

  <div class="kpi-grid">
    <div class="kpi">
      <div class="label">Revenue Bruto</div>
      <div class="value">${fmt(revenue)}</div>
      <div class="sub">${orders} órdenes · AOV ${fmt(aov)}</div>
    </div>
    <div class="kpi">
      <div class="label">Ad Spend</div>
      <div class="value">${fmt(adSpend)}</div>
      <div class="sub">ROAS ${roas ? roas.toFixed(2) + "x" : "N/A"} · CPA ${cpa ? fmt(cpa) : "N/A"}</div>
    </div>
    <div class="kpi">
      <div class="label">Ganancia Neta</div>
      <div class="value" class="${profit >= 0 ? "good" : "bad"}">${fmt(profit)}</div>
      <div class="sub">Margen ${fmtPct(margin)}</div>
    </div>
    <div class="kpi">
      <div class="label">Unidades</div>
      <div class="value">${units}</div>
      <div class="sub">COGS total ${fmt(cogs)}</div>
    </div>
  </div>

  <div class="section">
    <h2>Revenue por día (últimos ${Math.min(30, chartDays.length)} días)</h2>
    <svg width="100%" viewBox="0 0 600 110" preserveAspectRatio="none" style="height:100px;overflow:visible">
      ${chartBars}
    </svg>
  </div>

  <div class="section">
    <h2>Desglose por Marca</h2>
    <table>
      <thead><tr><th>Marca</th><th style="text-align:right">Revenue</th><th style="text-align:right">Órdenes</th><th style="text-align:right">Ad Spend</th><th style="text-align:right">ROAS</th></tr></thead>
      <tbody>
        ${Object.values(byBrand).map(b => {
          const bRoas = b.adSpend > 0 ? b.revenue / b.adSpend : null;
          return `<tr>
            <td><strong>${b.name}</strong></td>
            <td class="num">${fmt(b.revenue)}</td>
            <td class="num">${b.orders}</td>
            <td class="num">${fmt(b.adSpend)}</td>
            <td class="num">${bRoas ? bRoas.toFixed(2) + "x" : "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Ventas diarias (últimos 7 días)</h2>
    <table>
      <thead><tr><th>Fecha</th><th style="text-align:right">Revenue</th><th style="text-align:right">Órdenes</th><th style="text-align:right">Ad Spend</th><th style="text-align:right">Profit est.</th></tr></thead>
      <tbody>
        ${chartDays.slice(-7).reverse().map(([date, v]) => {
          const dayProfit = v.profit - v.adSpend;
          return `<tr>
            <td>${date}</td>
            <td class="num">${fmt(v.revenue)}</td>
            <td class="num">${v.orders}</td>
            <td class="num">${fmt(v.adSpend)}</td>
            <td class="num ${dayProfit >= 0 ? "good" : "bad"}">${fmt(dayProfit)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Resumen P&L</h2>
    <table>
      <tbody>
        <tr><td>Revenue Bruto</td><td class="num">${fmt(revenue)}</td></tr>
        <tr><td>— Descuentos y devoluciones</td><td class="num bad">−${fmt(revenue - net)}</td></tr>
        <tr><td><strong>Revenue Neto</strong></td><td class="num"><strong>${fmt(net)}</strong></td></tr>
        <tr><td>— COGS (costo producto)</td><td class="num bad">−${fmt(cogs)}</td></tr>
        <tr><td>— Shipping</td><td class="num bad">−${fmt(shipping)}</td></tr>
        <tr><td>— Fees pasarela</td><td class="num bad">−${fmt(fees)}</td></tr>
        <tr><td>— Ad Spend</td><td class="num bad">−${fmt(adSpend)}</td></tr>
        <tr style="background:#f8fafc;font-weight:700"><td><strong>Ganancia Neta</strong></td><td class="num ${profit >= 0 ? "good" : "bad"}"><strong>${fmt(profit)}</strong></td></tr>
        <tr><td style="color:#64748b">Margen neto</td><td class="num ${margin >= 15 ? "good" : margin >= 5 ? "" : "bad"}">${fmtPct(margin)}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    Generado por Onnexa Dashboard · ${new Date().toLocaleString("es-MX")} · Los datos provienen de Shopify y Meta Ads
  </div>
</div>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
