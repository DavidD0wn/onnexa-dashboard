/**
 * POST /api/meta-ads/rollup
 *
 * Toma los registros de AdSpend (por brand+country+día) y los escribe en
 * DailyMetric.adSpend, luego recalcula netProfit, netMargin, roas, cpa.
 *
 * Reglas de atribución de gasto por país:
 *  - Glowmmi (splitByCountry=true): el gasto US va a country_us, MX a country_mx, etc.
 *  - Balancea (splitByCountry=false): todo el revenue está en country_mx.
 *    Sus campañas Meta pueden tener countryId=country_us, pero el gasto se
 *    consolida siempre en country_mx para que revenue y adSpend estén en el
 *    mismo row del dashboard.
 *
 * Si no existe fila DailyMetric para ese brand+country+día, la crea con
 * adSpend y revenue=0 para que el gasto nunca se pierda.
 *
 * Body: { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD" }  (sin body = todo el historial)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* Brands donde TODO el revenue está en un único countryId (splitByCountry=false).
   El gasto de Meta —sin importar el país de la campaña— se consolida en ese country. */
const SINGLE_COUNTRY_BRAND: Record<string, { countryId: string; storeId: string }> = {
  brand_balancea: { countryId: "country_mx", storeId: "store_balancea_mx" },
};

/* Fallback para crear filas nuevas cuando no existe DailyMetric (caso Glowmmi) */
const BRAND_DEFAULTS: Record<string, { storeId: string; countryId: string }> = {
  brand_glowmmi:  { storeId: "store_glowmmi_us",  countryId: "country_us" },
  brand_balancea: { storeId: "store_balancea_mx",  countryId: "country_mx" },
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const from = body.from ? new Date(body.from + "T00:00:00Z") : new Date("2020-01-01");
    const to   = body.to   ? new Date(body.to   + "T23:59:59Z") : new Date();

    /* 1. Agrupar AdSpend por brandId + countryId + fecha
       (antes agrupaba solo por brand+date → volcaba TODO el gasto al row de mayor revenue) */
    const grouped = await prisma.adSpend.groupBy({
      by:   ["brandId", "countryId", "date"],
      _sum: { spend: true },
      where: { date: { gte: from, lte: to } },
    });

    if (grouped.length === 0) {
      return NextResponse.json({ ok: true, updated: 0, message: "Sin registros de AdSpend en ese rango" });
    }

    let updated  = 0;
    let created  = 0;
    let skipped  = 0;

    for (const row of grouped) {
      const adSpend  = row._sum.spend ?? 0;
      const date     = row.date;
      const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const dayEnd   = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59));

      /* Para marcas single-country, forzar countryId al consolidado.
         También zerear adSpend en los rows de países "incorrectos" para
         evitar doble conteo si el rollup viejo los había escrito antes. */
      const singleCountry = SINGLE_COUNTRY_BRAND[row.brandId];
      const targetCountry = singleCountry?.countryId ?? row.countryId;
      if (singleCountry && row.countryId !== targetCountry) {
        // Zero out any stale adSpend in non-target country rows for this brand+date
        await prisma.dailyMetric.updateMany({
          where: { brandId: row.brandId, countryId: row.countryId, date: { gte: dayStart, lte: dayEnd }, adSpend: { gt: 0 } },
          data:  { adSpend: 0, netProfit: 0, netMargin: 0, roas: 0, cpa: null },
        });
      }

      /* Buscar el DailyMetric para ese brand+country+día.
         Prioridad: CUID (Sheet5/importados) > shopify_* */
      const allMetrics = await prisma.dailyMetric.findMany({
        where: {
          brandId:   row.brandId,
          countryId: targetCountry,
          date:      { gte: dayStart, lte: dayEnd },
        },
        orderBy: { grossRevenue: "desc" },
      });

      let metric;

      if (allMetrics.length === 0) {
        /* No existe fila — crearla para no perder el gasto */
        const defaults = BRAND_DEFAULTS[row.brandId];
        if (!defaults) { skipped++; continue; }

        metric = await prisma.dailyMetric.create({
          data: {
            date:      dayStart,
            brandId:   row.brandId,
            countryId: targetCountry,
            storeId:   singleCountry?.storeId ?? defaults.storeId,
            adSpend,
            netProfit: -adSpend,
            netMargin: 0,
          },
        });
        created++;
        continue;
      }

      /* Preferir filas no-shopify (CSV/importados) sobre shopify_* */
      metric = allMetrics.find(m => !m.id.startsWith("shopify_")) ?? allMetrics[0];

      /* Si hay múltiples rows para el mismo brand+country+día (e.g. por imports duplicados),
         el gasto se aplica al de mayor grossRevenue (ya ordenado desc arriba). */

      const netRevenue = metric.netRevenue || metric.grossRevenue;
      const netProfit  = netRevenue - metric.cogs - metric.shippingCost - metric.fees - metric.taxes - metric.otherCosts - adSpend;
      const netMargin  = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;
      const roas       = adSpend > 0 ? netRevenue / adSpend : 0;
      const cpa        = metric.ordersCount > 0 && adSpend > 0 ? adSpend / metric.ordersCount : 0;

      await prisma.dailyMetric.update({
        where: { id: metric.id },
        data: {
          adSpend,
          netProfit,
          netMargin,
          roas: roas > 0 ? roas : 0,
          cpa:  cpa  > 0 ? cpa  : null,
        },
      });
      updated++;
    }

    return NextResponse.json({
      ok: true,
      updated,
      created,
      skipped,
      message: `${updated} días actualizados, ${created} filas nuevas creadas con adSpend. ${skipped} sin soporte de brand.`,
    });
  } catch (err: any) {
    console.error("[Rollup]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  /* Estado actual del adSpend en DailyMetric */
  const stats = await prisma.dailyMetric.aggregate({
    _sum:   { adSpend: true, netProfit: true },
    _count: { id: true },
    _min:   { date: true },
    _max:   { date: true },
  });
  const withAdSpend = await prisma.dailyMetric.count({ where: { adSpend: { gt: 0 } } });
  const inAdSpendTable = await prisma.adSpend.aggregate({ _sum: { spend: true }, _count: { id: true } });

  return NextResponse.json({
    dailyMetric: {
      totalRows:     stats._count.id,
      rowsWithAdSpend: withAdSpend,
      totalAdSpend:  stats._sum.adSpend,
      totalNetProfit: stats._sum.netProfit,
      dateRange: { from: stats._min.date, to: stats._max.date },
    },
    adSpendTable: {
      totalRows:  inAdSpendTable._count.id,
      totalSpend: inAdSpendTable._sum.spend,
    },
    synced: withAdSpend > 0,
  });
}
