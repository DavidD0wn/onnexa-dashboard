// app/api/asistente/mapa/route.ts
// Qué ve el asistente en Notion: workspace, bases con su rol, campos y personas.
// ?refrescar=1 vuelve a leer Notion (por ejemplo, después de crear una base nueva).
import { NextResponse } from "next/server";
import { obtenerMapa, resumenMapa } from "@/lib/asistente/mapa";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json({ conectado: false, motivo: "Falta NOTION_TOKEN" });
  }
  try {
    const refrescar = new URL(req.url).searchParams.get("refrescar") === "1";
    return NextResponse.json({ conectado: true, ...resumenMapa(await obtenerMapa(refrescar)) });
  } catch (e) {
    return NextResponse.json({ conectado: false, motivo: e instanceof Error ? e.message : String(e) });
  }
}
