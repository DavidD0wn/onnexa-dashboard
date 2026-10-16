// app/api/entrar/route.ts — valida el PIN del asistente y deja la cookie firmada.
import { NextResponse } from "next/server";
import { COOKIE_SESION, DURACION_SEG, crearSesion, pinCorrecto } from "@/lib/asistente/sesion";

export async function POST(req: Request) {
  if (!process.env.ASISTENTE_PIN) {
    return NextResponse.json({ error: "Falta configurar ASISTENTE_PIN en Vercel." }, { status: 503 });
  }
  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  if (!pin || !pinCorrecto(String(pin).trim())) {
    await new Promise((r) => setTimeout(r, 1200)); // frena los intentos a ciegas
    return NextResponse.json({ error: "PIN incorrecto." }, { status: 401 });
  }
  const token = await crearSesion();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESION, token!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACION_SEG,
  });
  return res;
}
