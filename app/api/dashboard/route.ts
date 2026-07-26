import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function utcDayStart(localDate: Date): Date {
  return new Date(Date.UTC(localDate.getFullYear(), localDate.getMonth(), localDate.getDate()));
}
function utcDayEnd(localDate: Date): Date {
  return new Date(Date.UTC(localDate.getFullYear(), localDate.getMonth(), localDate.getDate(), 23, 59, 59, 999));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
  const brandId   = searchParams.get("brand");
  const countryId = searchParams.get("country");

  const fromParam = searchParams.get("from");
  const toParam   = searchParams.get("to");

  let from: Date, to: Date;
  if (fromParam && toParam) {
    from = new Date(fromParam + "T00:00:00.000Z");
    to   = new Date(toParam   + "T23:59:59.999Z");
  } else {
    const days = parseInt(searchParams.get("days") ?? "30");
    const today = new Date();
    const fromLocal = new Date(today);
    fromLocal.setDate(today.getDate() - (days - 1));
    from = utcDayStart(fromLocal);
    to   = utcDayEnd(today);
  }

  const where: any = {
    date: { gte: from, lte: to },
    ...(brandId   && brandId   !== "all" && { brandId }),
    ...(countryId && countryId !== "all" && { countryId }),
  };

  // AdSpend filter — always read from source-of-truth AdSpend table, not DailyMetric
  const adWhere: any = { date: { gte: from, lte: to } };
  if (brandId && brandId !== "all") adWhere.brandId = brandId;
  if (countryId && countryId !== "all") adWhere.countryId = countryId;

  // Chargebacks filter (only brandId, no countryId in that model)
  const cbWhere: any = { date: { gte: from, lte: to } };
  if (brandId && brandId !== "all") cbWhere.brandId = brandId;

  const [metrics, adSpendRows, tasks, chargebacks] = await Promise.all([
    prisma.dailyMetric.findMany({
      where,
      include: { brand: true, country: true },
      orderBy: { date: "asc" },
    }),
    // Read adSpend from source-of-truth table grouped by brand+country+day
    prisma.adSpend.groupBy({
      by: ["brandId", "countryId", "date"],
      _sum: { spend: true },
      where: adWhere,
    }),
    prisma.task.findMany({
      where: { status: { in: ["pending", "in_progress", "blocked"] } },
      include: { brand: true },
      orderBy: { priority: "desc" },
      take: 5,
    }),
    (() => {
      try {
        const cb = (prisma as any).chargeback;
        if (!cb) return Promise.resolve([] as any[]);
        return cb.findMany({ where: cbWhere }).catch(() => [] as any[]);
      } catch { return Promise.resolve([] as any[]); }
    })(),
  ]);

  // Build adSpend lookup maps from source-of-truth
  const adSpendByBrandDay = new Map<string, number>(); // "date|brandId" → total spend
  const adSpendByBrand    = new Map<string, number>(); // brandId → total spend
  const adSpendByCountry  = new Map<string, number>(); // countryId → total spend
  const adSpendByDay      = new Map<string, number>(); // date → total spend
  for (const row of adSpendRows) {
    const dateKey = row.date.toISOString().slice(0, 10);
    const bdKey   = `${dateKey}|${row.brandId}`;
    const spend   = row._sum.spend ?? 0;
    adSpendByBrandDay.set(bdKey,   (adSpendByBrandDay.get(bdKey)   ?? 0) + spend);
    adSpendByBrand.set(row.brandId,(adSpendByBrand.get(row.brandId)?? 0) + spend);
    adSpendByCountry.set(row.countryId, (adSpendByCountry.get(row.countryId) ?? 0) + spend);
    adSpendByDay.set(dateKey,      (adSpendByDay.get(dateKey)       ?? 0) + spend);
  }
  const totalAdSpend = Array.from(adSpendByBrand.values()).reduce((s, v) => s + v, 0);

  // Aggregate totals — use AdSpend table for adSpend, DailyMetric for everything else
  const totals = metrics.reduce(
    (acc, m) => ({
      orders:    acc.orders    + m.ordersCount,
      units:     acc.units     + m.unitsSold,
      gross:     acc.gross     + m.grossRevenue,
      net:       acc.net       + m.netRevenue,
      discounts: acc.discounts + m.discounts,
      returns:   acc.returns   + m.returns,
      adSpend:   0, // replaced below with source-of-truth value
      cogs:      acc.cogs      + m.cogs,
      shipping:  acc.shipping  + m.shippingCost,
      fees:      acc.fees      + m.fees,
      handling:  acc.handling  + m.handlingFees,
      taxes:     acc.taxes     + m.taxes,
      other:     acc.other     + m.otherCosts,
      profit:    acc.profit    + m.netProfit,
    }),
    { orders: 0, units: 0, gross: 0, net: 0, discounts: 0, returns: 0, adSpend: 0, cogs: 0, shipping: 0, fees: 0, handling: 0, taxes: 0, other: 0, profit: 0 }
  );

  // Override totals.adSpend with the source-of-truth value
  totals.adSpend = totalAdSpend;

  // Recalculate profit with correct adSpend (DailyMetric.netProfit may be stale)
  // profit = gross - cogs - shipping - fees - taxes - other - adSpend
  const realCostBasis = totals.cogs + totals.shipping + totals.fees + totals.handling + totals.taxes + totals.other + totalAdSpend;
  const correctedProfit = totals.net - realCostBasis;
  totals.profit = correctedProfit;

  // Chargebacks total (exclude "won" disputes)
  const chargebackTotal = (chargebacks as any[]).reduce(
    (s: number, r: any) => s + (r.status !== "won" ? r.amount : 0), 0
  );

  // Real profit = netProfit - chargebacks
  const realProfit = totals.profit - chargebackTotal;

  const margin      = totals.net > 0 ? (totals.profit / totals.net) * 100 : 0;
  const realMargin  = totals.net > 0 ? (realProfit    / totals.net) * 100 : 0;
  const cpa         = totals.orders > 0 && totalAdSpend > 0 ? totalAdSpend / totals.orders : null;
  const roas        = totalAdSpend > 0 ? totals.net / totalAdSpend : null;
  const mer         = totalAdSpend > 0 ? totals.gross / totalAdSpend : null;
  const aov         = totals.orders > 0 ? totals.net / totals.orders : 0;
  const cpaBe       = totals.orders > 0
    ? (totals.net - totals.cogs - totals.shipping - totals.fees - totals.handling - totals.taxes - totals.other) / totals.orders
    : null;
  const roasBe         = cpaBe && cpaBe > 0 ? aov / cpaBe : null;
  const profitPerOrder = totals.orders > 0 ? totals.profit / totals.orders : null;
  const realProfitPerOrder = totals.orders > 0 ? realProfit / totals.orders : null;

  // Chart data by date — use adSpendByDay from source-of-truth
  const byDate: Record<string, {
    glowmmi: number; balancea: number; net: number; profit: number; adSpend: number;
    orders: number; cogs: number; shipping: number; fees: number; handling: number;
    taxes: number; other: number;
  }> = {};
  for (const m of metrics) {
    const d = m.date.toISOString().split("T")[0];
    if (!byDate[d]) byDate[d] = {
      glowmmi: 0, balancea: 0, net: 0, profit: 0, adSpend: 0, orders: 0,
      cogs: 0, shipping: 0, fees: 0, handling: 0, taxes: 0, other: 0,
    };
    if (m.brandId === "brand_glowmmi")  byDate[d].glowmmi  += m.netRevenue;
    if (m.brandId === "brand_balancea") byDate[d].balancea += m.netRevenue;
    byDate[d].net     += m.netRevenue;
    byDate[d].orders  += m.ordersCount;
    byDate[d].cogs    += m.cogs;
    byDate[d].shipping += m.shippingCost;
    byDate[d].fees    += m.fees;
    byDate[d].handling += m.handlingFees;
    byDate[d].taxes   += m.taxes;
    byDate[d].other   += m.otherCosts;
  }
  // Overlay per-day adSpend from source-of-truth (overrides DailyMetric.adSpend)
  for (const [dateKey, spend] of adSpendByDay.entries()) {
    if (byDate[dateKey]) byDate[dateKey].adSpend = spend;
    else byDate[dateKey] = {
      glowmmi: 0, balancea: 0, net: 0, profit: -spend, adSpend: spend,
      orders: 0, cogs: 0, shipping: 0, fees: 0, handling: 0, taxes: 0, other: 0,
    };
  }
  for (const value of Object.values(byDate)) {
    value.profit = value.net - value.cogs - value.shipping - value.fees
      - value.handling - value.taxes - value.other - value.adSpend;
  }
  const chartData = Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  // By brand — use adSpendByBrand from source-of-truth
  const byBrand: Record<string, any> = {};
  for (const m of metrics) {
    const key = m.brand.name;
    if (!byBrand[key]) byBrand[key] = {
      name: key, brandId: m.brandId, gross: 0, revenue: 0, net: 0, profit: 0, orders: 0, units: 0,
      adSpend: 0, cogs: 0, shipping: 0, fees: 0, handling: 0, taxes: 0, other: 0,
    };
    byBrand[key].gross    += m.grossRevenue;
    byBrand[key].revenue  += m.netRevenue;
    byBrand[key].net      += m.netRevenue;
    byBrand[key].orders   += m.ordersCount;
    byBrand[key].units    += m.unitsSold;
    byBrand[key].cogs     += m.cogs;
    byBrand[key].shipping += m.shippingCost;
    byBrand[key].fees     += m.fees;
    byBrand[key].handling += m.handlingFees;
    byBrand[key].taxes    += m.taxes;
    byBrand[key].other    += m.otherCosts;
  }
  // Override per-brand adSpend from source-of-truth
  for (const [bId, spend] of adSpendByBrand.entries()) {
    const entry = Object.values(byBrand).find((b: any) => b.brandId === bId) as any;
    if (entry) entry.adSpend = spend;
  }
  for (const entry of Object.values(byBrand) as any[]) {
    entry.profit = entry.net - entry.cogs - entry.shipping - entry.fees
      - entry.handling - entry.taxes - entry.other - entry.adSpend;
  }

  // Add chargebacks per brand
  for (const cb of chargebacks as any[]) {
    if (cb.status === "won") continue;
    const brand = Object.values(byBrand).find((b: any) => b.brandId === cb.brandId);
    if (brand) brand.chargebacks = (brand.chargebacks ?? 0) + cb.amount;
  }

  // By country
  const byCountry: Record<string, any> = {};
  for (const m of metrics) {
    const key = m.country.name;
    if (!byCountry[key]) byCountry[key] = {
      name: key, countryId: m.countryId, code: m.country.code, currency: m.country.currency,
      exchangeRate: m.country.exchangeRateToUsd,
      gross: 0, revenue: 0, net: 0, profit: 0, orders: 0, units: 0,
      adSpend: 0, cogs: 0, shipping: 0, fees: 0, handling: 0, taxes: 0, other: 0,
    };
    byCountry[key].gross    += m.grossRevenue;
    byCountry[key].revenue  += m.netRevenue;
    byCountry[key].net      += m.netRevenue;
    byCountry[key].orders   += m.ordersCount;
    byCountry[key].units    += m.unitsSold;
    byCountry[key].cogs     += m.cogs;
    byCountry[key].shipping += m.shippingCost;
    byCountry[key].fees     += m.fees;
    byCountry[key].handling += m.handlingFees;
    byCountry[key].taxes    += m.taxes;
    byCountry[key].other    += m.otherCosts;
  }
  for (const entry of Object.values(byCountry) as any[]) {
    entry.adSpend = adSpendByCountry.get(entry.countryId) ?? 0;
    entry.profit = entry.net - entry.cogs - entry.shipping - entry.fees
      - entry.handling - entry.taxes - entry.other - entry.adSpend;
  }

    return NextResponse.json({
      totals: {
        ...totals,
        margin, realMargin, cpa, roas, mer, aov,
        cpaBe, roasBe, profitPerOrder, realProfitPerOrder,
        chargebacks: chargebackTotal,
        realProfit,
      },
      chartData,
      byBrand:   Object.values(byBrand),
      byCountry: Object.values(byCountry),
      tasks,
    });
  } catch (error) {
    console.error(
      "[Dashboard API]",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "No se pudieron cargar los indicadores. Intenta nuevamente." },
      { status: 503 },
    );
  }
}
