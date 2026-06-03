import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Returns a YYYY-MM-DD string in the **local** timezone of the runtime
 * (browser or server). Using `.toISOString()` would give UTC which is
 * "tomorrow" for Mexico/Colombia users after ~6-7 pm.
 */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Returns local today minus `n` days as YYYY-MM-DD */
export function daysAgoLocal(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateStr(d);
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Always show exact numbers with specified decimal places
export function fmt(value: number, currency = "USD", decimals = 2): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function fmtNum(value: number, decimals = 2): string {
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function fmtPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function fmtMargin(value: number): string {
  return `${value.toFixed(4)}%`;
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    winner: "green", scaling: "blue", active: "blue", test: "yellow",
    research: "gray", paused: "gray", loser: "red", archived: "gray",
    pending: "yellow", in_progress: "blue", review: "purple", done: "green", blocked: "red",
    in_construction: "yellow",
  };
  return map[status] ?? "gray";
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    winner: "Ganador", scaling: "Escalando", active: "Activo", test: "En Test",
    research: "Investigación", paused: "Pausado", loser: "Perdedor", archived: "Archivado",
    in_construction: "En Construcción", pending: "Pendiente", in_progress: "En Proceso",
    review: "En Revisión", done: "Hecho", blocked: "Bloqueado",
  };
  return map[status] ?? status;
}
