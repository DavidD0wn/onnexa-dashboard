import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { businessDate } from "@/lib/finance-drive";
import {
  buildDailyFinancialReport,
  prepareDailyFinancialReport,
  previousBusinessDate,
  refreshAndSendDailyReport,
  sendDailyFinancialReport,
  validReportDate,
} from "@/lib/daily-financial-report";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET || process.env.SYNC_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

// Vercel llama a las 13:00 UTC = 8:00 a. m. Colombia.
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const date = previousBusinessDate();
  try {
    const result = await refreshAndSendDailyReport(new URL(req.url).origin, date);
    return NextResponse.json({ date, ...result });
  } catch (error) {
    console.error("[Daily Financial Report] send failed", error);
    return NextResponse.json({ date, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

// Acciones manuales autenticadas: preview, prepare, send o resend.
// "resend" es deliberado y queda auditado; el cron nunca reenvía un "sent".
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = await req.json().catch(() => ({})) as { date?: string; action?: string };
  const date = input.date || previousBusinessDate();
  if (!validReportDate(date) || date >= businessDate()) {
    return NextResponse.json({ error: "Fecha inválida o no cerrada." }, { status: 400 });
  }
  try {
    if (input.action === "preview-live") {
      return NextResponse.json({ date, ...await buildDailyFinancialReport(new URL(req.url).origin, date) });
    }
    if (input.action === "preview") {
      const report = await prisma.dailyFinancialReport.findUnique({ where: { date } });
      return NextResponse.json(report
        ? { date, status: report.status, subject: report.subject, body: report.body, htmlBody: report.htmlBody,
            recipient: report.recipient, sentAt: report.sentAt, error: report.errorMsg }
        : { date, status: "missing" });
    }
    if (input.action === "prepare") {
      const report = await prepareDailyFinancialReport(new URL(req.url).origin, date);
      return NextResponse.json({ date, status: report.status, subject: report.subject,
        body: report.body, htmlBody: report.htmlBody, recipient: report.recipient });
    }
    if (input.action === "refresh-preview") {
      return NextResponse.json({ date, ...await refreshAndSendDailyReport(new URL(req.url).origin, date, false, true) });
    }
    if (input.action === "send" || input.action === "resend") {
      const result = input.action === "send"
        ? await refreshAndSendDailyReport(new URL(req.url).origin, date, true, true)
        : await sendDailyFinancialReport(date, "resend");
      return NextResponse.json({ date, ...result });
    }
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  } catch (error) {
    console.error("[Daily Financial Report] manual action failed", error);
    return NextResponse.json({ date, error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
