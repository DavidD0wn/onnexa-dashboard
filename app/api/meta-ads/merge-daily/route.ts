import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as rollupMetaAds } from "@/app/api/meta-ads/rollup/route";

/**
 * Compatibilidad con el botón antiguo de configuración.
 * Toda consolidación usa ahora el mismo motor canónico de /api/meta-ads/rollup.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);
  const from =
    body.from ??
    body.dateFrom ??
    new Date(Date.now() - 59 * 86_400_000).toISOString().slice(0, 10);
  const to = body.to ?? body.dateTo ?? today;

  const rollupRequest = new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  });
  return rollupMetaAds(rollupRequest);
}

/** GET → muestra el estado actual del merge */
export async function GET() {
  const total = await prisma.dailyMetric.count();
  const withAds = await prisma.dailyMetric.count({
    where: { adSpend: { gt: 0 } },
  });
  const lastSync = await prisma.metaAdsSyncLog
    .findFirst({ orderBy: { createdAt: "desc" } })
    .catch(() => null);

  return NextResponse.json({
    total,
    withAds,
    withoutAds: total - withAds,
    lastMetaSync: lastSync,
  });
}
