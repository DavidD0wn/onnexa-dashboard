import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import ExcelJS from "exceljs";

/* ── ARGB colors ─────────────────────────────────────────────── */
const C = {
  navy:      "FF12304A",
  teal:      "FF0E766E",
  tealMid:   "FF47A89F",
  green:     "FF059669",
  greenBg:   "FFD1FAE5",
  red:       "FFDC2626",
  redBg:     "FFFEE2E2",
  amber:     "FFF59E0B",
  amberBg:   "FFFEF3C7",
  gray1:     "FFF9FAFB",
  gray2:     "FFF3F4F6",
  border:    "FFE5E7EB",
  borderDark:"FFD1D5DB",
  text:      "FF111827",
  textMid:   "FF374151",
  textLight: "FF6B7280",
  white:     "FFFFFFFF",
  glowmmi:   "FFBE185D",
  glowmmiBg: "FFFCE7F3",
  balancea:  "FF065F46",
  balanceaBg:"FFD1FAE5",
  subtotal:  "FFE8F5E9",
  result:    "FFDBEAFE",
  highlight: "FFFFFFFF",
};

/* ── Date helpers ────────────────────────────────────────────── */
function utcDate(y: number, m: number, d: number, h = 0, min = 0, s = 0) {
  return new Date(Date.UTC(y, m, d, h, min, s));
}

function fmtLabel(from: Date, to: Date, gran: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const f = from.toLocaleDateString("es-MX", opts);
  const t = to.toLocaleDateString("es-MX", opts);
  if (gran === "monthly") {
    return from.toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${f} — ${t}`;
}

/* ── Aggregate ───────────────────────────────────────────────── */
function aggregate(metrics: any[], pFrom: Date, pTo: Date, chargebacks: any[]) {
  const ms = metrics.filter((m) => m.date >= pFrom && m.date <= pTo);
  const t = ms.reduce(
    (a, m) => ({
      revenue:    a.revenue    + m.grossRevenue,
      discounts:  a.discounts  + (m.discounts  ?? 0),
      returns:    a.returns    + (m.returns    ?? 0),
      cogs:       a.cogs       + m.cogs,
      shipping:   a.shipping   + m.shippingCost,
      fees:       a.fees       + m.fees,
      handling:   a.handling   + (m.handlingFees ?? 0),
      adSpend:    a.adSpend    + m.adSpend,
      adFacebook: a.adFacebook + (m.adSpendFacebook > 0 ? m.adSpendFacebook : m.adSpend ?? 0),
      adGoogle:   a.adGoogle   + (m.adSpendGoogle   > 0 ? m.adSpendGoogle   : 0),
      adSnapchat: a.adSnapchat + (m.adSpendSnapchat > 0 ? m.adSpendSnapchat : 0),
      adTiktok:   a.adTiktok   + (m.adSpendTiktok   > 0 ? m.adSpendTiktok   : 0),
      taxes:      a.taxes      + m.taxes,
      other:      a.other      + m.otherCosts,
      marketing:  a.marketing  + (m.costMarketing ?? 0),
      office:     a.office     + (m.costOffice    ?? 0),
      netProfit:  a.netProfit  + m.netProfit,
      orders:     a.orders     + m.ordersCount,
      units:      a.units      + m.unitsSold,
    }),
    {
      revenue: 0, discounts: 0, returns: 0,
      cogs: 0, shipping: 0, fees: 0, handling: 0,
      adSpend: 0, adFacebook: 0, adGoogle: 0, adSnapchat: 0, adTiktok: 0,
      taxes: 0, other: 0, marketing: 0, office: 0,
      netProfit: 0, orders: 0, units: 0,
    }
  );

  const cb = chargebacks
    .filter((r) => r.date >= pFrom && r.date <= pTo && r.status !== "won")
    .reduce((s: number, r: any) => s + r.amount, 0);

  const netRevenue  = t.revenue - t.discounts - t.returns;
  const grossProfit = netRevenue - t.cogs - t.shipping - t.fees - t.handling;
  const customCosts = t.taxes + t.other + t.marketing + t.office;
  const totalCosts  = t.cogs + t.shipping + t.fees + t.handling + t.adSpend + customCosts + cb;
  const netProfit   = t.netProfit - cb;
  const grossMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const netMargin   = netRevenue > 0 ? (netProfit   / netRevenue) * 100 : 0;
  const aov         = t.orders  > 0 ? netRevenue  / t.orders  : 0;
  const roas        = t.adSpend > 0 ? netRevenue  / t.adSpend : 0;
  const poas        = t.adSpend > 0 ? grossProfit / t.adSpend : 0;

  return { ...t, netRevenue, grossProfit, grossMargin, customCosts, totalCosts, chargebacks: cb, netProfit, netMargin, aov, roas, poas };
}

/* ── Build periods ───────────────────────────────────────────── */
function buildPeriods(from: Date, to: Date, gran: "weekly" | "monthly") {
  const periods: { from: Date; to: Date; label: string }[] = [];
  if (gran === "weekly") {
    let pEnd = new Date(to);
    while (pEnd >= from) {
      const pStart = new Date(pEnd);
      pStart.setUTCDate(pEnd.getUTCDate() - 6);
      if (pStart < from) pStart.setTime(from.getTime());
      periods.unshift({ from: new Date(pStart), to: new Date(pEnd), label: fmtLabel(pStart, pEnd, gran) });
      pEnd = new Date(pStart);
      pEnd.setUTCDate(pStart.getUTCDate() - 1);
    }
  } else {
    let cur = utcDate(from.getUTCFullYear(), from.getUTCMonth(), 1);
    while (cur <= to) {
      const monthEnd = utcDate(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0, 23, 59, 59);
      const pEnd2    = monthEnd > to ? to : monthEnd;
      periods.push({ from: new Date(cur), to: pEnd2, label: fmtLabel(cur, pEnd2, gran) });
      cur = utcDate(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1);
    }
  }
  return periods;
}

/* ── Excel style helpers ─────────────────────────────────────── */
type AColor = string; // ARGB string

function fill(argb: AColor): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function border(
  sides: ("top" | "bottom" | "left" | "right" | "all")[],
  style: ExcelJS.BorderStyle = "thin",
  argb = C.border
): Partial<ExcelJS.Borders> {
  const b: Partial<ExcelJS.Borders> = {};
  const edge = { style, color: { argb } };
  const resolved = sides.includes("all")
    ? (["top", "bottom", "left", "right"] as const)
    : (sides as ("top" | "bottom" | "left" | "right")[]);
  resolved.forEach((s) => { b[s] = edge; });
  return b;
}

function applyCell(
  cell: ExcelJS.Cell,
  opts: {
    value?: ExcelJS.CellValue;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    fontColor?: AColor;
    bgColor?: AColor;
    align?: ExcelJS.Alignment["horizontal"];
    vAlign?: ExcelJS.Alignment["vertical"];
    numFmt?: string;
    wrapText?: boolean;
    indent?: number;
    borders?: Partial<ExcelJS.Borders>;
    fontName?: string;
  }
) {
  if (opts.value !== undefined) cell.value = opts.value;
  cell.font = {
    name:   opts.fontName  ?? "Calibri",
    size:   opts.fontSize  ?? 10,
    bold:   opts.bold      ?? false,
    italic: opts.italic    ?? false,
    color:  { argb: opts.fontColor ?? C.text },
  };
  if (opts.bgColor) cell.fill = fill(opts.bgColor);
  cell.alignment = {
    horizontal: opts.align  ?? "left",
    vertical:   opts.vAlign ?? "middle",
    wrapText:   opts.wrapText ?? false,
    indent:     opts.indent ?? 0,
  };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.borders) cell.border = opts.borders;
}

/* ── Row definitions for P&L ─────────────────────────────────── */
type RowKind = "section" | "data" | "subtotal" | "result" | "child";

interface RowSpec {
  label: string;
  kind:  RowKind;
  get:   (d: ReturnType<typeof aggregate>) => number;
  isPercent?: boolean;
  isCost?:    boolean;  // shown as negative / cost
  children?:  { label: string; get: (d: ReturnType<typeof aggregate>) => number }[];
}

const PNL_ROWS: RowSpec[] = [
  { label: "Ventas Brutas",       kind: "data",     get: d => d.revenue,     isCost: false },
  { label: "Descuentos",          kind: "data",     get: d => d.discounts,   isCost: true },
  { label: "Devoluciones",        kind: "data",     get: d => d.returns,     isCost: true },
  { label: "Revenue Neto",        kind: "subtotal", get: d => d.netRevenue },
  { label: "COGS",                kind: "data",     get: d => d.cogs,        isCost: true },
  { label: "Costo de Envío",      kind: "data",     get: d => d.shipping,    isCost: true },
  { label: "Fees de Pasarela",    kind: "data",     get: d => d.fees,        isCost: true },
  { label: "Handling Fees",       kind: "data",     get: d => d.handling,    isCost: true },
  {
    label: "Total Ad Spend",      kind: "data",     get: d => d.adSpend,     isCost: true,
    children: [
      { label: "  Facebook Ads",  get: d => d.adFacebook },
      { label: "  Google Ads",    get: d => d.adGoogle },
      { label: "  Snapchat Ads",  get: d => d.adSnapchat },
      { label: "  TikTok Ads",    get: d => d.adTiktok },
    ],
  },
  {
    label: "Costos Adicionales",  kind: "data",     get: d => d.customCosts, isCost: true,
    children: [
      { label: "  Impuestos Pagados", get: d => d.taxes },
      { label: "  Marketing",         get: d => d.marketing },
      { label: "  Gastos de Oficina", get: d => d.office },
      { label: "  Sin Categoría",     get: d => d.other },
    ],
  },
  { label: "Chargebacks",         kind: "data",     get: d => d.chargebacks, isCost: true },
  { label: "Total de Costos",     kind: "subtotal", get: d => d.totalCosts,  isCost: true },
  { label: "Utilidad Bruta",      kind: "result",   get: d => d.grossProfit },
  { label: "Utilidad Neta",       kind: "result",   get: d => d.netProfit },
  { label: "Margen Neto",         kind: "result",   get: d => d.netMargin,   isPercent: true },
];

/* ── Build a P&L sheet ───────────────────────────────────────── */
function buildPnLSheet(
  wb: ExcelJS.Workbook,
  name: string,
  periods: { label: string; data: ReturnType<typeof aggregate> }[],
  totalData: ReturnType<typeof aggregate>,
  meta: { title: string; brand: string; from: string; to: string }
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 5 }] });

  const numCols = periods.length + 2; // label + periods + total
  const colLetters = (i: number) => String.fromCharCode(65 + i); // A, B, C...

  /* Column widths */
  ws.getColumn(1).width = 26;
  for (let i = 2; i <= numCols; i++) ws.getColumn(i).width = 18;

  /* ── Row 1: Title ── */
  ws.mergeCells(1, 1, 1, numCols);
  const titleCell = ws.getCell("A1");
  applyCell(titleCell, {
    value: `📊 Reporte P&L — ${meta.title}`,
    bold: true, fontSize: 14, fontColor: C.white, bgColor: C.navy,
    align: "center", borders: border(["bottom"], "medium", C.teal),
  });
  ws.getRow(1).height = 30;

  /* ── Row 2: Metadata ── */
  ws.mergeCells(2, 1, 2, numCols);
  applyCell(ws.getCell("A2"), {
    value: `Tienda: ${meta.brand}   ·   Período: ${meta.from} al ${meta.to}   ·   Generado: ${new Date().toLocaleDateString("es-MX")}`,
    fontSize: 9, fontColor: C.white, bgColor: C.teal, align: "center",
  });
  ws.getRow(2).height = 18;

  /* ── Row 3: Blank ── */
  ws.getRow(3).height = 6;
  for (let c = 1; c <= numCols; c++) ws.getCell(3, c).fill = fill(C.gray1);

  /* ── Row 4: ROAS/POAS summary ── */
  const summaryData = [totalData, ...periods.map(p => p.data)];
  const summaryLabels = ["Total", ...periods.map(p => p.label)];
  let metaCol = 1;
  for (const [idx, sd] of summaryData.entries()) {
    const col = idx === 0 ? numCols : idx;
    const cell = ws.getCell(4, col);
    const label = summaryLabels[idx];
    applyCell(cell, {
      value: label,
      bold: true, fontSize: 9, fontColor: idx === 0 ? C.white : C.navy,
      bgColor: idx === 0 ? C.navy : C.gray2, align: "center",
      borders: { ...border(["all"], "thin", C.border) },
    });
  }
  ws.getCell(4, 1).value = "Concepto";
  applyCell(ws.getCell(4, 1), {
    bold: true, fontSize: 9, fontColor: C.white, bgColor: C.navy,
    borders: border(["all"], "thin", C.borderDark),
  });
  ws.getRow(4).height = 24;

  /* ── Set column headers for periods ── */
  for (let i = 0; i < periods.length; i++) {
    const cell = ws.getCell(4, i + 2);
    applyCell(cell, {
      value: periods[i].label,
      bold: true, fontSize: 9, fontColor: C.textMid, bgColor: C.gray2,
      align: "center", borders: border(["all"], "thin", C.border),
    });
  }
  /* Total header */
  applyCell(ws.getCell(4, numCols), {
    value: "Total", bold: true, fontSize: 9, fontColor: C.white, bgColor: C.navy,
    align: "center", borders: border(["all"], "thin", C.borderDark),
  });

  /* ── Data rows ── */
  let rowIdx = 5;
  const allData = [...periods.map(p => p.data), totalData];

  const usdFmt     = '"$"#,##0.00';
  const usdNegFmt  = '"($"#,##0.00")"';
  const pctFmt     = '0.00"%"';

  for (const row of PNL_ROWS) {
    /* Main row */
    const isSubtotal = row.kind === "subtotal";
    const isResult   = row.kind === "result";
    const isHighlight = isSubtotal || isResult;

    const bgColor = isResult
      ? C.result
      : isSubtotal
        ? C.subtotal
        : C.white;

    /* Label cell */
    const labelCell = ws.getCell(rowIdx, 1);
    applyCell(labelCell, {
      value: row.label,
      bold: isHighlight, fontSize: isHighlight ? 10 : 9,
      fontColor: isHighlight ? C.text : C.textMid,
      bgColor, align: "left",
      borders: {
        bottom: { style: isHighlight ? "medium" : "thin", color: { argb: isHighlight ? C.borderDark : C.border } },
        right:  { style: "medium", color: { argb: C.borderDark } },
      },
    });

    /* Value cells */
    for (let i = 0; i < allData.length; i++) {
      const d = allData[i];
      const val = row.get(d);
      const isTotal = i === allData.length - 1;
      const cellBg = isTotal ? (isResult ? "FFD8E4FF" : isSubtotal ? "FFE6F4EA" : C.gray1) : bgColor;

      const cell = ws.getCell(rowIdx, i + 2);
      let cellVal: ExcelJS.CellValue = val;
      let numFmt = row.isPercent ? pctFmt : (row.isCost ? usdNegFmt : usdFmt);
      let fontColor = C.textMid;

      if (row.isPercent) {
        cellVal = val / 100;
        numFmt = "0.00%";
      } else if (isResult || isSubtotal) {
        fontColor = val >= 0 ? C.green : C.red;
      }

      applyCell(cell, {
        value: cellVal,
        bold: isHighlight || isTotal,
        fontSize: isHighlight ? 10 : 9,
        fontColor: isTotal && !row.isPercent ? (isResult ? (val >= 0 ? C.green : C.red) : C.navy) : fontColor,
        bgColor: cellBg,
        align: "right",
        numFmt,
        borders: {
          bottom: { style: isHighlight ? "medium" : "thin", color: { argb: isHighlight ? C.borderDark : C.border } },
          left:   isTotal ? { style: "medium", color: { argb: C.navy } } : { style: "thin", color: { argb: C.border } },
        },
      });
    }

    ws.getRow(rowIdx).height = isHighlight ? 20 : 16;
    rowIdx++;

    /* Child rows */
    if (row.children) {
      for (const child of row.children) {
        applyCell(ws.getCell(rowIdx, 1), {
          value: child.label,
          fontSize: 8, fontColor: C.textLight, bgColor: C.gray1,
          borders: { bottom: { style: "thin", color: { argb: C.border } }, right: { style: "medium", color: { argb: C.borderDark } } },
        });
        for (let i = 0; i < allData.length; i++) {
          const val = child.get(allData[i]);
          const isTotal = i === allData.length - 1;
          applyCell(ws.getCell(rowIdx, i + 2), {
            value: val,
            fontSize: 8, fontColor: val === 0 ? C.border : C.textLight,
            bgColor: isTotal ? C.gray1 : C.white,
            align: "right", numFmt: usdNegFmt,
            borders: {
              bottom: { style: "thin", color: { argb: C.border } },
              left: isTotal ? { style: "medium", color: { argb: C.navy } } : { style: "thin", color: { argb: C.border } },
            },
          });
        }
        ws.getRow(rowIdx).height = 14;
        rowIdx++;
      }
    }
  }

  /* ── Bottom: Key ratios ── */
  rowIdx++;
  ws.mergeCells(rowIdx, 1, rowIdx, numCols);
  applyCell(ws.getCell(rowIdx, 1), {
    value: "MÉTRICAS ADICIONALES", bold: true, fontSize: 9,
    fontColor: C.white, bgColor: C.teal, align: "center",
    borders: border(["all"], "thin", C.tealMid),
  });
  ws.getRow(rowIdx).height = 18;
  rowIdx++;

  const ratioRows = [
    { label: "Pedidos",        get: (d: ReturnType<typeof aggregate>) => d.orders,   fmt: "#,##0" },
    { label: "Unidades",       get: (d: ReturnType<typeof aggregate>) => d.units,    fmt: "#,##0" },
    { label: "AOV",            get: (d: ReturnType<typeof aggregate>) => d.aov,      fmt: '"$"#,##0.00' },
    { label: "ROAS",           get: (d: ReturnType<typeof aggregate>) => d.roas,     fmt: "0.00" },
    { label: "POAS (Ut.Bruta/AdSpend)", get: (d: ReturnType<typeof aggregate>) => d.poas, fmt: "0.00" },
    { label: "Margen Bruto %", get: (d: ReturnType<typeof aggregate>) => d.grossMargin / 100, fmt: "0.00%" },
  ];

  for (const rr of ratioRows) {
    applyCell(ws.getCell(rowIdx, 1), {
      value: rr.label, fontSize: 9, fontColor: C.textMid,
      bgColor: C.gray1, bold: false,
      borders: { bottom: { style: "thin", color: { argb: C.border } }, right: { style: "medium", color: { argb: C.borderDark } } },
    });
    for (let i = 0; i < allData.length; i++) {
      const isTotal = i === allData.length - 1;
      applyCell(ws.getCell(rowIdx, i + 2), {
        value: rr.get(allData[i]),
        fontSize: 9, fontColor: isTotal ? C.navy : C.textMid,
        bgColor: isTotal ? C.gray1 : C.white,
        bold: isTotal, align: "right", numFmt: rr.fmt,
        borders: {
          bottom: { style: "thin", color: { argb: C.border } },
          left: isTotal ? { style: "medium", color: { argb: C.navy } } : { style: "thin", color: { argb: C.border } },
        },
      });
    }
    ws.getRow(rowIdx).height = 16;
    rowIdx++;
  }

  return ws;
}

/* ── Resumen Ejecutivo sheet ─────────────────────────────────── */
function buildSummarySheet(
  wb: ExcelJS.Workbook,
  all: ReturnType<typeof aggregate>,
  glw: ReturnType<typeof aggregate>,
  bal: ReturnType<typeof aggregate>,
  meta: { from: string; to: string }
) {
  const ws = wb.addWorksheet("Resumen Ejecutivo", { views: [{ state: "normal" }] });

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 20;
  ws.getColumn(5).width = 20;

  /* Title */
  ws.mergeCells("A1:E1");
  applyCell(ws.getCell("A1"), {
    value: "RESUMEN EJECUTIVO — ONNEXA DASHBOARD",
    bold: true, fontSize: 16, fontColor: C.white, bgColor: C.navy,
    align: "center",
  });
  ws.getRow(1).height = 36;

  ws.mergeCells("A2:E2");
  applyCell(ws.getCell("A2"), {
    value: `Período: ${meta.from} al ${meta.to}   ·   Generado: ${new Date().toLocaleDateString("es-MX")}`,
    fontSize: 9, fontColor: C.white, bgColor: C.teal, align: "center",
  });
  ws.getRow(2).height = 18;

  /* Blank */
  ws.getRow(3).height = 10;

  /* Headers */
  const headers = ["Métrica", "Total (Ambas)", "Glowmmi", "Balancea", "Notas"];
  for (let i = 0; i < headers.length; i++) {
    const cell = ws.getCell(4, i + 1);
    const isFirst = i === 0;
    applyCell(cell, {
      value: headers[i],
      bold: true, fontSize: 10,
      fontColor: i === 1 ? C.white : i === 2 ? C.glowmmi : i === 3 ? C.balancea : C.white,
      bgColor: i === 1 ? C.navy : i === 2 ? C.glowmmiBg : i === 3 ? C.balanceaBg : C.navy,
      align: "center",
      borders: border(["all"], "medium", C.borderDark),
    });
  }
  ws.getRow(4).height = 24;

  const usd = '"$"#,##0.00';
  const pct = "0.00%";
  const num = "#,##0";

  const kpis: { label: string; all: number; glw: number; bal: number; fmt: string; isGood?: "high" | "low" }[] = [
    { label: "Revenue Neto",    all: all.netRevenue,  glw: glw.netRevenue,  bal: bal.netRevenue,  fmt: usd, isGood: "high" },
    { label: "Ventas Brutas",   all: all.revenue,     glw: glw.revenue,     bal: bal.revenue,     fmt: usd },
    { label: "Descuentos",      all: all.discounts,   glw: glw.discounts,   bal: bal.discounts,   fmt: usd, isGood: "low" },
    { label: "Devoluciones",    all: all.returns,     glw: glw.returns,     bal: bal.returns,     fmt: usd, isGood: "low" },
    { label: "─── COSTOS ───",  all: 0, glw: 0, bal: 0, fmt: "", },
    { label: "COGS",            all: all.cogs,        glw: glw.cogs,        bal: bal.cogs,        fmt: usd, isGood: "low" },
    { label: "Envío",           all: all.shipping,    glw: glw.shipping,    bal: bal.shipping,    fmt: usd, isGood: "low" },
    { label: "Fees Pasarela",   all: all.fees,        glw: glw.fees,        bal: bal.fees,        fmt: usd, isGood: "low" },
    { label: "Handling Fees",   all: all.handling,    glw: glw.handling,    bal: bal.handling,    fmt: usd, isGood: "low" },
    { label: "Ad Spend Total",  all: all.adSpend,     glw: glw.adSpend,     bal: bal.adSpend,     fmt: usd },
    { label: "  Facebook Ads",  all: all.adFacebook,  glw: glw.adFacebook,  bal: bal.adFacebook,  fmt: usd },
    { label: "  Google Ads",    all: all.adGoogle,    glw: glw.adGoogle,    bal: bal.adGoogle,    fmt: usd },
    { label: "Costos Adicionales", all: all.customCosts, glw: glw.customCosts, bal: bal.customCosts, fmt: usd, isGood: "low" },
    { label: "  Impuestos",     all: all.taxes,       glw: glw.taxes,       bal: bal.taxes,       fmt: usd },
    { label: "  Marketing",     all: all.marketing,   glw: glw.marketing,   bal: bal.marketing,   fmt: usd },
    { label: "  Oficina",       all: all.office,      glw: glw.office,      bal: bal.office,      fmt: usd },
    { label: "Chargebacks",     all: all.chargebacks, glw: glw.chargebacks, bal: bal.chargebacks, fmt: usd, isGood: "low" },
    { label: "Total de Costos", all: all.totalCosts,  glw: glw.totalCosts,  bal: bal.totalCosts,  fmt: usd, isGood: "low" },
    { label: "─── RESULTADOS ───", all: 0, glw: 0, bal: 0, fmt: "" },
    { label: "Utilidad Bruta",  all: all.grossProfit, glw: glw.grossProfit, bal: bal.grossProfit, fmt: usd, isGood: "high" },
    { label: "Utilidad Neta",   all: all.netProfit,   glw: glw.netProfit,   bal: bal.netProfit,   fmt: usd, isGood: "high" },
    { label: "Margen Neto",     all: all.netMargin / 100, glw: glw.netMargin / 100, bal: bal.netMargin / 100, fmt: pct, isGood: "high" },
    { label: "Margen Bruto %",  all: all.grossMargin / 100, glw: glw.grossMargin / 100, bal: bal.grossMargin / 100, fmt: pct, isGood: "high" },
    { label: "─── KPIs ───",    all: 0, glw: 0, bal: 0, fmt: "" },
    { label: "Pedidos",         all: all.orders,      glw: glw.orders,      bal: bal.orders,      fmt: num },
    { label: "Unidades",        all: all.units,       glw: glw.units,       bal: bal.units,       fmt: num },
    { label: "AOV",             all: all.aov,         glw: glw.aov,         bal: bal.aov,         fmt: usd, isGood: "high" },
    { label: "ROAS",            all: all.roas,        glw: glw.roas,        bal: bal.roas,        fmt: "0.00", isGood: "high" },
    { label: "POAS",            all: all.poas,        glw: glw.poas,        bal: bal.poas,        fmt: "0.00", isGood: "high" },
  ];

  let r = 5;
  for (const kpi of kpis) {
    const isSep = kpi.label.startsWith("───");

    if (isSep) {
      ws.mergeCells(r, 1, r, 5);
      applyCell(ws.getCell(r, 1), {
        value: kpi.label.replace(/─/g, "").trim(),
        bold: true, fontSize: 9, fontColor: C.white, bgColor: C.teal,
        align: "center",
      });
      ws.getRow(r).height = 16;
      r++; continue;
    }

    applyCell(ws.getCell(r, 1), {
      value: kpi.label, fontSize: 9, fontColor: C.textMid,
      bgColor: r % 2 === 0 ? C.gray1 : C.white,
      borders: { bottom: { style: "thin", color: { argb: C.border } }, right: { style: "thin", color: { argb: C.border } } },
    });

    const vals = [kpi.all, kpi.glw, kpi.bal];
    for (let i = 0; i < 3; i++) {
      const cell = ws.getCell(r, i + 2);
      const val = vals[i];
      let fc = C.textMid;
      if (kpi.isGood === "high" && kpi.fmt !== num) fc = val >= 0 ? C.green : C.red;
      if (kpi.isGood === "low"  && val > 0) fc = C.red;
      applyCell(cell, {
        value: kpi.fmt ? val : "",
        fontSize: 9, fontColor: i === 0 ? C.navy : fc,
        bold: i === 0,
        bgColor: i === 0 ? (r % 2 === 0 ? C.gray1 : C.white) : (r % 2 === 0 ? C.gray1 : C.white),
        align: "right", numFmt: kpi.fmt || undefined,
        borders: { bottom: { style: "thin", color: { argb: C.border } }, left: { style: "thin", color: { argb: C.border } } },
      });
    }
    /* Notes cell */
    ws.getCell(r, 5).value = "";
    ws.getRow(r).height = 15;
    r++;
  }

  return ws;
}

/* ── Formulas reference sheet ────────────────────────────────── */
function buildFormulasSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Fórmulas y Metodología");
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 60;

  ws.mergeCells("A1:B1");
  applyCell(ws.getCell("A1"), {
    value: "FÓRMULAS Y METODOLOGÍA — ONNEXA DASHBOARD",
    bold: true, fontSize: 13, fontColor: C.white, bgColor: C.navy, align: "center",
  });
  ws.getRow(1).height = 30;

  const formulas = [
    ["FÓRMULAS PRINCIPALES", ""],
    ["Revenue Neto", "= Ventas Brutas − Descuentos − Devoluciones"],
    ["Utilidad Bruta", "= Revenue Neto − COGS − Costo de Envío − Fees de Pasarela − Handling Fees"],
    ["Utilidad Neta", "= Revenue Neto − Total de Costos"],
    ["Total de Costos", "= COGS + Envío + Fees + Handling + Ad Spend + Costos Adicionales + Chargebacks"],
    ["Margen Neto", "= (Utilidad Neta / Revenue Neto) × 100"],
    ["Margen Bruto", "= (Utilidad Bruta / Revenue Neto) × 100"],
    ["", ""],
    ["KPIs", ""],
    ["AOV (Ticket Promedio)", "= Revenue Neto / Total de Pedidos"],
    ["ROAS", "= Revenue Neto / Ad Spend Total"],
    ["POAS", "= Utilidad Bruta / Ad Spend Total  (mejor indicador que ROAS para rentabilidad)"],
    ["", ""],
    ["COSTOS ADICIONALES", ""],
    ["Impuestos Pagados", "Impuestos pagados al SAT / gobierno (≠ impuestos cobrados al cliente)"],
    ["Marketing", "Costos de agencias, diseño, software de marketing"],
    ["Gastos de Oficina", "Renta, servicios, equipos de oficina"],
    ["Sin Categoría", "Costos no clasificados en otras categorías"],
    ["Chargebacks", "Contracargos de tarjeta (status ≠ 'won' = pérdida real)"],
    ["", ""],
    ["TIENDAS", ""],
    ["Glowmmi", "glm-1694.myshopify.com · Skincare · Moneda: USD"],
    ["Balancea", "mp0vab-bw.myshopify.com · Salud · Moneda: MXN (÷ 17.2 para USD)"],
    ["", ""],
    ["NOTAS", ""],
    ["Exchange Rate Balancea", "MXN → USD: ÷ 17.2 (tasa configurada en el dashboard)"],
    ["Datos Ad Spend", "Registrados manualmente en el dashboard por día y marca"],
    ["Datos de Ventas", "Sincronizados desde Shopify vía API oficial"],
    ["Período de datos", "Disponible desde 2020 según datos en base de datos"],
  ];

  let r = 2;
  for (const [label, value] of formulas) {
    const isSectionHeader = value === "" && label !== "";
    if (isSectionHeader) {
      ws.mergeCells(r, 1, r, 2);
      applyCell(ws.getCell(r, 1), {
        value: label, bold: true, fontSize: 10,
        fontColor: C.white, bgColor: C.teal, align: "left", indent: 1,
      });
      ws.getRow(r).height = 20;
    } else if (label === "" && value === "") {
      ws.getRow(r).height = 8;
    } else {
      applyCell(ws.getCell(r, 1), {
        value: label, bold: true, fontSize: 9, fontColor: C.textMid,
        bgColor: r % 2 === 0 ? C.gray1 : C.white,
        borders: { bottom: { style: "thin", color: { argb: C.border } } },
      });
      applyCell(ws.getCell(r, 2), {
        value, fontSize: 9, fontColor: C.text,
        bgColor: r % 2 === 0 ? C.gray1 : C.white,
        borders: { bottom: { style: "thin", color: { argb: C.border } } },
        wrapText: true,
      });
      ws.getRow(r).height = 16;
    }
    r++;
  }

  return ws;
}

/* ── GET /api/export/pnl ─────────────────────────────────────── */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromParam   = searchParams.get("from");
  const toParam     = searchParams.get("to");
  const brandParam  = searchParams.get("brand") ?? "all";

  const today = new Date();
  const to: Date = toParam
    ? new Date(toParam + "T23:59:59.000Z")
    : utcDate(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59);
  const from: Date = fromParam
    ? new Date(fromParam + "T00:00:00.000Z")
    : utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1);

  /* ── Fetch data for ALL brands + per-brand ── */
  const brandFilter = brandParam !== "all" ? { brandId: brandParam } : {};

  const [metricsAll, metricsGlw, metricsBal, chargebacks] = await Promise.all([
    prisma.dailyMetric.findMany({ where: { date: { gte: from, lte: to }, ...brandFilter }, orderBy: { date: "asc" } }),
    brandParam === "all" || brandParam === "brand_glowmmi"
      ? prisma.dailyMetric.findMany({ where: { date: { gte: from, lte: to }, brandId: "brand_glowmmi" }, orderBy: { date: "asc" } })
      : Promise.resolve([]),
    brandParam === "all" || brandParam === "brand_balancea"
      ? prisma.dailyMetric.findMany({ where: { date: { gte: from, lte: to }, brandId: "brand_balancea" }, orderBy: { date: "asc" } })
      : Promise.resolve([]),
    (() => {
      try {
        const cb = (prisma as any).chargeback;
        if (!cb) return Promise.resolve([]);
        return cb.findMany({ where: { date: { gte: from, lte: to } } }).catch(() => []);
      } catch { return Promise.resolve([]); }
    })(),
  ]);

  /* ── Build periods ── */
  const weeklyPeriods  = buildPeriods(from, to, "weekly");
  const monthlyPeriods = buildPeriods(from, to, "monthly");

  /* ── Aggregate totals ── */
  const totalAll = aggregate(metricsAll, from, to, chargebacks as any[]);
  const totalGlw = aggregate(metricsGlw, from, to, chargebacks as any[]);
  const totalBal = aggregate(metricsBal, from, to, chargebacks as any[]);

  const weeklyAll  = weeklyPeriods.map(p  => ({ label: p.label,  data: aggregate(metricsAll, p.from, p.to, chargebacks as any[]) }));
  const monthlyAll = monthlyPeriods.map(p => ({ label: p.label, data: aggregate(metricsAll, p.from, p.to, chargebacks as any[]) }));
  const weeklyGlw  = weeklyPeriods.map(p  => ({ label: p.label,  data: aggregate(metricsGlw, p.from, p.to, chargebacks as any[]) }));
  const monthlyGlw = monthlyPeriods.map(p => ({ label: p.label, data: aggregate(metricsGlw, p.from, p.to, chargebacks as any[]) }));
  const weeklyBal  = weeklyPeriods.map(p  => ({ label: p.label,  data: aggregate(metricsBal, p.from, p.to, chargebacks as any[]) }));
  const monthlyBal = monthlyPeriods.map(p => ({ label: p.label, data: aggregate(metricsBal, p.from, p.to, chargebacks as any[]) }));

  const fromStr = from.toISOString().slice(0, 10);
  const toStr   = to.toISOString().slice(0, 10);

  /* ── Build workbook ── */
  const wb = new ExcelJS.Workbook();
  wb.creator  = "Onnexa Dashboard";
  wb.company  = "Onnexa";
  wb.created  = new Date();
  wb.modified = new Date();

  /* Sheet order: Resumen → Semanal All → Mensual All → Glowmmi → Balancea → Fórmulas */
  buildSummarySheet(wb, totalAll, totalGlw, totalBal, { from: fromStr, to: toStr });

  buildPnLSheet(wb, "P&L Semanal",
    weeklyAll, totalAll,
    { title: brandParam === "all" ? "Todas las Tiendas" : brandParam, brand: brandParam === "all" ? "Glowmmi + Balancea" : brandParam, from: fromStr, to: toStr }
  );

  buildPnLSheet(wb, "P&L Mensual",
    monthlyAll, totalAll,
    { title: brandParam === "all" ? "Todas las Tiendas" : brandParam, brand: brandParam === "all" ? "Glowmmi + Balancea" : brandParam, from: fromStr, to: toStr }
  );

  if (brandParam === "all" || brandParam === "brand_glowmmi") {
    buildPnLSheet(wb, "Glowmmi — Semanal", weeklyGlw, totalGlw,
      { title: "Glowmmi", brand: "glm-1694.myshopify.com", from: fromStr, to: toStr });
  }

  if (brandParam === "all" || brandParam === "brand_balancea") {
    buildPnLSheet(wb, "Balancea — Semanal", weeklyBal, totalBal,
      { title: "Balancea", brand: "mp0vab-bw.myshopify.com", from: fromStr, to: toStr });
  }

  buildFormulasSheet(wb);

  /* ── Stream as Excel file ── */
  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `reporte-pnl-${fromStr}-al-${toStr}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-cache",
    },
  });
}
