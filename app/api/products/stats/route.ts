/**
 * Compatibilidad para las tarjetas antiguas de producto.
 * La fuente canónica es Product Analytics; ProductDailyStat queda fuera del
 * cálculo porque era una importación histórica incompleta.
 */
import { NextRequest, NextResponse } from "next/server";
import { GET as getProductAnalytics } from "@/app/api/products/analytics/route";
import { GET as getDailyProducts } from "@/app/api/shopify/daily-products/route";

export async function GET(req: NextRequest) {
  try {
    const sourceUrl = new URL(req.url);
    const analyticsUrl = new URL("/api/products/analytics", sourceUrl.origin);
    const dailyUrl = new URL("/api/shopify/daily-products", sourceUrl.origin);

    for (const name of ["from", "to"]) {
      const value = sourceUrl.searchParams.get(name);
      if (value) {
        analyticsUrl.searchParams.set(name, value);
        dailyUrl.searchParams.set(name, value);
      }
    }

    const brand = sourceUrl.searchParams.get("brand") ?? "all";
    const store =
      brand === "brand_glowmmi"
        ? "glowmmi"
        : brand === "brand_balancea"
          ? "balancea"
          : "all";
    analyticsUrl.searchParams.set("store", store);
    dailyUrl.searchParams.set("store", store);

    const [analyticsResponse, dailyResponse] = await Promise.all([
      getProductAnalytics(new NextRequest(analyticsUrl)),
      getDailyProducts(new NextRequest(dailyUrl)),
    ]);
    if (!analyticsResponse.ok) return analyticsResponse;
    if (!dailyResponse.ok) return dailyResponse;

    const analytics = await analyticsResponse.json();
    const dailyProducts = await dailyResponse.json();
    const aggregate = new Map<string, any>();

    for (const row of analytics.rows ?? []) {
      const key = `${row.brandId}|${row.name}`;
      const current = aggregate.get(key) ?? {
        code: row.name,
        name: row.name,
        brandId: row.brandId,
        revenue: 0,
        profit: 0,
        orders: 0,
        adSpend: 0,
        cogs: 0,
        fees: 0,
      };
      current.revenue += row.revenueUsd ?? 0;
      current.profit += row.netProfit ?? 0;
      current.orders += row.orders ?? 0;
      current.adSpend += row.adSpendUsd ?? 0;
      current.cogs += row.cogsUsd ?? 0;
      current.fees +=
        (row.feesUsd ?? 0) +
        (row.shippingUsd ?? 0) +
        (row.taxesUsd ?? 0);
      aggregate.set(key, current);
    }

    const topProducts = [...aggregate.values()]
      .map((product) => ({
        ...product,
        avgRoas:
          product.adSpend > 0 ? product.revenue / product.adSpend : null,
        avgCpa:
          product.adSpend > 0 && product.orders > 0
            ? product.adSpend / product.orders
            : null,
        margin:
          product.revenue > 0
            ? (product.profit / product.revenue) * 100
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    const profitability = new Map(
      topProducts.map((product) => [
        `${product.brandId}|${product.name}`,
        product.profit >= 0,
      ]),
    );
    const daily = (dailyProducts.days ?? []).map((day: any) => ({
      date: day.date,
      products: day.products.map((product: any) => {
        const brandId =
          product.brandName === "Glowmmi"
            ? "brand_glowmmi"
            : "brand_balancea";
        return {
          code: `${brandId}|${product.name}|${product.variant ?? ""}`,
          name: product.name,
          brandId,
          orders: product.orderCount,
          revenue: product.revenueUsd,
          adSpend: 0,
          cogs: 0,
          profit: 0,
          roas: null,
          cpa: null,
          isProfit: profitability.get(`${brandId}|${product.name}`) ?? false,
        };
      }),
    }));

    return NextResponse.json({
      topProducts,
      daily,
      totals: analytics.totals,
      reconciliation: analytics.adSpendReconciliation,
    });
  } catch (error) {
    console.error(
      "[Product Stats]",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "No se pudieron cargar las estadísticas de producto." },
      { status: 502 },
    );
  }
}
