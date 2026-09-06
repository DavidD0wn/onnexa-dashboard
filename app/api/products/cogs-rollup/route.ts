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
import {
  fetchShopifyPaginated,
  getShopifyStores,
  isShopifyRevenueOrder,
  shopifyRestUrl,
  type ShopifyStoreConfig,
} from "@/lib/integrations/shopify";

// ─── Fetch orders with line_items ─────────────────────────────────────────────
async function fetchOrders(store: ShopifyStoreConfig, since: string, until: string) {
  const orders = await fetchShopifyPaginated<any>(
    store,
    shopifyRestUrl(
      store,
      `orders.json?status=any&created_at_min=${since}&created_at_max=${until}&limit=250&fields=id,created_at,financial_status,cancelled_at,test,shipping_address,line_items`,
    ),
    "orders",
  );
  return orders.filter(isShopifyRevenueOrder);
}

// ─── Load product costs (JSON priority > DB) ──────────────────────────────────
function normalizeName(n: string) {
  return n.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim();
}

type CountryCostKey = "mx" | "us" | "cl" | "es";
type CostsByCountry = Record<CountryCostKey, Record<string, number>>;

const COUNTRY_ID_BY_CODE: Record<string, string> = {
  MX: "country_mx",
  US: "country_us",
  CL: "country_cl",
  ES: "country_es",
};

function setCost(map: Record<string, number>, key: string, value: number) {
  map[key] = value;
  map[normalizeName(key)] = value;
}

async function loadCosts(): Promise<CostsByCountry> {
  const jsonPath = path.join(process.cwd(), "data", "product-costs.json");
  const costs: CostsByCountry = { mx: {}, us: {}, cl: {}, es: {} };
  try {
    if (fs.existsSync(jsonPath)) {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
      for (const country of ["mx", "us", "cl", "es"] as const) {
        const block = raw[country];
        if (!block || typeof block !== "object") continue;
        for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
          if (typeof value === "number" && value > 0) setCost(costs[country], key, value);
        }
      }
    }
  } catch {}

  try {
    const products = await prisma.product.findMany({ select: { name: true, supplierCostUsd: true } });
    for (const product of products) {
      if (!product.supplierCostUsd || product.supplierCostUsd <= 0) continue;
      for (const country of ["mx", "us", "cl", "es"] as const) {
        if (!costs[country][normalizeName(product.name)]) {
          setCost(costs[country], product.name, product.supplierCostUsd);
        }
      }
    }

    const rows = await prisma.productCogsByCountry.findMany({
      where: { isActive: true, countryCode: { in: ["MX", "US", "CL", "ES"] } },
      select: {
        countryCode: true,
        productBaseName: true,
        offerName: true,
        unitsTotal: true,
        productCostUnitUsd: true,
      },
      orderBy: { updatedAt: "asc" },
    });
    for (const row of rows) {
      if (row.productCostUnitUsd <= 0) continue;
      const country = row.countryCode.toLowerCase() as CountryCostKey;
      if (!costs[country]) continue;
      setCost(costs[country], row.offerName.trim(), row.productCostUnitUsd);
      setCost(costs[country], `${row.productBaseName} x${row.unitsTotal}`, row.productCostUnitUsd);
      if (row.unitsTotal === 1) setCost(costs[country], row.productBaseName, row.productCostUnitUsd);
    }
  } catch {}

  return costs;
}

function bundleSize(title: string, variant: string): number {
  const variantMatch = variant.match(/\bx(\d+)\b/i) ?? variant.match(/^(\d+)\s*(unidades?|pcs?|units?)?$/i);
  if (variantMatch) return Math.max(1, parseInt(variantMatch[1]));
  const titleMatch = title.match(/\bx(\d+)\b/i);
  return titleMatch ? Math.max(1, parseInt(titleMatch[1])) : 1;
}

function lookupCost(name: string, variant: string, costs: Record<string, number>): number {
  const base = name
    .split(/\s*[|—–]\s*/)[0]
    .replace(/[™®]/g, "")
    .trim();
  const normalizedName = normalizeName(name);
  const normalizedBase = normalizeName(base);
  const normalizedVariant = normalizeName(variant);
  if (variant) {
    return (
      costs[`${base} ${variant}`] ?? costs[`${normalizedBase} ${normalizedVariant}`] ??
      costs[`${name} ${variant}`] ?? costs[`${normalizedName} ${normalizedVariant}`] ??
      costs[name] ?? costs[base] ?? costs[normalizedName] ?? costs[normalizedBase] ?? 0
    );
  }
  return (
    costs[`${base} x1`] ?? costs[`${normalizedBase} x1`] ??
    costs[`${name} x1`] ?? costs[`${normalizedName} x1`] ??
    costs[name] ?? costs[base] ?? costs[normalizedName] ?? costs[normalizedBase] ?? 0
  );
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

  const since  = from.toISOString().slice(0, 10) + "T00:00:00-05:00";
  const until  = to.toISOString().slice(0, 10)   + "T23:59:59-05:00";

  const costs = await loadCosts();

  // brand+country+day → COGS in USD
  const cogsByBrandCountryDay: Record<string, number> = {};
  const missingCosts  = new Set<string>();
  let   totalOrders   = 0;

  for (const store of Object.values(getShopifyStores())) {
    try {
      const orders = await fetchOrders(store, since, until);
      totalOrders += orders.length;

      for (const order of orders) {
        const dateKey = order.created_at?.slice(0, 10);
        if (!dateKey) continue;
        const rawCountryCode = String(order.shipping_address?.country_code ?? "MX").toUpperCase();
        const countryCode = COUNTRY_ID_BY_CODE[rawCountryCode] ? rawCountryCode : "MX";
        const countryId = COUNTRY_ID_BY_CODE[countryCode];
        const countryCosts = costs[countryCode.toLowerCase() as CountryCostKey];
        const key = `${dateKey}|${store.brandId}|${countryId}`;

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

          const qty = parseInt(item.quantity) || 1;
          const variant = item.variant_title && item.variant_title !== "Default Title"
            ? String(item.variant_title)
            : "";
          const physicalUnits = qty * bundleSize(name, variant);
          const tierVariant = !variant && physicalUnits > 1 ? `x${physicalUnits}` : variant;
          const cost = lookupCost(name, tierVariant, countryCosts);

          if (cost === 0) { missingCosts.add(name); continue; }

          // line_items.price is in shop currency (MXN) — but cost is in USD, no conversion needed
          cogsByBrandCountryDay[key] = (cogsByBrandCountryDay[key] ?? 0) + physicalUnits * cost;
        }
      }
    } catch (e: any) {
      console.error(`[cogs-rollup] ${store.shop}:`, e.message);
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      days: Object.keys(cogsByBrandCountryDay).length,
      sampleEntries: Object.entries(cogsByBrandCountryDay).slice(0, 10).map(([k, v]) => ({ key: k, cogs: +v.toFixed(2) })),
      totalOrders,
      missingCosts: [...missingCosts].slice(0, 20),
      costsLoaded: Object.values(costs).reduce((sum, map) => sum + Object.keys(map).length, 0),
    });
  }

  // ── Apply to DailyMetric ───────────────────────────────────────────────────
  let updated = 0;
  let skipped = 0;

  for (const [key, cogsUsd] of Object.entries(cogsByBrandCountryDay)) {
    const [dateStr, brandId, countryId] = key.split("|");
    const dayStart = new Date(dateStr + "T00:00:00Z");
    const dayEnd   = new Date(dateStr + "T23:59:59Z");

    const rows = await prisma.dailyMetric.findMany({
      where: { brandId, countryId, date: { gte: dayStart, lte: dayEnd } },
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
    daysProcessed: Object.keys(cogsByBrandCountryDay).length,
    costsLoaded: Object.values(costs).reduce((sum, map) => sum + Object.keys(map).length, 0),
    missingCosts: [...missingCosts].slice(0, 30),
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  });
}
