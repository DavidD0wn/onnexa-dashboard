// lib/asistente/mapa.ts
// ─────────────────────────────────────────────────────────────────────────────
// Descubre el Notion que ve la integración (bases, campos, opciones, personas)
// y adivina qué base es "ideas", "tareas", "proyectos", "delegaciones".
// Port de mapear_notion.py, pero en vivo: no hay archivo que regenerar.
// Se cachea 10 min por instancia; ?refrescar=1 en /api/asistente/mapa lo fuerza.
//
// Ajustes a mano (opcionales, en Vercel):
//   NOTION_ROLES          {"tareas":"<id de base>","ideas":"<id>"}   fija roles
//   NOTION_ALIAS_PERSONAS {"Fer":"María Fernanda Rey"}               apodos
// ─────────────────────────────────────────────────────────────────────────────
import { basesCompartidas, textoPlano, usuarios, yo, type Json } from "@/lib/notion";
import { leerTokenNotion } from "./config";

export type Campo = { tipo: string; opciones?: string[]; base_relacionada?: string };
export type Base = {
  id: string;
  titulo: string;
  url?: string;
  campo_titulo: string;
  campos: Record<string, Campo>;
  roles_campos: Record<string, string>;
};
export type Persona = { id: string; nombre: string; email: string };
export type Mapa = {
  workspace: string;
  bases: Record<string, Base>;
  roles: Record<string, string>; // rol → id de base
  personas: Persona[];
  alias_personas: Record<string, string>;
  generado: string;
};

export const ROLES_BASE = ["ideas", "tareas", "proyectos", "delegaciones"] as const;

const PISTAS_ROL: Record<string, string[]> = {
  ideas: ["idea", "inbox", "brainstorm", "parking"],
  tareas: ["task", "tarea", "to do", "to-do", "pendiente"],
  proyectos: ["proyecto", "project"],
  delegaciones: ["delegaci", "delegation", "encargo", "asignaci"],
  equipo: ["equipo", "team", "miembro", "personas"],
};

const PISTAS_CAMPO: Record<string, [string[], string[]]> = {
  estado: [["status", "estado", "etapa"], ["status", "select"]],
  responsable: [["responsable", "asignado", "assignee", "owner", "a quién", "a quien", "dueño", "person"], ["people", "select", "multi_select"]],
  fecha: [["fecha", "date", "due", "deadline", "límite", "limite", "vence", "entrega"], ["date"]],
  prioridad: [["prioridad", "priority"], ["select", "status"]],
  proyecto: [["proyecto", "project"], ["relation", "select"]],
  tienda: [["tienda", "marca", "store", "brand", "negocio"], ["select", "multi_select"]],
  notas: [["nota", "descripci", "detalle", "notes", "description", "contexto"], ["rich_text"]],
  tipo: [["tipo", "type", "categor", "área", "area"], ["select", "multi_select"]],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const sinGuiones = (id: string) => id.replace(/-/g, "");

function esquemaDe(base: Json): Base {
  const campos: Record<string, Campo> = {};
  let campoTitulo = "";
  for (const [nombre, p] of Object.entries<Json>(base.properties ?? {})) {
    const t = p.type as string;
    const c: Campo = { tipo: t };
    if (t === "select" || t === "multi_select" || t === "status") c.opciones = (p[t]?.options ?? []).map((o: Json) => o.name);
    if (t === "relation") c.base_relacionada = p.relation?.database_id;
    if (t === "title") campoTitulo = nombre;
    campos[nombre] = c;
  }
  const esq: Base = {
    id: base.id,
    titulo: textoPlano(base.title) || "(sin título)",
    url: base.url,
    campo_titulo: campoTitulo,
    campos,
    roles_campos: {},
  };
  for (const [rol, [pistas, tipos]] of Object.entries(PISTAS_CAMPO)) {
    const hit = Object.entries(campos).find(([n, c]) => tipos.includes(c.tipo) && pistas.some((p) => norm(n).includes(p)));
    if (hit) esq.roles_campos[rol] = hit[0];
  }
  return esq;
}

function adivinarRol(titulo: string): string | null {
  const t = norm(titulo);
  for (const [rol, pistas] of Object.entries(PISTAS_ROL)) if (pistas.some((p) => t.includes(p))) return rol;
  return null;
}

function jsonEnv(nombre: string): Record<string, string> {
  try {
    return JSON.parse(process.env[nombre] ?? "{}");
  } catch {
    return {};
  }
}

async function construir(): Promise<Mapa> {
  const [me, crudas] = await Promise.all([yo(), basesCompartidas()]);
  let personas: Persona[] = [];
  try {
    personas = (await usuarios()).map((u) => ({ id: u.id, nombre: u.name ?? "?", email: u.person?.email ?? "" }));
  } catch {
    // La integración puede no tener permiso de leer usuarios: se sigue sin responsables.
  }

  const bases: Record<string, Base> = {};
  const roles: Record<string, string> = {};
  for (const b of crudas) {
    if (b.archived || b.in_trash) continue;
    const esq = esquemaDe(b);
    bases[esq.id] = esq;
    const rol = adivinarRol(esq.titulo);
    if (rol && !roles[rol]) roles[rol] = esq.id;
  }
  // Lo fijado a mano manda (acepta ids con o sin guiones)
  for (const [rol, id] of Object.entries(jsonEnv("NOTION_ROLES"))) {
    const real = Object.keys(bases).find((b) => sinGuiones(b) === sinGuiones(id));
    if (real) roles[rol] = real;
  }

  return {
    workspace: me.bot?.workspace_name ?? "(desconocido)",
    bases,
    roles,
    personas,
    alias_personas: jsonEnv("NOTION_ALIAS_PERSONAS"),
    generado: new Date().toISOString(),
  };
}

let cache: { mapa: Mapa; hasta: number; llave: string | null } | null = null;

export async function obtenerMapa(refrescar = false): Promise<Mapa> {
  const llave = await leerTokenNotion();
  if (!refrescar && cache && cache.llave === llave && cache.hasta > Date.now()) return cache.mapa;
  const mapa = await construir();
  cache = { mapa, hasta: Date.now() + 10 * 60 * 1000, llave };
  return mapa;
}

/** Resumen corto para la pantalla de conexión. */
export function resumenMapa(m: Mapa) {
  const porId = Object.fromEntries(Object.entries(m.roles).map(([r, id]) => [id, r]));
  return {
    workspace: m.workspace,
    generado: m.generado,
    bases: Object.values(m.bases).map((b) => ({
      id: b.id,
      titulo: b.titulo,
      url: b.url,
      rol: porId[b.id] ?? null,
      campos: Object.entries(b.campos).map(([n, c]) => ({ nombre: n, tipo: c.tipo, rol: Object.entries(b.roles_campos).find(([, v]) => v === n)?.[0] ?? null })),
    })),
    personas: m.personas.map((p) => p.nombre),
    faltan: ROLES_BASE.filter((r) => !m.roles[r]),
  };
}
