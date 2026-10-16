// lib/notion.ts
// ─────────────────────────────────────────────────────────────────────────────
// Capa fina sobre la API REST de Notion con el token de integración interna
// (el que se pega en el asistente; NOTION_TOKEN de respaldo). Port de notion_api.py.
// Versión 2025-09-03 (data sources): las tablas se leen, consultan y llenan por el
// id de su "data source". Es la única versión que entiende las vistas enlazadas
// que usa E-COMMERCE (con 2022-06-28 Notion responde "linked database" y no deja leerlas).
// ─────────────────────────────────────────────────────────────────────────────

import { leerTokenNotion } from "@/lib/asistente/config";

const API = "https://api.notion.com/v1";
const VERSION = "2025-09-03";

export class NotionError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Json = Record<string, any>;

async function token(): Promise<string> {
  const t = await leerTokenNotion();
  if (!t) throw new NotionError("Notion no está conectado: pega la llave de la integración en Automatizaciones → Asistente de voz.");
  return t;
}

async function req(method: string, path: string, body?: Json, llave?: string): Promise<Json> {
  const t = llave ?? (await token());
  for (let intento = 0; intento < 4; intento++) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${t}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 1000 * Number(r.headers.get("Retry-After") ?? 1)));
      continue;
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new NotionError(`Notion ${r.status}: ${data.message ?? r.statusText}`);
    return data;
  }
  throw new NotionError("Notion: demasiados reintentos (429)");
}

async function paginar(method: "GET" | "POST", path: string, body: Json = {}): Promise<Json[]> {
  const out: Json[] = [];
  let cursor: string | undefined;
  for (let vuelta = 0; vuelta < 20; vuelta++) {
    let data: Json;
    if (method === "POST") {
      data = await req("POST", path, { ...body, ...(cursor ? { start_cursor: cursor } : {}) });
    } else {
      const qs = new URLSearchParams({ page_size: "100", ...(cursor ? { start_cursor: cursor } : {}) });
      data = await req("GET", `${path}?${qs}`);
    }
    out.push(...(data.results ?? []));
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return out;
}

// ---------- lectura ----------
export const yo = () => req("GET", "/users/me");

/** Comprueba una llave antes de guardarla. Devuelve el nombre del workspace. */
export async function probarLlave(llave: string): Promise<string> {
  const me = await req("GET", "/users/me", undefined, llave);
  return me.bot?.workspace_name ?? "(desconocido)";
}

export async function usuarios(): Promise<Json[]> {
  return (await paginar("GET", "/users")).filter((u) => u.type === "person");
}

/** Tablas (data sources) que el buscador de Notion ya tiene indexadas para la integración. */
export function fuentesCompartidas(): Promise<Json[]> {
  return paginar("POST", "/search", { filter: { value: "data_source", property: "object" }, page_size: 100 });
}

/** Páginas compartidas con la integración (el buscador puede tardar en indexarlas). */
export function paginasCompartidas(): Promise<Json[]> {
  return paginar("POST", "/search", { filter: { value: "page", property: "object" }, page_size: 100 });
}

export const hijos = (blockId: string) => paginar("GET", `/blocks/${blockId}/children`);
export const baseDeDatos = (databaseId: string) => req("GET", `/databases/${databaseId}`);
export const fuente = (dataSourceId: string) => req("GET", `/data_sources/${dataSourceId}`);

export async function consultar(fuenteId: string, filtro?: Json | null, orden?: Json[], limite = 50): Promise<Json[]> {
  const body: Json = { page_size: Math.min(limite, 100) };
  if (filtro) body.filter = filtro;
  if (orden) body.sorts = orden;
  const data = await req("POST", `/data_sources/${fuenteId}/query`, body);
  return data.results ?? [];
}

export function buscarPorTitulo(fuenteId: string, propTitulo: string, texto: string): Promise<Json[]> {
  return consultar(fuenteId, { property: propTitulo, title: { contains: texto } }, undefined, 10);
}

// ---------- escritura ----------
export function crearPagina(fuenteId: string, propiedades: Json, contenido?: string | null): Promise<Json> {
  const body: Json = { parent: { type: "data_source_id", data_source_id: fuenteId }, properties: propiedades };
  if (contenido) {
    body.children = [
      { object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: contenido.slice(0, 1900) } }] } },
    ];
  }
  return req("POST", "/pages", body);
}

export const actualizarPagina = (pageId: string, propiedades: Json) =>
  req("PATCH", `/pages/${pageId}`, { properties: propiedades });

export const archivarPagina = (pageId: string) => req("PATCH", `/pages/${pageId}`, { archived: true });

export const comentar = (pageId: string, texto: string) =>
  req("POST", "/comments", { parent: { page_id: pageId }, rich_text: [{ type: "text", text: { content: texto.slice(0, 1900) } }] });

// ---------- utilidades de lectura de valores ----------
export const textoPlano = (rich?: Json[] | null) => (rich ?? []).map((t) => t.plain_text ?? "").join("");

export function tituloDe(pagina: Json): string {
  for (const p of Object.values<Json>(pagina.properties ?? {})) {
    if (p.type === "title") return textoPlano(p.title) || "(sin título)";
  }
  return "(sin título)";
}

/** Cualquier propiedad de Notion como texto corto, para leerlo en voz. */
export function valorLegible(prop: Json): string {
  const t = prop?.type;
  const v = prop?.[t];
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  switch (t) {
    case "title":
    case "rich_text":
      return textoPlano(v);
    case "select":
    case "status":
      return v.name ?? "";
    case "multi_select":
      return v.map((o: Json) => o.name).join(", ");
    case "date":
      return (v.start ?? "") + (v.end ? ` a ${v.end}` : "");
    case "people":
      return v.map((u: Json) => u.name ?? "?").join(", ");
    case "checkbox":
      return v ? "sí" : "no";
    case "number":
    case "url":
    case "email":
    case "phone_number":
      return String(v);
    case "relation":
      return `${v.length} relacionado(s)`;
    case "formula":
      return String(v[v.type] ?? "");
    default:
      return "";
  }
}
