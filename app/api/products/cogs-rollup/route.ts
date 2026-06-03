/**
 * POST /api/products/cogs-rollup
 *
 * Calcula COGS diario por brand a partir de órdenes reales de Shopify
 * + la tabla de costos (product-costs.json / Product.supplierCostUsd).
 *
 * Body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD", dryRun?: boolean }
 * Sin body → últimos 30 días
 *
 * Lógica:
 *  1. Carga costos de producto (JSON tiene prioridad sobre DB)
 *  2. Descarga órdenes de ambas tiendas en el rango
 *  3. Agrupa units_sold × cost_per_unit → COGS por brand+día
 *  4. Actualiza DailyMetric.cogs para cada brand+día
 *     (también recalcula netProfit = netRevenue − fees − adSpend − cogs)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

// ─── Store configs ────────────────────────────────────────────────────────────
const STORES = [
  {
    shop:         "glm-1694.myshopify.com",
    clientId:     "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType:     "json" as const,
    brandId:      "brand_glowmmi",
    shopRate:     18.7,  // MXN → USD
  },
  {
    shop:         "mp0vab-bw.myshopify.com",
    clientId:     "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType:     "urlencoded" as const,
    brandId:      "brand_balancea",
    shopRate:     18.7,
  },
];

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getToken(s: typeof STORES[number]): Promise<string> {
  const url  = `https://${s.shop}/admin/oauth/access_token`;
  const body = s.authType === "urlencoded"
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }).toString()
    : JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, grant_type: "client_credentials" });
  const res  = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": s.authType === "urlencoded" ? "application/x-www-form-urlencoded" : "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Auth ${s.shop}: ${res.status}`);
  return (await res.json()).access_token;
}

// ─── Fetch orders with line_items ─────────────────────────────────────────────
async function fetchOrders(shop: string, token: string, since: string, until: string) {
  const all: any[] = [];
  let url = `https://${shop}/admin/api/2024-01/orders.json?status=any&financial_status=paid,partially_paid&created_at_min=${since}&created_at_max=${until}&limit=250&fields=id,created_at,line_items`;
  while (url) {
    const res  = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data = await res.json();
    all.push(...(data.orders ?? []));
    const next = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
  }
  return all;
}

// ─── Load product costs (JSON priority > DB) ──────────────────────────────────
function normalizeName(n: string) {
  return n.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim();
}

async function loadCosts(): Promise<Record<string, number>> {
  const jsonPath = path.join(process.cwd(), "data", "product-costs.json");
  let jsonCosts: Record<string, number> = {};
  try {
    if (fs.existsSync(jsonPath)) {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) {
        if (!k.startsWith("_") && typeof v === "number") jsonCosts[k] = v;
      }
    }
  } catch {}

  const dbCosts: Record<string, number> = {};
  try {
    const products = await prisma.product.findMany({ select: { name: true, supplierCostUsd: true } });
    for (const p of products) {
      if (p.supplierCostUsd && p.supplierCostUsd > 0) {
        dbCosts[p.name] = p.supplierCostUsd;
        dbCosts[normalizeName(p.name)] = p.supplierCostUsd;
      }
    }
    const escalones = await (prisma as any).supplierEscalon?.findMany({ orderBy: { units: "asc" } }) ?? [];
    for (const e of escalones) {
      const cost = e.costUs ?? e.costMx ?? e.costCl ?? 0;
      if (cost > 0 && !dbCosts[e.productName]) {
        dbCosts[e.productName] = cost;
        dbCosts[normalizeName(e.productName)] = cost;
      }
    }
  } catch {}

  return { ...dbCosts, ...jsonCosts };
}

function lookupCost(name: string, costs: Record<string, number>): number {
  return costs[name] ?? costs[normalizeName(name)] ?? 0;
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body   = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;

  const today  = new Date();
  const days   = parseInt(body.days ?? "30") || 30;
  const from   = body.from
    ? new Date(body.from + "T00:00:00Z")
    : new Date(Date.now() - (days - 1) * 864e5);
  const to     = body.to
    ? new Date(body.to + "T23:59:59Z")
    : today;

  const since  = from.toISOString().slice(0, 10) + "T00:00:00-06:00";
  const until  = to.toISOString().slice(0, 10)   + "T23:59:59-06:00";

  const costs = await loadCosts();

  // brand+day → COGS in USD
  const cogsByBrandDay: Record<string, number> = {};
  const missingCosts  = new Set<string>();
  let   totalOrders   = 0;

  for (const store of STORES) {
    try {
      const token  = await getToken(store);
      const orders = await fetchOrders(store.shop, token, since, until);
      totalOrders += orders.length;

      for (const order of orders) {
        const dateKey = order.created_at?.slice(0, 10);
        if (!dateKey) continue;
        const key = `${dateKey}|${store.brandId}`;

        for (const item of (order.line_items ?? [])) {
          const name  = item.title ?? "";
          const nLow  = name.toLowerCase();
          const price = parseFloat(item.price ?? "0");
          // Skip free items ($0) and digital/ebook products — they have no COGS
          if (price <= 0) continue;
          if (
            nLow.includes("ebook") || nLow.includes("e-book") ||
            nLow.includes("digital") || nLow.includes("pdf") ||
            nLow.includes("guía gratis") || nLow.includes("guia gratis") ||
            nLow.includes("gratis") || nLow.includes("free") ||
            nLow.includes("regalo") || nLow.includes("gift") ||
            nLow.includes("bonus")
          ) continue;

          const qty  = parseInt(item.quantity) || 1;
          const cost = lookupCost(name, costs);

          if (cost === 0) { missingCosts.add(name); continue; }

          // line_items.price is in shop currency (MXN) — but cost is in USD, no conversion needed
          cogsByBrandDay[key] = (cogsByBrandDay[key] ?? 0) + qty * cost;
        }
      }
    } catch (e: any) {
      console.error(`[cogs-rollup] ${store.shop}:`, e.message);
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      days: Object.keys(cogsByBrandDay).length,
      sampleEntries: Object.entries(cogsByBrandDay).slice(0, 10).map(([k, v]) => ({ key: k, cogs: +v.toFixed(2) })),
      totalOrders,
      missingCosts: [...missingCosts].slice(0, 20),
      costsLoaded: Object.keys(costs).length,
    });
  }

  // ── Apply to DailyMetric ───────────────────────────────────────────────────
  let updated = 0;
  let skipped = 0;

  for (const [key, cogsUsd] of Object.entries(cogsByBrandDay)) {
    const [dateStr, brandId] = key.split("|");
    const dayStart = new Date(dateStr + "T00:00:00Z");
    const dayEnd   = new Date(dateStr + "T23:59:59Z");

    const rows = await prisma.dailyMetric.findMany({
      where: { brandId, date: { gte: dayStart, lte: dayEnd } },
      orderBy: { grossRevenue: "desc" },
    });

    if (rows.length === 0) { skipped++; continue; }

    // Update ALL rows for this brand+day proportionally by revenue share
    const totalRevenue = rows.reduce((s, r) => s + r.grossRevenue, 0);

    for (const row of rows) {
      const share = totalRevenue > 0 ? row.grossRevenue / totalRevenue : 1 / rows.length;
      const rowCogs = cogsUsd * share;

      // Recalc netProfit = netRevenue - fees - adSpend - cogs
      const adSpend   = row.adSpend ?? 0;
      const fees      = row.fees    ?? 0;
      const netProfit = row.netRevenue - fees - adSpend - rowCogs;
      const netMargin = row.grossRevenue > 0 ? (netProfit / row.grossRevenue) * 100 : 0;

      await prisma.dailyMetric.update({
        where: { id: row.id },
        data:  { cogs: rowCogs, netProfit, netMargin },
      });
      updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    skipped,
    totalOrders,
    daysProcessed: Object.keys(cogsByBrandDay).length,
    costsLoaded: Object.keys(costs).length,
    missingCosts: [...missingCosts].slice(0, 30),
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  });
}
