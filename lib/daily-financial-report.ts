import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import { businessDate } from "@/lib/finance-drive";
import { sendNewZohoMessage, ZohoSendRejectedError, zohoSentMessageExists } from "@/lib/zoho-send";

const TIME_ZONE = "America/Bogota";
// Varios destinatarios separados por coma (Zoho toAddress los acepta así).
const DEFAULT_RECIPIENT = "hamletdavid00.9@gmail.com,fr.nixxl@gmail.com";

export function previousBusinessDate(): string {
  const today = businessDate();
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000)
    .toISOString().slice(0, 10);
}

export function validReportDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const pct = (value: number) => `${value.toFixed(1)}%`;
const ratio = (value: number | null | undefined) => value == null ? "No disponible" : `${value.toFixed(2)}x`;
const dateLabel = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

type ProductRow = {
  name: string; variant?: string; brandName: string; countryName: string;
  productType: string;
  revenueUsd: number; adSpendUsd: number; cogsUsd: number; feesUsd: number;
  shippingUsd: number; taxesUsd: number; chargebacksUsd: number;
  orders: number; units: number; netProfit: number; netMargin: number;
  roas: number | null; roasAds: number | null; cpaAds: number | null;
  campaignPurchases: number; campaignConversionValue: number;
  campaignImpressions: number; campaignClicks: number;
  campaignLinkClicks: number; campaignAddToCart: number;
  campaignReach: number; campaignUniqueLinkClicks: number;
  metaCtr: number | null; metaCpc: number | null; metaCpm: number | null;
  metaUniqueCtr: number | null; metaLinkCpc: number | null;
  metaCostPerAtc: number | null; metaAov: number | null;
  dataQuality?: string;
};

function physicalProductsOnly(source: ProductRow[]): ProductRow[] {
  const grouped = new Map<string, ProductRow>();
  for (const row of source) {
    if (row.productType !== "físico") continue; // Excluye upsells, incluso los físicos.
    if (!(row.orders > 0 || row.units > 0 ||
      [row.revenueUsd, row.adSpendUsd, row.cogsUsd, row.feesUsd].some((value) => Math.abs(value) > 0.001))) continue;
    const key = `${row.brandName}\u0000${row.name}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...row, variant: "" });
      continue;
    }
    for (const field of [
      "revenueUsd", "adSpendUsd", "cogsUsd", "feesUsd", "shippingUsd",
      "taxesUsd", "chargebacksUsd", "orders", "units", "netProfit",
      "campaignPurchases", "campaignConversionValue", "campaignImpressions", "campaignClicks",
      "campaignLinkClicks", "campaignAddToCart", "campaignReach", "campaignUniqueLinkClicks",
    ] as const) {
      existing[field] += row[field];
    }
    const countries = new Set([...existing.countryName.split(" + "), row.countryName]);
    existing.countryName = [...countries].join(" + ");
    if (row.dataQuality && row.dataQuality !== existing.dataQuality) {
      existing.dataQuality = [existing.dataQuality, row.dataQuality].filter(Boolean).join("; ");
    }
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    netMargin: row.revenueUsd > 0 ? row.netProfit / row.revenueUsd * 100 : 0,
    roas: row.adSpendUsd > 0 ? row.revenueUsd / row.adSpendUsd : null,
    roasAds: row.adSpendUsd > 0 ? row.campaignConversionValue / row.adSpendUsd : null,
    cpaAds: row.campaignPurchases > 0 ? row.adSpendUsd / row.campaignPurchases : null,
    metaCtr: row.campaignImpressions > 0 ? row.campaignClicks / row.campaignImpressions * 100 : null,
    metaCpc: row.campaignClicks > 0 ? row.adSpendUsd / row.campaignClicks : null,
    metaCpm: row.campaignImpressions > 0 ? row.adSpendUsd / row.campaignImpressions * 1000 : null,
    // Unique CTR de Meta = clics únicos de enlace ÷ alcance (nivel campaña).
    metaUniqueCtr: row.campaignReach > 0 ? row.campaignUniqueLinkClicks / row.campaignReach * 100 : null,
    metaLinkCpc: row.campaignLinkClicks > 0 ? row.adSpendUsd / row.campaignLinkClicks : null,
    metaCostPerAtc: row.campaignAddToCart > 0 ? row.adSpendUsd / row.campaignAddToCart : null,
    metaAov: row.campaignPurchases > 0 ? row.campaignConversionValue / row.campaignPurchases : null,
  })).sort((a, b) => b.revenueUsd - a.revenueUsd);
}

function renderHtmlReport(date: string, rows: ProductRow[], summary: {
  revenue: number; adSpend: number; cogs: number; fees: number; profit: number;
}) {
  const tableRow = (label: string, value: string, accent = false) =>
    `<tr><td style="padding:9px 12px;border-bottom:1px solid #e8edf1;color:#53616e;font-size:13px">${escapeHtml(label)}</td>` +
    `<td style="padding:9px 12px;border-bottom:1px solid #e8edf1;text-align:right;font-size:13px;font-weight:${accent ? "700" : "600"};color:${accent ? "#0b776d" : "#172b36"}">${escapeHtml(value)}</td></tr>`;
  const maxProfit = Math.max(1, ...rows.map((row) => Math.abs(row.netProfit)));
  const bars = rows.map((row) => {
    const width = Math.max(3, Math.round(Math.abs(row.netProfit) / maxProfit * 100));
    const color = row.netProfit < 0 ? "#d75b60" : "#168f7b";
    return `<tr><td style="padding:8px 10px 8px 0;vertical-align:middle;font-size:12px;color:#24343f;width:43%">${escapeHtml(row.name)}</td>` +
      `<td style="padding:8px 4px;vertical-align:middle;width:35%"><div style="height:10px;background:#edf3f2;border-radius:6px"><div style="height:10px;width:${width}%;background:${color};border-radius:6px"></div></div></td>` +
      `<td style="padding:8px 0 8px 8px;text-align:right;white-space:nowrap;font-size:12px;font-weight:700;color:${color}">${escapeHtml(money(row.netProfit))}</td></tr>`;
  }).join("");
  const cards = rows.map((row, index) => {
    const profitColor = row.netProfit < 0 ? "#b3454b" : "#0b776d";
    const quality = row.dataQuality && !/^(OK|Completo)$/i.test(row.dataQuality)
      ? `<p style="margin:10px 0 0;color:#9a681e;font-size:12px">Calidad de datos: ${escapeHtml(row.dataQuality)}</p>` : "";
    return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #dce8e6;border-radius:12px;margin:0 0 16px">` +
      `<tr><td colspan="2" style="padding:15px 16px 12px;background:#eef8f6;border-bottom:1px solid #dce8e6">` +
      `<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#0b776d;font-weight:700">Producto ${index + 1} · ${escapeHtml(row.brandName)} · ${escapeHtml(row.countryName)}</div>` +
      `<div style="margin-top:5px;font-size:17px;line-height:1.3;font-weight:700;color:#142d35">${escapeHtml(row.name)}</div></td></tr>` +
      tableRow("Revenue neto", money(row.revenueUsd)) +
      tableRow("Ads Spend", money(row.adSpendUsd)) +
      tableRow("COGS", money(row.cogsUsd)) +
      tableRow("Fees y otros costos", money(row.feesUsd + row.shippingUsd + row.taxesUsd + row.chargebacksUsd)) +
      tableRow("Pedidos / unidades", `${row.orders} / ${row.units}`) +
      tableRow("Margen neto", row.revenueUsd > 0 ? pct(row.netMargin) : "No aplicable") +
      `<tr><td style="padding:11px 12px;color:#24343f;font-size:14px;font-weight:700">Profit / Loss</td><td style="padding:11px 12px;text-align:right;color:${profitColor};font-size:16px;font-weight:800">${escapeHtml(`${row.netProfit >= 0 ? "+" : ""}${money(row.netProfit)}`)}</td></tr>` +
      `<tr><td colspan="2" style="padding:10px 12px;background:#f8fbfa;border-top:1px solid #e8edf1"><strong style="font-size:12px;color:#52636a">ROAS financiero:</strong> <strong style="color:#142d35">${escapeHtml(row.adSpendUsd > 0 ? ratio(row.roas) : "Sin pauta")}</strong></td></tr>` +
      `<tr><td colspan="2" style="padding:13px 12px 4px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#637783">Meta Ads</td></tr>` +
      tableRow("Amount spent", money(row.adSpendUsd)) +
      tableRow("CPM", row.metaCpm == null ? "No disponible" : money(row.metaCpm)) +
      tableRow("Unique CTR (clic de enlace)", row.metaUniqueCtr == null ? "No disponible" : pct(row.metaUniqueCtr)) +
      tableRow("CPC (clic de enlace)", row.metaLinkCpc == null ? "No disponible" : money(row.metaLinkCpc)) +
      tableRow("Adds to cart", row.adSpendUsd > 0 ? row.campaignAddToCart.toFixed(0) : "No disponible") +
      tableRow("Cost per add to cart", row.metaCostPerAtc == null ? "No disponible" : money(row.metaCostPerAtc)) +
      tableRow("Purchases", row.adSpendUsd > 0 ? row.campaignPurchases.toFixed(0) : "No disponible") +
      tableRow("Cost per result (CPA)", row.cpaAds == null ? "No disponible" : money(row.cpaAds)) +
      tableRow("Purchase ROAS", row.adSpendUsd > 0 ? ratio(row.roasAds) : "No disponible") +
      tableRow("AOV", row.metaAov == null ? "No disponible" : money(row.metaAov)) +
      tableRow("Purchases conversion value", money(row.campaignConversionValue)) +
      `<tr><td colspan="2" style="padding:0 12px 12px">${quality}</td></tr></table>`;
  }).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f3f7f6;color:#172b36;font-family:Arial,Helvetica,sans-serif">` +
    `<div style="max-width:640px;margin:0 auto;padding:20px 12px">` +
    `<div style="background:#12343b;border-radius:14px;padding:22px 20px;color:#ffffff">` +
    `<div style="font-size:11px;letter-spacing:2px;color:#9bdfd5;font-weight:700">ONNEXA · FINANZAS</div>` +
    `<h1 style="font-size:24px;line-height:1.2;margin:8px 0 7px;color:#ffffff">Reporte financiero diario</h1>` +
    `<div style="font-size:13px;color:#d7eeea">${dateLabel(date)} · Colombia · USD</div></div>` +
    `<h2 style="font-size:16px;margin:24px 4px 10px;color:#12343b">Resumen · productos físicos</h2>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #dce8e6;border-radius:12px">` +
    tableRow("Revenue neto", money(summary.revenue)) +
    tableRow("Ads Spend", money(summary.adSpend)) +
    tableRow("COGS", money(summary.cogs)) +
    tableRow("Fees", money(summary.fees)) +
    tableRow("Margen neto", summary.revenue > 0 ? pct(summary.profit / summary.revenue * 100) : "No aplicable") +
    tableRow("ROAS financiero", summary.adSpend > 0 ? ratio(summary.revenue / summary.adSpend) : "Sin pauta") +
    tableRow("Profit / Loss", `${summary.profit >= 0 ? "+" : ""}${money(summary.profit)}`, true) +
    `</table>` +
    `<h2 style="font-size:16px;margin:25px 4px 10px;color:#12343b">Profit por producto</h2>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid #dce8e6;border-radius:12px;padding:12px"><tbody>${bars}</tbody></table>` +
    `<h2 style="font-size:16px;margin:25px 4px 10px;color:#12343b">Detalle (${rows.length} productos)</h2>` + cards +
    `<p style="font-size:11px;line-height:1.5;color:#667983;margin:14px 4px 0">Solo productos físicos; se excluyen upsells, digitales y pauta sin producto identificado. Por eso este subtotal puede diferir del dashboard global. ROAS financiero usa ventas netas de Shopify; Purchase ROAS usa compras atribuidas por Meta. Las métricas de Meta Ads (Unique CTR, CPC, adds to cart, AOV, etc.) vienen del mismo reporte de Meta.</p>` +
    `</div></body></html>`;
}

async function readJson(base: string, path: string) {
  // La URL pública puede estar protegida por Vercel aunque esta función ya
  // esté ejecutándose dentro del deployment. Leer los handlers localmente.
  const request = new NextRequest(`${base}${path}`);
  const response = path.startsWith("/api/products/analytics?")
    ? await (await import("@/app/api/products/analytics/route")).GET(request)
    : path.startsWith("/api/dashboard?")
      ? await (await import("@/app/api/dashboard/route")).GET(request)
      : (() => { throw new Error(`Ruta interna no admitida: ${path}`); })();
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.error) {
    throw new Error(`No se pudo consultar ${path} (HTTP ${response.status}).`);
  }
  return body;
}

export async function buildDailyFinancialReport(base: string, date: string) {
  if (!validReportDate(date) || date >= businessDate()) {
    throw new Error("El reporte debe corresponder a un día cerrado de Colombia.");
  }
  const range = `from=${date}&to=${date}`;
  const [analytics, dashboard] = await Promise.all([
    readJson(base, `/api/products/analytics?${range}`),
    readJson(base, `/api/dashboard?${range}`),
  ]);
  if (!analytics.adSpendReconciliation?.ok) {
    throw new Error("El gasto de Meta no concilia con Product Analytics; no se enviará un reporte engañoso.");
  }
  if (analytics.salesSyncGaps?.length) {
    throw new Error("Shopify y el cierre de ventas tienen diferencias pendientes; reintenta tras sincronizar.");
  }
  const t = analytics.totals;
  const d = dashboard.totals;
  // La única fuente de divergencia entre PA y Dashboard es la conversión USD del
  // REVENUE (PA usa net_sales de Shopify; Dashboard usa DailyMetric, que el sync
  // re-escribe con la tasa en vivo del día, difiriendo ~6-7%). Ese gap absoluto
  // se arrastra idéntico al profit (profit = revenue − costos, y los costos sí
  // coinciden). Por eso la tolerancia se mide contra el REVENUE, no contra cada
  // métrica: así el mismo gap de FX no se vuelve "enorme" al compararlo contra el
  // profit (un número menor). Solo bloquea discrepancias GRANDES (doble conteo,
  // datos faltantes), nunca el ruido normal de FX.
  const fxBase = Math.max(Math.abs(d.net ?? 0), Math.abs(t.revenueUsd ?? 0));
  const tolerance = Math.max(1, fxBase * 0.10);
  for (const [label, actual, expected] of [
    ["revenue", t.revenueUsd, d.net],
    ["ad spend", t.adSpendUsd, d.adSpend],
    ["COGS", t.cogsUsd, d.cogs],
    ["profit", t.netProfit, d.realProfit],
  ] as Array<[string, number, number]>) {
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
      throw new Error(`Falta el dato de ${label} en Product Analytics o Dashboard.`);
    }
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`Product Analytics y Dashboard no concilian en ${label} (PA ${actual.toFixed(2)} vs Dashboard ${expected.toFixed(2)}).`);
    }
  }
  const rows = physicalProductsOnly(analytics.rows as ProductRow[]);
  const physical = rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenueUsd,
    adSpend: sum.adSpend + row.adSpendUsd,
    cogs: sum.cogs + row.cogsUsd,
    fees: sum.fees + row.feesUsd,
    profit: sum.profit + row.netProfit,
  }), { revenue: 0, adSpend: 0, cogs: 0, fees: 0, profit: 0 });
  const lines = [
    "REPORTE FINANCIERO DIARIO",
    `Fecha: ${dateLabel(date)} · Zona horaria: ${TIME_ZONE}`,
    "Importes en USD. Revenue = ingreso neto de Shopify; profit incluye COGS, pauta, fees y demás costos registrados.",
    "",
    "RESUMEN DE PRODUCTOS FÍSICOS",
    `Revenue total: ${money(physical.revenue)}`,
    `Ads Spend: ${money(physical.adSpend)}`,
    `COGS: ${money(physical.cogs)}`,
    `Fees: ${money(physical.fees)}`,
    `Margen neto: ${physical.revenue > 0 ? pct(physical.profit / physical.revenue * 100) : "No aplicable"}`,
    `Profit/Loss: ${physical.profit >= 0 ? "+" : ""}${money(physical.profit)}`,
    `ROAS financiero (Shopify / pauta): ${physical.adSpend > 0 ? ratio(physical.revenue / physical.adSpend) : "Sin pauta"}`,
    `Productos físicos detallados: ${rows.length}`,
    "Se excluyen upsells, productos digitales y pauta sin producto identificado. Este subtotal puede diferir del dashboard global.",
  ];

  for (const [index, row] of rows.entries()) {
    lines.push(
      "", "──────────────────────────────",
      `PRODUCTO ${index + 1}: ${row.name}${row.variant ? ` · ${row.variant}` : ""}`,
      `Tienda / país: ${row.brandName} / ${row.countryName}`,
      `Revenue total: ${money(row.revenueUsd)}`,
      `Ads Spend: ${money(row.adSpendUsd)}`,
      `COGS: ${money(row.cogsUsd)}`,
      `Fees y otros costos registrados: ${money(row.feesUsd + row.shippingUsd + row.taxesUsd + row.chargebacksUsd)}`,
      `Pedidos / unidades: ${row.orders} / ${row.units}`,
      `Margen neto: ${row.revenueUsd > 0 ? pct(row.netMargin) : "No aplicable"}`,
      `Profit/Loss: ${row.netProfit >= 0 ? "+" : ""}${money(row.netProfit)}`,
      `ROAS financiero: ${row.adSpendUsd > 0 ? ratio(row.roas) : "Sin pauta"}`,
      "MÉTRICAS DE META ADS",
      `Amount spent: ${money(row.adSpendUsd)}`,
      `CPM: ${row.metaCpm == null ? "No disponible" : money(row.metaCpm)}`,
      `Unique CTR (clic de enlace): ${row.metaUniqueCtr == null ? "No disponible" : pct(row.metaUniqueCtr)}`,
      `CPC (clic de enlace): ${row.metaLinkCpc == null ? "No disponible" : money(row.metaLinkCpc)}`,
      `Adds to cart: ${row.adSpendUsd > 0 ? row.campaignAddToCart.toFixed(0) : "No disponible"}`,
      `Cost per add to cart: ${row.metaCostPerAtc == null ? "No disponible" : money(row.metaCostPerAtc)}`,
      `Purchases: ${row.adSpendUsd > 0 ? row.campaignPurchases.toFixed(0) : "No disponible"}`,
      `Cost per result (CPA): ${row.cpaAds == null ? "No disponible" : money(row.cpaAds)}`,
      `Purchase ROAS: ${row.adSpendUsd > 0 ? ratio(row.roasAds) : "No disponible"}`,
      `AOV: ${row.metaAov == null ? "No disponible" : money(row.metaAov)}`,
      `Purchases conversion value: ${money(row.campaignConversionValue)}`,
    );
    if (row.dataQuality && !/^(OK|Completo)$/i.test(row.dataQuality)) {
      lines.push(`Calidad de datos: ${row.dataQuality}`);
    }
  }
  lines.push("", "Nota: las métricas de Meta Ads vienen del reporte de Meta. El Purchase ROAS es atribuido por Meta y puede diferir del ROAS financiero (ventas netas de Shopify ÷ pauta).");
  return {
    subject: `Reporte financiero diario | ${dateLabel(date)}`,
    body: lines.join("\n"),
    htmlBody: renderHtmlReport(date, rows, physical),
    recipient: process.env.FINANCE_REPORT_TO_EMAIL?.trim() || DEFAULT_RECIPIENT,
    productCount: rows.length,
    totals: physical,
  };
}

export async function prepareDailyFinancialReport(base: string, date: string) {
  const existing = await prisma.dailyFinancialReport.findUnique({ where: { date } });
  if (existing && ["sent", "sending", "refreshing"].includes(existing.status)) return existing;
  const report = await buildDailyFinancialReport(base, date);
  const content = { subject: report.subject, body: report.body,
    htmlBody: report.htmlBody, recipient: report.recipient };
  if (existing) {
    await prisma.dailyFinancialReport.updateMany({
      where: { date, status: { in: ["ready", "failed"] }, sentAt: null },
      data: { ...content, status: "ready", errorMsg: null, preparedAt: new Date() },
    });
    return prisma.dailyFinancialReport.findUniqueOrThrow({ where: { date } });
  }
  try {
    return await prisma.dailyFinancialReport.create({
      data: { date, status: "ready", ...content },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return prisma.dailyFinancialReport.findUniqueOrThrow({ where: { date } });
    }
    throw error;
  }
}

export async function sendDailyFinancialReport(
  date: string,
  mode: "automatic" | "after-refresh" | "retry" | "resend" = "automatic",
) {
  const manualResend = mode === "resend";
  const claim = await prisma.dailyFinancialReport.updateMany({
    where: manualResend
      ? { date, status: "sent", sentAt: { not: null } }
      : { date, status: mode === "retry" ? { in: ["ready", "failed"] } : mode === "after-refresh" ? "refreshing" : "ready", sentAt: null },
    data: { status: "sending", sendingAt: new Date(), errorMsg: null },
  });
  if (claim.count !== 1) {
    const current = await prisma.dailyFinancialReport.findUnique({ where: { date } });
    return { sent: false, status: current?.status ?? "missing" };
  }
  const report = await prisma.dailyFinancialReport.findUniqueOrThrow({ where: { date } });
  const mailbox = process.env.FINANCE_REPORT_FROM_MAILBOX?.trim() || "glowmmi";
  try {
    await sendNewZohoMessage(mailbox, {
      to: report.recipient,
      subject: report.subject,
      text: report.body,
      html: report.htmlBody,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Una caída de red puede ocurrir después de que Zoho acepte el correo.
    // En ese caso el respaldo comprueba Enviados antes de liberar la reserva.
    const status = manualResend ? "sent" : error instanceof ZohoSendRejectedError ? "failed" : "sending";
    await prisma.dailyFinancialReport.update({ where: { date }, data: { status, errorMsg: message } });
    throw error;
  }
  // Si esta escritura falla, queda "sending": no se reintenta automáticamente
  // porque Zoho ya pudo haber aceptado el mensaje.
  await prisma.dailyFinancialReport.update({
    where: { date },
    data: { status: "sent", sentAt: new Date(), errorMsg: null,
      ...(manualResend ? { resendCount: { increment: 1 }, lastResentAt: new Date() } : {}) },
  });
  return { sent: true, status: "sent", recipient: report.recipient, manualResend };
}

export async function reconcileUncertainDailyReport(date: string) {
  const report = await prisma.dailyFinancialReport.findUnique({ where: { date } });
  if (report?.status !== "sending" || report.sentAt || !report.sendingAt ||
      report.sendingAt.getTime() > Date.now() - 15 * 60_000) return;
  const mailbox = process.env.FINANCE_REPORT_FROM_MAILBOX?.trim() || "glowmmi";
  const found = await zohoSentMessageExists(mailbox, report.subject, report.recipient);
  await prisma.dailyFinancialReport.updateMany({
    where: { date, status: "sending", sentAt: null, sendingAt: report.sendingAt },
    data: found
      ? { status: "sent", sentAt: new Date(), errorMsg: null }
      : { status: "failed", errorMsg: "No aparece en Enviados de Zoho; reintento automático." },
  });
}

/** Vuelve a ejecutar la actualización de Ventas + Ads antes de calcular/enviar. */
export async function refreshAndSendDailyReport(
  base: string, date: string, deliver = true, allowFailed = false,
) {
  if (!validReportDate(date) || date >= businessDate()) {
    throw new Error("El reporte debe corresponder a un día cerrado de Colombia.");
  }
  await prisma.dailyFinancialReport.upsert({
    where: { date },
    create: { date, status: "ready", subject: "", body: "", recipient: process.env.FINANCE_REPORT_TO_EMAIL?.trim() || DEFAULT_RECIPIENT },
    update: {},
  });
  const claim = await prisma.dailyFinancialReport.updateMany({
    where: { date, status: allowFailed ? { in: ["ready", "failed"] } : "ready", sentAt: null },
    data: { status: "refreshing", errorMsg: null, sendingAt: null },
  });
  if (claim.count !== 1) {
    const current = await prisma.dailyFinancialReport.findUnique({ where: { date } });
    return { sent: false, status: current?.status ?? "missing" };
  }
  try {
    // Ejecutar el handler dentro de la misma invocación evita que una llamada
    // HTTP al propio deployment (protección/routing de Vercel) impida el correo.
    const { POST: runAutosync } = await import("@/app/api/shopify/autosync/route");
    const syncResponse = await runAutosync(new Request(`${base}/api/shopify/autosync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: date, to: date, incremental: false,
        skipDailyFinancialReport: true, skipFinanceDrive: true }),
    }));
    const sync = await syncResponse.json().catch(() => null);
    const syncErrors = Object.entries({
      ...Object.fromEntries(Object.entries(sync?.shopify ?? {}).map(([key, value]) => [`shopify.${key}`, value])),
      ...Object.fromEntries(Object.entries(sync?.payments ?? {}).map(([key, value]) => [`payments.${key}`, value])),
      ...Object.fromEntries(Object.entries(sync?.disputes ?? {}).map(([key, value]) => [`disputes.${key}`, value])),
      general: sync, metaAds: sync?.metaAds, rollup: sync?.rollup, cleanup: sync?.cleanup,
    }).flatMap(([source, result]) => {
      if (!result || typeof result !== "object" || !("error" in result) || !result.error) return [];
      const detail = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
      return [`${source}: ${detail}`];
    });
    if (!syncResponse.ok || !sync?.coreSyncOk || syncErrors.length > 0) {
      throw new Error(`La actualización de Ventas + Ads no terminó completa (HTTP ${syncResponse.status}; ${syncErrors.join("; ") || "sin detalle"}). No se enviará el reporte.`);
    }
    const report = await buildDailyFinancialReport(base, date);
    const saved = await prisma.dailyFinancialReport.updateMany({
      where: { date, status: "refreshing", sentAt: null },
      data: { subject: report.subject, body: report.body, htmlBody: report.htmlBody,
        recipient: report.recipient, preparedAt: new Date(),
        status: deliver ? "refreshing" : "ready" },
    });
    if (saved.count !== 1) throw new Error("El reporte cambió de estado durante la actualización.");
    if (!deliver) return { sent: false, status: "ready", date,
      productCount: report.productCount, totals: report.totals };
    return await sendDailyFinancialReport(date, "after-refresh");
  } catch (error) {
    await prisma.dailyFinancialReport.updateMany({
      where: { date, status: "refreshing" },
      data: { status: "failed", errorMsg: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
