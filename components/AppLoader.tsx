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

const SESSION_KEY = "onnexa_loaded_v2";

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
    { id: "meta",     label: "Meta Ads",         sublabel: "Sincronizando campañas y gasto (30 días)", status: "waiting" },
    { id: "shopify",  label: "Ventas Shopify",    sublabel: "Sincronizando órdenes de Glowmmi y Balancea", status: "waiting" },
    { id: "rollup",   label: "Dashboard",         sublabel: "Consolidando métricas y KPIs", status: "waiting" },
  ]);

  const ranRef = useRef(false);

  const updateStep = (id: string, patch: Partial<Step>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // If already loaded this session, skip splash immediately
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_KEY)) {
      setDone(true);
      return;
    }

    setShow(true);

    // Allow skip after 15s
    const skipTimer = setTimeout(() => setCanSkip(true), 15000);

    const run = async () => {
      // Use local date (not UTC) — avoids requesting "tomorrow" from Meta at night
      const localStr = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const today = localStr(new Date());
      const from30d = new Date(); from30d.setDate(from30d.getDate() - 30);
      const from30 = localStr(from30d);

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
          body: JSON.stringify({ store: "glowmmi", days: 30 }),
        });
        const d1 = await r1.json().catch(() => ({}));
        // Balancea second (after glowmmi finishes to avoid concurrent DB writes)
        await fetch("/api/shopify/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: "balancea", days: 30 }),
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
      if (typeof window !== "undefined") sessionStorage.setItem(SESSION_KEY, "1");
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
                Sincronizando datos frescos · solo una vez por sesión
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
