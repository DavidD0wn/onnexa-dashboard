/**
 * GET /api/shopify/pending-orders?store=all|glowmmi|balancea
 * Retorna órdenes pagadas sin fulfillment, con días sin enviar y urgencia.
 */
import { NextResponse } from "next/server";
import {
  fetchShopifyPaginated,
  getShopifyStores,
  isShopifyStoreConfigured,
  shopifyRestUrl,
} from "@/lib/integrations/shopify";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeKey = searchParams.get("store") ?? "all";

  const stores = getShopifyStores();
  if (storeKey !== "all" && !(storeKey in stores)) {
    return NextResponse.json({ error: "Tienda no válida" }, { status: 400 });
  }
  const targets = storeKey === "all"
    ? Object.values(stores)
    : Object.values(stores).filter((store) => store.key === storeKey);

  const allOrders: any[] = [];
  const storeErrors: Array<{ store: string; error: string }> = [];

  for (const store of targets) {
    try {
      if (!isShopifyStoreConfigured(store)) {
        throw new Error("Credenciales no configuradas");
      }
      const orders = await fetchShopifyPaginated<any>(
        store,
        shopifyRestUrl(
          store,
          "orders.json?fulfillment_status=unfulfilled&financial_status=paid&status=open&limit=250" +
            "&fields=id,name,created_at,total_price,currency,customer,email,shipping_address,line_items,fulfillment_status,financial_status",
        ),
        "orders",
      );

      const now = Date.now();
      for (const o of orders) {
        const createdAt   = new Date(o.created_at);
        const daysPending = Math.max(0, Math.floor((now - createdAt.getTime()) / 864e5));

        allOrders.push({
          id:               o.id,
          name:             o.name,
          createdAt:        o.created_at,
          daysPending,
          customerName:     o.customer ? `${o.customer.first_name ?? ""} ${o.customer.last_name ?? ""}`.trim() : "Sin nombre",
          email:            o.email ?? o.customer?.email ?? "—",
          total:            o.total_price,
          currency:         o.currency,
          country:          o.shipping_address?.country_code ?? o.shipping_address?.country ?? "",
          items: (o.line_items ?? []).map((li: any) => ({
            title: li.title,
            qty:   li.quantity,
          })),
          store:      store.key,
          brandColor: store.color,
          shopUrl:    store.shop,
        });
      }
    } catch (e: any) {
      console.error(`[pending-orders] ${store.shop}:`, e.message);
      storeErrors.push({ store: store.key, error: e.message });
    }
  }

  // Sort: most urgent (most days) first
  allOrders.sort((a, b) => b.daysPending - a.daysPending);

  const urgent  = allOrders.filter((o) => o.daysPending > 7).length;
  const warning = allOrders.filter((o) => o.daysPending >= 3 && o.daysPending <= 7).length;
  const recent  = allOrders.filter((o) => o.daysPending < 3).length;

  const payload = {
    orders: allOrders,
    summary: { total: allOrders.length, urgent, warning, recent },
    dataComplete: storeErrors.length === 0,
    storeErrors,
  };

  if (storeErrors.length === targets.length) {
    return NextResponse.json(
      { ...payload, error: "Shopify no respondió para ninguna tienda. No se muestran ceros como si fueran datos reales." },
      { status: 502 },
    );
  }
  return NextResponse.json(payload);
}
