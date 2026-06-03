import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join }         from "path";
import ExcelJS          from "exceljs";
import type { AppEntry } from "@/app/api/apps/route";

const FILE = join(process.cwd(), "data", "app-costs.json");

const CAT_LABELS: Record<string, string> = {
  plataforma: "Plataforma",
  marketing:  "Marketing",
  envio:      "Envío",
  analitica:  "Analítica",
  atencion:   "Atención a Cliente",
  diseno:     "Diseño / Tema",
  finanzas:   "Finanzas",
  inventario: "Inventario",
  otro:       "Otro",
};

const STORE_LABELS: Record<string, string> = {
  all:             "Ambas Tiendas",
  brand_glowmmi:   "Glowmmi",
  brand_balancea:  "Balancea",
};

const C = {
  navy:     "FF12304A",
  teal:     "FF0E766E",
  green:    "FF059669",
  greenBg:  "FFD1FAE5",
  gray1:    "FFF9FAFB",
  gray2:    "FFF3F4F6",
  border:   "FFE5E7EB",
  text:     "FF111827",
  textMid:  "FF374151",
  textLight:"FF6B7280",
  white:    "FFFFFFFF",
  red:      "FFDC2626",
  glowmmi:  "FFBE185D",
  glowmmiBg:"FFFCE7F3",
  balancea: "FF065F46",
  balBg:    "FFD1FAE5",
  both:     "FF0E766E",
  bothBg:   "FFCCFBF1",
};

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function applyCell(
  cell: ExcelJS.Cell,
  opts: {
    value?: ExcelJS.CellValue;
    bold?: boolean;
    fontSize?: number;
    fontColor?: string;
    bgColor?: string;
    align?: ExcelJS.Alignment["horizontal"];
    numFmt?: string;
    wrapText?: boolean;
    borders?: Partial<ExcelJS.Borders>;
  }
) {
  if (opts.value !== undefined) cell.value = opts.value;
  cell.font      = { name: "Calibri", size: opts.fontSize ?? 10, bold: opts.bold ?? false, color: { argb: opts.fontColor ?? C.text } };
  if (opts.bgColor) cell.fill = fill(opts.bgColor);
  cell.alignment = { horizontal: opts.align ?? "left", vertical: "middle", wrapText: opts.wrapText ?? false };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.borders) cell.border = opts.borders;
}

const thin = (argb = C.border): ExcelJS.Border => ({ style: "thin", color: { argb } });
const allBorders = (argb = C.border): Partial<ExcelJS.Borders> => ({ top: thin(argb), bottom: thin(argb), left: thin(argb), right: thin(argb) });

export async function GET() {
  let apps: AppEntry[] = [];
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf-8"));
    apps = raw.apps ?? [];
  } catch { apps = []; }

  const withMonthly = apps.map((a) => ({
    ...a,
    monthlyUsd: a.billingCycle === "annual" ? a.costUsd / 12 : a.billingCycle === "monthly" ? a.costUsd : 0,
    annualUsd:  a.billingCycle === "annual" ? a.costUsd : a.billingCycle === "monthly" ? a.costUsd * 12 : a.costUsd,
  }));

  const active = withMonthly.filter((a) => a.active);
  const totalMonthly = active.reduce((s, a) => s + a.monthlyUsd, 0);
  const totalAnnual  = active.reduce((s, a) => s + a.annualUsd,  0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Onnexa Dashboard";
  wb.created = new Date();

  /* ── Sheet 1: Full list ── */
  const ws = wb.addWorksheet("Costos de Apps", { views: [{ state: "frozen", xSplit: 0, ySplit: 5 }] });

  ws.getColumn(1).width = 28;  // Name
  ws.getColumn(2).width = 18;  // Store
  ws.getColumn(3).width = 20;  // Category
  ws.getColumn(4).width = 15;  // Cost
  ws.getColumn(5).width = 16;  // Cycle
  ws.getColumn(6).width = 15;  // Monthly
  ws.getColumn(7).width = 15;  // Annual
  ws.getColumn(8).width = 12;  // Status
  ws.getColumn(9).width = 26;  // Notes

  /* Title */
  ws.mergeCells("A1:I1");
  applyCell(ws.getCell("A1"), {
    value: "📦 COSTOS DE APLICACIONES SHOPIFY — ONNEXA DASHBOARD",
    bold: true, fontSize: 13, fontColor: C.white, bgColor: C.navy, align: "center",
  });
  ws.getRow(1).height = 30;

  ws.mergeCells("A2:I2");
  applyCell(ws.getCell("A2"), {
    value: `Generado: ${new Date().toLocaleDateString("es-MX")}   ·   Total mensual activo: $${totalMonthly.toFixed(2)} USD   ·   Total anual: $${totalAnnual.toFixed(2)} USD`,
    fontSize: 9, fontColor: C.white, bgColor: C.teal, align: "center",
  });
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 8;

  /* Headers */
  const headers = ["Aplicación", "Tienda", "Categoría", "Costo USD", "Ciclo de Cobro", "Mensual USD", "Anual USD", "Estado", "Notas"];
  for (let i = 0; i < headers.length; i++) {
    applyCell(ws.getCell(4, i + 1), {
      value: headers[i],
      bold: true, fontSize: 9, fontColor: C.white, bgColor: C.navy,
      align: i >= 3 && i <= 6 ? "right" : "left",
      borders: allBorders(C.navy),
    });
  }
  ws.getRow(4).height = 20;

  /* Data rows */
  let r = 5;
  const usd = '"$"#,##0.00';
  for (const app of withMonthly.sort((a, b) => b.monthlyUsd - a.monthlyUsd)) {
    const isEven  = (r - 5) % 2 === 0;
    const rowBg   = isEven ? C.white : C.gray1;
    const storeBg = app.store === "brand_glowmmi" ? C.glowmmiBg : app.store === "brand_balancea" ? C.balBg : C.bothBg;
    const storeColor = app.store === "brand_glowmmi" ? C.glowmmi : app.store === "brand_balancea" ? C.balancea : C.both;

    applyCell(ws.getCell(r, 1), { value: app.name,                       bold: !app.active ? false : true,  fontSize: 9, fontColor: app.active ? C.text : C.textLight, bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 2), { value: STORE_LABELS[app.store] ?? app.store, fontSize: 9, fontColor: storeColor, bgColor: storeBg,  borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 3), { value: CAT_LABELS[app.category] ?? app.category, fontSize: 9, fontColor: C.textMid, bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 4), { value: app.costUsd,   fontSize: 9, align: "right", numFmt: usd,   bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 5), { value: app.billingCycle === "monthly" ? "Mensual" : app.billingCycle === "annual" ? "Anual" : "Pago único", fontSize: 9, fontColor: C.textMid, bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 6), { value: app.monthlyUsd > 0 ? app.monthlyUsd : null, fontSize: 9, fontColor: C.green, bold: true, align: "right", numFmt: usd, bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 7), { value: app.annualUsd,  fontSize: 9, align: "right", numFmt: usd,   bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 8), { value: app.active ? "✓ Activa" : "✗ Inactiva", fontSize: 9, fontColor: app.active ? C.green : C.red, bgColor: rowBg, borders: { bottom: thin(), right: thin() } });
    applyCell(ws.getCell(r, 9), { value: app.notes || "",  fontSize: 9, fontColor: C.textLight, bgColor: rowBg, borders: { bottom: thin() } });

    ws.getRow(r).height = 16;
    r++;
  }

  /* Totals row */
  if (withMonthly.length > 0) {
    applyCell(ws.getCell(r, 1), { value: `TOTAL ACTIVO (${active.length} apps)`, bold: true, fontSize: 10, fontColor: C.white, bgColor: C.navy, borders: allBorders(C.navy) });
    ws.mergeCells(r, 1, r, 5);
    applyCell(ws.getCell(r, 6), { value: totalMonthly, bold: true, fontSize: 11, fontColor: C.white, bgColor: C.teal, align: "right", numFmt: usd, borders: allBorders(C.teal) });
    applyCell(ws.getCell(r, 7), { value: totalAnnual,  bold: true, fontSize: 11, fontColor: C.white, bgColor: C.navy, align: "right", numFmt: usd, borders: allBorders(C.navy) });
    applyCell(ws.getCell(r, 8), { value: "", bgColor: C.gray2, borders: allBorders() });
    applyCell(ws.getCell(r, 9), { value: "", bgColor: C.gray2, borders: allBorders() });
    ws.getRow(r).height = 22;
    r += 2;
  }

  /* ── Sheet 2: Summary by category ── */
  const ws2 = wb.addWorksheet("Por Categoría");
  ws2.getColumn(1).width = 24;
  ws2.getColumn(2).width = 20;
  ws2.getColumn(3).width = 20;
  ws2.getColumn(4).width = 20;

  ws2.mergeCells("A1:D1");
  applyCell(ws2.getCell("A1"), { value: "Resumen por Categoría — Apps Activas", bold: true, fontSize: 12, fontColor: C.white, bgColor: C.navy, align: "center" });
  ws2.getRow(1).height = 28;

  const catHeaders = ["Categoría", "Apps Activas", "Total Mensual", "Total Anual"];
  for (let i = 0; i < catHeaders.length; i++) {
    applyCell(ws2.getCell(3, i + 1), { value: catHeaders[i], bold: true, fontSize: 9, fontColor: C.white, bgColor: C.teal, align: i > 0 ? "right" : "left", borders: allBorders(C.teal) });
  }
  ws2.getRow(3).height = 18;

  const categories = Object.keys(CAT_LABELS);
  let r2 = 4;
  let catTotal = 0;
  for (const cat of categories) {
    const catApps = active.filter((a) => a.category === cat);
    if (catApps.length === 0) continue;
    const monthly = catApps.reduce((s, a) => s + a.monthlyUsd, 0);
    const annual  = catApps.reduce((s, a) => s + a.annualUsd,  0);
    catTotal += monthly;
    const isEven = (r2 - 4) % 2 === 0;
    applyCell(ws2.getCell(r2, 1), { value: CAT_LABELS[cat], fontSize: 9, fontColor: C.textMid, bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin(), right: thin() } });
    applyCell(ws2.getCell(r2, 2), { value: catApps.length, fontSize: 9, align: "right", bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin(), right: thin() } });
    applyCell(ws2.getCell(r2, 3), { value: monthly, fontSize: 9, fontColor: C.green, bold: true, align: "right", numFmt: '"$"#,##0.00', bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin(), right: thin() } });
    applyCell(ws2.getCell(r2, 4), { value: annual,  fontSize: 9, align: "right", numFmt: '"$"#,##0.00', bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin() } });
    ws2.getRow(r2).height = 16;
    r2++;
  }
  applyCell(ws2.getCell(r2, 1), { value: "TOTAL", bold: true, fontSize: 10, fontColor: C.white, bgColor: C.navy, borders: allBorders(C.navy) });
  ws2.mergeCells(r2, 1, r2, 2);
  applyCell(ws2.getCell(r2, 3), { value: totalMonthly, bold: true, fontSize: 11, fontColor: C.white, bgColor: C.teal, align: "right", numFmt: '"$"#,##0.00', borders: allBorders(C.teal) });
  applyCell(ws2.getCell(r2, 4), { value: totalAnnual,  bold: true, fontSize: 11, fontColor: C.white, bgColor: C.navy, align: "right", numFmt: '"$"#,##0.00', borders: allBorders(C.navy) });
  ws2.getRow(r2).height = 20;

  /* ── Sheet 3: Summary by store ── */
  const ws3 = wb.addWorksheet("Por Tienda");
  ws3.getColumn(1).width = 22;
  ws3.getColumn(2).width = 18;
  ws3.getColumn(3).width = 18;
  ws3.getColumn(4).width = 18;

  ws3.mergeCells("A1:D1");
  applyCell(ws3.getCell("A1"), { value: "Resumen por Tienda — Apps Activas", bold: true, fontSize: 12, fontColor: C.white, bgColor: C.navy, align: "center" });
  ws3.getRow(1).height = 28;

  const storeHeaders = ["Tienda", "Apps", "Mensual USD", "Anual USD"];
  for (let i = 0; i < storeHeaders.length; i++) {
    applyCell(ws3.getCell(3, i + 1), { value: storeHeaders[i], bold: true, fontSize: 9, fontColor: C.white, bgColor: C.teal, align: i > 0 ? "right" : "left", borders: allBorders(C.teal) });
  }
  ws3.getRow(3).height = 18;

  const storeKeys = ["brand_glowmmi", "brand_balancea", "all"];
  let r3 = 4;
  for (const store of storeKeys) {
    const storeApps = active.filter((a) => a.store === store);
    if (storeApps.length === 0) continue;
    const monthly = storeApps.reduce((s, a) => s + a.monthlyUsd, 0);
    const annual  = storeApps.reduce((s, a) => s + a.annualUsd,  0);
    const isEven = (r3 - 4) % 2 === 0;
    const storeColor = store === "brand_glowmmi" ? C.glowmmi : store === "brand_balancea" ? C.balancea : C.both;
    applyCell(ws3.getCell(r3, 1), { value: STORE_LABELS[store], fontSize: 9, fontColor: storeColor, bold: true, bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin(), right: thin() } });
    applyCell(ws3.getCell(r3, 2), { value: storeApps.length, fontSize: 9, align: "right", bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin(), right: thin() } });
    applyCell(ws3.getCell(r3, 3), { value: monthly, fontSize: 9, fontColor: C.green, bold: true, align: "right", numFmt: '"$"#,##0.00', bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin(), right: thin() } });
    applyCell(ws3.getCell(r3, 4), { value: annual,  fontSize: 9, align: "right", numFmt: '"$"#,##0.00', bgColor: isEven ? C.white : C.gray1, borders: { bottom: thin() } });
    ws3.getRow(r3).height = 16;
    r3++;
  }
  applyCell(ws3.getCell(r3, 1), { value: "TOTAL", bold: true, fontSize: 10, fontColor: C.white, bgColor: C.navy, borders: allBorders(C.navy) });
  ws3.mergeCells(r3, 1, r3, 2);
  applyCell(ws3.getCell(r3, 3), { value: totalMonthly, bold: true, fontSize: 11, fontColor: C.white, bgColor: C.teal, align: "right", numFmt: '"$"#,##0.00', borders: allBorders(C.teal) });
  applyCell(ws3.getCell(r3, 4), { value: totalAnnual,  bold: true, fontSize: 11, fontColor: C.white, bgColor: C.navy, align: "right", numFmt: '"$"#,##0.00', borders: allBorders(C.navy) });
  ws3.getRow(r3).height = 20;

  const buffer   = await wb.xlsx.writeBuffer();
  const fileName = `costos-apps-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-cache",
    },
  });
}
