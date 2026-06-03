/**
 * GET /api/shopify/customers
 *
 * Datos enriquecidos de clientes usando read_customers.
 * Devuelve: email, nombre, total_spent, orders_count, tags, last_order_date.
 *
 * Requiere scope: read_customers (nuevo)
 *
 * Query params:
 *   store?: "glowmmi" | "balancea" | "all"
 *   updated_at_min?: "YYYY-MM-DD"  (solo clientes actualizados desde esa fecha)
 *   limit?: number  (default: 250 — para análisis de segmentos)
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
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": isJson ? "application/json" : "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Auth error (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error("No access_token");
  return data.access_token;
}

async function fetchCustomers(shop: string, token: string, params: Record<string, string>): Promise<any[]> {
  const all: any[] = [];
  const qs = new URLSearchParams({
    limit: "250",
    fields: "id,email,first_name,last_name,orders_count,total_spent,tags,created_at,updated_at,last_order_id,last_order_name,currency",
    ...params,
  });
  let url: string | null = `https://${shop}/admin/api/2024-01/customers.json?${qs}`;

  while (url) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Customers error (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data: any = await res.json();
    all.push(...(data.customers ?? []));
    const next: RegExpMatchArray | null = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeParam      = searchParams.get("store") ?? "all";
  const updatedAtMin    = searchParams.get("updated_at_min") ?? undefined;

  const storeKeys = storeParam === "all"
    ? (Object.keys(STORES) as (keyof typeof STORES)[])
    : ([storeParam] as (keyof typeof STORES)[]).filter((k) => STORES[k]);

  const allCustomers: any[] = [];
  const storeErrors: Record<string, string> = {};
  const storeCounts: Record<string, number> = {};

  for (const key of storeKeys) {
    const cfg = STORES[key];
    try {
      const token = await getToken(cfg.shop, cfg.clientId, cfg.clientSecret, cfg.authType);
      const params: Record<string, string> = {};
      if (updatedAtMin) params.updated_at_min = updatedAtMin;

      const customers = await fetchCustomers(cfg.shop, token, params);
      storeCounts[cfg.label] = customers.length;

      for (const c of customers) {
        const totalSpent    = parseFloat(c.total_spent ?? "0");
        const ordersCount   = parseInt(c.orders_count ?? "0");
        const ltv           = totalSpent;
        const aov           = ordersCount > 0 ? totalSpent / ordersCount : 0;
        const isRepeat      = ordersCount > 1;

        allCustomers.push({
          id:          String(c.id),
          email:       c.email,
          name:        `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(),
          ordersCount,
          totalSpent,
          ltv,
          aov:         parseFloat(aov.toFixed(2)),
          currency:    c.currency ?? cfg.currency,
          tags:        c.tags ? c.tags.split(", ").filter(Boolean) : [],
          isRepeat,
          createdAt:   c.created_at,
          updatedAt:   c.updated_at,
          lastOrderName: c.last_order_name ?? null,
          store:       cfg.label,
        });
      }
    } catch (e: any) {
      storeErrors[key] = e.message;
    }
  }

  // Aggregate metrics
  const totalCustomers   = allCustomers.length;
  const repeatCustomers  = allCustomers.filter((c) => c.isRepeat).length;
  const repeatRate       = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0;
  const totalRevenue     = allCustomers.reduce((s, c) => s + (c.currency === "USD" ? c.totalSpent : 0), 0);
  const avgLTV           = totalCustomers > 0
    ? allCustomers.reduce((s, c) => s + c.ltv, 0) / totalCustomers
    : 0;

  // Top customers by LTV (USD only for comparable data)
  const topCustomers = allCustomers
    .filter((c) => c.currency === "USD")
    .sort((a, b) => b.ltv - a.ltv)
    .slice(0, 20);

  return NextResponse.json({
    totalCustomers,
    repeatCustomers,
    repeatRate:       parseFloat(repeatRate.toFixed(1)),
    avgLTV:           parseFloat(avgLTV.toFixed(2)),
    totalRevenue:     parseFloat(totalRevenue.toFixed(2)),
    storeCounts,
    errors:           Object.keys(storeErrors).length > 0 ? storeErrors : undefined,
    topCustomers,
    // Full list for analysis (can be large)
    customers: allCustomers,
  });
}
