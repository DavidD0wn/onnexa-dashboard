// app/api/mcp/route.ts
// Servidor MCP (Streamable HTTP, sin estado) del asistente de Notion, para usarlo desde
// Claude Code o cualquier cliente MCP:  claude mcp add --transport http notion-asistente <url>/api/mcp
// Es JSON-RPC a mano, sin SDK: solo initialize, tools/list y tools/call.
// - asistente_notion / asistente_confirmar: el asistente completo (lenguaje natural + confirmación).
// - notion_*: operaciones directas y deterministas, para clientes que ya tienen su propio modelo.
import { POST as turno } from "../asistente/route";
import { obtenerMapa } from "@/lib/asistente/mapa";
import { Ejecutor, pendientesDeConfirmar, type Accion } from "@/lib/asistente/cerebro";
import { NextRequest, NextResponse } from "next/server";
import { GET as marcas } from "../brands/route";
import { GET as dashboard } from "../dashboard/route";
import { GET as pyl } from "../p-and-l/route";
import { GET as ads } from "../meta-ads/insights/route";
import { GET as productos } from "../products/analytics/route";
import { GET as ltv } from "../ltv/route";
import { GET as contracargos } from "../chargebacks/route";

// Datos de la app (solo lectura): se llama al mismo handler GET que usa el dashboard,
// así los números son idénticos. Montos en USD.
const FECHAS = { from: "Desde, AAAA-MM-DD", to: "Hasta, AAAA-MM-DD" };
const DATOS: Record<string, { get: (req: NextRequest) => Promise<Response>; descripcion: string; params: Record<string, string> }> = {
  app_marcas: { get: () => marcas(), descripcion: "Marcas (Glowmmi, Balancea, Pleena…) y países con sus ids. Úsalo para saber qué id pasar en brand/brandId/country.", params: {} },
  app_dashboard: {
    get: dashboard,
    descripcion: "KPIs del dashboard: ventas, pedidos, gasto en ads, ROAS, márgenes, por día. Montos en USD.",
    params: { brand: "Id de marca (opcional, ver app_marcas)", country: "Id de país (opcional)", ...FECHAS, days: "Últimos N días si no hay from/to" },
  },
  app_pyl: {
    get: pyl,
    descripcion: "Estado de resultados (P&L): ingresos, COGS, envío, comisiones, ads, costos fijos y utilidad. USD.",
    params: { brand: "Id de marca (opcional)", ...FECHAS, granularity: "day | week | month" },
  },
  app_ads: {
    get: ads,
    descripcion: "Meta Ads por campaña: gasto, compras, ROAS, CPA y estado.",
    params: { brandId: "Id de marca (opcional)", dateFrom: "Desde, AAAA-MM-DD", dateTo: "Hasta, AAAA-MM-DD" },
  },
  app_productos: {
    get: productos,
    descripcion: "Analítica por producto: unidades, ingreso, COGS, margen y gasto atribuido. Puede ser una respuesta grande.",
    params: { brandId: "Id de marca (opcional)", country: "Id de país (opcional)", ...FECHAS, days: "Últimos N días si no hay from/to" },
  },
  app_ltv: { get: ltv, descripcion: "Valor de vida del cliente (LTV), recompra y cohortes.", params: { brand: "Id de marca (opcional)", ...FECHAS } },
  app_contracargos: { get: contracargos, descripcion: "Contracargos (disputas) registrados.", params: { brandId: "Id de marca (opcional)", ...FECHAS, days: "Últimos N días" } },
};

async function datos(nombre: string, args: Record<string, unknown> = {}) {
  const url = new URL("http://mcp/");
  for (const [k, v] of Object.entries(args)) if (v != null && v !== "" && k in DATOS[nombre].params) url.searchParams.set(k, String(v));
  const r = await DATOS[nombre].get(new NextRequest(url));
  const texto = await r.text();
  // shortcut: corta respuestas enormes a 100k caracteres; si hace falta más, pedir rangos de fecha más cortos.
  return { content: [{ type: "text", text: texto.length > 100_000 ? texto.slice(0, 100_000) + "\n…[recortado: pide un rango más corto]" : texto }], isError: !r.ok };
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROL = { type: "string", description: "Rol de la tabla: ideas, tareas o proyectos (ver notion_bases)." };
const HERRAMIENTAS = [
  {
    name: "asistente_notion",
    description:
      "Habla con el asistente de Notion de Fernanda (E-COMMERCE): crea, actualiza, comenta, archiva o consulta ideas, tareas y proyectos en lenguaje natural. " +
      "Si la respuesta trae `pendientes`, la acción requiere confirmación: pregúntale al usuario y luego llama a asistente_confirmar con esas acciones.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Lo que se le dice al asistente, en español." },
        historial: { type: "array", description: "Turnos anteriores devueltos por esta misma herramienta (opcional).", items: { type: "object" } },
      },
      required: ["texto"],
    },
  },
  {
    name: "asistente_confirmar",
    description: "Ejecuta las acciones `pendientes` que devolvió asistente_notion, una vez que el usuario confirmó.",
    inputSchema: {
      type: "object",
      properties: { acciones: { type: "array", items: { type: "object" } } },
      required: ["acciones"],
    },
  },
  {
    name: "notion_bases",
    description: "Lista las tablas que ve el asistente: rol (ideas, tareas, proyectos), título y campos con sus opciones. Úsalo antes de crear o consultar.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "notion_consultar",
    description:
      'Consulta filas de una tabla. filtro es un objeto con nombres de campo exactos: {"Status": "Completed"} para igual, ' +
      '{"Status": {"distinto": "Completed"}} para excluir. limite: máximo 100 (por defecto 10).',
    inputSchema: {
      type: "object",
      properties: { base: ROL, filtro: { type: "object" }, limite: { type: "number" } },
      required: ["base"],
    },
  },
  {
    name: "notion_crear",
    description: "Crea una fila en una tabla. propiedades usa los nombres de campo exactos de notion_bases (el título va en el campo de título).",
    inputSchema: {
      type: "object",
      properties: {
        base: ROL,
        propiedades: { type: "object" },
        contenido: { type: "string", description: "Texto opcional del cuerpo de la página." },
        confirmar: { type: "boolean", description: "Solo true después de que el usuario confirmó la vista previa." },
      },
      required: ["base", "propiedades"],
    },
  },
  {
    name: "notion_comentar",
    description: "Agrega un comentario a una fila, buscándola por parte de su título.",
    inputSchema: {
      type: "object",
      properties: {
        base: ROL,
        buscar: { type: "string" },
        texto: { type: "string" },
        confirmar: { type: "boolean", description: "Solo true después de que el usuario confirmó la vista previa." },
      },
      required: ["base", "buscar", "texto"],
    },
  },
];

HERRAMIENTAS.push(
  ...Object.entries(DATOS).map(([name, d]) => ({
    name,
    description: d.descripcion,
    inputSchema: { type: "object", properties: Object.fromEntries(Object.entries(d.params).map(([k, desc]) => [k, { type: "string", description: desc }])) } as any,
  })),
);

const DIRECTAS = new Set(["notion_bases", "notion_consultar", "notion_crear", "notion_comentar"]);

async function directa(nombre: string, a: any) {
  const mapa = await obtenerMapa();
  if (nombre === "notion_bases") {
    const bases = Object.values(mapa.bases)
      .map((b) => ({ rol: Object.entries(mapa.roles).find(([, id]) => id === b.id)?.[0] ?? null, titulo: b.titulo, campos: Object.entries(b.campos).map(([n, c]) => ({ nombre: n, tipo: c.tipo, opciones: c.opciones })) }))
      .filter((b) => b.rol);
    return { ok: true, texto: JSON.stringify(bases) };
  }
  if (typeof a?.base !== "string") return { ok: false, texto: "Falta base (ideas, tareas o proyectos)." };
  const accion: Accion =
    nombre === "notion_consultar"
      ? { tipo: "consultar", base: a.base, filtro: a.filtro ?? null, limite: a.limite }
      : nombre === "notion_crear"
        ? { tipo: "crear", base: a.base, propiedades: a.propiedades ?? {}, contenido: a.contenido }
        : { tipo: "comentar", base: a.base, buscar: a.buscar, texto: a.texto };
  // Cualquier escritura primero muestra la vista previa; no escribe hasta confirmar: true.
  if (nombre !== "notion_consultar" && a.confirmar !== true) {
    const cambios = pendientesDeConfirmar(mapa, [accion]);
    return { ok: true, texto: `NO SE HIZO NADA. Voy a ${cambios.join(" y ")}. Pide confirmación al usuario y vuelve a llamar con confirmar: true.` };
  }
  const [res] = await new Ejecutor(mapa).ejecutarTodo([accion]);
  return res;
}

async function llamar(nombre: string, args: any) {
  if (nombre in DATOS) return datos(nombre, args);
  if (DIRECTAS.has(nombre)) {
    const res = await directa(nombre, args);
    return { content: [{ type: "text", text: res.texto }], isError: !res.ok };
  }
  const body = nombre === "asistente_confirmar" ? { ejecutar: args?.acciones ?? [] } : { texto: args?.texto, historial: args?.historial };
  const r = await turno(new Request("http://mcp/api/asistente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const data = await r.json();
  return { content: [{ type: "text", text: JSON.stringify(data) }], isError: !r.ok };
}

// Sin llave: la usan solo Fernanda y Hamlet. Las escrituras siguen pidiendo confirmación.
export async function POST(req: Request) {
  const msg = await req.json().catch(() => null);
  if (!msg || msg.jsonrpc !== "2.0") return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON-RPC inválido" } }, { status: 400 });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notificaciones (p. ej. notifications/initialized)

  const ok = (result: any) => NextResponse.json({ jsonrpc: "2.0", id: msg.id, result });
  try {
    switch (msg.method) {
      case "initialize":
        return ok({ protocolVersion: msg.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "notion-asistente", version: "1.1.0" } });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: HERRAMIENTAS });
      case "tools/call":
        if (!HERRAMIENTAS.some((h) => h.name === msg.params?.name)) return ok({ content: [{ type: "text", text: `No existe la herramienta ${msg.params?.name}` }], isError: true });
        return ok(await llamar(msg.params.name, msg.params.arguments));
      default:
        return NextResponse.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Método no soportado: ${msg.method}` } });
    }
  } catch (e) {
    return NextResponse.json({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
  }
}

// Sin sesiones ni stream: el cliente trabaja solo con POST.
export const GET = () => new Response(null, { status: 405 });
export const DELETE = () => new Response(null, { status: 405 });
