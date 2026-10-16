// app/api/asistente/route.ts
// Un turno del asistente de voz. Protegido por el PIN (proxy.ts).
//   { texto, historial }        → el cerebro decide; si no requiere confirmación, ejecuta en Notion.
//   { ejecutar: acciones, ... } → Fernanda pulsó "Confirmar": se ejecutan las acciones propuestas.
// El historial vive en el cliente (últimos 10 turnos); aquí se devuelve lo que hay que añadirle.
import { NextResponse } from "next/server";
import { obtenerMapa } from "@/lib/asistente/mapa";
import { Ejecutor, mensajeFinal, pendientesDeConfirmar, pensar, type Accion, type Turno } from "@/lib/asistente/cerebro";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TIPOS = new Set(["crear", "actualizar", "comentar", "archivar", "consultar"]);
const OK_JSON = JSON.stringify({ respuesta: "ok", pregunta: null, necesita_confirmacion: false, acciones: [] });

function nota(resumen: string): Turno[] {
  return [
    { role: "user", content: `[sistema] Resultado de la ejecución: ${resumen}` },
    { role: "assistant", content: OK_JSON },
  ];
}

function limpiarHistorial(h: unknown): Turno[] {
  if (!Array.isArray(h)) return [];
  return h
    .filter((t) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-10)
    .map((t) => ({ role: t.role, content: String(t.content).slice(0, 4000) }));
}

export async function POST(req: Request) {
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json(
      { error: "Todavía no está conectado Notion: falta la llave (NOTION_TOKEN) de la integración de Fernanda.", sinNotion: true },
      { status: 503 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const historial = limpiarHistorial(body.historial);

  try {
    const mapa = await obtenerMapa();
    const ejecutor = new Ejecutor(mapa);

    // ── Confirmación de acciones propuestas en el turno anterior ──
    if (Array.isArray(body.ejecutar)) {
      const acciones = (body.ejecutar as Accion[]).filter((a) => a && TIPOS.has(a.tipo)).slice(0, 5);
      const resultados = await ejecutor.ejecutarTodo(acciones);
      const mensaje = mensajeFinal({ respuesta: "Listo, hecho.", pregunta: null, necesita_confirmacion: false, acciones }, resultados);
      return NextResponse.json({
        respuesta: mensaje,
        resultados,
        historial: nota("La jefa confirmó. " + resultados.map((r) => r.texto).join(" | ")),
      });
    }

    // ── Turno normal ──
    const texto = String(body.texto ?? "").trim().slice(0, 2000);
    if (!texto) return NextResponse.json({ error: "No llegó texto." }, { status: 400 });

    const { plan, crudo } = await pensar(mapa, texto, historial);
    const turno: Turno[] = [
      { role: "user", content: texto },
      { role: "assistant", content: crudo },
    ];

    const avisos = pendientesDeConfirmar(mapa, plan.acciones);
    if (plan.acciones.length && (avisos.length || plan.necesita_confirmacion)) {
      return NextResponse.json({
        respuesta: avisos.length ? `Voy a ${avisos.join(" y ")}.` : plan.respuesta || "¿Lo hago?",
        pendientes: plan.acciones,
        historial: turno,
      });
    }
    if (plan.pregunta) {
      const frase = plan.respuesta.includes("?") ? plan.respuesta : plan.pregunta;
      return NextResponse.json({ respuesta: frase, pregunta: true, historial: turno });
    }
    if (!plan.acciones.length) {
      // Pidió confirmar pero no mandó qué ejecutar: no se puede ofrecer el botón.
      const respuesta = plan.necesita_confirmacion ? "Dímelo otra vez con el nombre exacto y te lo confirmo." : plan.respuesta || "Listo.";
      return NextResponse.json({ respuesta, historial: turno });
    }

    const resultados = await ejecutor.ejecutarTodo(plan.acciones);
    return NextResponse.json({
      respuesta: mensajeFinal(plan, resultados),
      resultados,
      historial: [...turno, ...nota(resultados.map((r) => r.texto).join(" | "))],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[asistente]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
