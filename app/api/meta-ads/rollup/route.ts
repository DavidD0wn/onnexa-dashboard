import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateProfit } from "@/lib/metrics";

export const runtime = "nodejs";
export const maxDuration = 300;

const BRAND_DEFAULTS: Record<
  string,
  { storeId: string; countryId: string }
> = {
  brand_glowmmi: {
    storeId: "store_glowmmi_us",
    countryId: "country_us",
  },
  brand_balancea: {
    storeId: "store_balancea_mx",
    countryId: "country_mx",
  },
  brand_pleena: {
    storeId: "store_pleena_mx",
    countryId: "country_mx",
  },
};

function storeIdFor(brandId: string, countryId: string): string | null {
  const brand =
    brandId === "brand_glowmmi"
      ? "glowmmi"
      : brandId === "brand_balancea"
        ? "balancea"
        : brandId === "brand_pleena"
          ? "pleena"
          : null;
  const country = countryId.replace(/^country_/, "").toLowerCase();
  return brand && ["mx", "us", "cl", "es"].includes(country)
    ? `store_${brand}_${country}`
    : null;
}

function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

async function runInBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(...await Promise.all(items.slice(index, index + batchSize).map(worker)));
  }
  return results;
}

function profitForMetric(
  metric: {
    netRevenue: number;
    grossRevenue: number;
    cogs: number;
    shippingCost: number;
    fees: number;
    handlingFees: number;
    taxes: number;
    otherCosts: number;
    adSpendGoogle: number;
    adSpendSnapchat: number;
    adSpendTiktok: number;
  },
  facebookSpend: number,
) {
  const adSpend =
    facebookSpend +
    metric.adSpendGoogle +
    metric.adSpendSnapchat +
    metric.adSpendTiktok;
  const netRevenue =
    metric.netRevenue > 0 ? metric.netRevenue : metric.grossRevenue;
  return {
    netRevenue,
    ...calculateProfit({
      netRevenue,
      cogs: metric.cogs,
      shippingCost: metric.shippingCost,
      fees: metric.fees,
      handlingFees: metric.handlingFees,
      taxes: metric.taxes,
      otherCosts: metric.otherCosts,
      adSpend,
    }),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const from = body.from
      ? new Date(body.from + "T00:00:00Z")
      : new Date("2020-01-01T00:00:00Z");
    const to = body.to
      ? new Date(body.to + "T23:59:59Z")
      : new Date();

    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from > to
    ) {
      return NextResponse.json(
        { error: "Rango de fechas inválido" },
        { status: 400 },
      );
    }

    const grouped = await prisma.adSpend.groupBy({
      by: ["brandId", "countryId", "date"],
      _sum: { spend: true },
      where: { date: { gte: from, lte: to } },
    });

    // Consolidar por país real mantiene separados MX, US, CL y ES.
    const consolidated = new Map<
      string,
      { brandId: string; countryId: string; date: Date; adSpend: number }
    >();
    let sourceSpend = 0;

    for (const row of grouped) {
      const adSpend = row._sum.spend ?? 0;
      sourceSpend += adSpend;
      const date = utcDay(row.date);
      const targetCountry = row.countryId;
      const key = `${row.brandId}|${targetCountry}|${date.toISOString()}`;
      const current = consolidated.get(key);
      if (current) {
        current.adSpend += adSpend;
      } else {
        consolidated.set(key, {
          brandId: row.brandId,
          countryId: targetCountry,
          date,
          adSpend,
        });
      }
    }

    let updated = 0;
    let created = 0;
    let skipped = 0;
    let duplicateRowsCleared = 0;
    let appliedSpend = 0;
    let staleSpendCleared = 0;

    // Leer el período una sola vez. La versión anterior abría una transacción y
    // repetía findMany por cada día, lo que agotaba el pool de Neon en Vercel.
    const metrics = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { grossRevenue: "desc" },
    });
    const metricsByDay = new Map<string, typeof metrics>();
    for (const metric of metrics) {
      const key = `${metric.brandId}|${metric.countryId}|${utcDay(metric.date).toISOString()}`;
      const rows = metricsByDay.get(key);
      if (rows) rows.push(metric);
      else metricsByDay.set(key, [metric]);
    }

    // Solo una fila DailyMetric recibe la pauta de cada marca/país/día. El resto
    // queda en cero para impedir que el dashboard duplique el gasto.
    const facebookByMetricId = new Map<string, number>();
    const rowsToCreate: Array<{
      date: Date;
      brandId: string;
      countryId: string;
      storeId: string;
      adSpend: number;
    }> = [];

    for (const row of consolidated.values()) {
      const key = `${row.brandId}|${row.countryId}|${row.date.toISOString()}`;
      const dayMetrics = metricsByDay.get(key) ?? [];
      if (dayMetrics.length === 0) {
        const defaults = BRAND_DEFAULTS[row.brandId];
        const storeId = storeIdFor(row.brandId, row.countryId);
        if (!defaults || !storeId) {
          skipped++;
          continue;
        }
        rowsToCreate.push({ ...row, storeId });
        created++;
        appliedSpend += row.adSpend;
        continue;
      }

      const selected =
        dayMetrics.find((metric) => !metric.id.startsWith("shopify_")) ??
        dayMetrics[0];
      facebookByMetricId.set(selected.id, row.adSpend);
      duplicateRowsCleared += dayMetrics.filter(
        (metric) => metric.id !== selected.id && metric.adSpendFacebook !== 0,
      ).length;
      updated++;
      appliedSpend += row.adSpend;
    }

    const metricUpdates: Array<{
      id: string;
      adSpend: number;
      adSpendFacebook: number;
      netProfit: number;
      netMargin: number;
      roas: number;
      cpa: number | null;
    }> = [];
    for (const metric of metrics) {
      const facebookSpend = facebookByMetricId.get(metric.id) ?? 0;
      const totalAdSpend =
        facebookSpend +
        metric.adSpendGoogle +
        metric.adSpendSnapchat +
        metric.adSpendTiktok;
      const profit = profitForMetric(metric, facebookSpend);
      const roas = facebookSpend > 0 ? profit.netRevenue / facebookSpend : 0;
      const cpa =
        facebookSpend > 0 && metric.ordersCount > 0
          ? facebookSpend / metric.ordersCount
          : null;
      const cpaChanged =
        metric.cpa === null || cpa === null
          ? metric.cpa !== cpa
          : Math.abs(metric.cpa - cpa) >= 0.005;
      const changed =
        Math.abs(metric.adSpend - totalAdSpend) >= 0.005 ||
        Math.abs(metric.adSpendFacebook - facebookSpend) >= 0.005 ||
        Math.abs(metric.netProfit - profit.netProfit) >= 0.005 ||
        Math.abs(metric.netMargin - profit.netMargin) >= 0.005 ||
        Math.abs((metric.roas ?? 0) - roas) >= 0.005 ||
        cpaChanged;
      if (!changed) continue;

      if (metric.adSpendFacebook !== 0 && facebookSpend === 0) {
        staleSpendCleared++;
      }
      metricUpdates.push({
        id: metric.id,
        adSpend: totalAdSpend,
        adSpendFacebook: facebookSpend,
        netProfit: profit.netProfit,
        netMargin: profit.netMargin,
        roas,
        cpa,
      });
    }

    // Dos escrituras concurrentes respetan el pool pequeño de Neon. No se usan
    // transacciones interactivas: cada ejecución posterior es idempotente y
    // termina cualquier lote que haya quedado incompleto.
    await runInBatches(metricUpdates, 2, (update) =>
      prisma.dailyMetric.update({
        where: { id: update.id },
        data: {
          adSpend: update.adSpend,
          adSpendFacebook: update.adSpendFacebook,
          netProfit: update.netProfit,
          netMargin: update.netMargin,
          roas: update.roas,
          cpa: update.cpa,
        },
      }),
    );
    await runInBatches(rowsToCreate, 2, (row) =>
      prisma.dailyMetric.create({
        data: {
          date: row.date,
          brandId: row.brandId,
          countryId: row.countryId,
          storeId: row.storeId,
          adSpend: row.adSpend,
          adSpendFacebook: row.adSpend,
          netProfit: -row.adSpend,
          netMargin: 0,
          roas: 0,
          cpa: null,
        },
      }),
    );
    const profitRowsRecalculated = metricUpdates.length;

    const difference = sourceSpend - appliedSpend;
    return NextResponse.json({
      ok: Math.abs(difference) < 0.01,
      updated,
      created,
      skipped,
      duplicateRowsCleared,
      staleSpendCleared,
      profitRowsRecalculated,
      sourceSpend,
      appliedSpend,
      difference,
      message:
        `${updated} días actualizados, ${created} filas creadas; ` +
        `diferencia de conciliación: ${difference.toFixed(2)}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Rollup]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const [stats, withAdSpend, inAdSpendTable] = await Promise.all([
    prisma.dailyMetric.aggregate({
      _sum: { adSpend: true, netProfit: true },
      _count: { id: true },
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.dailyMetric.count({ where: { adSpend: { gt: 0 } } }),
    prisma.adSpend.aggregate({
      _sum: { spend: true },
      _count: { id: true },
    }),
  ]);

  const dailySpend = stats._sum.adSpend ?? 0;
  const sourceSpend = inAdSpendTable._sum.spend ?? 0;
  return NextResponse.json({
    dailyMetric: {
      totalRows: stats._count.id,
      rowsWithAdSpend: withAdSpend,
      totalAdSpend: dailySpend,
      totalNetProfit: stats._sum.netProfit,
      dateRange: { from: stats._min.date, to: stats._max.date },
    },
    adSpendTable: {
      totalRows: inAdSpendTable._count.id,
      totalSpend: sourceSpend,
    },
    difference: sourceSpend - dailySpend,
    synced: Math.abs(sourceSpend - dailySpend) < 0.01,
  });
}
