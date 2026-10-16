"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const volver = (() => {
    const v = params.get("volver") ?? "/automatizaciones/asistente";
    return v.startsWith("/") && !v.startsWith("//") ? v : "/automatizaciones/asistente";
  })();

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || enviando) return;
    setEnviando(true);
    setError("");
    const r = await fetch("/api/entrar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (r.ok) {
      router.replace(volver);
      return;
    }
    const d = await r.json().catch(() => ({}));
    setError(d.error ?? "No se pudo entrar.");
    setPin("");
    setEnviando(false);
  };

  return (
    <form
      onSubmit={entrar}
      className="w-full max-w-xs rounded-2xl flex flex-col gap-4"
      style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 4px 24px var(--shadow)", padding: 24 }}
    >
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text-2)" }}>
          <Lock size={16} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>Asistente</p>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>Escribe tu PIN para entrar</p>
        </div>
      </div>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder="PIN"
        className="w-full rounded-xl text-base tracking-widest outline-none"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", padding: "10px 12px" }}
      />
      {error && <p className="text-xs" style={{ color: "var(--red)" }}>{error}</p>}
      <button
        type="submit"
        disabled={enviando || !pin.trim()}
        className="rounded-xl text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: "#0E766E", padding: "10px 0" }}
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

export default function EntrarPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ padding: "0 16px" }}>
      <Suspense>
        <Formulario />
      </Suspense>
    </div>
  );
}
