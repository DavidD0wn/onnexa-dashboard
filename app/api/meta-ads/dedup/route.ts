import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/meta-ads/dedup
 *
 * Elimina filas duplicadas de DailyMetric.
 * Las filas con id "shopify_*" son creadas por el sync de Shopify.
 * Las filas con id CUID vienen del import original y tienen mejor data (COGS, USD correcto).
 *
 * Lógica: para cada (date, brandId), si existen filas CUID Y filas shopify_*,
 * se eliminan las shopify_* (las CUID tienen prioridad por tener COGS y conversión USD).
 */
export async function POST() {
  // Traer todas las filas
  const all = await prisma.dailyMetric.findMany({
    select: { id: true, date: true, brandId: true, countryId: true, cogs: true },
  });

  // Separar por tipo de ID
  const shopifyRows = all.filter((r) => r.id.startsWith("shopify_"));
  const cuidRows    = all.filter((r) => !r.id.startsWith("shopify_"));

  // Construir set de (date, brandId) cubiertos por filas CUID
  const cuidKeys = new Set(
    cuidRows.map((r) => `${r.date.toISOString().slice(0, 10)}|${r.brandId}`)
  );

  // Shopify rows que duplican fechas con filas CUID → borrar
  const toDelete = shopifyRows.filter((r) => {
    const key = `${r.date.toISOString().slice(0, 10)}|${r.brandId}`;
    return cuidKeys.has(key);
  });

  if (!toDelete.length) {
    return NextResponse.json({ ok: true, deleted: 0, message: "Sin duplicados encontrados" });
  }

  // Borrar en lotes
  await prisma.dailyMetric.deleteMany({
    where: { id: { in: toDelete.map((r) => r.id) } },
  });

  return NextResponse.json({
    ok: true,
    deleted: toDelete.length,
    shopifyRowsTotal: shopifyRows.length,
    cuidRowsTotal: cuidRows.length,
    remaining: all.length - toDelete.length,
  });
}

export async function GET() {
  const all = await prisma.dailyMetric.findMany({
    select: { id: true, date: true, brandId: true },
  });
  const shopify = all.filter((r) => r.id.startsWith("shopify_")).length;
  const cuid    = all.filter((r) => !r.id.startsWith("shopify_")).length;
  return NextResponse.json({ total: all.length, shopifyRows: shopify, cuidRows: cuid });
}
