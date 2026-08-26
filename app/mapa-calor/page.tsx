"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Flame, Loader2, Clock } from "lucide-react";
import { useFilters } from "@/lib/filters";

interface HeatData {
  countGrid: number[][]; revGrid: number[][];
  byHour: number[]; byWeekday: number[]; revByHour: number[]; revByWeekday: number[];
  peak: { wd: number; hr: number; count: number; rev: number };
  totalOrders: number; totalRevenue: number; currencies: string[];
  perStore: Array<{ key: string; brandName: string; color: string; orders: number }>;
  errores: string[];
}

const BRANDS = [
  { label: "Todas", value: "all", color: "#7C5CFF" },
  { label: "Glowmmi", value: "glowmmi", color: "#EC4899" },
  { label: "Balancea", value: "balancea", color: "#10B981" },
  { label: "Pleena", value: "pleena", color: "#8B5CF6" },
];
const TZS = [
  { label: "México (Centro)", value: -6 },
  { label: "México (Pacífico)", value: -7 },
  { label: "EE.UU. Este", value: -5 },
  { label: "EE.UU. Pacífico", value: -8 },
];
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const C = { card: "var(--card)", bg: "var(--bg-2)", border: "var(--border)", text: "var(--text)", muted: "var(--text-3)", accent: "#7C5CFF" };
const hLabel = (h: number) => `${String(h).padStart(2, "0")}h`;
const franja = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;

export default function MapaCalorPage() {
  const { days, isCustom, customFrom, customTo } = useFilters();
  const [brand, setBrand] = useState("all");
  const [tz, setTz] = useState(-6);
  const [metric, setMetric] = useState<"orders" | "rev">("orders");
  const [data, setData] = useState<HeatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    setLoading(true); setErr("");
    const p = new URLSearchParams();
    p.set("brand", brand); p.set("tz", String(tz));
    if (isCustom && customFrom && customTo) { p.set("from", customFrom); p.set("to", customTo); }
    else p.set("days", String(days));
    fetch(`/api/analytics/heatmap?${p}`).then((r) => r.json()).then((d) => {
      if (d.error) { setErr(d.error); setData(null); } else setData(d);
    }).catch((e) => setErr(e?.message ?? "Error de red")).finally(() => setLoading(false));
  }, [brand, tz, days, isCustom, customFrom, customTo]);
  useEffect(() => { load(); }, [load]);

  const grid = metric === "orders" ? data?.countGrid : data?.revGrid;
  const maxCell = useMemo(() => {
    if (!grid) return 0;
    let m = 0; for (const row of grid) for (const v of row) if (v > m) m = v;
    return m;
  }, [grid]);
  const cur = data?.currencies?.[0] ?? "MXN";
  const mixed = (data?.currencies?.length ?? 0) > 1;

  // escala de color morado (0 → transparente, max → accent sólido)
  const cellColor = (v: number) => {
    if (!v || maxCell === 0) return "transparent";
    const t = Math.pow(v / maxCell, 0.7); // gamma para que lo bajo se note
    return `rgba(124, 92, 255, ${0.08 + t * 0.92})`;
  };
  const fmtV = (v: number) => metric === "orders" ? String(Math.round(v)) : `$${Math.round(v).toLocaleString("es-MX")}`;

  return (
    <div style={{ padding: "24px 32px", width: "100%", background: "var(--bg)", minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Flame size={22} style={{ color: C.accent }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: C.text }}>Mapa de Calor de Ventas</h1>
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>A qué horas y días vendes más → cuándo pausar ads y mandar correos</p>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {BRANDS.map((b) => (
            <button key={b.value} onClick={() => setBrand(b.value)} className="filter-pill"
              style={brand === b.value ? { background: b.color, borderColor: b.color, color: "#fff" } : {}}>{b.label}</button>
          ))}
        </div>
      </div>

      {/* Controles */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Clock size={14} style={{ color: C.muted }} />
          <select value={tz} onChange={(e) => setTz(Number(e.target.value))}
            style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            {TZS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 4, background: C.bg, padding: 3, borderRadius: 9, border: `1px solid ${C.border}` }}>
          {([["orders", "Órdenes"], ["rev", "Ingresos"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setMetric(v)}
              style={{ padding: "6px 14px", borderRadius: 7, border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: metric === v ? C.accent : "transparent", color: metric === v ? "#fff" : C.muted }}>{l}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.muted }}>Usa el selector de fechas de arriba para cambiar el periodo</span>
      </div>

      {loading && <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 50, textAlign: "center", color: C.muted }}>
        <Loader2 size={26} className="animate-spin" style={{ color: C.accent, margin: "0 auto 10px" }} />
        <p style={{ fontSize: 13, margin: 0 }}>Jalando órdenes de Shopify y armando el mapa…</p></div>}

      {err && <div style={{ background: "var(--red-bg)", color: "var(--red)", border: "1px solid var(--red)", borderRadius: 10, padding: "12px 16px", fontSize: 13 }}>❌ {err}</div>}

      {data && !loading && (
        <>
          {/* Resumen */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <Stat label="Órdenes en el periodo" value={String(data.totalOrders)} />
            <Stat label={`Ingresos (${mixed ? "mixto" : cur})`} value={`$${Math.round(data.totalRevenue).toLocaleString("es-MX")}`} />
            <Stat label="Franja más caliente" value={data.peak.count > 0 ? `${DAYS[data.peak.wd]} ${franja(data.peak.hr)}` : "—"}
              sub={data.peak.count > 0 ? `${data.peak.count} órdenes` : ""} accent />
          </div>

          {data.totalOrders === 0 ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
              No hay órdenes en este periodo/tienda. Prueba un rango más amplio arriba.
            </div>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 16px", overflowX: "auto" }}>
              {/* Rejilla */}
              <div style={{ minWidth: 720 }}>
                {/* encabezado de horas */}
                <div style={{ display: "grid", gridTemplateColumns: `44px repeat(24, 1fr) 52px`, gap: 3, marginBottom: 3 }}>
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} style={{ fontSize: 9, color: C.muted, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{h % 3 === 0 ? h : ""}</div>
                  ))}
                  <div style={{ fontSize: 9, color: C.muted, textAlign: "center", alignSelf: "center" }}>Total</div>
                </div>
                {DAYS.map((dl, d) => {
                  const rowTotal = data.byWeekday[d];
                  const rowRev = data.revByWeekday[d];
                  return (
                    <div key={d} style={{ display: "grid", gridTemplateColumns: `44px repeat(24, 1fr) 52px`, gap: 3, marginBottom: 3 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.text, display: "flex", alignItems: "center" }}>{dl}</div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const v = grid![d][h];
                        return (
                          <div key={h} title={`${dl} ${franja(h)} · ${grid === data.countGrid ? "" : ""}${data.countGrid[d][h]} órdenes · $${Math.round(data.revGrid[d][h]).toLocaleString("es-MX")}`}
                            style={{ aspectRatio: "1", borderRadius: 3, background: cellColor(v), border: `1px solid ${v ? "transparent" : "var(--border)"}`,
                              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8,
                              color: v / (maxCell || 1) > 0.55 ? "#fff" : "transparent", fontWeight: 700 }}>
                            {v ? (metric === "orders" ? v : "") : ""}
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textAlign: "right", alignSelf: "center", fontVariantNumeric: "tabular-nums" }}>
                        {metric === "orders" ? rowTotal : `$${Math.round(rowRev / 1000)}k`}
                      </div>
                    </div>
                  );
                })}
                {/* fila de totales por hora */}
                <div style={{ display: "grid", gridTemplateColumns: `44px repeat(24, 1fr) 52px`, gap: 3, marginTop: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                  <div style={{ fontSize: 9, color: C.muted, alignSelf: "center" }}>Total</div>
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} style={{ fontSize: 8, color: C.muted, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {(metric === "orders" ? data.byHour[h] : Math.round(data.revByHour[h] / 1000)) || ""}
                    </div>
                  ))}
                  <div />
                </div>
              </div>

              {/* Leyenda */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 11, color: C.muted }}>
                <span>Menos</span>
                {[0.12, 0.3, 0.5, 0.72, 1].map((t) => (
                  <div key={t} style={{ width: 22, height: 12, borderRadius: 3, background: `rgba(124,92,255,${0.08 + t * 0.92})` }} />
                ))}
                <span>Más</span>
                <span style={{ marginLeft: 12 }}>· {metric === "orders" ? "número de órdenes" : `ingresos ${mixed ? "(monedas mixtas)" : cur}`} por franja</span>
              </div>
            </div>
          )}

          {data.errores?.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "var(--red)" }}>⚠️ {data.errores.join(" · ")}</div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${accent ? C.accent : C.border}`, borderRadius: 12, padding: "14px 18px", minWidth: 160, flex: 1 }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? C.accent : C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
