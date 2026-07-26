import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchShopifyPaginated,
  getShopifyStores,
  shopifyRestUrl,
  type ShopifyStoreConfig,
} from "@/lib/integrations/shopify";

type ProductRow = {
  name: string;
  variant: string;
  qty: number;
  revenueUsd: number;
  orderCount: number;
  brandName: string;
  brandColor: string;
};

type DayBucket = {
  date: string;
  totalOrders: number;
  totalRevenueUsd: number;
  products: Record<string, ProductRow>;
};

function bundleSize(title: string, variantTitle: string): number {
  const variant =
    variantTitle && variantTitle !== "Default Title" ? variantTitle : "";
  const match =
    variant.match(/\bx(\d+)\b/i) ??
    variant.match(/^(\d+)\s*(unidades?|pcs?|units?)?$/i) ??
    title.match(/\bx(\d+)\b/i);
  return match ? Math.max(1, Number.parseInt(match[1], 10)) : 1;
}

async function fetchOrders(
  store: ShopifyStoreConfig,
  since: string,
  until: string,
) {
  return fetchShopifyPaginated<any>(
    store,
    shopifyRestUrl(store, "orders.json") +
      `?status=any&financial_status=paid,partially_paid,partially_refunded,refunded` +
      `&created_at_min=${encodeURIComponent(since)}` +
      `&created_at_max=${encodeURIComponent(until)}` +
      "&limit=250" +
      "&fields=id,created_at,line_items",
    "orders",
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const requestedDays = Number.parseInt(searchParams.get("days") ?? "7", 10);
    const days = Number.isFinite(requestedDays)
      ? Math.min(365, Math.max(1, requestedDays))
      : 7;
    const storeKey = searchParams.get("store") ?? "all";

    const to = searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
    const from =
      searchParams.get("from") ??
      new Date(
        new Date(`${to}T12:00:00Z`).getTime() - (days - 1) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    ) {
      return NextResponse.json({ error: "Rango de fechas inválido" }, { status: 400 });
    }

    const stores = getShopifyStores();
    const selected =
      storeKey === "all"
        ? Object.values(stores)
        : storeKey === "glowmmi" || storeKey === "balancea"
          ? [stores[storeKey]]
          : [];
    if (!selected.length) {
      return NextResponse.json({ error: "Tienda no válida" }, { status: 400 });
    }

    const brandIds = selected.map((store) => store.brandId);
    const [orderResults, metrics] = await Promise.all([
      Promise.all(
        selected.map(async (store) => ({
          store,
          orders: await fetchOrders(
            store,
            `${from}T00:00:00-06:00`,
            `${to}T23:59:59-06:00`,
          ),
        })),
      ),
      prisma.dailyMetric.findMany({
        where: {
          date: {
            gte: new Date(`${from}T00:00:00Z`),
            lte: new Date(`${to}T23:59:59Z`),
          },
          brandId: { in: brandIds },
        },
        select: {
          date: true,
          brandId: true,
          ordersCount: true,
          netRevenue: true,
        },
      }),
    ]);

    const canonical = new Map<
      string,
      { orders: number; revenue: number }
    >();
    for (const metric of metrics) {
      const date = metric.date.toISOString().slice(0, 10);
      const key = `${date}|${metric.brandId}`;
      const current = canonical.get(key) ?? { orders: 0, revenue: 0 };
      current.orders += metric.ordersCount;
      current.revenue += metric.netRevenue;
      canonical.set(key, current);
    }

    const rawByBrandDay = new Map<
      string,
      { rawRevenue: number; products: Record<string, ProductRow> }
    >();
    const orderIdsByBrandDay = new Map<string, Set<string>>();

    for (const { store, orders } of orderResults) {
      for (const order of orders) {
        const date = String(order.created_at ?? "").slice(0, 10);
        if (date < from || date > to) continue;
        const brandDayKey = `${date}|${store.brandId}`;
        const aggregate = rawByBrandDay.get(brandDayKey) ?? {
          rawRevenue: 0,
          products: {},
        };
        const orderIds = orderIdsByBrandDay.get(brandDayKey) ?? new Set<string>();
        orderIds.add(String(order.id));

        for (const item of order.line_items ?? []) {
          const qty = Math.max(0, Number.parseInt(item.quantity ?? "0", 10) || 0);
          if (!qty) continue;
          const name = item.title ?? "Producto sin nombre";
          const variant =
            item.variant_title && item.variant_title !== "Default Title"
              ? item.variant_title
              : "";
          const discounts = (item.discount_allocations ?? []).reduce(
            (sum: number, allocation: any) =>
              sum + (Number.parseFloat(allocation.amount) || 0),
            0,
          );
          const lineRevenue = Math.max(
            0,
            (Number.parseFloat(item.price) || 0) * qty - discounts,
          );
          const productKey = `${name}||${variant}||${store.brandId}`;
          const row = aggregate.products[productKey] ?? {
            name,
            variant,
            qty: 0,
            revenueUsd: 0,
            orderCount: 0,
            brandName: store.brandName,
            brandColor: store.color,
          };
          row.qty += qty * bundleSize(name, variant);
          row.revenueUsd += lineRevenue;
          row.orderCount += 1;
          aggregate.products[productKey] = row;
          aggregate.rawRevenue += lineRevenue;
        }
        rawByBrandDay.set(brandDayKey, aggregate);
        orderIdsByBrandDay.set(brandDayKey, orderIds);
      }
    }

    const byDay: Record<string, DayBucket> = {};
    const allKeys = new Set([...canonical.keys(), ...rawByBrandDay.keys()]);
    for (const brandDayKey of allKeys) {
      const [date] = brandDayKey.split("|");
      const target = canonical.get(brandDayKey);
      const raw = rawByBrandDay.get(brandDayKey);
      const canonicalRevenue = target?.revenue ?? 0;
      const scale =
        raw && raw.rawRevenue > 0 ? canonicalRevenue / raw.rawRevenue : 0;

      if (!byDay[date]) {
        byDay[date] = {
          date,
          totalOrders: 0,
          totalRevenueUsd: 0,
          products: {},
        };
      }
      byDay[date].totalOrders +=
        target?.orders ?? orderIdsByBrandDay.get(brandDayKey)?.size ?? 0;
      byDay[date].totalRevenueUsd += canonicalRevenue;

      for (const [productKey, product] of Object.entries(raw?.products ?? {})) {
        byDay[date].products[productKey] = {
          ...product,
          revenueUsd: product.revenueUsd * scale,
        };
      }
    }

    const result = Object.values(byDay)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({
        ...day,
        products: Object.values(day.products).sort((a, b) => b.qty - a.qty),
      }));

    return NextResponse.json({
      days: result,
      reconciliation: {
        source: "DailyMetric",
        revenueUsd: result.reduce((sum, day) => sum + day.totalRevenueUsd, 0),
        orders: result.reduce((sum, day) => sum + day.totalOrders, 0),
      },
    });
  } catch (error) {
    console.error(
      "[Daily Products]",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "No se pudieron conciliar los productos con Shopify." },
      { status: 502 },
    );
  }
}
