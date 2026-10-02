import { prisma } from "@/lib/prisma";
import { businessDate } from "@/lib/finance-drive";
import { getPooledTransporter, smtpFor } from "@/lib/zoho-send";

const TIME_ZONE = "America/Bogota";
const DEFAULT_RECIPIENT = "fr.nixxl@gmail.com";

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

type ProductRow = {
  name: string; variant?: string; brandName: string; countryName: string;
  productType: string;
  revenueUsd: number; adSpendUsd: number; cogsUsd: number; feesUsd: number;
  shippingUsd: number; taxesUsd: number; chargebacksUsd: number;
  orders: number; units: number; netProfit: number; netMargin: number;
  roas: number | null; roasAds: number | null; cpaAds: number | null;
  campaignPurchases: number; campaignConversionValue: number;
  campaignImpressions: number; campaignClicks: number;
  metaCtr: number | null; metaCpc: number | null; metaCpm: number | null;
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
  })).sort((a, b) => b.revenueUsd - a.revenueUsd);
}

async function readJson(base: string, path: string) {
  const response = await fetch(`${base}${path}`, { cache: "no-store" });
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
  for (const [label, actual, expected] of [
    ["revenue", t.revenueUsd, d.net],
    ["ad spend", t.adSpendUsd, d.adSpend],
    ["COGS", t.cogsUsd, d.cogs],
    ["profit", t.netProfit, d.realProfit],
  ] as Array<[string, number, number]>) {
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) >= 0.01) {
      throw new Error(`Product Analytics y Dashboard no concilian en ${label}.`);
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
      `CTR (todos los clics): ${row.metaCtr == null ? "No disponible" : pct(row.metaCtr)}`,
      `CPC: ${row.metaCpc == null ? "No disponible" : money(row.metaCpc)}`,
      `CPM: ${row.metaCpm == null ? "No disponible" : money(row.metaCpm)}`,
      `CPA Ads: ${row.cpaAds == null ? "No disponible" : money(row.cpaAds)}`,
      `Compras atribuidas: ${row.adSpendUsd > 0 ? row.campaignPurchases.toFixed(0) : "No disponible"}`,
      `ROAS Meta Ads: ${row.adSpendUsd > 0 ? ratio(row.roasAds) : "No disponible"}`,
    );
    if (row.dataQuality && !/^(OK|Completo)$/i.test(row.dataQuality)) {
      lines.push(`Calidad de datos: ${row.dataQuality}`);
    }
  }
  lines.push("", "Nota: el CTR disponible corresponde a todos los clics de Meta, no al Unique CTR. El ROAS de Meta es atribuido y puede diferir del ROAS financiero.");
  return {
    subject: `Reporte financiero diario | ${dateLabel(date)}`,
    body: lines.join("\n"),
    recipient: process.env.FINANCE_REPORT_TO_EMAIL?.trim() || DEFAULT_RECIPIENT,
    productCount: rows.length,
    totals: physical,
  };
}

export async function prepareDailyFinancialReport(base: string, date: string) {
  const existing = await prisma.dailyFinancialReport.findUnique({ where: { date } });
  if (existing?.status === "sent" || existing?.status === "sending") return existing;
  const report = await buildDailyFinancialReport(base, date);
  return prisma.dailyFinancialReport.upsert({
    where: { date },
    create: { date, status: "ready", subject: report.subject, body: report.body, recipient: report.recipient },
    update: { status: "ready", subject: report.subject, body: report.body, recipient: report.recipient, errorMsg: null, preparedAt: new Date() },
  });
}

export async function sendDailyFinancialReport(
  date: string,
  mode: "automatic" | "retry" | "resend" = "automatic",
) {
  const manualResend = mode === "resend";
  const claim = await prisma.dailyFinancialReport.updateMany({
    where: manualResend
      ? { date, status: "sent", sentAt: { not: null } }
      : { date, status: mode === "retry" ? { in: ["ready", "failed"] } : "ready", sentAt: null },
    data: { status: "sending", sendingAt: new Date(), errorMsg: null },
  });
  if (claim.count !== 1) {
    const current = await prisma.dailyFinancialReport.findUnique({ where: { date } });
    return { sent: false, status: current?.status ?? "missing" };
  }
  const report = await prisma.dailyFinancialReport.findUniqueOrThrow({ where: { date } });
  const mailbox = process.env.FINANCE_REPORT_FROM_MAILBOX?.trim() || "glowmmi";
  const smtp = smtpFor(mailbox);
  if (!smtp.pass) {
    await prisma.dailyFinancialReport.update({ where: { date }, data: { status: manualResend ? "sent" : "failed", errorMsg: "Falta la credencial SMTP del buzón Zoho." } });
    throw new Error("Falta la credencial SMTP del buzón Zoho.");
  }
  try {
    await getPooledTransporter(smtp.user, smtp.pass).sendMail({
      from: `"Reporte financiero Onnexa" <${smtp.user}>`,
      to: report.recipient,
      subject: report.subject,
      text: report.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.dailyFinancialReport.update({ where: { date }, data: { status: manualResend ? "sent" : "failed", errorMsg: message } });
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
