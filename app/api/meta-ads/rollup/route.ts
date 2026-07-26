import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateProfit } from "@/lib/metrics";

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
};

function storeIdFor(brandId: string, countryId: string): string | null {
  const brand =
    brandId === "brand_glowmmi"
      ? "glowmmi"
      : brandId === "brand_balancea"
        ? "balancea"
        : null;
  const country = countryId.replace(/^country_/, "").toLowerCase();
  return brand && ["mx", "us", "cl"].includes(country)
    ? `store_${brand}_${country}`
    : null;
}

function utcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
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

    // Consolidar por país real mantiene separados MX, US y CL.
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

    // Empezar desde cero evita conservar pauta vieja cuando una campaña/día
    // desaparece del rango recién sincronizado.
    const previousMetrics = await prisma.dailyMetric.findMany({
      where: {
        date: { gte: from, lte: to },
        OR: [{ adSpendFacebook: { not: 0 } }, { adSpend: { not: 0 } }],
      },
    });
    for (const metric of previousMetrics) {
      const nonFacebookSpend =
        metric.adSpendGoogle +
        metric.adSpendSnapchat +
        metric.adSpendTiktok;
      const profit = profitForMetric(metric, 0);
      await prisma.dailyMetric.update({
        where: { id: metric.id },
        data: {
          adSpend: nonFacebookSpend,
          adSpendFacebook: 0,
          netProfit: profit.netProfit,
          netMargin: profit.netMargin,
          roas: 0,
          cpa: null,
        },
      });
      staleSpendCleared++;
    }

    for (const row of consolidated.values()) {
      const dayStart = row.date;
      const dayEnd = new Date(row.date.getTime() + 86_400_000 - 1);

      const result = await prisma.$transaction(
        async (tx) => {
          const metrics = await tx.dailyMetric.findMany({
            where: {
              brandId: row.brandId,
              countryId: row.countryId,
              date: { gte: dayStart, lte: dayEnd },
            },
            orderBy: { grossRevenue: "desc" },
          });

          if (metrics.length === 0) {
            const defaults = BRAND_DEFAULTS[row.brandId];
            const storeId = storeIdFor(row.brandId, row.countryId);
            if (!defaults || !storeId) {
              return { status: "skipped" as const, duplicates: 0 };
            }

            await tx.dailyMetric.create({
              data: {
                date: dayStart,
                brandId: row.brandId,
                countryId: row.countryId,
                storeId,
                adSpend: row.adSpend,
                adSpendFacebook: row.adSpend,
                netProfit: -row.adSpend,
                netMargin: 0,
                roas: 0,
                cpa: null,
              },
            });
            return { status: "created" as const, duplicates: 0 };
          }

          const selected =
            metrics.find((metric) => !metric.id.startsWith("shopify_")) ??
            metrics[0];
          const duplicates = metrics.filter(
            (metric) => metric.id !== selected.id && metric.adSpend !== 0,
          );

          for (const duplicate of duplicates) {
            const duplicateProfit = profitForMetric(duplicate, 0);
            const nonFacebookSpend =
              duplicate.adSpendGoogle +
              duplicate.adSpendSnapchat +
              duplicate.adSpendTiktok;
            await tx.dailyMetric.update({
              where: { id: duplicate.id },
              data: {
                adSpend: nonFacebookSpend,
                adSpendFacebook: 0,
                netProfit: duplicateProfit.netProfit,
                netMargin: duplicateProfit.netMargin,
                roas: 0,
                cpa: null,
              },
            });
          }

          const profit = profitForMetric(selected, row.adSpend);
          const totalAdSpend =
            row.adSpend +
            selected.adSpendGoogle +
            selected.adSpendSnapchat +
            selected.adSpendTiktok;
          const roas =
            row.adSpend > 0 ? profit.netRevenue / row.adSpend : 0;
          const cpa =
            row.adSpend > 0 && selected.ordersCount > 0
              ? row.adSpend / selected.ordersCount
              : null;

          await tx.dailyMetric.update({
            where: { id: selected.id },
            data: {
              adSpend: totalAdSpend,
              adSpendFacebook: row.adSpend,
              netProfit: profit.netProfit,
              netMargin: profit.netMargin,
              roas,
              cpa,
            },
          });

          return {
            status: "updated" as const,
            duplicates: duplicates.length,
          };
        },
        { timeout: 30_000 },
      );

      if (result.status === "created") created++;
      else if (result.status === "updated") updated++;
      else skipped++;
      duplicateRowsCleared += result.duplicates;
      if (result.status !== "skipped") appliedSpend += row.adSpend;
    }

    // La utilidad también debe quedar consistente en días que todavía no
    // tienen anuncios (por ejemplo, el día actual antes del cierre de Meta).
    const profitRows = await prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to } },
    });
    let profitRowsRecalculated = 0;
    for (const metric of profitRows) {
      const netRevenue =
        metric.netRevenue > 0 ? metric.netRevenue : metric.grossRevenue;
      const profit = calculateProfit({
        netRevenue,
        cogs: metric.cogs,
        shippingCost: metric.shippingCost,
        fees: metric.fees,
        handlingFees: metric.handlingFees,
        taxes: metric.taxes,
        otherCosts: metric.otherCosts,
        adSpend: metric.adSpend,
      });
      if (
        Math.abs(metric.netProfit - profit.netProfit) >= 0.005 ||
        Math.abs(metric.netMargin - profit.netMargin) >= 0.005
      ) {
        await prisma.dailyMetric.update({
          where: { id: metric.id },
          data: {
            netProfit: profit.netProfit,
            netMargin: profit.netMargin,
          },
        });
        profitRowsRecalculated++;
      }
    }

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
