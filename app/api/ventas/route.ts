import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get("days") ?? "30");
  const today = new Date();
  const fromLocal = new Date(today);
  fromLocal.setDate(today.getDate() - (days - 1));
  const from = new Date(Date.UTC(fromLocal.getFullYear(), fromLocal.getMonth(), fromLocal.getDate()));

  const metrics = await prisma.dailyMetric.findMany({
    where: { date: { gte: from } },
    include: { brand: true, country: true },
    orderBy: { date: "desc" },
  });

  const rows = metrics.map((m) => ({
    id: m.id,
    date: m.date,
    brandName: m.brand.name,
    countryName: m.country.name,
    ordersCount: m.ordersCount,
    grossRevenue: m.grossRevenue,
    netRevenue: m.netRevenue,
    adSpend: m.adSpend,
    cogs: m.cogs,
    shippingCost: m.shippingCost,
    fees: m.fees,
    netProfit: m.netProfit,
    netMargin: m.netMargin,
    aov: m.aov,
    cpa: m.cpa,
    roas: m.roas,
    mer: m.mer,
    decision: m.decision,
  }));

  return NextResponse.json({ rows });
}
