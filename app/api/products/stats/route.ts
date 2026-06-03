/**
 * GET /api/products/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&brand=all
 * Devuelve top productos y detalle diario por producto del Sheet5
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from  = searchParams.get("from")
    ? new Date(searchParams.get("from")! + "T00:00:00Z")
    : new Date("2026-01-01");
  const to    = searchParams.get("to")
    ? new Date(searchParams.get("to")! + "T23:59:59Z")
    : new Date();
  const brand = searchParams.get("brand") ?? "all";

  const where: Record<string, any> = { date: { gte: from, lte: to } };
  if (brand !== "all") where.brandId = brand;

  // ── Top productos agregados ────────────────────────────────────────────
  const topRaw = await prisma.productDailyStat.groupBy({
    by: ["productCode", "productName", "brandId"],
    where,
    _sum: {
      revenueUsd: true, profitUsd: true, orders: true,
      adSpendUsd: true, cogsUsd: true, feesUsd: true,
    },
    _avg: { roas: true, cpaReal: true },
    orderBy: { _sum: { revenueUsd: "desc" } },
    take: 20,
  });

  const topProducts = topRaw.map(p => ({
    code:    p.productCode,
    name:    p.productName,
    brandId: p.brandId,
    revenue: p._sum.revenueUsd ?? 0,
    profit:  p._sum.profitUsd  ?? 0,
    orders:  p._sum.orders     ?? 0,
    adSpend: p._sum.adSpendUsd ?? 0,
    cogs:    p._sum.cogsUsd    ?? 0,
    fees:    p._sum.feesUsd    ?? 0,
    avgRoas: p._avg.roas,
    avgCpa:  p._avg.cpaReal,
    margin:  (p._sum.revenueUsd ?? 0) > 0
               ? ((p._sum.profitUsd ?? 0) / (p._sum.revenueUsd ?? 1)) * 100
               : 0,
  }));

  // ── Detalle diario (qué se vendió cada día) ────────────────────────────
  const allRows = await prisma.productDailyStat.findMany({
    where,
    orderBy: { date: "desc" },
    take: 600,
    select: {
      date: true, productCode: true, productName: true, brandId: true,
      orders: true, revenueUsd: true, adSpendUsd: true, cogsUsd: true,
      profitUsd: true, roas: true, cpaReal: true, isProfit: true,
    },
  });

  // Agrupar por fecha
  const byDate: Record<string, { date: string; products: any[] }> = {};
  for (const r of allRows) {
    if (r.orders === 0 && r.revenueUsd === 0) continue;
    const d = r.date.toISOString().slice(0, 10);
    if (!byDate[d]) byDate[d] = { date: d, products: [] };
    byDate[d].products.push({
      code:     r.productCode,
      name:     r.productName,
      brandId:  r.brandId,
      orders:   r.orders,
      revenue:  r.revenueUsd,
      adSpend:  r.adSpendUsd,
      cogs:     r.cogsUsd,
      profit:   r.profitUsd,
      roas:     r.roas,
      cpa:      r.cpaReal,
      isProfit: r.isProfit,
    });
  }

  const daily = Object.values(byDate)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(d => ({
      ...d,
      products: d.products.sort((a: any, b: any) => b.revenue - a.revenue),
    }));

  return NextResponse.json({ topProducts, daily });
}
