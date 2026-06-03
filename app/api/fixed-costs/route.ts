import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const FILE = join(process.cwd(), "data", "fixed-costs.json");

export interface FixedCostItem {
  id:        string;
  name:      string;
  amountUsd: number;
  active:    boolean;
}

export interface FixedCostsData {
  salaries: FixedCostItem[];
  other:    FixedCostItem[];
}

function read(): FixedCostsData {
  try { return JSON.parse(readFileSync(FILE, "utf-8")); }
  catch { return { salaries: [], other: [] }; }
}

function write(data: FixedCostsData) {
  writeFileSync(FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET() {
  const data = read();
  const all  = [...data.salaries, ...data.other];
  const totalMonthly = all.filter(i => i.active).reduce((s, i) => s + i.amountUsd, 0);
  return NextResponse.json({ ...data, totalMonthly });
}

export async function PATCH(req: NextRequest) {
  const body: FixedCostItem & { section: "salaries" | "other" } = await req.json();
  const data = read();
  const arr  = data[body.section];
  const idx  = arr.findIndex((i) => i.id === body.id);
  if (idx === -1) return NextResponse.json({ error: "not found" }, { status: 404 });
  arr[idx] = { id: body.id, name: body.name, amountUsd: body.amountUsd, active: body.active };
  write(data);
  return NextResponse.json(arr[idx]);
}

export async function POST(req: NextRequest) {
  const body: Omit<FixedCostItem, "id"> & { section: "salaries" | "other" } = await req.json();
  const data = read();
  const item: FixedCostItem = { id: `fc-${Date.now()}`, name: body.name, amountUsd: body.amountUsd, active: body.active ?? true };
  data[body.section].push(item);
  write(data);
  return NextResponse.json(item, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { id, section } = await req.json() as { id: string; section: "salaries" | "other" };
  const data = read();
  data[section] = data[section].filter((i) => i.id !== id);
  write(data);
  return NextResponse.json({ ok: true });
}
