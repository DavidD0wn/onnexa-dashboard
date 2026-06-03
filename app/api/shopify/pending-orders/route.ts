/**
 * GET /api/shopify/pending-orders?store=all|glowmmi|balancea
 * Retorna órdenes pagadas sin fulfillment, con días sin enviar y urgencia.
 */
import { NextResponse } from "next/server";

const STORES = {
  glowmmi: {
    shop: "glm-1694.myshopify.com",
    clientId: "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType: "json" as const,
    brandColor: "#EC4899",
    key: "glowmmi",
  },
  balancea: {
    shop: "mp0vab-bw.myshopify.com",
    clientId: "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType: "urlencoded" as const,
    brandColor: "#10B981",
    key: "balancea",
  },
};

async function getToken(s: typeof STORES[keyof typeof STORES]) {
  const url  = `https://${s.shop}/admin/oauth/access_token`;
  const body = s.authType === "urlencoded"
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }).toString()
    : JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, grant_type: "client_credentials" });
  const ct   = s.authType === "urlencoded" ? "application/x-www-form-urlencoded" : "application/json";
  const res  = await fetch(url, { method: "POST", headers: { "Content-Type": ct }, body });
  if (!res.ok) throw new Error(`Auth error ${s.shop}: ${res.status}`);
  return (await res.json()).access_token as string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeKey = searchParams.get("store") ?? "all";

  const targets = storeKey === "all"
    ? Object.values(STORES)
    : Object.values(STORES).filter((s) => s.key === storeKey);

  const allOrders: any[] = [];

  for (const store of targets) {
    try {
      const token = await getToken(store);
      // Fetch unfulfilled paid orders
      let url = `https://${store.shop}/admin/api/2024-01/orders.json?fulfillment_status=unfulfilled&financial_status=paid&status=open&limit=250&fields=id,name,created_at,total_price,currency,customer,email,shipping_address,line_items,fulfillment_status,financial_status`;

      while (url) {
        const res  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) break;
        const data = await res.json();
        const orders = data.orders ?? [];

        const now = Date.now();
        for (const o of orders) {
          const createdAt   = new Date(o.created_at);
          const daysPending = Math.floor((now - createdAt.getTime()) / 864e5);

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
            brandColor: store.brandColor,
            shopUrl:    store.shop,
          });
        }

        const link = res.headers.get("Link") ?? "";
        const next = link.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : "";
      }
    } catch (e: any) {
      console.error(`[pending-orders] ${store.shop}:`, e.message);
    }
  }

  // Sort: most urgent (most days) first
  allOrders.sort((a, b) => b.daysPending - a.daysPending);

  const urgent  = allOrders.filter((o) => o.daysPending > 7).length;
  const warning = allOrders.filter((o) => o.daysPending >= 3 && o.daysPending <= 7).length;
  const recent  = allOrders.filter((o) => o.daysPending < 3).length;

  return NextResponse.json({
    orders: allOrders,
    summary: { total: allOrders.length, urgent, warning, recent },
  });
}
