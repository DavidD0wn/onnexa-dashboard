// app/api/mcp/route.ts
// Servidor MCP (Streamable HTTP, sin estado) del asistente de Notion, para usarlo desde
// Claude Code o cualquier cliente MCP:  claude mcp add --transport http notion-asistente <url>/api/mcp
// Es JSON-RPC a mano, sin SDK: solo initialize, tools/list y tools/call. Reutiliza el
// endpoint /api/asistente tal cual (mismo cerebro, mismas reglas, misma confirmación).
import { NextResponse } from "next/server";
import { POST as turno } from "../asistente/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */
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
];

async function llamar(nombre: string, args: any) {
  const body = nombre === "asistente_confirmar" ? { ejecutar: args?.acciones ?? [] } : { texto: args?.texto, historial: args?.historial };
  const r = await turno(new Request("http://mcp/api/asistente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const data = await r.json();
  return { content: [{ type: "text", text: JSON.stringify(data) }], isError: !r.ok };
}

export async function POST(req: Request) {
  const msg = await req.json().catch(() => null);
  if (!msg || msg.jsonrpc !== "2.0") return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON-RPC inválido" } }, { status: 400 });
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notificaciones (p. ej. notifications/initialized)

  const ok = (result: any) => NextResponse.json({ jsonrpc: "2.0", id: msg.id, result });
  try {
    switch (msg.method) {
      case "initialize":
        return ok({ protocolVersion: msg.params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "notion-asistente", version: "1.0.0" } });
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
