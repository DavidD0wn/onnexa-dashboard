/**
 * GET /api/shopify/discounts
 *
 * Analiza códigos de descuento activos: uso, tipo, valor, y su impacto en revenue.
 * Requiere scope: read_price_rules (nuevo)
 *
 * Query params:
 *   store?: "glowmmi" | "balancea" | "all"
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

async function fetchPriceRules(shop: string, token: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null =
    `https://${shop}/admin/api/2024-01/price_rules.json` +
    `?limit=250&fields=id,title,value_type,value,allocation_method,target_type,usage_count,starts_at,ends_at,status`;

  while (url) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Price rules error (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data: any = await res.json();
    all.push(...(data.price_rules ?? []));
    const next: RegExpMatchArray | null = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

async function fetchDiscountCodes(shop: string, token: string, priceRuleId: string): Promise<any[]> {
  const res: Response = await fetch(
    `https://${shop}/admin/api/2024-01/price_rules/${priceRuleId}/discount_codes.json?limit=250`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (!res.ok) return [];
  const data: any = await res.json();
  return data.discount_codes ?? [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const storeParam = searchParams.get("store") ?? "all";

  const storeKeys = storeParam === "all"
    ? (Object.keys(STORES) as (keyof typeof STORES)[])
    : ([storeParam] as (keyof typeof STORES)[]).filter((k) => STORES[k]);

  const results: any[] = [];
  const storeErrors: Record<string, string> = {};

  for (const key of storeKeys) {
    const cfg = STORES[key];
    try {
      const token      = await getToken(cfg.shop, cfg.clientId, cfg.clientSecret, cfg.authType);
      const priceRules = await fetchPriceRules(cfg.shop, token);

      for (const rule of priceRules) {
        // Get discount codes for this rule (to show actual codes used)
        const codes = await fetchDiscountCodes(cfg.shop, token, String(rule.id));
        const now   = new Date();
        const isActive =
          rule.status === "enabled" &&
          (!rule.ends_at || new Date(rule.ends_at) > now) &&
          (!rule.starts_at || new Date(rule.starts_at) <= now);

        results.push({
          id:              String(rule.id),
          title:           rule.title,
          valueType:       rule.value_type,           // "percentage" | "fixed_amount"
          value:           rule.value,                // negative number, e.g. "-10.0" = 10% off
          displayValue:    rule.value_type === "percentage"
            ? `${Math.abs(parseFloat(rule.value))}% off`
            : `${Math.abs(parseFloat(rule.value))} ${cfg.currency} off`,
          allocationMethod: rule.allocation_method,  // "across" | "each"
          targetType:      rule.target_type,          // "line_item" | "shipping_line"
          usageCount:      rule.usage_count ?? 0,
          isActive,
          startsAt:        rule.starts_at,
          endsAt:          rule.ends_at,
          codes:           codes.map((c: any) => ({
            code:       c.code,
            usageCount: c.usage_count ?? 0,
            createdAt:  c.created_at,
          })),
          codesCount:      codes.length,
          store:           cfg.label,
          currency:        cfg.currency,
        });
      }
    } catch (e: any) {
      storeErrors[key] = e.message;
    }
  }

  // Sort by usage count desc
  results.sort((a, b) => b.usageCount - a.usageCount);

  const activeRules   = results.filter((r) => r.isActive);
  const totalUsage    = results.reduce((s, r) => s + r.usageCount, 0);
  const percentageOff = results.filter((r) => r.valueType === "percentage");
  const fixedOff      = results.filter((r) => r.valueType === "fixed_amount");

  return NextResponse.json({
    totalRules:    results.length,
    activeRules:   activeRules.length,
    totalUsage,
    byType: {
      percentage:  percentageOff.length,
      fixedAmount: fixedOff.length,
    },
    errors:        Object.keys(storeErrors).length > 0 ? storeErrors : undefined,
    // Most used active discounts
    topActive: activeRules.sort((a, b) => b.usageCount - a.usageCount).slice(0, 10),
    // All rules
    rules: results,
  });
}
