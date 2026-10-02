import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { previousBusinessDate, refreshAndSendDailyReport } from "@/lib/daily-financial-report";

export const runtime = "nodejs";
export const maxDuration = 300;

// Respaldo a las 15:00 UTC (10 a. m. Colombia). Nunca reenvía un reporte
// marcado como sent, ni uno cuyo envío SMTP quedó en estado incierto.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.SYNC_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = previousBusinessDate();
  try {
    // Si Vercel interrumpió la función durante la actualización, liberar la
    // reserva solo después de 15 minutos. El límite del handler es 5 minutos.
    await prisma.dailyFinancialReport.updateMany({
      where: {
        date,
        status: "refreshing",
        sentAt: null,
        sendingAt: null,
        updatedAt: { lt: new Date(Date.now() - 15 * 60_000) },
      },
      data: { status: "failed", errorMsg: "Actualización interrumpida; reintento automático." },
    });

    const result = await refreshAndSendDailyReport(new URL(req.url).origin, date, true, true);
    return NextResponse.json({ date, ...result });
  } catch (error) {
    console.error("[Daily Financial Report] backup retry failed", error);
    return NextResponse.json({ date, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
