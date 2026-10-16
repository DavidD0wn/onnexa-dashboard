// lib/asistente/mapa.ts
// ─────────────────────────────────────────────────────────────────────────────
// Descubre el Notion que ve la integración (bases, campos, opciones, personas)
// y adivina qué base es "ideas", "tareas", "proyectos", "delegaciones".
// Port de mapear_notion.py, pero en vivo: no hay archivo que regenerar.
// Los roles se recuerdan en Neon; el esquema se cachea 10 min. ?refrescar=1 vuelve a recorrer todo.
//
// Ajustes a mano (opcionales, en Vercel):
//   NOTION_ROLES          {"tareas":"<id de base>","ideas":"<id>"}   fija roles
//   NOTION_ALIAS_PERSONAS {"Fer":"María Fernanda Rey"}               apodos
// ─────────────────────────────────────────────────────────────────────────────
import { baseDeDatos, consultar, fuente, fuentesCompartidas, hijos, paginasCompartidas, textoPlano, usuarios, yo, type Json } from "@/lib/notion";
import { guardarRoles, leerRolesGuardados, leerTokenNotion } from "./config";

// Página raíz donde Fernanda tiene sus tablas (E-COMMERCE). Se recorre aunque el buscador
// de Notion todavía no la haya indexado.
const RAIZ = (process.env.NOTION_RAIZ ?? "17a3796efac580349b73e3f61b4220c0").replace(/-/g, "");

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
  sin_acceso: string[]; // tablas que la integración ve solo por nombre
  otras: string[]; // nombres de las demás tablas vistas al recorrer (solo tras un refresco)
  generado: string;
};

export const ROLES_BASE = ["ideas", "tareas", "proyectos", "delegaciones"] as const;

const PISTAS_ROL: Record<string, string[]> = {
  ideas: ["idea", "inbox", "brainstorm", "parking", "nota"],
  tareas: ["task", "tarea", "to do", "to-do", "pendiente"],
  proyectos: ["proyecto", "project"],
  delegaciones: ["delegaci", "delegation", "encargo", "asignaci"],
  equipo: ["equipo", "team", "miembro", "personas"],
};

const PISTAS_CAMPO: Record<string, [string[], string[]]> = {
  estado: [["status", "estado", "etapa"], ["status", "select"]],
  responsable: [["responsable", "asignado", "assigned", "assignee", "owner", "a quién", "a quien", "dueño", "person"], ["people", "select", "multi_select"]],
  fecha: [["fecha", "date", "due", "deadline", "límite", "limite", "vence", "entrega"], ["date"]],
  prioridad: [["prioridad", "priority", "urgen", "importan"], ["select", "status"]],
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
    if (t === "relation") c.base_relacionada = p.relation?.data_source_id ?? p.relation?.database_id;
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

// Bloques que pueden tener tablas dentro (columnas, toggles, etc.)
const CONTENEDORES = new Set(["column_list", "column", "toggle", "synced_block", "callout", "quote", "bulleted_list_item", "numbered_list_item"]);

/** Ejecuta fn sobre cada elemento con como máximo `n` llamadas a la vez (Notion permite ~3/s). */
async function enLotes<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(fn))));
  return out;
}

/**
 * Recorre las páginas compartidas buscando tablas (child_database), incluidas las vistas
 * enlazadas. Hace falta porque el buscador de Notion tarda en indexar lo recién compartido
 * y no devuelve las vistas enlazadas que usa E-COMMERCE. Va por niveles, de 3 en 3.
 */
async function idsDeTablas(raices: string[]): Promise<Set<string>> {
  const tablas = new Set<string>();
  const vistos = new Set<string>();
  let nivel = raices;
  let presupuesto = 80; // llamadas máximas a /blocks
  for (let prof = 0; prof <= 3 && nivel.length && presupuesto > 0; prof++) {
    const tanda = nivel.filter((id) => !vistos.has(id)).slice(0, presupuesto);
    tanda.forEach((id) => vistos.add(id));
    presupuesto -= tanda.length;
    const siguientes: string[] = [];
    const resultados = await enLotes(tanda, 3, (id) => hijos(id).catch(() => [] as Json[]));
    for (const bloques of resultados) {
      for (const b of bloques) {
        if (b.type === "child_database") tablas.add(b.id);
        else if (b.type === "child_page" || (b.has_children && CONTENEDORES.has(b.type))) siguientes.push(b.id);
      }
    }
    nivel = siguientes;
  }
  return tablas;
}

/** Recorre E-COMMERCE y elige la tabla de cada rol por su nombre (la de nombre más corto gana). */
async function descubrirRoles(): Promise<{ roles: Record<string, string>; otras: string[] }> {
  const nombres = new Map<string, string>(); // id de data source → nombre
  const [indexadas, paginas] = await Promise.all([fuentesCompartidas().catch(() => []), paginasCompartidas().catch(() => [])]);
  for (const f of indexadas) nombres.set(f.id, textoPlano(f.title));
  const raices = [RAIZ, ...paginas.filter((p) => p.parent?.type === "workspace").map((p) => p.id)];
  const tablas = [...(await idsDeTablas([...new Set(raices.map(sinGuiones))]))];
  const bases = await enLotes(tablas, 3, (id) => baseDeDatos(id).catch(() => null));
  for (const b of bases) for (const ds of b?.data_sources ?? []) nombres.set(ds.id, ds.name ?? "");

  const roles: Record<string, string> = {};
  for (const [id, nombre] of nombres) {
    const rol = adivinarRol(nombre);
    if (rol && (!roles[rol] || nombre.length < (nombres.get(roles[rol]) ?? "").length)) roles[rol] = id;
  }
  const otras = [...new Set([...nombres.values()].filter(Boolean))].sort();
  return { roles, otras };
}

async function construir(refrescar: boolean): Promise<Mapa> {
  const me = await yo();
  let personas: Persona[] = [];
  try {
    personas = (await usuarios()).map((u) => ({ id: u.id, nombre: u.name ?? "?", email: u.person?.email ?? "" }));
  } catch {
    // La integración puede no tener permiso de leer usuarios: se sigue sin responsables.
  }

  // 1) Qué tabla es cada rol: lo recordado en Neon, o se recorre E-COMMERCE (lento) y se guarda.
  let roles = refrescar ? {} : await leerRolesGuardados();
  let otras: string[] = [];
  if (!Object.keys(roles).length) {
    ({ roles, otras } = await descubrirRoles());
    await guardarRoles(roles);
  }
  // Lo fijado a mano en Vercel manda
  for (const [rol, id] of Object.entries(jsonEnv("NOTION_ROLES"))) roles[rol] = id;

  // 2) Esquema solo de las tablas con rol. Si Notion deja ver el nombre pero no los campos,
  //    la tabla original vive fuera de lo compartido: se avisa en pantalla.
  const bases: Record<string, Base> = {};
  const sinAcceso: string[] = [];
  const ids = [...new Set(Object.values(roles))];
  const fuentes = await enLotes(ids, 3, (id) => fuente(id).catch(() => null));
  fuentes.forEach((f, i) => {
    if (!f || f.archived || f.in_trash) return;
    if (!f.properties || !Object.keys(f.properties).length) {
      sinAcceso.push(textoPlano(f.title) || ids[i]);
      return;
    }
    const esq = esquemaDe(f);
    bases[esq.id] = esq;
  });
  const rolesValidos = Object.fromEntries(Object.entries(roles).filter(([, id]) => bases[id]));

  // Notion no lista a los invitados (p. ej. Hamlet) en /users: se toman también las
  // personas que ya aparecen asignadas en las tareas.
  if (rolesValidos.tareas) {
    try {
      for (const fila of await consultar(rolesValidos.tareas, null, undefined, 100)) {
        for (const p of Object.values<Json>(fila.properties ?? {})) {
          if (p.type !== "people") continue;
          for (const u of p.people ?? []) {
            if (u.id && u.name && !personas.some((x) => x.id === u.id)) personas.push({ id: u.id, nombre: u.name, email: u.person?.email ?? "" });
          }
        }
      }
    } catch {
      // no es crítico
    }
  }

  return {
    workspace: me.bot?.workspace_name ?? "(desconocido)",
    bases,
    roles: rolesValidos,
    personas,
    alias_personas: jsonEnv("NOTION_ALIAS_PERSONAS"),
    sin_acceso: sinAcceso,
    otras,
    generado: new Date().toISOString(),
  };
}

let cache: { mapa: Mapa; hasta: number; llave: string | null } | null = null;

export async function obtenerMapa(refrescar = false): Promise<Mapa> {
  const llave = await leerTokenNotion();
  if (!refrescar && cache && cache.llave === llave && cache.hasta > Date.now()) return cache.mapa;
  const mapa = await construir(refrescar);
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
    sinAcceso: m.sin_acceso,
    otras: m.otras,
    faltan: ROLES_BASE.filter((r) => !m.roles[r]),
  };
}
