import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";

const DIR = path.join(process.cwd(), "data", "backups");

// POST /api/backup — guarda un snapshot de AdSpend + DailyMetric.
// Lo llama el AppLoader ANTES de cada sincronización, para tener siempre un
// punto de restauración si el sync llegara a corromper datos.
export async function POST() {
  try {
    const [adSpend, dailyMetric] = await Promise.all([
      prisma.adSpend.findMany(),
      prisma.dailyMetric.findMany(),
    ]);

    // Salvaguarda: nunca respaldar un estado vacío encima de los buenos.
    if (adSpend.length === 0 && dailyMetric.length === 0) {
      return NextResponse.json({ ok: false, skipped: "sin datos para respaldar" });
    }

    fs.mkdirSync(DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const file  = path.join(DIR, `backup-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), adSpend, dailyMetric }));

    // Conservar solo los últimos 10 respaldos
    const backups = fs.readdirSync(DIR).filter((f) => f.startsWith("backup-")).sort();
    while (backups.length > 10) fs.unlinkSync(path.join(DIR, backups.shift()!));

    return NextResponse.json({ ok: true, file: path.basename(file), adSpend: adSpend.length, dailyMetric: dailyMetric.length });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// GET /api/backup — lista los respaldos disponibles
export async function GET() {
  try {
    if (!fs.existsSync(DIR)) return NextResponse.json({ backups: [] });
    const backups = fs.readdirSync(DIR)
      .filter((f) => f.startsWith("backup-"))
      .sort()
      .reverse()
      .map((f) => {
        const stat = fs.statSync(path.join(DIR, f));
        return { file: f, sizeKb: Math.round(stat.size / 1024), date: stat.mtime.toISOString() };
      });
    return NextResponse.json({ backups });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
