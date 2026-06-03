/**
 * POST /api/products/costs/import
 * Recibe un archivo Excel (.xlsx) con sheets:
 *   - "KPIs"       → costos para México
 *   - "KPIs Usa"   → costos para USA
 *   - "KPIs Ch"    → costos para Chile
 *   - "ESCALONES_COSTO" → escalones de costo por cantidad
 *
 * Columnas esperadas en sheets KPIs (flexible, busca por cabecera):
 *   Oferta | Costo prod USD | Shipping/Gift USD | Refund USD | Fee pasarela USD | Costo total USD | Precio venta USD
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

const COSTS_PATH  = path.join(process.cwd(), "data", "product-costs.json");
const DETAIL_PATH = path.join(process.cwd(), "data", "product-costs-detail.json");

type CountryKey = "mx" | "us" | "cl";
type CostsByCountry  = { mx: Record<string, number>;  us: Record<string, number>;  cl: Record<string, number> };
type CostDetail = { product?: number; shipping?: number; refund?: number; fee?: number; price?: number };
type DetailByCountry = { mx: Record<string, CostDetail>; us: Record<string, CostDetail>; cl: Record<string, CostDetail> };

/* ─── File I/O ─────────────────────────────────────────────────────────────── */
function loadCosts(): CostsByCountry {
  try {
    if (fs.existsSync(COSTS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(COSTS_PATH, "utf-8")) as Record<string, unknown>;
      const parse = (obj: unknown): Record<string, number> => {
        const out: Record<string, number> = {};
        if (obj && typeof obj === "object")
          for (const [k, v] of Object.entries(obj as Record<string, unknown>))
            if (typeof v === "number") out[k] = v;
        return out;
      };
      if (raw.mx) return { mx: parse(raw.mx), us: parse(raw.us ?? raw.mx), cl: parse(raw.cl ?? raw.mx) };
      const flat: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw))
        if (!k.startsWith("_") && typeof v === "number") flat[k] = v;
      return { mx: flat, us: { ...flat }, cl: { ...flat } };
    }
  } catch {}
  return { mx: {}, us: {}, cl: {} };
}

function saveCosts(data: CostsByCountry) {
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

/* ─── Column finder ──────────────────────────────────────────────────────────── */
function findCol(headers: string[], keywords: string[]): number {
  for (const kw of keywords) {
    const idx = headers.findIndex(h => h.toLowerCase().includes(kw.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

/* ─── Parse a KPI sheet → country costs ─────────────────────────────────────── */
function parseKpiSheet(
  sheet: XLSX.WorkSheet,
  country: CountryKey,
  costs: CostsByCountry,
  detail: DetailByCountry
): { imported: number; warnings: string[] } {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
  if (!rows.length) return { imported: 0, warnings: ["Sheet vacío"] };

  // Find header row (first row containing "oferta" or "producto" or "costo")
  let headerRow = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const rowStr = rows[i].join(" ").toLowerCase();
    if (rowStr.includes("oferta") || rowStr.includes("producto") || rowStr.includes("costo total")) {
      headerRow = i;
      break;
    }
  }

  const headers = rows[headerRow].map(h => String(h ?? "").trim());

  // Map columns
  const colOferta   = findCol(headers, ["oferta", "producto", "nombre"]);
  const colProduct  = findCol(headers, ["costo prod", "costo producto", "proveedor"]);
  const colShipping = findCol(headers, ["shipping", "gift", "envio", "envío"]);
  const colRefund   = findCol(headers, ["refund", "devolucion", "devolución"]);
  const colFee      = findCol(headers, ["fee", "pasarela", "comision", "comisión"]);
  const colTotal    = findCol(headers, ["costo total", "total usd", "total cost"]);
  const colPrice    = findCol(headers, ["precio venta usd", "precio usd", "price usd", "selling price"]);

  if (colOferta < 0) return { imported: 0, warnings: ["No se encontró columna Oferta/Producto"] };
  if (colTotal < 0 && colProduct < 0) return { imported: 0, warnings: ["No se encontró columna de costo"] };

  const warnings: string[] = [];
  let imported = 0;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[colOferta] ?? "").trim();
    if (!name || name.startsWith("#")) continue;

    // Parse values
    const parseFl = (v: unknown): number | undefined => {
      const n = parseFloat(String(v ?? "").replace(/[,$€]/g, ""));
      return isNaN(n) ? undefined : n;
    };

    const productCost  = colProduct  >= 0 ? parseFl(row[colProduct])  : undefined;
    const shippingCost = colShipping >= 0 ? parseFl(row[colShipping]) : undefined;
    const refundCost   = colRefund   >= 0 ? parseFl(row[colRefund])   : undefined;
    const feeCost      = colFee      >= 0 ? parseFl(row[colFee])      : undefined;
    const priceSell    = colPrice    >= 0 ? parseFl(row[colPrice])    : undefined;
    let   totalCost    = colTotal    >= 0 ? parseFl(row[colTotal])    : undefined;

    // Compute total if not present but components are
    if (totalCost == null && productCost != null) {
      totalCost = (productCost ?? 0) + (shippingCost ?? 0) + (refundCost ?? 0) + (feeCost ?? 0);
    }

    if (totalCost == null || totalCost <= 0) continue;

    // Chile sanity check: warn if value looks like CLP (>500)
    if (country === "cl" && totalCost > 200) {
      warnings.push(`${name}: valor $${totalCost} parece CLP, no USD — se omite`);
      continue;
    }

    costs[country][name] = totalCost;
    if (!detail[country]) detail[country] = {};
    detail[country][name] = {
      ...(productCost  != null ? { product:  productCost  } : {}),
      ...(shippingCost != null ? { shipping: shippingCost } : {}),
      ...(refundCost   != null ? { refund:   refundCost   } : {}),
      ...(feeCost      != null ? { fee:      feeCost      } : {}),
      ...(priceSell    != null ? { price:    priceSell    } : {}),
    };
    imported++;
  }

  return { imported, warnings };
}

/* ─── Parse ESCALONES sheet ──────────────────────────────────────────────────── */
async function parseEscalonesSheet(sheet: XLSX.WorkSheet): Promise<{ saved: number; warnings: string[] }> {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
  if (!rows.length) return { saved: 0, warnings: ["Sheet escalones vacío"] };

  // Find header row
  let headerRow = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const rowStr = rows[i].join(" ").toLowerCase();
    if (rowStr.includes("código") || rowStr.includes("codigo") || rowStr.includes("unidades") || rowStr.includes("escalon")) {
      headerRow = i;
      break;
    }
  }

  const headers = rows[headerRow].map(h => String(h ?? "").trim());
  const colCode    = findCol(headers, ["código", "codigo", "code", "sku", "clave"]);
  const colName    = findCol(headers, ["producto", "nombre", "product", "name"]);
  const colUnits   = findCol(headers, ["unidades", "units", "cantidad", "qty", "escalon", "escalón"]);
  const colCostMx  = findCol(headers, ["mx", "mexico", "méxico", "costo mx"]);
  const colCostUs  = findCol(headers, ["us", "usa", "estados unidos", "costo us", "costo usa"]);
  const colCostCl  = findCol(headers, ["cl", "chile", "costo cl", "costo chile"]);

  if (colName < 0) return { saved: 0, warnings: ["No se encontró columna Producto en escalones"] };

  const warnings: string[] = [];
  const toSave: Array<{
    productCode: string; productName: string; units: number;
    costMx?: number; costUs?: number; costCl?: number;
  }> = [];

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const name  = String(row[colName] ?? "").trim();
    const code  = colCode >= 0 ? String(row[colCode] ?? "").trim() : name.slice(0, 6).toUpperCase().replace(/\s/g, "");
    const units = colUnits >= 0 ? parseInt(String(row[colUnits] ?? ""), 10) : NaN;

    if (!name || isNaN(units) || units <= 0) continue;

    const parseFl = (v: unknown): number | undefined => {
      const n = parseFloat(String(v ?? "").replace(/[,$€]/g, ""));
      return isNaN(n) || n <= 0 ? undefined : n;
    };

    toSave.push({
      productCode: code,
      productName: name,
      units,
      costMx: colCostMx >= 0 ? parseFl(row[colCostMx]) : undefined,
      costUs: colCostUs >= 0 ? parseFl(row[colCostUs]) : undefined,
      costCl: colCostCl >= 0 ? parseFl(row[colCostCl]) : undefined,
    });
  }

  let saved = 0;
  for (const r of toSave) {
    try {
      await prisma.supplierEscalon.upsert({
        where: { productCode_units: { productCode: r.productCode, units: r.units } },
        update: { productName: r.productName, costMx: r.costMx ?? null, costUs: r.costUs ?? null, costCl: r.costCl ?? null },
        create: { productCode: r.productCode, productName: r.productName, units: r.units, costMx: r.costMx ?? null, costUs: r.costUs ?? null, costCl: r.costCl ?? null },
      });
      saved++;
    } catch (e) {
      warnings.push(`Error guardando ${r.productName} x${r.units}: ${e}`);
    }
  }

  return { saved, warnings };
}

/* ─── POST handler ───────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

    const buffer  = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;

    const costs  = loadCosts();
    const detail = loadDetail();

    const summary: Record<string, { imported: number; warnings: string[] }> = {};
    let escalonesSaved = 0;

    // Map known sheet names to countries
    const sheetMap: Array<{ keywords: string[]; country: CountryKey }> = [
      { keywords: ["kpis usa", "kpi usa", "kpis us", "kpi us"],      country: "us" },
      { keywords: ["kpis ch",  "kpi ch",  "kpis chile", "kpi chile"], country: "cl" },
      { keywords: ["kpis",     "kpi mx",  "kpi mexico", "mexico"],    country: "mx" },
    ];

    for (const sheetName of sheetNames) {
      const nameLower = sheetName.toLowerCase().trim();

      // Escalones
      if (nameLower.includes("escalon") || nameLower.includes("costo_escal") || nameLower === "escalones") {
        const esc = await parseEscalonesSheet(workbook.Sheets[sheetName]);
        escalonesSaved += esc.saved;
        summary[sheetName] = { imported: esc.saved, warnings: esc.warnings };
        continue;
      }

      // Country sheets
      for (const { keywords, country } of sheetMap) {
        if (keywords.some(kw => nameLower.includes(kw))) {
          const res = parseKpiSheet(workbook.Sheets[sheetName], country, costs, detail);
          summary[sheetName] = res;
          break;
        }
      }
    }

    saveCosts(costs);
    saveDetail(detail);

    // Log import
    try {
      const totalImported = Object.values(summary).reduce((s, v) => s + v.imported, 0);
      const allWarnings   = Object.values(summary).flatMap(v => v.warnings);
      await prisma.import.create({
        data: {
          type:         "costs_excel",
          filename:     file.name,
          status:       "completed",
          totalRows:    totalImported + escalonesSaved,
          importedRows: totalImported,
          errors:       allWarnings.length ? JSON.stringify(allWarnings.slice(0, 20)) : null,
        },
      });
    } catch { /* non-critical */ }

    const totalCosts     = Object.values(summary).filter(v => !v.imported || v.imported > 0).reduce((s, v) => s + v.imported, 0) - escalonesSaved;
    const allWarnings    = Object.values(summary).flatMap(v => v.warnings);

    return NextResponse.json({
      ok: true,
      sheetsProcessed: sheetNames.length,
      costsImported:   Math.max(0, totalCosts),
      escalonesSaved,
      bySheet:         summary,
      warnings:        allWarnings,
    });

  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
