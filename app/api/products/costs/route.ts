import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

const COSTS_PATH  = path.join(process.cwd(), "data", "product-costs.json");
const DETAIL_PATH = path.join(process.cwd(), "data", "product-costs-detail.json");

type CountryKey = "mx" | "us" | "cl";
type CostsByCountry  = { mx: Record<string, number>;  us: Record<string, number>;  cl: Record<string, number> };
export type CostDetail = { product?: number; shipping?: number; refund?: number; fee?: number; price?: number };
type DetailByCountry = { mx: Record<string, CostDetail>; us: Record<string, CostDetail>; cl: Record<string, CostDetail> };

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim();
}
const parseCountry = (obj: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (obj && typeof obj === "object")
    for (const [k, v] of Object.entries(obj as Record<string, unknown>))
      if (typeof v === "number") out[k] = v;
  return out;
};

function loadCosts(): CostsByCountry {
  try {
    if (fs.existsSync(COSTS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(COSTS_PATH, "utf-8")) as Record<string, unknown>;
      if (raw.mx && typeof raw.mx === "object")
        return { mx: parseCountry(raw.mx), us: parseCountry(raw.us ?? raw.mx), cl: parseCountry(raw.cl ?? raw.mx) };
      const flat: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw))
        if (!k.startsWith("_") && typeof v === "number") flat[k] = v;
      return { mx: flat, us: { ...flat }, cl: { ...flat } };
    }
  } catch {}
  return { mx: {}, us: {}, cl: {} };
}

function saveCosts(data: CostsByCountry) {
  const dir = path.dirname(COSTS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let existing: Record<string, unknown> = {};
  try { if (fs.existsSync(COSTS_PATH)) existing = JSON.parse(fs.readFileSync(COSTS_PATH, "utf-8")); } catch {}
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) if (k.startsWith("_")) meta[k] = v;
  fs.writeFileSync(COSTS_PATH, JSON.stringify({ ...meta, ...data }, null, 2), "utf-8");
}

function loadDetail(): DetailByCountry {
  try {
    if (fs.existsSync(DETAIL_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DETAIL_PATH, "utf-8")) as Record<string, unknown>;
      const parse = (obj: unknown): Record<string, CostDetail> => {
        const out: Record<string, CostDetail> = {};
        if (obj && typeof obj === "object")
          for (const [k, v] of Object.entries(obj as Record<string, unknown>))
            if (v && typeof v === "object") out[k] = v as CostDetail;
        return out;
      };
      return { mx: parse(raw.mx), us: parse(raw.us), cl: parse(raw.cl) };
    }
  } catch {}
  return { mx: {}, us: {}, cl: {} };
}

function saveDetail(data: DetailByCountry) {
  fs.writeFileSync(DETAIL_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/* ─── GET — returns totals + detail breakdown ─────────────────────────────── */
export async function GET() {
  const costs  = loadCosts();
  const detail = loadDetail();

  // Enrich from DB (MX only, non-critical)
  try {
    const dbProducts = await prisma.product.findMany({ select: { name: true, supplierCostUsd: true } });
    for (const p of dbProducts)
      if (p.supplierCostUsd && p.supplierCostUsd > 0 && !costs.mx[p.name])
        costs.mx[p.name] = p.supplierCostUsd;
  } catch {}

  return NextResponse.json({ ...costs, detail });
}

/* ─── PATCH { name, costPerUnit, country?, product?, shipping?, refund?, fee?, price? } ─── */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { name, costPerUnit, country, product, shipping, refund, fee, price } = body;
  if (!name || costPerUnit === undefined)
    return NextResponse.json({ error: "name + costPerUnit required" }, { status: 400 });

  const val = parseFloat(costPerUnit) || 0;
  const costs  = loadCosts();
  const detail = loadDetail();

  const targets: CountryKey[] = country ? [country as CountryKey] : ["mx", "us", "cl"];
  const normalizedName = normalizeName(name);

  for (const c of targets) {
    costs[c][name] = val;
    if (normalizedName !== name) costs[c][normalizedName] = val;

    // Update detail breakdown if any component provided
    const hasBreakdown = product !== undefined || shipping !== undefined || refund !== undefined || fee !== undefined || price !== undefined;
    if (hasBreakdown) {
      if (!detail[c]) detail[c] = {};
      detail[c][name] = {
        ...(detail[c][name] ?? {}),
        ...(product  !== undefined ? { product:  parseFloat(product)  || 0 } : {}),
        ...(shipping !== undefined ? { shipping: parseFloat(shipping) || 0 } : {}),
        ...(refund   !== undefined ? { refund:   parseFloat(refund)   || 0 } : {}),
        ...(fee      !== undefined ? { fee:      parseFloat(fee)      || 0 } : {}),
        ...(price    !== undefined ? { price:    parseFloat(price)    || 0 } : {}),
      };
    }
  }

  saveCosts(costs);
  saveDetail(detail);

  // Best-effort DB sync for MX cost
  try {
    await prisma.product.updateMany({
      where: { name: { contains: name.slice(0, 30) } },
      data:  { supplierCostUsd: val },
    });
  } catch {}

  return NextResponse.json({ ok: true, name, costPerUnit: val, country: country ?? "all" });
}

/* ─── PUT { mx: {...}, us: {...}, cl: {...} } — bulk replace totals ─────── */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  saveCosts(body);
  return NextResponse.json({ ok: true });
}

/* ─── POST — sync MX costs from JSON → Product.supplierCostUsd ─────────── */
export async function POST() {
  const costs = loadCosts();
  const mxEntries = Object.entries(costs.mx).filter(([, v]) => v > 0);

  let updated = 0;
  let matched = 0;
  for (const [name, cost] of mxEntries) {
    try {
      const result = await prisma.product.updateMany({
        where: { name: { contains: name.slice(0, 40) } },
        data:  { supplierCostUsd: cost },
      });
      if (result.count > 0) { updated += result.count; matched++; }
    } catch {}
  }

  return NextResponse.json({
    ok: true,
    costsInJson:     mxEntries.length,
    productsMatched: matched,
    dbRowsUpdated:   updated,
  });
}
