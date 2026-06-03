import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/* ─── Stores config ──────────────────────────────────────────── */
const STORES = {
  glowmmi: {
    shop:         "glm-1694.myshopify.com",
    clientId:     process.env.SHOPIFY_GLOWMMI_CLIENT_ID     ?? "",
    clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET ?? "",
    brandId:      "brand_glowmmi",
    exchangeRate: 1,
  },
  balancea: {
    shop:         "mp0vab-bw.myshopify.com",
    clientId:     process.env.SHOPIFY_BALANCEA_CLIENT_ID     ?? "",
    clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET ?? "",
    brandId:      "brand_balancea",
    exchangeRate: 17.2,
  },
};

/* ─── Month helpers ──────────────────────────────────────────── */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-MX", {
    month: "short", year: "numeric", timeZone: "UTC",
  });
}
function monthsApart(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}
function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return monthKey(d);
}

/* ─── Shopify auth ───────────────────────────────────────────── */
async function getToken(store: typeof STORES["glowmmi"]) {
  const isBalancea = store.exchangeRate > 1;
  const body = isBalancea
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret }).toString()
    : JSON.stringify({ client_id: store.clientId, client_secret: store.clientSecret, grant_type: "client_credentials" });
  const res = await fetch(`https://${store.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": isBalancea ? "application/x-www-form-urlencoded" : "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Auth error ${store.shop}`);
  return (await res.json()).access_token as string;
}

/* ─── Fetch orders with customer data ───────────────────────── */
async function fetchCustomerOrders(
  shop: string,
  token: string,
  since: string,
  until: string
): Promise<any[]> {
  const all: any[] = [];
  let url =
    `https://${shop}/admin/api/2024-01/orders.json` +
    `?status=any&financial_status=paid,partially_paid` +
    `&created_at_min=${since}&created_at_max=${until}` +
    `&limit=250&fields=id,created_at,customer,total_price`;
  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data = await res.json();
    all.push(...(data.orders ?? []));
    const next = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
  }
  return all;
}

/* ─── GET /api/ltv ───────────────────────────────────────────── */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const brandParam = searchParams.get("brand") ?? "all";
  const fromMonth  = searchParams.get("from"); // e.g. "2025-11"
  const toMonth    = searchParams.get("to");   // e.g. "2026-05"

  const today  = new Date();
  const pTo    = toMonth   ?? monthKey(today);
  const pFrom  = fromMonth ?? (() => {
    const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - 5); return monthKey(d);
  })();

  /* Extend the since window so we capture customers who first bought
     before the selected period but also bought within it (all-time LTV) */
  const allTimeSince = "2020-01-01T00:00:00-06:00";
  const periodUntil  = `${pTo}-31T23:59:59-06:00`; // overshoot is fine

  /* ── 1. Pick stores ─────────────────────────────────────────── */
  const targetStores = brandParam === "all"
    ? Object.values(STORES)
    : Object.values(STORES).filter((s) => s.brandId === brandParam);

  /* ── 2. Fetch orders from Shopify ──────────────────────────── */
  type OrderRow = { customerId: string; date: Date; amountUsd: number; brandId: string };
  const allOrders: OrderRow[] = [];

  for (const store of targetStores) {
    try {
      const token  = await getToken(store);
      const orders = await fetchCustomerOrders(store.shop, token, allTimeSince, periodUntil);
      for (const o of orders) {
        // Use customer.id if available; guest checkout = unique per order
        const customerId = o.customer?.id
          ? `${store.brandId}_${o.customer.id}`
          : `${store.brandId}_guest_${o.id}`;
        allOrders.push({
          customerId,
          date:      new Date(o.created_at),
          amountUsd: parseFloat(o.total_price) / store.exchangeRate,
          brandId:   store.brandId,
        });
      }
    } catch (e: any) {
      console.error(`[ltv] ${store.shop}:`, e.message);
    }
  }

  /* ── 3. Build customer profiles ────────────────────────────── */
  // customerId → { firstDate, orders: [{date, amount}] }
  const customerMap = new Map<string, { firstDate: Date; orders: { date: Date; amount: number }[] }>();
  for (const o of allOrders) {
    if (!customerMap.has(o.customerId)) {
      customerMap.set(o.customerId, { firstDate: o.date, orders: [] });
    }
    const c = customerMap.get(o.customerId)!;
    c.orders.push({ date: o.date, amount: o.amountUsd });
    if (o.date < c.firstDate) c.firstDate = o.date;
  }

  /* ── 4. Group customers into acquisition cohorts ────────────── */
  const cohortMap = new Map<string, { customers: Array<{ firstDate: Date; orders: { date: Date; amount: number }[] }> }>();
  for (const c of customerMap.values()) {
    const k = monthKey(c.firstDate);
    if (!cohortMap.has(k)) cohortMap.set(k, { customers: [] });
    cohortMap.get(k)!.customers.push(c);
  }

  /* ── 5. Fetch CAC data from DB (adSpend by month) ──────────── */
  const brandFilter = brandParam !== "all" ? { brandId: brandParam } : {};
  const dbMetrics   = await prisma.dailyMetric.findMany({
    where: { ...brandFilter },
    select: { date: true, adSpend: true, grossRevenue: true, ordersCount: true },
  });
  const adSpendByMonth: Record<string, number> = {};
  const revenueByMonth: Record<string, number> = {};
  for (const m of dbMetrics) {
    const k = monthKey(m.date);
    adSpendByMonth[k] = (adSpendByMonth[k] ?? 0) + m.adSpend;
    revenueByMonth[k] = (revenueByMonth[k] ?? 0) + m.grossRevenue;
  }

  /* ── 6. Build cohort array for the selected period ──────────── */
  const allCohortKeys = [...cohortMap.keys()].sort();
  const periodKeys    = allCohortKeys.filter((k) => k >= pFrom && k <= pTo);

  const cohorts = periodKeys.map((cohortKey) => {
    const { customers } = cohortMap.get(cohortKey)!;
    const newCustomers  = customers.length;
    const monthsObserved = monthsApart(cohortKey, pTo) + 1;

    /* Cumulative LTV per month offset
       monthlyLtv[i] = avg total spend of cohort customers through month i (0-indexed) */
    const monthlyLtv = Array.from({ length: monthsObserved }, (_, offset) => {
      const cutoff = addMonths(cohortKey, offset + 1); // month key of "offset-th month after cohort"
      // Sum orders up to and including that month
      const total = customers.reduce((sum, c) => {
        const spent = c.orders
          .filter((o) => monthKey(o.date) <= cutoff)
          .reduce((s, o) => s + o.amount, 0);
        return sum + spent;
      }, 0);
      return newCustomers > 0 ? total / newCustomers : 0;
    });

    /* Repurchase rate = % of customers who bought again after their first order */
    const repeatCustomers = customers.filter((c) => {
      const firstMonthKey = monthKey(c.firstDate);
      return c.orders.some((o) => monthKey(o.date) > firstMonthKey);
    }).length;
    const repurchaseRate = newCustomers > 0 ? (repeatCustomers / newCustomers) * 100 : 0;

    /* Total revenue from this cohort */
    const revenue = customers.reduce((s, c) => s + c.orders.reduce((ss, o) => ss + o.amount, 0), 0);

    /* LTV = latest cumulative value */
    const ltv = monthlyLtv.at(-1) ?? 0;

    /* CAC = ad spend that month / new customers */
    const cac   = newCustomers > 0 ? (adSpendByMonth[cohortKey] ?? 0) / newCustomers : 0;
    const ratio = cac > 0 ? ltv / cac : 0;

    return {
      month: cohortKey,
      label: monthLabel(cohortKey),
      newCustomers,
      revenue,
      ltv,
      cac,
      ratio,
      repurchaseRate: Math.round(repurchaseRate * 10) / 10,
      monthlyLtv,
    };
  });

  /* ── 7. All-time overview (using all Shopify customers) ──────── */
  const allCustomers   = customerMap.size;
  const allRevenue     = [...customerMap.values()].reduce(
    (s, c) => s + c.orders.reduce((ss, o) => ss + o.amount, 0), 0
  );
  const allAdSpend     = Object.values(adSpendByMonth).reduce((s, v) => s + v, 0);
  const allTimeLtv     = allCustomers > 0 ? allRevenue  / allCustomers : 0;
  const allTimeCac     = allCustomers > 0 ? allAdSpend  / allCustomers : 0;
  const allTimeLtvCac  = allTimeCac > 0   ? allTimeLtv  / allTimeCac   : 0;
  const allRepeat      = [...customerMap.values()].filter((c) => c.orders.length > 1).length;
  const allRepurchRate = allCustomers > 0 ? (allRepeat / allCustomers) * 100 : 0;

  /* ── 8. Period overview ──────────────────────────────────────── */
  const periodRevenue  = cohorts.reduce((s, c) => s + c.revenue, 0);
  const periodCustomers = cohorts.reduce((s, c) => s + c.newCustomers, 0);
  const periodAdSpend  = periodKeys.reduce((s, k) => s + (adSpendByMonth[k] ?? 0), 0);
  const periodLtv      = cohorts.length > 0 ? cohorts.reduce((s, c) => s + c.ltv, 0) / cohorts.length : 0;
  const periodCac      = periodCustomers > 0 ? periodAdSpend / periodCustomers : 0;
  const periodRatio    = periodCac > 0 ? periodLtv / periodCac : 0;
  const periodRepeat   = cohorts.reduce((s, c) => s + (c.repurchaseRate * c.newCustomers / 100), 0);
  const periodRepRate  = periodCustomers > 0 ? (periodRepeat / periodCustomers) * 100 : 0;

  /* ── 9. Chart data ───────────────────────────────────────────── */
  const chartData = periodKeys.map((k) => {
    const c = cohorts.find((c) => c.month === k);
    return { label: monthLabel(k), ltv: c?.ltv ?? 0, cac: c?.cac ?? 0, ratio: c?.ratio ?? 0 };
  });

  const maxLtv = Math.max(...cohorts.map((c) => Math.max(...c.monthlyLtv, 0)), 1);

  return NextResponse.json({
    source: "shopify",
    allTime: {
      customers:     allCustomers,
      repurchaseRate: Math.round(allRepurchRate * 10) / 10,
      revenue:       allRevenue,
      ltv:           allTimeLtv,
      cac:           allTimeCac,
      ltvCacRatio:   allTimeLtvCac,
    },
    period: {
      from: pFrom, to: pTo,
      newCustomers:   periodCustomers,
      repurchaseRate: Math.round(periodRepRate * 10) / 10,
      revenue:        periodRevenue,
      ltv:            periodLtv,
      cac:            periodCac,
      ltvCacRatio:    periodRatio,
    },
    cohorts,
    chartData,
    maxLtv,
    periodMonths: periodKeys.length,
  });
}
