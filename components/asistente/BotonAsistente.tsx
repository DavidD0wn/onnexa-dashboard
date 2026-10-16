"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic } from "lucide-react";

/** Botón flotante en toda la app: abre el asistente con el micrófono ya escuchando. */
export function BotonAsistente() {
  const ruta = usePathname();
  if (ruta.startsWith("/asistente") || ruta.startsWith("/entrar")) return null;
  return (
    <Link
      href="/asistente?escuchar=1"
      title="Hablar con el asistente"
      aria-label="Hablar con el asistente"
      className="fixed z-40 bottom-5 right-5 w-12 h-12 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105"
      style={{ background: "#0E766E", boxShadow: "0 6px 20px rgba(14,118,110,0.35)" }}
    >
      <Mic size={20} />
    </Link>
  );
}
