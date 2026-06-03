"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { fmtNum, fmtPct } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";
import { RefreshCw, TrendingUp, TrendingDown, Calendar, ChevronDown, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PeriodData {
  totals: {
    orders: number; gross: number; net: number;
    adSpend: number; cogs: number; shipping: number; fees: number;
    profit: number; margin: number; realMargin: number;
    cpa: number | null; roas: number | null; aov: number; mer: number | null;
    chargebacks: number; realProfit: number;
  };
  byBrand:   Array<{ name: string; brandId: string; revenue: number; profit: number; orders: number; adSpend: number }>;
  byCountry: Array<{ name: string; revenue: number; profit: number; orders: number }>;
}

// ─── Preset periods ───────────────────────────────────────────────────────────
type PresetId = "1d" | "7d" | "14d" | "30d" | "60d" | "90d" | "custom";
const PRESETS: { id: PresetId; label: string; days?: number }[] = [
  { id: "1d",  label: "Hoy",        days: 1  },
  { id: "7d",  label: "7 días",     days: 7  },
  { id: "14d", label: "14 días",    days: 14 },
  { id: "30d", label: "30 días",    days: 30 },
  { id: "60d", label: "60 días",    days: 60 },
  { id: "90d", label: "Trimestre",  days: 90 },
  { id: "custom", label: "Custom"           },
];

// Use local date (not UTC) so "Hoy" matches the user's timezone, not server UTC
function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayStr() { return localStr(new Date()); }
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return localStr(d);
}
function daysBeforeStr(baseFrom: string, n: number) {
  const d = new Date(baseFrom + "T12:00:00");
  d.setDate(d.getDate() - n);
  return localStr(d);
}
function rangeLabel(from: string, to: string) {
  const f = new Date(from + "T12:00:00Z").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  const t = new Date(to   + "T12:00:00Z").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return f === t ? f : `${f} — ${t}`;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function Badge({ label, type }: { label: string; type: "good" | "ok" | "bad" | "neutral" }) {
  const s = { good: { background: "var(--green-bg)", color: "var(--green-text)" }, ok: { background: "var(--yellow-bg)", color: "var(--yellow-text)" }, bad: { background: "var(--red-bg)", color: "var(--red-text)" }, neutral: { background: "var(--bg-2)", color: "var(--text-3)" } };
  return <span style={{ ...s[type], display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }}>{label}</span>;
}

// ─── Delta chip ───────────────────────────────────────────────────────────────
function Delta({ pct, lowerIsBetter = false, size = 11 }: { pct: number; lowerIsBetter?: boolean; size?: number }) {
  if (!isFinite(pct) || pct === 0) return <span style={{ fontSize: size, color: "var(--text-3)" }}>—</span>;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: size, fontWeight: 700, color: good ? "var(--green)" : "var(--red)" }}>
      {good ? <TrendingUp size={size - 1} /> : <TrendingDown size={size - 1} />}
      {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
    </span>
  );
}

// ─── Period picker ────────────────────────────────────────────────────────────
interface PeriodState { preset: PresetId; from: string; to: string; }

function PeriodPicker({
  label, color, value, onChange,
}: {
  label: string; color: string;
  value: PeriodState;
  onChange: (p: PeriodState) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function selectPreset(p: typeof PRESETS[number]) {
    if (p.days) {
      onChange({ preset: p.id, from: daysAgoStr(p.days), to: todayStr() });
      setOpen(false);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 14px", borderRadius: 8, cursor: "pointer",
          background: "var(--card)", border: `1.5px solid ${color}33`,
          color: "var(--text)", fontSize: 12, fontWeight: 600,
          minWidth: 180,
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ color: color, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 2 }}>{label}</span>
        <span style={{ flex: 1, textAlign: "left" }}>{rangeLabel(value.from, value.to)}</span>
        <ChevronDown size={12} style={{ color: "var(--text-3)", flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 200,
          background: "var(--card)", border: "1.5px solid var(--border)",
          borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          padding: 14, minWidth: 280,
        }}>
          {/* Presets */}
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Período rápido</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {PRESETS.filter(p => p.id !== "custom").map(p => (
              <button key={p.id} onClick={() => selectPreset(p)} style={{
                padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: value.preset === p.id ? color : "var(--bg-2)",
                color: value.preset === p.id ? "#fff" : "var(--text-2)",
                border: value.preset === p.id ? `1.5px solid ${color}` : "1.5px solid var(--border)",
              }}>{p.label}</button>
            ))}
          </div>

          {/* Custom range */}
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Rango personalizado</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={value.from} max={value.to}
              onChange={e => onChange({ preset: "custom", from: e.target.value, to: value.to })}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--bg-2)", color: "var(--text)", fontSize: 12 }}
            />
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>→</span>
            <input type="date" value={value.to} min={value.from} max={todayStr()}
              onChange={e => { onChange({ preset: "custom", from: value.from, to: e.target.value }); setOpen(false); }}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1.5px solid var(--border)", background: "var(--bg-2)", color: "var(--text)", fontSize: 12 }}
            />
          </div>

          {/* Season shortcuts */}
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 14, marginBottom: 8 }}>Temporadas</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[
              { label: "Día de la Madre 2026", from: "2026-05-01", to: "2026-05-15" },
              { label: "Black Friday 2025",    from: "2025-11-24", to: "2025-11-30" },
              { label: "Mayo 2026",            from: "2026-05-01", to: "2026-05-31" },
              { label: "Abril 2026",           from: "2026-04-01", to: "2026-04-30" },
              { label: "Q1 2026",              from: "2026-01-01", to: "2026-03-31" },
              { label: "Q2 2026",              from: "2026-04-01", to: "2026-06-30" },
            ].map(s => (
              <button key={s.label} onClick={() => { onChange({ preset: "custom", from: s.from, to: s.to }); setOpen(false); }}
                style={{ padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, background: "var(--bg-2)", color: "var(--text-2)", border: "1.5px solid var(--border)" }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function KPIsPage() {
  const { fmtC } = useCurrency();

  // Period A (current) — defaults to last 30 days
  const [pA, setPa] = useState<PeriodState>({ preset: "30d", from: daysAgoStr(30), to: todayStr() });
  // Period B (comparison) — defaults to previous equivalent period
  const [pB, setPb] = useState<PeriodState>({ preset: "30d", from: daysAgoStr(60), to: daysAgoStr(31) });
  const [compareOn, setCompareOn] = useState(true);

  const [dataA, setDataA] = useState<PeriodData | null>(null);
  const [dataB, setDataB] = useState<PeriodData | null>(null);
  const [loadingA, setLoadingA] = useState(true);
  const [loadingB, setLoadingB] = useState(false);

  // Auto-sync period B when A changes (previous equivalent period)
  function handleSetPa(p: PeriodState) {
    setPa(p);
    if (p.preset !== "custom" && p.preset !== "1d") {
      const days = PRESETS.find(x => x.id === p.preset)?.days ?? 30;
      const prevTo   = daysBeforeStr(p.from, 1);
      const prevFrom = daysBeforeStr(p.from, days);
      setPb({ preset: p.preset, from: prevFrom, to: prevTo });
    }
  }

  const fetchPeriod = useCallback(async (from: string, to: string): Promise<PeriodData | null> => {
    try {
      const r = await fetch(`/api/dashboard?from=${from}&to=${to}`);
      return r.json();
    } catch { return null; }
  }, []);

  const load = useCallback(async () => {
    setLoadingA(true);
    setLoadingB(compareOn);
    const [a, b] = await Promise.all([
      fetchPeriod(pA.from, pA.to),
      compareOn ? fetchPeriod(pB.from, pB.to) : Promise.resolve(null),
    ]);
    setDataA(a); setDataB(b);
    setLoadingA(false); setLoadingB(false);
  }, [pA, pB, compareOn, fetchPeriod]);

  useEffect(() => { load(); }, [load]);

  const tA = dataA?.totals;
  const tB = dataB?.totals;

  function pct(a: number, b: number) {
    if (!b || b === 0) return 0;
    return ((a - b) / Math.abs(b)) * 100;
  }

  const daysA = Math.max(1, Math.round((new Date(pA.to).getTime() - new Date(pA.from).getTime()) / 86400000) + 1);
  const cpaMáx = tA && tA.orders > 0
    ? tA.aov - tA.cogs / tA.orders - tA.shipping / tA.orders - tA.fees / tA.orders - tA.aov * 0.15
    : 0;
  const totalCosts = tA ? tA.cogs + tA.shipping + tA.fees + tA.adSpend : 0;

  const loading = loadingA;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Topbar ────────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "10px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>KPIs</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              {rangeLabel(pA.from, pA.to)}{compareOn && tB ? ` · vs ${rangeLabel(pB.from, pB.to)}` : ""}
            </p>
          </div>
          <div style={{ flex: 1, minWidth: 0 }} />

          {/* Period A */}
          <PeriodPicker label="Período A" color="#0E766E" value={pA} onChange={handleSetPa} />

          {/* Compare toggle + Period B */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => setCompareOn(v => !v)} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 12px", borderRadius: 8, cursor: "pointer",
              background: compareOn ? "rgba(14,118,110,0.12)" : "var(--card)",
              border: `1.5px solid ${compareOn ? "#0E766E" : "var(--border)"}`,
              color: compareOn ? "#0E766E" : "var(--text-3)", fontSize: 12, fontWeight: 700,
            }}>
              <span style={{ fontSize: 13 }}>⇄</span>
              Comparar
            </button>
            {compareOn && (
              <PeriodPicker label="vs" color="#7C3AED" value={pB} onChange={setPb} />
            )}
          </div>

          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 12px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 0.8s linear infinite" : "none" }} />
            Actualizar
          </button>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : tA ? (
          <>
            {/* ── Hero KPI cards ──────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 12 }}>

              {/* Revenue hero */}
              <div className="card" style={{ padding: "24px 28px", background: "linear-gradient(135deg, #0D1117 0%, #12304A 100%)", border: "none" }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.45)", marginBottom: 12 }}>Revenue {rangeLabel(pA.from, pA.to)}</p>
                <p style={{ fontSize: 42, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtC(tA.gross)}</p>
                {tB && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                    <Delta pct={pct(tA.gross, tB.gross)} size={13} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>vs {rangeLabel(pB.from, pB.to)}</span>
                  </div>
                )}
                <div style={{ marginTop: 16, display: "flex", gap: 20 }}>
                  {[
                    { label: "Neto",     value: fmtC(tA.net) },
                    { label: "Desctos.", value: fmtC(tA.gross - tA.net) },
                    { label: "Pedidos",  value: fmtNum(tA.orders, 0) },
                    { label: "AOV",      value: fmtC(tA.aov) },
                  ].map(x => (
                    <div key={x.label}>
                      <p style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{x.label}</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 2 }}>{x.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Utilidad */}
              {[
                {
                  label: "Utilidad",
                  value: fmtC(tA.profit),
                  color: tA.profit >= 0 ? "var(--green)" : "var(--red)",
                  sub: `Margen ${fmtPct(tA.margin, 1)}`,
                  delta: tB ? pct(tA.profit, tB.profit) : null,
                  badge: <Badge label={tA.margin >= 20 ? "Escalable ⬆" : tA.margin >= 10 ? "Mantener" : tA.margin >= 0 ? "Justo" : "En rojo"} type={tA.margin >= 20 ? "good" : tA.margin >= 10 ? "ok" : "bad"} />,
                },
                {
                  label: "ROAS",
                  value: tA.roas != null ? `${tA.roas.toFixed(2)}x` : "—",
                  color: tA.roas != null ? (tA.roas >= 3 ? "var(--green)" : tA.roas >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)",
                  sub: `MER ${tA.mer?.toFixed(2) ?? "—"}x`,
                  delta: tA.roas && tB?.roas ? pct(tA.roas, tB.roas) : null,
                  badge: <Badge label={tA.roas != null ? (tA.roas >= 3 ? "Excelente" : tA.roas >= 2 ? "Bueno" : "Bajo") : "Sin pauta"} type={tA.roas != null ? (tA.roas >= 3 ? "good" : tA.roas >= 2 ? "ok" : "bad") : "neutral"} />,
                },
                {
                  label: "CPA",
                  value: tA.cpa != null ? fmtC(tA.cpa) : "—",
                  color: tA.cpa != null ? (tA.cpa > cpaMáx ? "var(--red)" : "var(--green)") : "var(--text-3)",
                  sub: `Máx ${fmtC(cpaMáx)}`,
                  delta: tA.cpa && tB?.cpa ? -pct(tA.cpa, tB.cpa) : null,
                  lowerIsBetter: true,
                  badge: <Badge label={tA.cpa != null ? (tA.cpa > cpaMáx ? "Sobre límite" : "Óptimo ✓") : "Sin pauta"} type={tA.cpa != null ? (tA.cpa > cpaMáx ? "bad" : "good") : "neutral"} />,
                },
                {
                  label: "Ad Spend",
                  value: fmtC(tA.adSpend),
                  color: "var(--purple)",
                  sub: `${daysA}d · ${fmtC(Math.round(tA.adSpend / daysA))}/día`,
                  delta: tB ? -pct(tA.adSpend, tB.adSpend) : null,
                  lowerIsBetter: true,
                  badge: null,
                },
              ].map((c) => (
                <div key={c.label} className="kpi-card" style={{ padding: "20px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 12 }}>{c.label}</p>
                  <p style={{ fontSize: 24, fontWeight: 800, color: c.color, letterSpacing: "-0.02em", lineHeight: 1 }}>{c.value}</p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 5 }}>{c.sub}</p>
                  {c.delta != null && (
                    <div style={{ marginTop: 6 }}>
                      <Delta pct={c.delta} lowerIsBetter={c.lowerIsBetter} />
                    </div>
                  )}
                  {c.badge && <div style={{ marginTop: 8 }}>{c.badge}</div>}
                </div>
              ))}
            </div>

            {/* ── Comparison table ─────────────────────────────────────────── */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Calendar size={14} style={{ color: "var(--text-3)" }} />
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  {compareOn && tB ? "Comparación de períodos" : `KPIs — ${rangeLabel(pA.from, pA.to)}`}
                </p>
                <div style={{ flex: 1 }} />
                {compareOn && tB && (
                  <div style={{ display: "flex", gap: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#0E766E" }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>A: {rangeLabel(pA.from, pA.to)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C3AED" }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)" }}>B: {rangeLabel(pB.from, pB.to)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Métrica</th>
                      <th style={{ textAlign: "right" }}>
                        <span style={{ color: "#0E766E" }}>● </span>Período A
                      </th>
                      {compareOn && tB && (
                        <>
                          <th style={{ textAlign: "right" }}>
                            <span style={{ color: "#7C3AED" }}>● </span>Período B
                          </th>
                          <th style={{ textAlign: "right" }}>Variación</th>
                          <th style={{ textAlign: "center", width: 90 }}>Estado</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Revenue",     a: tA.gross,    b: tB?.gross,    fmt: fmtC,                                       lib: false },
                      { label: "Revenue Neto",a: tA.net,      b: tB?.net,      fmt: fmtC,                                       lib: false },
                      { label: "Descuentos",  a: tA.gross - tA.net, b: tB ? tB.gross - tB.net : undefined, fmt: fmtC,           lib: true  },
                      { label: "Utilidad",    a: tA.profit,   b: tB?.profit,   fmt: fmtC,                                       lib: false },
                      { label: "Margen %",    a: tA.margin,   b: tB?.margin,   fmt: (v: number) => fmtPct(v, 1),                lib: false },
                      { label: "Real Profit", a: tA.realProfit, b: tB?.realProfit, fmt: fmtC,                                   lib: false },
                      { label: "Real Margen", a: tA.realMargin, b: tB?.realMargin, fmt: (v: number) => fmtPct(v, 1),            lib: false },
                      { label: "Pedidos",     a: tA.orders,   b: tB?.orders,   fmt: (v: number) => fmtNum(v, 0),                lib: false },
                      { label: "AOV",         a: tA.aov,      b: tB?.aov,      fmt: fmtC,                                       lib: false },
                      { label: "Ad Spend",    a: tA.adSpend,  b: tB?.adSpend,  fmt: fmtC,                                       lib: true  },
                      { label: "COGS",        a: tA.cogs,     b: tB?.cogs,     fmt: fmtC,                                       lib: true  },
                      { label: "ROAS",        a: tA.roas ?? 0, b: tB?.roas ?? 0, fmt: (v: number) => v > 0 ? `${v.toFixed(2)}x` : "—", lib: false },
                      { label: "MER",         a: tA.mer ?? 0, b: tB?.mer ?? 0, fmt: (v: number) => v > 0 ? `${v.toFixed(2)}x` : "—", lib: false },
                      { label: "CPA",         a: tA.cpa ?? 0, b: tB?.cpa ?? 0, fmt: (v: number) => v > 0 ? fmtC(v) : "—",      lib: true  },
                      { label: "Chargebacks", a: tA.chargebacks ?? 0, b: tB?.chargebacks ?? 0, fmt: fmtC,                       lib: true  },
                    ].map((row) => {
                      const delta = row.b !== undefined && row.b !== null && row.b !== 0
                        ? pct(row.a, row.b) : null;
                      const good = delta != null ? (row.lib ? delta <= 0 : delta >= 0) : true;
                      return (
                        <tr key={row.label}>
                          <td style={{ fontWeight: 600, color: "var(--text-2)" }}>{row.label}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{row.fmt(row.a)}</td>
                          {compareOn && tB && (
                            <>
                              <td style={{ textAlign: "right", color: "var(--text-3)" }}>
                                {row.b !== undefined && row.b !== null ? row.fmt(row.b) : "—"}
                              </td>
                              <td style={{ textAlign: "right" }}>
                                {delta != null ? <Delta pct={delta} lowerIsBetter={row.lib} /> : <span style={{ color: "var(--text-3)" }}>—</span>}
                              </td>
                              <td style={{ textAlign: "center" }}>
                                {delta != null ? <Badge label={good ? "Mejor ✓" : "Peor"} type={good ? "good" : "bad"} /> : null}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Por marca ────────────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: compareOn && dataB ? "1fr 1fr" : "1fr 1fr", gap: 18 }}>
              <div className="card" style={{ padding: "20px 24px" }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Por Marca — Período A</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 16 }}>{rangeLabel(pA.from, pA.to)}</p>
                {(dataA?.byBrand ?? []).map((b) => {
                  const isGlow = b.name.toLowerCase().includes("glow");
                  const color  = isGlow ? "#EC4899" : "#10B981";
                  const bMargin = b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0;
                  const revShare = tA.gross > 0 ? (b.revenue / tA.gross) * 100 : 0;
                  const bB = dataB?.byBrand?.find(x => x.name === b.name);
                  return (
                    <div key={b.name} style={{ marginBottom: 12, padding: "14px 16px", borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{b.name}</span>
                        </div>
                        <Badge label={bMargin >= 20 ? "Escalar ⬆" : bMargin >= 10 ? "Mantener" : "Revisar ⚠"} type={bMargin >= 20 ? "good" : bMargin >= 10 ? "ok" : "bad"} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                        {[
                          { label: "Revenue",  v: b.revenue, vB: bB?.revenue, fmt: fmtC, lib: false },
                          { label: "Utilidad", v: b.profit,  vB: bB?.profit,  fmt: fmtC, color: b.profit >= 0 ? "var(--green)" : "var(--red)", lib: false },
                          { label: "Margen",   v: bMargin,   vB: bB ? (bB.revenue > 0 ? bB.profit / bB.revenue * 100 : 0) : undefined, fmt: (v: number) => fmtPct(v, 1), color: bMargin >= 20 ? "var(--green)" : bMargin >= 10 ? "var(--yellow)" : "var(--red)", lib: false },
                          { label: "ROAS",     v: b.adSpend > 0 ? b.revenue / b.adSpend : 0, vB: bB && bB.adSpend > 0 ? bB.revenue / bB.adSpend : 0, fmt: (v: number) => v > 0 ? `${v.toFixed(2)}x` : "—", lib: false },
                        ].map((m) => (
                          <div key={m.label} style={{ textAlign: "center" }}>
                            <p style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{m.label}</p>
                            <p style={{ fontSize: 13, fontWeight: 800, color: (m as any).color ?? "var(--text)" }}>{m.fmt(m.v)}</p>
                            {compareOn && m.vB !== undefined && m.vB !== 0 && (
                              <div style={{ marginTop: 2 }}><Delta pct={pct(m.v, m.vB)} lowerIsBetter={m.lib} size={10} /></div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 10, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                        <div style={{ height: 4, borderRadius: 2, width: `${revShare}%`, background: color, transition: "width 0.6s ease" }} />
                      </div>
                      <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{revShare.toFixed(1)}% del revenue</p>
                    </div>
                  );
                })}
              </div>

              {/* Por país */}
              <div className="card" style={{ padding: "20px 24px" }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Por País — Período A</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 16 }}>{rangeLabel(pA.from, pA.to)}</p>
                {(dataA?.byCountry ?? []).length === 0 ? (
                  <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>Sin datos por país</p>
                ) : (
                  [...(dataA?.byCountry ?? [])].sort((a, b) => b.revenue - a.revenue).map((c) => {
                    const cMargin = c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0;
                    const revShare = tA.gross > 0 ? (c.revenue / tA.gross) * 100 : 0;
                    const cB = dataB?.byCountry?.find(x => x.name === c.name);
                    return (
                      <div key={c.name} style={{ marginBottom: 12, padding: "14px 16px", borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.name}</p>
                            <p style={{ fontSize: 10, color: "var(--text-3)" }}>{fmtNum(c.orders, 0)} pedidos</p>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{fmtC(c.revenue)}</p>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", marginTop: 2 }}>
                              <Badge label={fmtPct(cMargin, 1)} type={cMargin >= 20 ? "good" : cMargin >= 10 ? "ok" : "bad"} />
                              {compareOn && cB && <Delta pct={pct(c.revenue, cB.revenue)} size={10} />}
                            </div>
                          </div>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                          <div style={{ height: 4, borderRadius: 2, width: `${revShare}%`, background: "#2563EB", transition: "width 0.6s ease" }} />
                        </div>
                        <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{revShare.toFixed(1)}% del total</p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* ── Estructura de costos ─────────────────────────────────────── */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Estructura de Costos</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 16 }}>{rangeLabel(pA.from, pA.to)}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
                {[
                  { label: "COGS",     value: tA.cogs,     pct: totalCosts > 0 ? tA.cogs / totalCosts * 100 : 0,     color: "#6366F1", bVal: tB?.cogs },
                  { label: "Flete",    value: tA.shipping, pct: totalCosts > 0 ? tA.shipping / totalCosts * 100 : 0, color: "#F59E0B", bVal: tB?.shipping },
                  { label: "Fees",     value: tA.fees,     pct: totalCosts > 0 ? tA.fees / totalCosts * 100 : 0,     color: "#EC4899", bVal: tB?.fees },
                  { label: "Ad Spend", value: tA.adSpend,  pct: totalCosts > 0 ? tA.adSpend / totalCosts * 100 : 0, color: "#8B5CF6", bVal: tB?.adSpend },
                  { label: "Total",    value: totalCosts,  pct: 100, color: "#0E766E", bVal: tB ? tB.cogs + tB.shipping + tB.fees + tB.adSpend : undefined },
                ].map((c) => (
                  <div key={c.label} style={{
                    padding: "14px 16px", borderRadius: 12,
                    background: c.label === "Total" ? "linear-gradient(135deg, #0D1117 0%, #12304A 100%)" : "var(--bg-2)",
                    border: c.label === "Total" ? "none" : "1px solid var(--border)",
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: c.label === "Total" ? "rgba(255,255,255,0.45)" : "var(--text-3)", marginBottom: 8 }}>{c.label}</p>
                    <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: c.label === "Total" ? "#fff" : c.color }}>{fmtC(c.value)}</p>
                    <p style={{ fontSize: 10, color: c.label === "Total" ? "rgba(255,255,255,0.35)" : "var(--text-3)", marginTop: 3 }}>{c.pct.toFixed(0)}% del total</p>
                    {compareOn && c.bVal !== undefined && c.bVal > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <Delta pct={-pct(c.value, c.bVal)} lowerIsBetter size={10} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-3)" }}>
            <p>Sin datos para este período</p>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
