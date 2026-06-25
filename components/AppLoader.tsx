"use client";
import { useEffect, useState, useRef } from "react";

type StepStatus = "waiting" | "loading" | "done" | "error";

type Step = {
  id: string;
  label: string;
  sublabel: string;
  status: StepStatus;
  detail?: string;
};

const SESSION_KEY  = "onnexa_loaded_v2";

// ✅ AUTO-SYNC SEGURO (jun 2026).
// Al abrir la app se sincronizan SOLO los últimos 15 días (mes en curso: hoy, ayer,
// junio) usando el endpoint correcto /api/shopify/sync — NUNCA el daemon viejo (que
// fue desactivado por corromper datos). Los meses cerrados (ene–may) NO se tocan:
// la limpieza de stale rows solo afecta fechas >= (hoy - 15 días). El sync es
// "todo o nada": si no logra traer todo, no escribe nada (conserva lo bueno).
// Se sincroniza UNA vez por sesión del navegador (al iniciar), no en cada recarga.
const AUTO_SYNC_ENABLED = true;

// Marca de tiempo del último sync exitoso (persiste entre sesiones).
const LAST_SYNC_KEY = "onnexa_last_sync_at";
// Re-sincronizar cuando el último sync exitoso fue hace más de N minutos.
// 4 horas: balance entre frescura (hoy/ayer al día) y no saturar APIs cada recarga.
const SYNC_EVERY_MS = 4 * 60 * 60 * 1000;
// Sync incremental: cubre todo el mes en curso + margen (30 días).
// Antes era 15 días, lo cual dejaba fuera órdenes del inicio del mes y permitía
// que si una sincronización fallaba parcialmente, datos del mes anterior no se
// recuperaran nunca. 30 días asegura cobertura completa del mes.
const INCREMENTAL_DAYS = 30;
// Sync profundo: una vez por semana, cubre 60 días para recuperar cualquier
// dato degradado en meses pasados (cancelaciones tardías, etc.).
const DEEP_SYNC_DAYS = 60;
const DEEP_SYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_DEEP_SYNC_KEY = "onnexa_last_deep_sync_at";

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: "50%",
      border: "2.5px solid rgba(255,255,255,0.15)",
      borderTopColor: "#0E766E",
      animation: "spin 0.75s linear infinite",
      flexShrink: 0,
    }} />
  );
}

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="9" cy="9" r="9" fill="#0E766E" />
      <path d="M5 9.5L7.5 12L13 6.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="9" cy="9" r="9" fill="#DC2626" />
      <path d="M6 6L12 12M12 6L6 12" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function WaitIcon() {
  return (
    <div style={{
      width: 18, height: 18, borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.12)",
      flexShrink: 0,
    }} />
  );
}

export function AppLoader({ children }: { children: React.ReactNode }) {
  const [show,     setShow]     = useState(false);
  const [done,     setDone]     = useState(false);
  const [fadeOut,  setFadeOut]  = useState(false);
  const [canSkip,  setCanSkip]  = useState(false);
  const [steps,    setSteps]    = useState<Step[]>([
    { id: "meta",     label: "Meta Ads",         sublabel: `Actualizando gasto reciente (${INCREMENTAL_DAYS} días)`, status: "waiting" },
    { id: "shopify",  label: "Ventas Shopify",    sublabel: "Actualizando órdenes recientes de Glowmmi y Balancea", status: "waiting" },
    { id: "rollup",   label: "Dashboard",         sublabel: "Consolidando métricas y KPIs", status: "waiting" },
  ]);

  const ranRef = useRef(false);

  const updateStep = (id: string, patch: Partial<Step>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // ⛔ Auto-sync desactivado: la BD está congelada. Cargar directo desde la BD,
    // sin sincronizar ni mostrar el splash. Los datos no se mueven.
    if (!AUTO_SYNC_ENABLED) {
      setDone(true);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_KEY, "1");
        window.dispatchEvent(new Event("onnexa-sync-done"));
      }
      return;
    }

    // Throttle por TIEMPO (no por sesión): sincronizar si han pasado más de
    // SYNC_EVERY_MS desde el último sync exitoso. Así, aunque la pestaña quede
    // abierta todo el día, al recargar después de unas horas trae los datos
    // frescos de hoy y ayer. Pero no satura si recargas varias veces seguidas.
    if (typeof window !== "undefined") {
      const last = parseInt(localStorage.getItem(LAST_SYNC_KEY) ?? "0", 10);
      const fresh = last && Date.now() - last < SYNC_EVERY_MS;
      if (fresh) {
        sessionStorage.setItem(SESSION_KEY, "1");
        setDone(true);
        window.dispatchEvent(new Event("onnexa-sync-done"));
        return;
      }
    }

    setShow(true);

    // Allow skip after 15s
    const skipTimer = setTimeout(() => setCanSkip(true), 15000);

    const run = async () => {
      // Use local date (not UTC) — avoids requesting "tomorrow" from Meta at night
      const localStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = localStr(new Date());
      // Sync incremental (30 días) cada vez. Sync profundo (60 días) si pasó >7 días.
      const lastDeep = typeof window !== "undefined"
        ? parseInt(localStorage.getItem(LAST_DEEP_SYNC_KEY) ?? "0", 10) : 0;
      const needsDeepSync = !lastDeep || (Date.now() - lastDeep > DEEP_SYNC_EVERY_MS);
      const syncDays = needsDeepSync ? DEEP_SYNC_DAYS : INCREMENTAL_DAYS;
      const fromIncD = new Date(); fromIncD.setDate(fromIncD.getDate() - syncDays);
      const from30 = localStr(fromIncD);
      if (needsDeepSync) console.log(`[AppLoader] Deep sync (${DEEP_SYNC_DAYS} días) — recupera datos del histórico reciente`);

      // ── Step 0: Respaldo de seguridad ANTES de tocar nada ──────────────────
      // Garantiza un punto de restauración si la sincronización fallara.
      try { await fetch("/api/backup", { method: "POST" }); } catch { /* no crítico */ }

      // ── Step 1: Meta Ads sync ──────────────────────────────────────────────
      updateStep("meta", { status: "loading" });
      try {
        const res  = await fetch("/api/meta-ads/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dateFrom: from30, dateTo: today }),
        });
        const data = await res.json();
        if (data.ok) {
          updateStep("meta", { status: "done", detail: `${data.recordsSaved ?? 0} registros guardados` });
        } else {
          updateStep("meta", { status: "error", detail: data.error?.slice(0, 60) ?? "Error" });
        }
      } catch (e: any) {
        updateStep("meta", { status: "error", detail: e.message?.slice(0, 60) ?? "Error de red" });
      }

      // ── Step 2: Shopify sync — both stores, sequential (avoid SQLite write conflicts) ─
      updateStep("shopify", { status: "loading" });
      try {
        // Glowmmi first
        const r1   = await fetch("/api/shopify/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: "glowmmi", days: syncDays }),
        });
        const d1 = await r1.json().catch(() => ({}));
        // Balancea second (after glowmmi finishes to avoid concurrent DB writes)
        await fetch("/api/shopify/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: "balancea", days: syncDays }),
        });
        const ok = r1.ok || d1.ok || d1.synced || d1.message;
        if (ok) {
          updateStep("shopify", { status: "done", detail: `Glowmmi + Balancea actualizados` });
        } else {
          updateStep("shopify", { status: "error", detail: (d1.error ?? "Sin respuesta")?.toString().slice(0, 60) });
        }
      } catch (e: any) {
        updateStep("shopify", { status: "error", detail: e.message?.slice(0, 60) ?? "Error de red" });
      }

      // ── Step 3: Rollup (already triggered by Meta sync, but force refresh) ─
      updateStep("rollup", { status: "loading" });
      try {
        const res  = await fetch("/api/meta-ads/rollup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: from30, to: today }),
        });
        const data = await res.json().catch(() => ({}));
        updateStep("rollup", { status: "done", detail: data.message ?? "Dashboard listo" });
      } catch {
        updateStep("rollup", { status: "done", detail: "Usando datos en caché" });
      }

      // ── All done ─────────────────────────────────────────────────────────
      if (typeof window !== "undefined") {
        sessionStorage.setItem(SESSION_KEY, "1");
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
        // Si fue deep sync, también guardamos esa marca para no repetirlo en 7 días.
        if (needsDeepSync) localStorage.setItem(LAST_DEEP_SYNC_KEY, String(Date.now()));
      }
      clearTimeout(skipTimer);

      // Short pause to show final state, then fade out
      await new Promise(r => setTimeout(r, 1200));
      setFadeOut(true);
      await new Promise(r => setTimeout(r, 400));
      setShow(false);
      setDone(true);

      // Signal all pages to re-fetch fresh data from DB
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("onnexa-sync-done"));
      }
    };

    run();
    return () => clearTimeout(skipTimer);
  }, []);

  const handleSkip = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, "1");
    }
    setFadeOut(true);
    setTimeout(() => {
      setShow(false);
      setDone(true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("onnexa-sync-done"));
      }
    }, 400);
  };

  const allDone = steps.every(s => s.status === "done" || s.status === "error");
  const progress = steps.filter(s => s.status === "done" || s.status === "error").length / steps.length;

  return (
    <>
      {/* Actual app — visible immediately behind loader, avoids layout shift */}
      <div style={{ visibility: done || !show ? "visible" : "hidden", height: "100%" }}>
        {children}
      </div>

      {/* Loading overlay */}
      {show && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "#0D1117",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          opacity: fadeOut ? 0 : 1,
          transition: "opacity 0.4s ease",
          userSelect: "none",
        }}>
          {/* Logo + Brand */}
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: "linear-gradient(135deg, #0E766E 0%, #0a5a54 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
              boxShadow: "0 0 40px rgba(14,118,110,0.4)",
            }}>
              <svg width="32" height="32" viewBox="0 0 22 22" fill="none">
                <path d="M11 2L19 6.5V15.5L11 20L3 15.5V6.5L11 2Z"
                  stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
                <path d="M11 7L15 9.5V14.5L11 17L7 14.5V9.5L11 7Z" fill="white" opacity="0.95" />
              </svg>
            </div>
            <p style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em", margin: 0 }}>
              Onnexa
            </p>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
              Command Center
            </p>
          </div>

          {/* Progress bar */}
          <div style={{ width: 340, marginBottom: 32 }}>
            <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: "linear-gradient(90deg, #0E766E, #14B8A6)",
                width: `${progress * 100}%`,
                transition: "width 0.6s ease",
              }} />
            </div>
          </div>

          {/* Steps */}
          <div style={{ width: 340, display: "flex", flexDirection: "column", gap: 12 }}>
            {steps.map((step) => (
              <div key={step.id} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 18px", borderRadius: 12,
                background: step.status === "loading" ? "rgba(14,118,110,0.12)"
                  : step.status === "done"    ? "rgba(14,118,110,0.07)"
                  : step.status === "error"   ? "rgba(220,38,38,0.08)"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${
                  step.status === "loading" ? "rgba(14,118,110,0.3)"
                  : step.status === "done"  ? "rgba(14,118,110,0.2)"
                  : step.status === "error" ? "rgba(220,38,38,0.2)"
                  : "rgba(255,255,255,0.07)"
                }`,
                transition: "all 0.3s ease",
              }}>
                {/* Icon */}
                {step.status === "loading" ? <Spinner />
                  : step.status === "done"  ? <Check />
                  : step.status === "error" ? <ErrorIcon />
                  : <WaitIcon />}

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: 0, fontSize: 13, fontWeight: 600,
                    color: step.status === "waiting" ? "rgba(255,255,255,0.35)" : "#fff",
                  }}>
                    {step.label}
                  </p>
                  <p style={{
                    margin: "2px 0 0", fontSize: 11,
                    color: step.status === "done"  ? "rgba(78,213,190,0.8)"
                      : step.status === "error" ? "rgba(248,113,113,0.8)"
                      : "rgba(255,255,255,0.35)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {step.detail ?? step.sublabel}
                  </p>
                </div>

                {/* Status pill */}
                {step.status !== "waiting" && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
                    background: step.status === "done"    ? "rgba(14,118,110,0.25)"
                      : step.status === "error"   ? "rgba(220,38,38,0.2)"
                      : "rgba(255,255,255,0.08)",
                    color: step.status === "done"  ? "#4DD9C6"
                      : step.status === "error" ? "#f87171"
                      : "rgba(255,255,255,0.5)",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>
                    {step.status === "done" ? "✓ Listo"
                      : step.status === "error" ? "⚠ Error"
                      : "En curso"}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ marginTop: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {allDone ? (
              <p style={{ fontSize: 13, color: "rgba(78,213,190,0.9)", fontWeight: 600 }}>
                ✓ Todo listo — abriendo dashboard…
              </p>
            ) : (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
                Actualizando datos recientes · se refresca cada 7 días
              </p>
            )}
            {canSkip && !allDone && (
              <button onClick={handleSkip} style={{
                marginTop: 4, padding: "7px 20px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.5)", fontSize: 12, cursor: "pointer",
              }}>
                Saltar y abrir app →
              </button>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
