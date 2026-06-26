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

export const revalidate = 600; // 10 min

const STORES = [
  {
    brand: "glowmmi",
    shop: "glm-1694.myshopify.com",
    publicDomain: "glm-1694.myshopify.com",
    clientId: "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType: "json" as const,
  },
  {
    brand: "balancea",
    shop: "mp0vab-bw.myshopify.com",
    publicDomain: "mp0vab-bw.myshopify.com",
    clientId: "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType: "urlencoded" as const,
  },
];

async function getToken(s: (typeof STORES)[number]): Promise<string | null> {
  try {
    const body = s.authType === "json"
      ? JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, grant_type: "client_credentials" })
      : new URLSearchParams({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }).toString();
    const ct = s.authType === "json" ? "application/json" : "application/x-www-form-urlencoded";
    const r = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
      method: "POST", headers: { "Content-Type": ct }, body,
    });
    const d = await r.json();
    return d.access_token ?? null;
  } catch { return null; }
}

async function fetchProducts(s: (typeof STORES)[number], token: string) {
  const out: any[] = [];
  let url: string | null =
    `https://${s.shop}/admin/api/2024-01/products.json?limit=250&status=active,draft&fields=id,title,handle,status,image,product_type`;
  while (url) {
    const r: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!r.ok) break;
    const d: any = await r.json();
    for (const p of d.products ?? []) {
      out.push({
        brand:      s.brand,
        productId:  String(p.id),
        title:      p.title,
        handle:     p.handle,
        status:     p.status,
        image:      p.image?.src ?? null,
        productType: p.product_type ?? null,
        productUrl: `https://${s.publicDomain}/products/${p.handle}`,
        adminUrl:   `https://${s.shop}/admin/products/${p.id}`,
      });
    }
    const next: RegExpMatchArray | null = (r.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return out;
}

export async function GET() {
  try {
    const all: any[] = [];
    for (const s of STORES) {
      const token = await getToken(s);
      if (!token) continue;
      const products = await fetchProducts(s, token);
      all.push(...products);
    }
    // ordenar por marca y título
    all.sort((a, b) => a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title));
    return NextResponse.json({ products: all, count: all.length, cachedFor: "10min" });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
