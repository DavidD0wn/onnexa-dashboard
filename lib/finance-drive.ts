import "server-only";

import { gzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";

const DEFAULT_FOLDER_ID = "1kmzXwPXFHekS9gHXjXlI630E3u4c9Ly7";
const MANIFEST_NAME = "manifest.json";
const CATALOG_NAME = "catalogo-financiero.json.gz";
const INITIAL_HISTORY_DATE = "2026-03-01";

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
};

export type FinanceWeekEntry = {
  fileId: string;
  fileName: string;
  dateFrom: string;
  dateTo: string;
  generatedAt: string;
  closed: boolean;
  rows: {
    dailyMetrics: number;
    adSpend: number;
    productDailyStats: number;
    chargebacks: number;
  };
};

export type FinanceDriveManifest = {
  schemaVersion: 1;
  folderId: string;
  createdAt: string;
  updatedAt: string;
  lastSuccessfulDate: string | null;
  lastSuccessfulAt: string | null;
  catalog?: {
    fileId: string;
    fileName: string;
    generatedAt: string;
  };
  weeks: Record<string, FinanceWeekEntry>;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name} para conectar Google Drive.`);
  return value;
}

export function financeDriveFolderId(): string {
  return process.env.GOOGLE_DRIVE_FINANCE_FOLDER_ID?.trim() || DEFAULT_FOLDER_ID;
}

export function financeDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() &&
      financeDriveFolderId(),
  );
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_DRIVE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_DRIVE_CLIENT_SECRET"),
      refresh_token: requiredEnv("GOOGLE_DRIVE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || "Google no pudo renovar el acceso a Drive.");
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFile(name: string): Promise<DriveFile | null> {
  const token = await accessToken();
  const folderId = financeDriveFolderId();
  const query = [
    `name = '${escapeDriveQuery(name)}'`,
    `'${escapeDriveQuery(folderId)}' in parents`,
    "trashed = false",
  ].join(" and ");
  const params = new URLSearchParams({
    q: query,
    fields: "files(id,name,modifiedTime,size)",
    pageSize: "10",
    spaces: "drive",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Drive no pudo buscar ${name} (HTTP ${response.status}).`);
  const data = (await response.json()) as { files?: DriveFile[] };
  return data.files?.[0] ?? null;
}

async function readJsonFile<T>(name: string): Promise<T | null> {
  const file = await findFile(name);
  if (!file) return null;
  const token = await accessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Drive no pudo descargar ${name} (HTTP ${response.status}).`);
  return (await response.json()) as T;
}

async function uploadFile(
  name: string,
  content: Uint8Array,
  mimeType: string,
): Promise<DriveFile> {
  const token = await accessToken();
  const previous = await findFile(name);
  const metadata = previous
    ? { name }
    : { name, parents: [financeDriveFolderId()] };
  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json; charset=UTF-8" }),
  );
  const payload = new ArrayBuffer(content.byteLength);
  new Uint8Array(payload).set(content);
  form.append("file", new Blob([payload], { type: mimeType }), name);

  const endpoint = previous
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(previous.id)}?uploadType=multipart&supportsAllDrives=true&fields=id,name,modifiedTime,size`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,modifiedTime,size";
  const response = await fetch(endpoint, {
    method: previous ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as DriveFile & {
    error?: { message?: string };
  };
  if (!response.ok || !data.id) {
    throw new Error(data.error?.message || `Drive rechazó ${name} (HTTP ${response.status}).`);
  }
  return data;
}

async function uploadJson(name: string, value: unknown): Promise<DriveFile> {
  return uploadFile(
    name,
    new TextEncoder().encode(JSON.stringify(value, null, 2)),
    "application/json",
  );
}

async function uploadGzipJson(name: string, value: unknown): Promise<DriveFile> {
  const compressed = gzipSync(Buffer.from(JSON.stringify(value)));
  return uploadFile(name, new Uint8Array(compressed), "application/gzip");
}

export async function readFinanceManifest(): Promise<FinanceDriveManifest | null> {
  if (!financeDriveConfigured()) return null;
  return readJsonFile<FinanceDriveManifest>(MANIFEST_NAME);
}

function emptyManifest(): FinanceDriveManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    folderId: financeDriveFolderId(),
    createdAt: now,
    updatedAt: now,
    lastSuccessfulDate: null,
    lastSuccessfulAt: null,
    weeks: {},
  };
}

function utcDate(date: string, end = false): Date {
  return new Date(`${date}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
}

function addDays(date: string, amount: number): string {
  const value = utcDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const value = utcDate(date);
  const day = value.getUTCDay();
  value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

function weekId(date: string): string {
  return mondayOf(date);
}

function weeksBetween(from: string, to: string): string[] {
  const weeks: string[] = [];
  for (let cursor = mondayOf(from); cursor <= to; cursor = addDays(cursor, 7)) {
    weeks.push(cursor);
  }
  return weeks;
}

export function businessDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function incrementalStartDate(
  manifest: FinanceDriveManifest | null,
  fallbackDays = 3,
): string {
  if (manifest?.lastSuccessfulDate) return manifest.lastSuccessfulDate;
  return addDays(businessDate(), -(Math.max(1, fallbackDays) - 1));
}

async function uploadCatalog(manifest: FinanceDriveManifest): Promise<void> {
  const [brands, countries, stores, products, cogs, supplierTiers, supplierEscalones] =
    await Promise.all([
      prisma.brand.findMany(),
      prisma.country.findMany(),
      prisma.store.findMany(),
      prisma.product.findMany(),
      prisma.productCogsByCountry.findMany(),
      prisma.supplierCostTier.findMany(),
      prisma.supplierEscalon.findMany(),
    ]);
  const generatedAt = new Date().toISOString();
  const file = await uploadGzipJson(CATALOG_NAME, {
    schemaVersion: 1,
    generatedAt,
    brands,
    countries,
    stores,
    products,
    cogs,
    supplierTiers,
    supplierEscalones,
  });
  manifest.catalog = { fileId: file.id, fileName: CATALOG_NAME, generatedAt };
}

export async function exportFinanceRangeToDrive(
  from: string,
  to: string,
  options: { advanceCheckpoint?: boolean } = {},
): Promise<FinanceDriveManifest> {
  if (!financeDriveConfigured()) {
    throw new Error("Google Drive no está configurado para Finanzas.");
  }
  if (utcDate(from) > utcDate(to)) throw new Error("Rango inválido para el respaldo de Drive.");

  const manifest = (await readFinanceManifest()) ?? emptyManifest();
  const currentWeek = weekId(businessDate());

  for (const monday of weeksBetween(from, to)) {
    const sunday = addDays(monday, 6);
    const range = { gte: utcDate(monday), lte: utcDate(sunday, true) };
    const [dailyMetrics, adSpend, productDailyStats, chargebacks] = await Promise.all([
      prisma.dailyMetric.findMany({ where: { date: range }, orderBy: { date: "asc" } }),
      prisma.adSpend.findMany({ where: { date: range }, orderBy: { date: "asc" } }),
      prisma.productDailyStat.findMany({ where: { date: range }, orderBy: { date: "asc" } }),
      prisma.chargeback.findMany({ where: { date: range }, orderBy: { date: "asc" } }),
    ]);
    const generatedAt = new Date().toISOString();
    const fileName = `finanzas-semana-${monday}.json.gz`;
    const file = await uploadGzipJson(fileName, {
      schemaVersion: 1,
      week: monday,
      dateFrom: monday,
      dateTo: sunday,
      generatedAt,
      closed: monday < currentWeek,
      dailyMetrics,
      adSpend,
      productDailyStats,
      chargebacks,
    });
    manifest.weeks[monday] = {
      fileId: file.id,
      fileName,
      dateFrom: monday,
      dateTo: sunday,
      generatedAt,
      closed: monday < currentWeek,
      rows: {
        dailyMetrics: dailyMetrics.length,
        adSpend: adSpend.length,
        productDailyStats: productDailyStats.length,
        chargebacks: chargebacks.length,
      },
    };
  }

  await uploadCatalog(manifest);
  const now = new Date().toISOString();
  manifest.updatedAt = now;
  if (options.advanceCheckpoint) {
    manifest.lastSuccessfulDate = to;
    manifest.lastSuccessfulAt = now;
  }
  // El manifiesto se escribe al final: es el commit de una sincronización completa.
  await uploadJson(MANIFEST_NAME, manifest);
  return manifest;
}

export async function bootstrapFinanceDrive(): Promise<FinanceDriveManifest> {
  const [lastDaily, lastAds, lastProducts] = await Promise.all([
    prisma.dailyMetric.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    prisma.adSpend.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
    prisma.productDailyStat.findFirst({ orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const latest = [lastDaily?.date, lastAds?.date, lastProducts?.date]
    .filter((date): date is Date => Boolean(date))
    .map((date) => date.toISOString().slice(0, 10))
    .sort()
    .at(-1);
  const to = latest && latest <= businessDate() ? latest : businessDate();
  return exportFinanceRangeToDrive(INITIAL_HISTORY_DATE, to, {
    advanceCheckpoint: true,
  });
}

export function financeDriveUrl(): string {
  return `https://drive.google.com/drive/folders/${financeDriveFolderId()}`;
}
