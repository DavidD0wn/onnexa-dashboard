// app/api/analytics/heatmap/route.ts
// Mapa de calor de ventas por HORA × DÍA de la semana.
// Jala las órdenes directo de Shopify (la tabla Order local está vacía) y las
// agrupa en una rejilla 7×24 según la zona horaria elegida.
import { NextRequest, NextResponse } from "next/server";
import {
  getShopifyStores,
  isShopifyStoreConfigured,
  shopifyRestUrl,
  fetchShopifyPaginated,
  type ShopifyStoreConfig,
} from "@/lib/integrations/shopify";

export const maxDuration = 120;

type ShopifyOrder = {
  id: number | string;
  created_at: string;
  total_price?: string;
  currency?: string;
  cancelled_at?: string | null;
  test?: boolean;
};

// Lun..Dom (0..6). weekday JS: 0=Dom → lo mandamos a 6; 1=Lun → 0, etc.
const toMondayIndex = (jsDay: number) => (jsDay + 6) % 7;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const brand = sp.get("brand") ?? "all";            // all | glowmmi | balancea | pleena
    const tz = Number(sp.get("tz") ?? "-6");            // offset horas (México = -6)
    const from = sp.get("from");
    const to = sp.get("to");
    const days = Number(sp.get("days") ?? "90");

    // Rango de fechas (UTC ISO)
    let minISO: string, maxISO: string | null = null;
    if (from && to) {
      minISO = new Date(from + "T00:00:00Z").toISOString();
      maxISO = new Date(to + "T23:59:59Z").toISOString();
    } else {
      minISO = new Date(Date.now() - days * 86400_000).toISOString();
    }

    const stores = Object.values(getShopifyStores()).filter(
      (s) => isShopifyStoreConfigured(s) && (brand === "all" || s.key === brand),
    );
    if (stores.length === 0) {
      return NextResponse.json({ error: "No hay tiendas Shopify configuradas para ese filtro." }, { status: 400 });
    }

    // rejillas 7 (Lun..Dom) × 24 (0..23)
    const countGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const revGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const currencies = new Set<string>();
    let totalOrders = 0;
    let totalRevenue = 0;
    const perStore: Array<{ key: string; brandName: string; color: string; orders: number }> = [];
    const errores: string[] = [];

    await Promise.all(
      stores.map(async (store: ShopifyStoreConfig) => {
        try {
          let path =
            `orders.json?status=any&limit=250&fields=id,created_at,total_price,currency,cancelled_at,test` +
            `&created_at_min=${encodeURIComponent(minISO)}`;
          if (maxISO) path += `&created_at_max=${encodeURIComponent(maxISO)}`;
          const url = shopifyRestUrl(store, path);
          const orders = await fetchShopifyPaginated<ShopifyOrder>(store, url, "orders");

          let storeOrders = 0;
          for (const o of orders) {
            if (o.test) continue;
            if (o.cancelled_at) continue;
            if (!o.created_at) continue;
            const inst = new Date(o.created_at);
            if (Number.isNaN(inst.getTime())) continue;
            const local = new Date(inst.getTime() + tz * 3600_000);
            const wd = toMondayIndex(local.getUTCDay());
            const hr = local.getUTCHours();
            const rev = Number(o.total_price ?? 0) || 0;
            countGrid[wd][hr] += 1;
            revGrid[wd][hr] += rev;
            totalRevenue += rev;
            storeOrders += 1;
            if (o.currency) currencies.add(o.currency);
          }
          totalOrders += storeOrders;
          perStore.push({ key: store.key, brandName: store.brandName, color: store.color, orders: storeOrders });
        } catch (e: any) {
          errores.push(`${store.brandName}: ${e?.message ?? "error"}`);
        }
      }),
    );

    // marginales
    const byHour = new Array(24).fill(0);
    const byWeekday = new Array(7).fill(0);
    const revByHour = new Array(24).fill(0);
    const revByWeekday = new Array(7).fill(0);
    let peak = { wd: 0, hr: 0, count: 0, rev: 0 };
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        byHour[h] += countGrid[d][h];
        byWeekday[d] += countGrid[d][h];
        revByHour[h] += revGrid[d][h];
        revByWeekday[d] += revGrid[d][h];
        if (countGrid[d][h] > peak.count) peak = { wd: d, hr: h, count: countGrid[d][h], rev: revGrid[d][h] };
      }
    }

    return NextResponse.json({
      ok: true,
      countGrid, revGrid,
      byHour, byWeekday, revByHour, revByWeekday,
      peak,
      totalOrders, totalRevenue,
      currencies: [...currencies],
      perStore,
      tz,
      range: { min: minISO, max: maxISO },
      errores,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error en el mapa de calor" }, { status: 500 });
  }
}
