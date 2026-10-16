// proxy.ts — PIN solo para el asistente de voz (/automatizaciones/asistente y /api/asistente).
// El resto de la app, los crons de Vercel y los webhooks NO pasan por aquí:
// el matcher se limita a esas rutas a propósito.
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESION, sesionValida } from "@/lib/asistente/sesion";

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(COOKIE_SESION)?.value;
  if (await sesionValida(token)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sesión vencida. Vuelve a entrar con el PIN." }, { status: 401 });
  }
  const url = new URL("/entrar", req.url);
  url.searchParams.set("volver", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/automatizaciones/asistente", "/automatizaciones/asistente/:path*", "/api/asistente", "/api/asistente/:path*"],
};
