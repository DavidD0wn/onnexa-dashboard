import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/meta-ads/merge-daily
 *
 * Lee la tabla AdSpend, agrupa por (fecha, brandId, countryId) y actualiza
 * DailyMetric.adSpend + recalcula netProfit, netMargin, cpa, roas, mer.
 *
 * Estrategia de distribución:
 *  - Si hay AdSpend con countryId → match exacto por (fecha, brand, country)
 *  - Si solo hay AdSpend a nivel brand → distribuye equitativamente entre las filas del día
 *
 * Body (opcional): { dateFrom: "YYYY-MM-DD", dateTo: "YYYY-MM-DD" }
 * Sin body → últimos 60 días
 */
export async function POST(req: NextRequest) {
  try {
    const body     = await req.json().catch(() => ({}));
    const today    = new Date();
    const dateTo   = body.dateTo   ?? today.toISOString().slice(0, 10);
    const dateFrom = body.dateFrom ?? new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);

    const from = new Date(dateFrom + "T00:00:00.000Z");
    const to   = new Date(dateTo   + "T23:59:59.999Z");

    // 1. Traer todos los AdSpend del rango
    const adRows = await prisma.adSpend.findMany({
      where: { date: { gte: from, lte: to } },
    });

    if (!adRows.length) {
      return NextResponse.json({ ok: true, updated: 0, message: "Sin datos en AdSpend para el rango" });
    }

    // 2. Agrupar gasto a dos niveles:
    //    a) Por (fecha, brandId, countryId) — para match exacto
    //    b) Por (fecha, brandId)            — total por marca/día
    const spendByCountry: Record<string, number> = {};  // key: date|brandId|countryId
    const spendByBrand:   Record<string, number> = {};  // key: date|brandId

    for (const r of adRows) {
      const date = r.date.toISOString().slice(0, 10);
      const keyC = `${date}|${r.brandId}|${r.countryId}`;
      const keyB = `${date}|${r.brandId}`;
      spendByCountry[keyC] = (spendByCountry[keyC] ?? 0) + r.spend;
      spendByBrand[keyB]   = (spendByBrand[keyB]   ?? 0) + r.spend;
    }

    // 3. Traer los DailyMetric del rango
    const metrics = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
    });

    // 4. Contar cuántas filas hay por (fecha, brandId) para distribuir proporcionalmente
    const rowsPerBrandDay: Record<string, number> = {};
    for (const m of metrics) {
      const key = `${m.date.toISOString().slice(0, 10)}|${m.brandId}`;
      rowsPerBrandDay[key] = (rowsPerBrandDay[key] ?? 0) + 1;
    }

    let updated = 0;
    let skipped = 0;

    for (const m of metrics) {
      const date = m.date.toISOString().slice(0, 10);
      const keyC = `${date}|${m.brandId}|${m.countryId}`;
      const keyB = `${date}|${m.brandId}`;

      let newAdSpend: number;

      if (spendByCountry[keyC] !== undefined) {
        // Match exacto por país — usa el gasto de esa cuenta específica
        newAdSpend = spendByCountry[keyC];
      } else if (spendByBrand[keyB] !== undefined) {
        // Sin desglose por país → dividir equitativamente entre las filas del día
        const rowCount = rowsPerBrandDay[keyB] ?? 1;
        newAdSpend = spendByBrand[keyB] / rowCount;
      } else {
        skipped++;
        continue;
      }

      // Recalcular métricas derivadas
      const newProfit = m.grossRevenue - m.cogs - m.shippingCost - m.fees - m.taxes - m.otherCosts - newAdSpend;
      const newMargin = m.grossRevenue > 0 ? (newProfit / m.grossRevenue) * 100 : 0;
      const newCpa    = m.ordersCount > 0 && newAdSpend > 0 ? newAdSpend / m.ordersCount : null;
      const newRoas   = newAdSpend > 0 ? m.grossRevenue / newAdSpend : null;
      const newMer    = newAdSpend > 0 ? m.grossRevenue / newAdSpend : null;

      await prisma.dailyMetric.update({
        where: { id: m.id },
        data: {
          adSpend:   newAdSpend,
          netProfit: newProfit,
          netMargin: newMargin,
          cpa:       newCpa,
          roas:      newRoas,
          mer:       newMer,
        },
      });
      updated++;
    }

    return NextResponse.json({
      ok: true,
      dateFrom,
      dateTo,
      adSpendEntries: Object.keys(spendByBrand).length,
      dailyMetricRows: metrics.length,
      updated,
      skipped,
    });
  } catch (err: any) {
    console.error("[Meta Ads Merge]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** GET → muestra el estado actual del merge */
export async function GET() {
  const total   = await prisma.dailyMetric.count();
  const withAds = await prisma.dailyMetric.count({ where: { adSpend: { gt: 0 } } });
  const lastSync = await prisma.metaAdsSyncLog
    .findFirst({ orderBy: { createdAt: "desc" } })
    .catch(() => null);

  return NextResponse.json({ total, withAds, withoutAds: total - withAds, lastMetaSync: lastSync });
}
