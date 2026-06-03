import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/prisma";

const APP_COSTS_FILE   = join(process.cwd(), "data", "app-costs.json");
const FIXED_COSTS_FILE = join(process.cwd(), "data", "fixed-costs.json");

function loadAppCosts() {
  try {
    const data = JSON.parse(readFileSync(APP_COSTS_FILE, "utf-8"));
    const active = (data.apps ?? []).filter((a: any) => a.active);
    const totalMonthly = active.reduce((s: number, a: any) => {
      if (a.billingCycle === "monthly")  return s + (a.costUsd ?? 0);
      if (a.billingCycle === "annual")   return s + (a.costUsd ?? 0) / 12;
      return s;
    }, 0);
    return { totalMonthly };
  } catch { return { totalMonthly: 0 }; }
}

function loadFixedCosts() {
  try {
    const data = JSON.parse(readFileSync(FIXED_COSTS_FILE, "utf-8"));
    const salaries: Array<{ id: string; name: string; amountUsd: number }> = (data.salaries ?? []).filter((i: any) => i.active);
    const other:    Array<{ id: string; name: string; amountUsd: number }> = (data.other    ?? []).filter((i: any) => i.active);
    const items    = [...salaries, ...other];
    const totalMonthly = items.reduce((s, i) => s + i.amountUsd, 0);
    return { totalMonthly, items, salaries, other };
  } catch { return { totalMonthly: 0, items: [], salaries: [], other: [] }; }
}

/* ── helpers ─────────────────────────────────────────────────── */
function utcDate(y: number, m: number, d: number, h = 0, min = 0, s = 0) {
  return new Date(Date.UTC(y, m, d, h, min, s));
}

function fmtLabel(from: Date, to: Date, granularity: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const f = from.toLocaleDateString("es-MX", opts);
  const t = to.toLocaleDateString("es-MX", opts);
  if (granularity === "monthly") {
    return from.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${t} — ${f}`;
}

/* ── aggregate a slice of metrics ───────────────────────────── */
function aggregate(
  metrics: any[],
  pFrom: Date,
  pTo: Date,
  chargebacks: any[]
) {
  const ms = metrics.filter((m) => m.date >= pFrom && m.date <= pTo);

  const t = ms.reduce(
    (a, m) => ({
      revenue:   a.revenue   + m.grossRevenue,
      discounts: a.discounts + (m.discounts ?? 0),
      returns:   a.returns   + (m.returns ?? 0),
      cogs:      a.cogs      + m.cogs,
      shipping:  a.shipping  + m.shippingCost,
      fees:      a.fees      + m.fees,
      handling:  a.handling  + (m.handlingFees ?? 0),
      adSpend:   a.adSpend   + m.adSpend,
      taxes:     a.taxes     + m.taxes,
      other:     a.other     + m.otherCosts,
      netProfit: a.netProfit + m.netProfit,
      orders:    a.orders    + m.ordersCount,
      units:     a.units     + m.unitsSold,
      // per-channel adSpend — fall back to total adSpend as Facebook if channels not broken out
      adFacebook:  a.adFacebook  + (m.adSpendFacebook > 0 ? m.adSpendFacebook  : m.adSpend ?? 0),
      adGoogle:    a.adGoogle    + (m.adSpendGoogle   > 0 ? m.adSpendGoogle    : 0),
      adSnapchat:  a.adSnapchat  + (m.adSpendSnapchat > 0 ? m.adSpendSnapchat  : 0),
      adTiktok:    a.adTiktok    + (m.adSpendTiktok   > 0 ? m.adSpendTiktok    : 0),
      // custom cost sub-categories (currently rolled into taxes + other)
      marketing:  a.marketing  + (m.costMarketing  ?? 0),
      office:     a.office     + (m.costOffice     ?? 0),
    }),
    {
      revenue: 0, discounts: 0, returns: 0,
      cogs: 0, shipping: 0, fees: 0, handling: 0,
      adSpend: 0, taxes: 0, other: 0, netProfit: 0,
      orders: 0, units: 0,
      adFacebook: 0, adGoogle: 0, adSnapchat: 0, adTiktok: 0,
      marketing: 0, office: 0,
    }
  );

  // Chargebacks in this period
  const cb = chargebacks
    .filter((r) => r.date >= pFrom && r.date <= pTo && r.status !== "won")
    .reduce((s: number, r: any) => s + r.amount, 0);

  const netRevenue   = t.revenue - t.discounts - t.returns;
  // Gross Profit = Revenue − COGS − Shipping − Fees − Handling
  const grossProfit  = netRevenue - t.cogs - t.shipping - t.fees - t.handling;
  const customCosts  = t.taxes + t.other;
  // Net Profit (from stored field, adjusted for chargebacks)
  const netProfit    = t.netProfit - cb;
  const grossMargin  = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const netMargin    = netRevenue > 0 ? (netProfit   / netRevenue) * 100 : 0;
  const aov          = t.orders > 0 ? netRevenue / t.orders : 0;

  return {
    ...t,
    netRevenue,
    grossProfit,
    grossMargin,
    customCosts,
    chargebacks: cb,
    netProfit,
    netMargin,
    aov,
  };
}

/* ── GET /api/p-and-l ────────────────────────────────────────── */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromParam     = searchParams.get("from");
  const toParam       = searchParams.get("to");
  const brandId       = searchParams.get("brand");
  const granularity   = (searchParams.get("granularity") ?? "weekly") as "weekly" | "monthly";

  /* Date range defaults: current month */
  const today = new Date();
  const to: Date = toParam
    ? new Date(toParam + "T23:59:59.000Z")
    : utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59);
  const from: Date = fromParam
    ? new Date(fromParam + "T00:00:00.000Z")
    : utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1);

  const brandFilter = brandId && brandId !== "all" ? { brandId } : {};

  /* Fetch all metrics & chargebacks in range */
  const [metrics, chargebacks] = await Promise.all([
    prisma.dailyMetric.findMany({
      where: { date: { gte: from, lte: to }, ...brandFilter },
      orderBy: { date: "asc" },
    }),
    (() => {
      try {
        const cb = (prisma as any).chargeback;
        if (!cb) return Promise.resolve([]);
        return cb.findMany({ where: { date: { gte: from, lte: to } } }).catch(() => []);
      } catch { return Promise.resolve([]); }
    })(),
  ]);

  /* Build periods (newest first, matching TrueProfit layout) */
  const periods: { from: Date; to: Date; label: string }[] = [];

  if (granularity === "weekly") {
    // Walk backwards from 'to' in 7-day chunks
    let pEnd = new Date(to);
    while (pEnd >= from) {
      const pStart = new Date(pEnd);
      pStart.setUTCDate(pEnd.getUTCDate() - 6);
      if (pStart < from) pStart.setTime(from.getTime());
      periods.push({ from: new Date(pStart), to: new Date(pEnd), label: fmtLabel(pStart, pEnd, granularity) });
      pEnd = new Date(pStart);
      pEnd.setUTCDate(pStart.getUTCDate() - 1);
    }
  } else {
    // Monthly: forward
    let cur = utcDate(from.getUTCFullYear(), from.getUTCMonth(), 1);
    while (cur <= to) {
      const monthEnd = utcDate(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0, 23, 59, 59);
      const pEnd2    = monthEnd > to ? to : monthEnd;
      periods.push({ from: new Date(cur), to: pEnd2, label: fmtLabel(cur, pEnd2, granularity) });
      cur = utcDate(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1);
    }
  }

  /* Aggregate per period */
  const columns = periods.map((p) => ({
    label: p.label,
    from:  p.from.toISOString().slice(0, 10),
    to:    p.to.toISOString().slice(0, 10),
    data:  aggregate(metrics, p.from, p.to, chargebacks as any[]),
  }));

  /* Total column */
  const totalData = aggregate(metrics, from, to, chargebacks as any[]);

  const appCosts   = loadAppCosts();
  const fixedCosts = loadFixedCosts();

  return NextResponse.json({
    from:  from.toISOString().slice(0, 10),
    to:    to.toISOString().slice(0, 10),
    granularity,
    columns,
    total: { label: "Total", data: totalData },
    // Fixed costs metadata — used by page to prorate per period
    appCosts:   { monthlyTotal: appCosts.totalMonthly },
    fixedCosts: {
      monthlyTotal: fixedCosts.totalMonthly,
      salaries:     fixedCosts.salaries,
      other:        fixedCosts.other,
    },
  });
}
