import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getShopifyStores,
  isShopifyStoreConfigured,
} from "@/lib/integrations/shopify";
import {
  bootstrapFinanceDrive,
  businessDate,
  exportFinanceRangeToDrive,
  financeDriveConfigured,
  incrementalStartDate,
  readFinanceManifest,
} from "@/lib/finance-drive";

export const runtime = "nodejs";
export const maxDuration = 300;

async function readJsonResponse(res: Response): Promise<Record<string, any>> {
  const text = await res.text();
  if (!text.trim()) return { error: `Respuesta vacía (HTTP ${res.status})` };
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return { error: `Respuesta inválida (HTTP ${res.status})` };
  }
}

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
  const body = await req.json().catch(() => ({})) as {
    days?: number;
    secret?: string;
    from?: string;
    to?: string;
    incremental?: boolean;
  };
  const days = Math.max(1, Number(body.days ?? 3));
  const { secret } = body;

  const expectedSecret = process.env.SYNC_SECRET ?? "onnexa2024";
  if (secret && secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Siempre llamar al mismo proceso que recibió la petición. Esto permite que
  // localhost y Vercel compartan Drive sin que un puerto termine llamando a otra app.
  const base = new URL(req.url).origin;
  const today = body.to ?? businessDate();
  let driveManifest = null;
  let bootstrapped = false;
  if (financeDriveConfigured()) {
    try {
      driveManifest = await readFinanceManifest();
      if (!driveManifest) {
        driveManifest = await bootstrapFinanceDrive();
        bootstrapped = true;
      }
    } catch (error) {
      return NextResponse.json(
        {
          error: "No se pudo leer el punto de sincronización de Google Drive.",
          detail: error instanceof Error ? error.message : String(error),
        },
        { status: 503 },
      );
    }
  }
  const fallbackFrom = new Date(Date.now() - (days - 1) * 864e5)
    .toISOString()
    .slice(0, 10);
  const requestedFrom = body.from ?? (
    body.incremental === false
      ? fallbackFrom
      : incrementalStartDate(driveManifest, days)
  );
  const dateFrom = requestedFrom > today ? today : requestedFrom;

  const results: Record<string, any> = {};
  const stores = Object.values(getShopifyStores()).filter(isShopifyStoreConfigured);

  // ── Paso 1: Shopify sync ──────────────────────────────────
  for (const store of stores) {
    try {
      const res = await fetch(`${base}/api/shopify/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: store.key,
          days,
          from: dateFrom,
          to: today,
          skipRollup: true,
        }),
      });
      results[`shopify_${store.key}`] = await readJsonResponse(res);
    } catch (e: any) {
      results[`shopify_${store.key}`] = { error: e.message };
    }
  }

  // ── Paso 2: Shopify Payments → fees reales (Glowmmi only) ───
  results.payments = {};
  for (const store of stores) {
    try {
      const res = await fetch(`${base}/api/shopify/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: store.key, days, from: dateFrom, to: today }),
      });
      results.payments[store.key] = await readJsonResponse(res);
    } catch (e: any) {
      results.payments[store.key] = { error: e.message };
    }
  }

  // ── Paso 3: Disputes → chargebacks automáticos ────────────
  results.disputes = {};
  for (const store of stores) {
    try {
      const res = await fetch(`${base}/api/shopify/disputes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: store.key }),
      });
      results.disputes[store.key] = await readJsonResponse(res);
    } catch (e: any) {
      results.disputes[store.key] = { error: e.message };
    }
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
  let preservedConflicts = 0;
  try {
    const shopifyRows = await prisma.dailyMetric.findMany({
      // Nunca limpiar fuera del rango que acabamos de descargar. Antes una
      // actualización de un solo día podía borrar filas válidas de meses atrás.
      where: {
        id: { startsWith: "shopify_" },
        date: {
          gte: new Date(`${dateFrom}T00:00:00Z`),
          lte: new Date(`${today}T23:59:59Z`),
        },
      },
      select: {
        id: true,
        brandId: true,
        countryId: true,
        date: true,
        ordersCount: true,
        netRevenue: true,
      },
    });
    for (const sr of shopifyRows) {
      const dayStart = new Date(Date.UTC(sr.date.getUTCFullYear(), sr.date.getUTCMonth(), sr.date.getUTCDate(), 0, 0, 0));
      const dayEnd   = new Date(Date.UTC(sr.date.getUTCFullYear(), sr.date.getUTCMonth(), sr.date.getUTCDate(), 23, 59, 59));
      const sheet5Row = await prisma.dailyMetric.findFirst({
        where: {
          brandId: sr.brandId,
          countryId: sr.countryId,
          date: { gte: dayStart, lte: dayEnd },
          id: { not: { startsWith: "shopify_" } },
        },
      });
      if (sheet5Row) {
        // Una fila CUID también puede ser una fila técnica creada para guardar
        // Meta Ads, con cero ventas. Borrar shopify_* solo por su existencia
        // eliminó pedidos históricos válidos. Solo es duplicado si ambas filas
        // contienen exactamente las mismas ventas.
        const sameSales =
          sheet5Row.ordersCount === sr.ordersCount &&
          Math.abs(sheet5Row.netRevenue - sr.netRevenue) < 0.01;
        if (sameSales && sr.ordersCount > 0) {
          await prisma.dailyMetric.delete({ where: { id: sr.id } });
          cleanedShopify++;
        } else {
          preservedConflicts++;
        }
      }
    }
    results.cleanup = {
      deletedShopifyDuplicates: cleanedShopify,
      preservedSalesConflicts: preservedConflicts,
    };
  } catch (e: any) {
    results.cleanup = { error: e.message };
  }

  // ── Paso 7: snapshot semanal + checkpoint compartido en Drive ───────────
  // Solo se avanza el checkpoint cuando TODAS las tiendas, Meta y el rollup
  // terminaron. Si algo falla, Drive conserva el último estado confirmado.
  const shopifyOk = stores.every((store) => !results[`shopify_${store.key}`]?.error);
  const metaOk =
    !results.metaAds?.error &&
    results.metaAds?.ok !== false &&
    (results.metaAds?.skippedAccounts?.length ?? 0) === 0;
  const rollupOk = !results.rollup?.error;
  const coreSyncOk = shopifyOk && metaOk && rollupOk;

  if (financeDriveConfigured() && coreSyncOk) {
    try {
      const manifest = await exportFinanceRangeToDrive(dateFrom, today, {
        advanceCheckpoint: true,
      });
      results.drive = {
        ok: true,
        lastSuccessfulDate: manifest.lastSuccessfulDate,
        lastSuccessfulAt: manifest.lastSuccessfulAt,
        weeksSaved: Object.keys(manifest.weeks).length,
        bootstrapped,
      };
    } catch (e: any) {
      results.drive = { ok: false, error: e.message };
    }
  } else if (financeDriveConfigured()) {
    results.drive = {
      ok: false,
      error: "No se avanzó el guardado porque Shopify, Meta o el consolidado quedó incompleto.",
    };
  } else {
    results.drive = { ok: false, error: "Google Drive no está configurado." };
  }

  // ── Resumen ────────────────────────────────────────────────
  const totalOrders =
    (results.shopify_glowmmi?.ordersTotal  ?? 0) +
    (results.shopify_balancea?.ordersTotal ?? 0) +
    (results.shopify_pleena?.ordersTotal ?? 0);

  return NextResponse.json({
    ok: coreSyncOk && results.drive?.ok === true,
    timestamp: new Date().toISOString(),
    mode: body.incremental === false || body.from ? "range" : "incremental",
    days: Math.floor((new Date(today).getTime() - new Date(dateFrom).getTime()) / 864e5) + 1,
    dateFrom,
    dateTo: today,
    totalOrders,
    shopify: {
      glowmmi:  results.shopify_glowmmi,
      balancea: results.shopify_balancea,
      pleena:   results.shopify_pleena,
    },
    payments: results.payments,
    disputes: results.disputes,
    metaAds:  results.metaAds,
    rollup:   results.rollup,
    cleanup:  results.cleanup,
    drive:    results.drive,
  });
}

export async function GET(req: Request) {
  return POST(new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incremental: true }),
  }));
}
