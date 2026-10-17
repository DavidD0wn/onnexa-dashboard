// app/api/mcp/route.ts
// Servidor MCP (Streamable HTTP, sin estado) de Onnexa para Claude, ChatGPT o cualquier cliente MCP:
//   claude mcp add --transport http onnexa <url>/api/mcp
// JSON-RPC a mano, sin SDK: initialize, tools/list y tools/call.
// No usa Groq: el que piensa es el modelo del cliente (Claude/ChatGPT, con sus tokens); aquí solo se
// ejecuta. Las reglas y la memoria del asistente se le entregan en `instructions` y en asistente_reglas.
import { obtenerMapa } from "@/lib/asistente/mapa";
import { Ejecutor, completarTarea, pendientesDeConfirmar, type Accion } from "@/lib/asistente/cerebro";
import { NextResponse } from "next/server";
import { DATOS, consultarDatos } from "@/lib/asistente/datos";
import { REGLAS_ASISTENTE } from "@/lib/asistente/reglas";
import { guardarAprendizaje, leerAprendizajes } from "@/lib/asistente/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
const ROL = { type: "string", description: "Rol de la tabla: ideas, tareas o proyectos (ver notion_bases)." };
const BUSCAR = { type: "string", description: "Parte del título de la fila a localizar." };
const CONFIRMAR = { type: "boolean", description: "Solo true después de que el usuario confirmó la vista previa." };

const INSTRUCCIONES =
  "Servidor de Onnexa (tiendas Glowmmi, Balancea y Pleena de María Fernanda Rey). " +
  "Antes de escribir en Notion llama a asistente_reglas: trae las reglas y lo que Fernanda le ha enseñado al asistente, con prioridad. " +
  "Toda tarea nueva va con Status Delegada, Create Date (hoy si no dicen otra) y Assigned To; si no dicen para quién, pregunta. " +
  "Toda escritura (notion_crear, notion_actualizar, notion_comentar, notion_archivar) primero devuelve una vista previa: muéstrasela al usuario y repite la llamada con confirmar: true solo si dice que sí. " +
  "Si el usuario te corrige o dice 'recuerda que…', guárdalo con asistente_recordar. " +
  "Para números (ventas, gasto, ROAS, P&L, productos, LTV) usa las herramientas app_*; montos en USD; no inventes cifras.";

const HERRAMIENTAS: any[] = [
  {
    name: "asistente_reglas",
    description: "Reglas del asistente y lo que Fernanda le ha enseñado (memoria). Llámala al empezar y antes de escribir en Notion.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "asistente_recordar",
    description: "Guarda en la memoria del asistente algo que Fernanda enseñó o corrigió, como una regla corta y general. Lo usan Claude, ChatGPT y el asistente de voz.",
    inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] },
  },
  {
    name: "notion_bases",
    description: "Lista las tablas de Notion: rol (ideas, tareas, proyectos), título y campos con sus opciones. Úsalo antes de crear, cambiar o consultar.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "notion_consultar",
    description:
      'Consulta filas de una tabla. filtro es un objeto con nombres de campo exactos: {"Status": "Completed"} para igual, ' +
      '{"Status": {"distinto": "Completed"}} para excluir. limite: máximo 100 (por defecto 10).',
    inputSchema: { type: "object", properties: { base: ROL, filtro: { type: "object" }, limite: { type: "number" } }, required: ["base"] },
  },
  {
    name: "notion_crear",
    description: "Crea una fila. propiedades usa los nombres de campo exactos de notion_bases (el título va en el campo de título). Primero devuelve vista previa.",
    inputSchema: {
      type: "object",
      properties: { base: ROL, propiedades: { type: "object" }, contenido: { type: "string", description: "Texto opcional del cuerpo." }, confirmar: CONFIRMAR },
      required: ["base", "propiedades"],
    },
  },
  {
    name: "notion_actualizar",
    description: "Cambia campos de una fila buscada por su título (estado, fecha, responsable, prioridad…). Primero devuelve vista previa.",
    inputSchema: { type: "object", properties: { base: ROL, buscar: BUSCAR, propiedades: { type: "object" }, confirmar: CONFIRMAR }, required: ["base", "buscar", "propiedades"] },
  },
  {
    name: "notion_comentar",
    description: "Agrega un comentario a una fila buscada por su título. Primero devuelve vista previa.",
    inputSchema: { type: "object", properties: { base: ROL, buscar: BUSCAR, texto: { type: "string" }, confirmar: CONFIRMAR }, required: ["base", "buscar", "texto"] },
  },
  {
    name: "notion_archivar",
    description: "Archiva una fila (va a la papelera de Notion, se puede recuperar). Primero devuelve vista previa.",
    inputSchema: { type: "object", properties: { base: ROL, buscar: BUSCAR, confirmar: CONFIRMAR }, required: ["base", "buscar"] },
  },
  ...Object.entries(DATOS).map(([name, d]) => ({
    name,
    description: d.descripcion,
    inputSchema: { type: "object", properties: Object.fromEntries(Object.entries(d.params).map(([k, desc]) => [k, { type: "string", description: desc }])) },
  })),
];

const TIPO: Record<string, Accion["tipo"]> = {
  notion_consultar: "consultar",
  notion_crear: "crear",
  notion_actualizar: "actualizar",
  notion_comentar: "comentar",
  notion_archivar: "archivar",
};

async function directa(nombre: string, a: any): Promise<{ ok: boolean; texto: string }> {
  if (nombre === "asistente_reglas") {
    const aprendidas = await leerAprendizajes();
    return { ok: true, texto: `REGLAS:\n${REGLAS_ASISTENTE}\n\nLO QUE FERNANDA LE ENSEÑÓ (prioridad):\n${aprendidas.map((x) => `- ${x}`).join("\n") || "(nada todavía)"}` };
  }
  if (nombre === "asistente_recordar") {
    if (!a?.texto?.trim()) return { ok: false, texto: "Falta texto." };
    await guardarAprendizaje(a.texto);
    return { ok: true, texto: `Aprendido: ${a.texto}` };
  }
  const mapa = await obtenerMapa();
  if (nombre === "notion_bases") {
    const bases = Object.values(mapa.bases)
      .map((b) => ({ rol: Object.entries(mapa.roles).find(([, id]) => id === b.id)?.[0] ?? null, titulo: b.titulo, campos: Object.entries(b.campos).map(([n, c]) => ({ nombre: n, tipo: c.tipo, opciones: c.opciones })) }))
      .filter((b) => b.rol);
    return { ok: true, texto: JSON.stringify({ bases, personas: mapa.personas.map((p) => p.nombre) }) };
  }
  if (typeof a?.base !== "string") return { ok: false, texto: "Falta base (ideas, tareas o proyectos)." };
  const accion: Accion = { tipo: TIPO[nombre], base: a.base, propiedades: a.propiedades, contenido: a.contenido, buscar: a.buscar, texto: a.texto, filtro: a.filtro ?? null, limite: a.limite };
  const falta = completarTarea(mapa, accion); // tareas: Delegada + fecha de hoy; responsable obligatorio
  if (falta) return { ok: false, texto: `${falta} Falta el campo de responsable (Assigned To).` };
  // Cualquier escritura primero muestra la vista previa; no escribe hasta confirmar: true.
  if (accion.tipo !== "consultar" && a.confirmar !== true) {
    const cambios = pendientesDeConfirmar(mapa, [accion]);
    return { ok: true, texto: `NO SE HIZO NADA. Voy a ${cambios.join(" y ")} con ${JSON.stringify(accion.propiedades ?? {})}. Pide confirmación al usuario y vuelve a llamar con confirmar: true.` };
  }
  const [res] = await new Ejecutor(mapa).ejecutarTodo([accion]);
  return res;
}

async function llamar(nombre: string, args: any) {
  const res = nombre in DATOS ? await consultarDatos(nombre, args) : await directa(nombre, args);
  return { content: [{ type: "text", text: res.texto }], isError: !res.ok };
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
        return ok({
          protocolVersion: msg.params?.protocolVersion ?? "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "onnexa", version: "2.0.0" },
          instructions: INSTRUCCIONES,
        });
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
