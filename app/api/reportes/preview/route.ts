import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const period = parseInt(searchParams.get("period") ?? "30");
  const brand  = searchParams.get("brand") ?? "all";

  const from = new Date(Date.now() - (period - 1) * 864e5);
  const where: any = { date: { gte: from } };
  if (brand !== "all") where.brandId = `brand_${brand}`;

  const metrics = await prisma.dailyMetric.findMany({ where });
  const adRows  = await prisma.adSpend.groupBy({
    by: ["brandId"], _sum: { spend: true },
    where: { date: { gte: from }, ...(brand !== "all" ? { brandId: `brand_${brand}` } : {}) },
  });

  const revenue  = metrics.reduce((s, m) => s + m.grossRevenue, 0);
  const net      = metrics.reduce((s, m) => s + m.netRevenue,   0);
  const orders   = metrics.reduce((s, m) => s + m.ordersCount,  0);
  const adSpend  = adRows.reduce((s, r) => s + (r._sum.spend ?? 0), 0);
  const profit   = metrics.reduce((s, m) => s + m.netProfit,    0) - adSpend;
  const margin   = net > 0 ? (profit / net) * 100 : 0;
  const roas     = adSpend > 0 ? net / adSpend : null;

  return NextResponse.json({ revenue, net, orders, adSpend, profit, margin, roas });
}
