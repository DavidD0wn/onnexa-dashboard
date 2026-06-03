import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FILE = join(process.cwd(), "data", "app-costs.json");

export interface AppEntry {
  id:           string;
  name:         string;
  store:        "brand_glowmmi" | "brand_balancea" | "all";
  category:     "plataforma" | "marketing" | "envio" | "analitica" | "atencion" | "diseno" | "finanzas" | "inventario" | "otro";
  costUsd:      number;
  billingCycle: "monthly" | "annual" | "one-time";
  active:       boolean;
  startDate:    string;      // YYYY-MM-DD
  notes:        string;
}

function readFile(): { apps: AppEntry[] } {
  try { return JSON.parse(readFileSync(FILE, "utf-8")); }
  catch { return { apps: [] }; }
}

function writeFile(data: { apps: AppEntry[] }) {
  writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
}

/* GET /api/apps */
export async function GET() {
  const data = readFile();
  const apps = data.apps;

  /* monthly equivalent per app */
  const withMonthly = apps.map((a) => ({
    ...a,
    monthlyUsd: a.billingCycle === "annual"   ? a.costUsd / 12
              : a.billingCycle === "monthly"   ? a.costUsd
              : 0, // one-time: no monthly impact
  }));

  /* Totals */
  const active = withMonthly.filter((a) => a.active);
  const totalMonthly   = active.reduce((s, a) => s + a.monthlyUsd, 0);
  const totalAnnual    = active.reduce((s, a) =>
    s + (a.billingCycle === "annual" ? a.costUsd : a.billingCycle === "monthly" ? a.costUsd * 12 : a.costUsd), 0);

  const byStore: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const a of active) {
    byStore[a.store]       = (byStore[a.store]       ?? 0) + a.monthlyUsd;
    byCategory[a.category] = (byCategory[a.category] ?? 0) + a.monthlyUsd;
  }

  return NextResponse.json({ apps: withMonthly, totalMonthly, totalAnnual, byStore, byCategory });
}

/* POST /api/apps — create */
export async function POST(req: Request) {
  const body = await req.json() as Omit<AppEntry, "id">;
  const data = readFile();
  const newApp: AppEntry = { ...body, id: crypto.randomUUID() };
  data.apps.push(newApp);
  writeFile(data);
  return NextResponse.json(newApp, { status: 201 });
}

/* PATCH /api/apps — update */
export async function PATCH(req: Request) {
  const body = await req.json() as AppEntry;
  const data = readFile();
  const idx  = data.apps.findIndex((a) => a.id === body.id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });
  data.apps[idx] = body;
  writeFile(data);
  return NextResponse.json(body);
}

/* DELETE /api/apps */
export async function DELETE(req: Request) {
  const { id } = await req.json();
  const data   = readFile();
  data.apps    = data.apps.filter((a) => a.id !== id);
  writeFile(data);
  return NextResponse.json({ ok: true });
}
