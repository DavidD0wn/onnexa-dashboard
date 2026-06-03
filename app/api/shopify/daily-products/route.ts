import { NextRequest, NextResponse } from "next/server";

const STORES = {
  glowmmi: {
    shop:         "glm-1694.myshopify.com",
    clientId:     process.env.SHOPIFY_GLOWMMI_CLIENT_ID     ?? "",
    clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET ?? "",
    brandId:      "brand_glowmmi",
    brandName:    "Glowmmi",
    color:        "#EC4899",
    currency:     "USD",
    exchangeRate: 1,
  },
  balancea: {
    shop:         "mp0vab-bw.myshopify.com",
    clientId:     process.env.SHOPIFY_BALANCEA_CLIENT_ID     ?? "",
    clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET ?? "",
    brandId:      "brand_balancea",
    brandName:    "Balancea",
    color:        "#10B981",
    currency:     "MXN",
    exchangeRate: 17.2,
  },
};

async function getToken(store: typeof STORES["glowmmi"]) {
  const isBalancea = store.currency === "MXN";
  const body = isBalancea
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret }).toString()
    : JSON.stringify({ client_id: store.clientId, client_secret: store.clientSecret, grant_type: "client_credentials" });

  const res = await fetch(`https://${store.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": isBalancea ? "application/x-www-form-urlencoded" : "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Auth error ${store.shop}`);
  const data = await res.json();
  return data.access_token as string;
}

async function fetchOrders(shop: string, token: string, since: string, until: string) {
  const allOrders: any[] = [];
  let url = `https://${shop}/admin/api/2024-01/orders.json?status=any&financial_status=paid,partially_paid&created_at_min=${since}&created_at_max=${until}&limit=250&fields=id,name,created_at,total_price,line_items,tags`;

  while (url) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data = await res.json();
    allOrders.push(...(data.orders ?? []));
    const link = res.headers.get("Link") ?? "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
  }
  return allOrders;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days    = parseInt(searchParams.get("days") ?? "7");
  const storeKey = searchParams.get("store") ?? "all"; // "all"|"glowmmi"|"balancea"

  const today = new Date();
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10) + "T00:00:00-06:00";
  const until = today.toISOString().slice(0, 10) + "T23:59:59-06:00";

  const targetStores = storeKey === "all"
    ? Object.entries(STORES)
    : Object.entries(STORES).filter(([k]) => k === storeKey);

  // day → productKey → { name, variant, qty, revenueUsd, orders: Set<orderId> }
  const byDay: Record<string, {
    date: string;
    totalOrders: number;
    totalRevenueUsd: number;
    products: Record<string, { name: string; variant: string; qty: number; revenueUsd: number; orderCount: number; brandName: string; brandColor: string }>;
  }> = {};

  for (const [, store] of targetStores) {
    try {
      const token  = await getToken(store);
      const orders = await fetchOrders(store.shop, token, since, until);

      for (const order of orders) {
        const date = order.created_at.split("T")[0];
        if (!byDay[date]) byDay[date] = { date, totalOrders: 0, totalRevenueUsd: 0, products: {} };

        const orderRevUsd = parseFloat(order.total_price) / store.exchangeRate;
        byDay[date].totalOrders    += 1;
        byDay[date].totalRevenueUsd += orderRevUsd;

        for (const item of (order.line_items ?? [])) {
          const productName = item.title ?? "Producto sin nombre";
          // Skip ebooks / digital free products
          const nameLower = productName.toLowerCase();
          if (
            nameLower.includes("ebook") || nameLower.includes("e-book") ||
            nameLower.includes("digital") || nameLower.includes("pdf") ||
            nameLower.includes("guía gratis") || nameLower.includes("guia gratis") ||
            (parseFloat(item.price) === 0 && (nameLower.includes("libro") || nameLower.includes("guía") || nameLower.includes("guia")))
          ) continue;
          const variantName = (item.variant_title && item.variant_title !== "Default Title")
            ? item.variant_title : "";
          const key = `${productName}||${variantName}||${store.brandId}`;

          if (!byDay[date].products[key]) {
            byDay[date].products[key] = {
              name:       productName,
              variant:    variantName,
              qty:        0,
              revenueUsd: 0,
              orderCount: 0,
              brandName:  store.brandName,
              brandColor: store.color,
            };
          }
          const qty    = parseInt(item.quantity) || 1;
          const priceUsd = parseFloat(item.price) * qty / store.exchangeRate;
          byDay[date].products[key].qty        += qty;
          byDay[date].products[key].revenueUsd += priceUsd;
          byDay[date].products[key].orderCount += 1;
        }
      }
    } catch (e: any) {
      console.error(`[daily-products] ${store.shop}:`, e.message);
    }
  }

  // Sort days desc, sort products by qty desc
  const days_arr = Object.values(byDay)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((day) => ({
      ...day,
      products: Object.values(day.products).sort((a, b) => b.qty - a.qty),
    }));

  return NextResponse.json({ days: days_arr });
}
