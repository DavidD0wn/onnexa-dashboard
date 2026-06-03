/**
 * GET /api/shopify/inventory
 *
 * Devuelve niveles de inventario actuales de ambas tiendas.
 * Usa read_products (ya activo) para obtener inventory_quantity de variantes.
 * Con read_inventory activo también consulta inventory_levels para ubicaciones.
 *
 * Query params:
 *   store?: "glowmmi" | "balancea" | "all"  (default: "all")
 *   lowStock?: number  (default: 10 — alerta si qty <= N)
 */
import { NextResponse } from "next/server";

const STORES = {
  glowmmi: {
    shop: "glm-1694.myshopify.com",
    clientId: "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType: "json" as const,
    label: "Glowmmi",
    currency: "USD",
  },
  balancea: {
    shop: "mp0vab-bw.myshopify.com",
    clientId: "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType: "urlencoded" as const,
    label: "Balancea",
    currency: "MXN",
  },
};

async function getToken(shop: string, clientId: string, clientSecret: string, authType: "json" | "urlencoded"): Promise<string> {
  const isJson = authType === "json";
  const body = isJson
    ? JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
    : new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString();
  const contentType = isJson ? "application/json" : "application/x-www-form-urlencoded";
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, { method: "POST", headers: { "Content-Type": contentType }, body });
  if (!res.ok) throw new Error(`Auth error (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token");
  return data.access_token;
}

async function fetchAllProducts(shop: string, token: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null =
    `https://${shop}/admin/api/2024-01/products.json` +
    `?limit=250&status=active` +
    `&fields=id,title,status,variants,image`;

  while (url) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data: any = await res.json();
    all.push(...(data.products ?? []));
    const next: RegExpMatchArray | null = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

interface InventoryItem {
  productId:   string;
  productTitle: string;
  variantId:   string;
  variantTitle: string;
  sku:         string | null;
  qty:         number;
  price:       string;
  status:      string;
  imageUrl:    string | null;
  store:       string;
  currency:    string;
  lowStock:    boolean;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeParam = searchParams.get("store") ?? "all";
  const lowStockThreshold = parseInt(searchParams.get("lowStock") ?? "10");

  const storeKeys = storeParam === "all"
    ? (Object.keys(STORES) as (keyof typeof STORES)[])
    : ([storeParam] as (keyof typeof STORES)[]).filter((k) => STORES[k]);

  const allItems: InventoryItem[] = [];
  const storeErrors: Record<string, string> = {};

  for (const key of storeKeys) {
    const cfg = STORES[key];
    try {
      const token    = await getToken(cfg.shop, cfg.clientId, cfg.clientSecret, cfg.authType);
      const products = await fetchAllProducts(cfg.shop, token);

      for (const product of products) {
        for (const variant of (product.variants ?? [])) {
          const qty = typeof variant.inventory_quantity === "number" ? variant.inventory_quantity : 0;
          allItems.push({
            productId:    String(product.id),
            productTitle: product.title,
            variantId:    String(variant.id),
            variantTitle: variant.title !== "Default Title" ? variant.title : "",
            sku:          variant.sku ?? null,
            qty,
            price:        variant.price,
            status:       product.status,
            imageUrl:     product.image?.src ?? null,
            store:        cfg.label,
            currency:     cfg.currency,
            lowStock:     qty <= lowStockThreshold,
          });
        }
      }
    } catch (e: any) {
      storeErrors[key] = e.message;
    }
  }

  // Sort: low stock first, then by qty asc
  allItems.sort((a, b) => {
    if (a.lowStock !== b.lowStock) return a.lowStock ? -1 : 1;
    return a.qty - b.qty;
  });

  const lowStockItems = allItems.filter((i) => i.lowStock);
  const outOfStock    = allItems.filter((i) => i.qty <= 0);

  return NextResponse.json({
    total:           allItems.length,
    lowStock:        lowStockItems.length,
    outOfStock:      outOfStock.length,
    threshold:       lowStockThreshold,
    errors:          Object.keys(storeErrors).length > 0 ? storeErrors : undefined,
    alerts: outOfStock.map((i) => ({
      store:   i.store,
      product: i.productTitle,
      variant: i.variantTitle,
      sku:     i.sku,
      qty:     i.qty,
    })),
    items: allItems,
  });
}
