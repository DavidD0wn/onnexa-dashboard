/**
 * GET /api/products/shopify-catalog
 *
 * Lista los productos REALES de ambas tiendas Shopify (Glowmmi + Balancea).
 * Devuelve { brand, title, handle, image, productUrl, status } por cada producto.
 * El frontend de /costos usa esto como source of truth — productos que no
 * existen aquí no se muestran (collares viejos, duplicados borrados, etc.).
 *
 * Cache: 10 min vía Next ISR para no saturar Shopify en cada recarga.
 */
import { NextResponse } from "next/server";
import {
  fetchShopifyPaginated,
  getShopifyStore,
  shopifyRestUrl,
  type ShopifyStoreConfig,
} from "@/lib/integrations/shopify";

export const dynamic = "force-dynamic";

const STORE_KEYS = ["glowmmi", "balancea"] as const;

type ShopifyProduct = {
  id: string | number;
  title: string;
  handle: string;
  status: "active" | "draft" | "archived";
  image?: { src?: string } | null;
  product_type?: string | null;
};

async function fetchProducts(store: ShopifyStoreConfig) {
  const statuses = ["active", "draft"] as const;
  const pages = await Promise.all(statuses.map((status) =>
    fetchShopifyPaginated<ShopifyProduct>(
      store,
      shopifyRestUrl(
        store,
        `products.json?limit=250&status=${status}&fields=id,title,handle,status,image,product_type`,
      ),
      "products",
    )
  ));
  const products = new Map<string, ShopifyProduct>();
  for (const product of pages.flat()) products.set(String(product.id), product);

  return [...products.values()]
    .map((product) => ({
      brand: store.key,
      productId: String(product.id),
      title: product.title,
      handle: product.handle,
      status: product.status,
      image: product.image?.src ?? null,
      productType: product.product_type ?? null,
      productUrl: `https://${store.shop}/products/${product.handle}`,
      adminUrl: `https://${store.shop}/admin/products/${product.id}`,
    }));
}

export async function GET() {
  try {
    const all: any[] = [];
    const errors: string[] = [];
    for (const key of STORE_KEYS) {
      const store = getShopifyStore(key);
      try {
        all.push(...await fetchProducts(store));
      } catch (error) {
        errors.push(`${store.brandName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // ordenar por marca y título
    all.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
    return NextResponse.json({ products: all, count: all.length, errors });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
