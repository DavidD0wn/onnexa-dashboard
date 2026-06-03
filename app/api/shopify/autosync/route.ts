import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Auto-sync completo en 5 pasos:
 *  1. Shopify sync  → DailyMetric (ventas, órdenes, fees estimados)
 *  2. Payments sync → fees reales de Shopify Payments (Glowmmi)
 *  3. Disputes sync → chargebacks automáticos (Glowmmi)
 *  4. Meta Ads sync → AdSpend table
 *  5. Rollup        → DailyMetric.adSpend + netProfit recalculado
 *
 * Llamar con POST o GET (GET útil desde Task Scheduler / cron).
 */

export async function POST(req: Request) {
  const { days = 3, secret } = await req.json().catch(() => ({ days: 3 }));

  const expectedSecret = process.env.SYNC_SECRET ?? "onnexa2024";
  if (secret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const today    = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);

  const results: Record<string, any> = {};

  // ── Paso 1: Shopify sync ──────────────────────────────────
  for (const store of ["glowmmi", "balancea"]) {
    try {
      const res = await fetch(`${base}/api/shopify/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, days }),
      });
      results[`shopify_${store}`] = await res.json();
    } catch (e: any) {
      results[`shopify_${store}`] = { error: e.message };
    }
  }

  // ── Paso 2: Shopify Payments → fees reales (Glowmmi only) ───
  try {
    const res = await fetch(`${base}/api/shopify/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "glowmmi", days }),
    });
    results.payments = await res.json();
  } catch (e: any) {
    results.payments = { error: e.message };
  }

  // ── Paso 3: Disputes → chargebacks automáticos ────────────
  try {
    const res = await fetch(`${base}/api/shopify/disputes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "glowmmi" }),
    });
    results.disputes = await res.json();
  } catch (e: any) {
    results.disputes = { error: e.message };
  }

  // ── Paso 4: Meta Ads sync ──────────────────────────────────
  try {
    const res = await fetch(`${base}/api/meta-ads/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateFrom, dateTo: today }),
    });
    results.metaAds = await res.json();
  } catch (e: any) {
    results.metaAds = { error: e.message };
  }

  // ── Paso 5: Rollup AdSpend → DailyMetric ──────────────────
  try {
    const res = await fetch(`${base}/api/meta-ads/rollup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: dateFrom, to: today }),
    });
    results.rollup = await res.json();
  } catch (e: any) {
    results.rollup = { error: e.message };
  }

  // ── Paso 6: Limpiar shopify_* duplicados ─────────────────
  // Si ya existe una fila Sheet5/CUID para esa fecha+brand, borramos el shopify_*
  // para evitar doble conteo. Mantenemos shopify_* solo si no hay fila Sheet5.
  let cleanedShopify = 0;
  try {
    const shopifyRows = await prisma.dailyMetric.findMany({
      where: { id: { startsWith: "shopify_" } },
      select: { id: true, brandId: true, date: true },
    });
    for (const sr of shopifyRows) {
      const dayStart = new Date(Date.UTC(sr.date.getUTCFullYear(), sr.date.getUTCMonth(), sr.date.getUTCDate(), 0, 0, 0));
      const dayEnd   = new Date(Date.UTC(sr.date.getUTCFullYear(), sr.date.getUTCMonth(), sr.date.getUTCDate(), 23, 59, 59));
      const sheet5Row = await prisma.dailyMetric.findFirst({
        where: {
          brandId: sr.brandId,
          date: { gte: dayStart, lte: dayEnd },
          id: { not: { startsWith: "shopify_" } },
        },
      });
      if (sheet5Row) {
        await prisma.dailyMetric.delete({ where: { id: sr.id } });
        cleanedShopify++;
      }
    }
    results.cleanup = { deletedShopifyDuplicates: cleanedShopify };
  } catch (e: any) {
    results.cleanup = { error: e.message };
  }

  // ── Resumen ────────────────────────────────────────────────
  const totalOrders =
    (results.shopify_glowmmi?.ordersTotal  ?? 0) +
    (results.shopify_balancea?.ordersTotal ?? 0);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    days,
    dateFrom,
    dateTo: today,
    totalOrders,
    shopify: {
      glowmmi:  results.shopify_glowmmi,
      balancea: results.shopify_balancea,
    },
    payments: results.payments,
    disputes: results.disputes,
    metaAds:  results.metaAds,
    rollup:   results.rollup,
    cleanup:  results.cleanup,
  });
}

export async function GET() {
  return POST(new Request("http://localhost/api/shopify/autosync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days: 3 }),
  }));
}
