import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateProfit } from "@/lib/metrics";

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function metricKey(brandId: string, countryId: string, date: Date): string {
  return `${brandId}|${countryId}|${dayKey(date)}`;
}

function finiteDays(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(3650, Math.max(1, Math.floor(parsed)))
    : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const includeDetails =
      Boolean(process.env.SYNC_SECRET) &&
      req.headers.get("x-sync-secret") === process.env.SYNC_SECRET;
    const days = finiteDays(req.nextUrl.searchParams.get("days"), 30);
    const requestedFrom = req.nextUrl.searchParams.get("from");
    const requestedTo = req.nextUrl.searchParams.get("to");
    const now = new Date();
    const todayEnd = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );
    const to = requestedTo
      ? new Date(requestedTo + "T23:59:59Z")
      : todayEnd;
    const from = requestedFrom
      ? new Date(requestedFrom + "T00:00:00Z")
      : new Date(
          Date.UTC(
            to.getUTCFullYear(),
            to.getUTCMonth(),
            to.getUTCDate() - days + 1,
          ),
        );

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

    const [adRows, metricRows] = await Promise.all([
      prisma.adSpend.findMany({
        where: { date: { gte: from, lte: to } },
        select: {
          brandId: true,
          countryId: true,
          date: true,
          spend: true,
        },
      }),
      prisma.dailyMetric.findMany({
        where: { date: { gte: from, lte: to } },
        select: {
          id: true,
          storeId: true,
          brandId: true,
          countryId: true,
          date: true,
          ordersCount: true,
          unitsSold: true,
          netRevenue: true,
          grossRevenue: true,
          cogs: true,
          shippingCost: true,
          fees: true,
          handlingFees: true,
          taxes: true,
          otherCosts: true,
          adSpend: true,
          adSpendFacebook: true,
          adSpendGoogle: true,
          adSpendSnapchat: true,
          adSpendTiktok: true,
          netProfit: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const sourceByKey = new Map<string, number>();
    for (const row of adRows) {
      const key = metricKey(row.brandId, row.countryId, row.date);
      sourceByKey.set(key, (sourceByKey.get(key) ?? 0) + row.spend);
    }

    const metricsByKey = new Map<string, typeof metricRows>();
    let storedNetProfit = 0;
    let expectedNetProfit = 0;
    let dailyMetricAdSpend = 0;

    for (const row of metricRows) {
      const key = metricKey(row.brandId, row.countryId, row.date);
      const group = metricsByKey.get(key) ?? [];
      group.push(row);
      metricsByKey.set(key, group);

      const netRevenue =
        row.netRevenue > 0 ? row.netRevenue : row.grossRevenue;
      const expected = calculateProfit({
        netRevenue,
        cogs: row.cogs,
        shippingCost: row.shippingCost,
        fees: row.fees,
        handlingFees: row.handlingFees,
        taxes: row.taxes,
        otherCosts: row.otherCosts,
        adSpend: row.adSpend,
      });
      storedNetProfit += row.netProfit;
      expectedNetProfit += expected.netProfit;
      const otherPlatformSpend =
        row.adSpendGoogle + row.adSpendSnapchat + row.adSpendTiktok;
      dailyMetricAdSpend +=
        row.adSpendFacebook > 0
          ? row.adSpendFacebook
          : otherPlatformSpend === 0
            ? row.adSpend
            : 0;
    }

    const allKeys = new Set([...sourceByKey.keys(), ...metricsByKey.keys()]);
    const mismatches: Array<{
      date: string;
      brandId: string;
      countryId: string;
      sourceAdSpend: number;
      dailyMetricAdSpend: number;
      adSpendDifference: number;
      storedNetProfit: number;
      expectedNetProfit: number;
      profitDifference: number;
      rowCount: number;
      rows?: Array<{
        id: string;
        storeId: string;
        ordersCount: number;
        unitsSold: number;
        grossRevenue: number;
        netRevenue: number;
        cogs: number;
        adSpend: number;
        adSpendFacebook: number;
        netProfit: number;
        notes: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>;
    }> = [];

    for (const key of allKeys) {
      const [brandId, countryId, date] = key.split("|");
      const rows = metricsByKey.get(key) ?? [];
      const source = sourceByKey.get(key) ?? 0;
      const daily = rows.reduce((sum, row) => {
        const otherPlatformSpend =
          row.adSpendGoogle + row.adSpendSnapchat + row.adSpendTiktok;
        const metaSpend =
          row.adSpendFacebook > 0
            ? row.adSpendFacebook
            : otherPlatformSpend === 0
              ? row.adSpend
              : 0;
        return sum + metaSpend;
      }, 0);
      const storedProfit = rows.reduce((sum, row) => sum + row.netProfit, 0);
      const expectedProfit = rows.reduce((sum, row) => {
        const netRevenue =
          row.netRevenue > 0 ? row.netRevenue : row.grossRevenue;
        return (
          sum +
          calculateProfit({
            netRevenue,
            cogs: row.cogs,
            shippingCost: row.shippingCost,
            fees: row.fees,
            handlingFees: row.handlingFees,
            taxes: row.taxes,
            otherCosts: row.otherCosts,
            adSpend: row.adSpend,
          }).netProfit
        );
      }, 0);
      const adDifference = source - daily;
      const profitDifference = expectedProfit - storedProfit;

      if (
        Math.abs(adDifference) >= 0.01 ||
        Math.abs(profitDifference) >= 0.01 ||
        rows.length > 1
      ) {
        mismatches.push({
          date,
          brandId,
          countryId,
          sourceAdSpend: source,
          dailyMetricAdSpend: daily,
          adSpendDifference: adDifference,
          storedNetProfit: storedProfit,
          expectedNetProfit: expectedProfit,
          profitDifference,
          rowCount: rows.length,
          ...(includeDetails
            ? {
                rows: rows.map((row) => ({
                  id: row.id,
                  storeId: row.storeId,
                  ordersCount: row.ordersCount,
                  unitsSold: row.unitsSold,
                  grossRevenue: row.grossRevenue,
                  netRevenue: row.netRevenue,
                  cogs: row.cogs,
                  adSpend: row.adSpend,
                  adSpendFacebook: row.adSpendFacebook,
                  netProfit: row.netProfit,
                  notes: row.notes,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                })),
              }
            : {}),
        });
      }
    }

    mismatches.sort(
      (a, b) =>
        Math.abs(b.adSpendDifference) -
          Math.abs(a.adSpendDifference) ||
        Math.abs(b.profitDifference) - Math.abs(a.profitDifference),
    );

    const sourceAdSpend = [...sourceByKey.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const adSpendDifference = sourceAdSpend - dailyMetricAdSpend;
    const profitDifference = expectedNetProfit - storedNetProfit;

    return NextResponse.json({
      ok:
        Math.abs(adSpendDifference) < 0.01 &&
        Math.abs(profitDifference) < 0.01 &&
        mismatches.every((row) => row.rowCount <= 1),
      range: {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
      },
      summary: {
        sourceAdSpend,
        dailyMetricAdSpend,
        adSpendDifference,
        storedNetProfit,
        expectedNetProfit,
        profitDifference,
        sourceRows: adRows.length,
        dailyMetricRows: metricRows.length,
        mismatchedGroups: mismatches.length,
        duplicateGroups: mismatches.filter((row) => row.rowCount > 1).length,
        missingDailyMetricGroups: mismatches.filter(
          (row) => row.rowCount === 0 && row.sourceAdSpend !== 0,
        ).length,
      },
      mismatches: mismatches.slice(0, 250),
      truncated: mismatches.length > 250,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
