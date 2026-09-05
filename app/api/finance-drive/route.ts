import { NextRequest, NextResponse } from "next/server";
import {
  bootstrapFinanceDrive,
  exportFinanceRangeToDrive,
  financeDriveConfigured,
  financeDriveUrl,
  readFinanceManifest,
} from "@/lib/finance-drive";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const expected = process.env.SYNC_SECRET?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-sync-secret") === expected;
}

export async function GET() {
  try {
    if (!financeDriveConfigured()) {
      return NextResponse.json({
        configured: false,
        connected: false,
        folderUrl: financeDriveUrl(),
        manifest: null,
      });
    }
    const manifest = await readFinanceManifest();
    return NextResponse.json({
      configured: true,
      connected: true,
      folderUrl: financeDriveUrl(),
      manifest,
    });
  } catch (error) {
    return NextResponse.json(
      {
        configured: financeDriveConfigured(),
        connected: false,
        folderUrl: financeDriveUrl(),
        manifest: null,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: "bootstrap" | "export";
      from?: string;
      to?: string;
      advanceCheckpoint?: boolean;
    };
    const manifest =
      body.action === "export" && body.from && body.to
        ? await exportFinanceRangeToDrive(body.from, body.to, {
            advanceCheckpoint: body.advanceCheckpoint === true,
          })
        : await bootstrapFinanceDrive();
    return NextResponse.json({
      ok: true,
      folderUrl: financeDriveUrl(),
      manifest,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
