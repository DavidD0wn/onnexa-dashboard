// app/api/asistente/notion/route.ts
// POST { token } → prueba la llave contra Notion, la guarda y devuelve lo que ve (conecta al instante).
import { mensajeSeguro } from "@/lib/asistente/errores";
import { NextResponse } from "next/server";
import { NotionError, probarLlave } from "@/lib/notion";
import { guardarTokenNotion } from "@/lib/asistente/config";
import { obtenerMapa, resumenMapa } from "@/lib/asistente/mapa";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // al conectar se recorre E-COMMERCE completo

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const llave = String(token ?? "").trim();
  if (!/^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(llave)) {
    return NextResponse.json({ error: "Esa no parece una llave de Notion: debe empezar por ntn_ o secret_." }, { status: 400 });
  }
  try {
    await probarLlave(llave);
  } catch (e) {
    const rechazada = e instanceof NotionError && /Notion 40[13]/.test(e.message);
    const error = rechazada
      ? "Notion rechazó la llave. Revisa que la copiaste completa."
      : `No se pudo hablar con Notion: ${mensajeSeguro(e)}`;
    return NextResponse.json({ error }, { status: 400 });
  }
  try {
    await guardarTokenNotion(llave);
    return NextResponse.json({ conectado: true, ...resumenMapa(await obtenerMapa(true)) });
  } catch (e) {
    return NextResponse.json({ error: mensajeSeguro(e) }, { status: 500 });
  }
}

