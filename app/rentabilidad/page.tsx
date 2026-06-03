"use client";
import { useEffect, useState, useCallback } from "react";
import { fmtNum, fmtPct, localDateStr, daysAgoLocal } from "@/lib/utils";
import { useFilters } from "@/lib/filters";
import { useCurrency } from "@/lib/currency";
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Package, Truck, CreditCard, Zap, Target } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface DashboardData {
  totals: {
    orders: number; gross: number; net: number;
    adSpend: number; cogs: number; shipping: number; fees: number;
    profit: number; margin: number; cpa: number | null; roas: number | null;
    mer?: number | null; aov: number;
  };
  chartData: Array<{ date: string; glowmmi: number; balancea: number; profit: number; adSpend: number }>;
  byBrand: Array<{ name: string; revenue: number; profit: number; orders: number }>;
}

function StatusBadge({ label, type }: { label: string; type: "good" | "ok" | "bad" | "neutral" }) {
  const s = {
    good:    { background: "var(--green-bg)",  color: "var(--green-text)" },
    ok:      { background: "var(--yellow-bg)", color: "var(--yellow-text)" },
    bad:     { background: "var(--red-bg)",    color: "var(--red-text)" },
    neutral: { background: "var(--bg-2)",      color: "var(--text-3)" },
  };
  return (
    <span style={{
      ...s[type], display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function CustomBarTooltip({ active, payload, label, fmtC }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10,
      padding: "10px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", minWidth: 180,
    }}>
      <p style={{ color: "#6B7280", fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 4 }}>
          <span style={{ color: "#6B7280", fontSize: 12 }}>{p.name}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: p.value >= 0 ? "#00A676" : "#DC2626" }}>
            {fmtC(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

type TopProduct = { code: string; name: string; brandId: string; revenue: number; profit: number; orders: number; adSpend: number; cogs: number; margin: number };

export default function RentabilidadPage() {
  const { days, isCustom, customFrom, customTo } = useFilters();
  const { fmtC } = useCurrency();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isCustom && customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", String(days));
    }
    // Main dashboard data
    fetch(`/api/dashboard?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    // Product stats from Sheet5
    const pParams = new URLSearchParams();
    if (isCustom && customFrom && customTo) { pParams.set("from", customFrom); pParams.set("to", customTo); }
    else { const d = days; pParams.set("from", daysAgoLocal(d - 1)); pParams.set("to", localDateStr()); }
    fetch(`/api/products/stats?${pParams}`)
      .then((r) => r.json())
      .then((d) => setTopProducts(d.topProducts ?? []))
      .catch(() => {});
  }, [days, isCustom, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const totalCosts    = t ? t.cogs + t.shipping + t.fees + t.adSpend : 0;
  const cogsPerOrder  = t && t.orders > 0 ? t.cogs / t.orders : 0;
  const shipPerOrder  = t && t.orders > 0 ? t.shipping / t.orders : 0;
  const feesPerOrder  = t && t.orders > 0 ? t.fees / t.orders : 0;
  const cpaMáx        = t
    ? t.aov - cogsPerOrder - shipPerOrder - feesPerOrder - (t.aov * 0.15)
    : 0;
  const breakEvenCpa  = t && t.orders > 0
    ? (t.gross - t.cogs - t.shipping - t.fees) / t.orders : 0;

  /* Profit chart data — mostrar revenue, costos y profit por día */
  const profitChartData = (data?.chartData ?? []).map((d) => ({
    date: format(new Date(d.date), "d MMM", { locale: es }),
    Profit: Math.round(d.profit),
  }));

  /* Waterfall-style breakdown */
  const breakdown = t ? [
    { label: "Revenue bruto",       value:  t.gross,     type: "positive" as const },
    { label: "− COGS (productos)",  value: -t.cogs,      type: "cost" as const },
    { label: "− Flete / envío",     value: -t.shipping,  type: "cost" as const },
    { label: "− Pasarela / fees",   value: -t.fees,      type: "cost" as const },
    { label: "− Pauta (Ad Spend)",  value: -t.adSpend,   type: "cost" as const },
    { label: "= Utilidad Neta",     value:  t.profit,    type: t.profit >= 0 ? "result" as const : "negative" as const },
  ] : [];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Topbar ─────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              Rentabilidad
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              Profit real · últimos {days} días
            </p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

        {loading && !data && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E",
              animation: "spin 0.8s linear infinite",
            }} />
          </div>
        )}

        {t && (
          <>
            {/* ╔══════════════════════════════════════════════════╗
                ║  HERO — Resultado neto                           ║
                ╚══════════════════════════════════════════════════╝ */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 16 }}>

              {/* Gran hero */}
              <div className="card" style={{
                padding: "28px 32px",
                background: t.profit >= 0
                  ? "linear-gradient(135deg, #0D6E62 0%, #0E766E 100%)"
                  : "linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)",
                border: "none",
              }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.6)", marginBottom: 16 }}>
                  Utilidad Neta Real
                </p>
                <p style={{ fontSize: 48, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>
                  {fmtC(t.profit)}
                </p>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 12 }}>
                  {fmtPct(t.margin, 1)} de margen neto · {fmtC(t.gross)} de revenue
                </p>
                <div style={{ marginTop: 20, display: "flex", gap: 24 }}>
                  {[
                    { label: "Revenue", value: fmtC(t.gross) },
                    { label: "Costos", value: fmtC(totalCosts) },
                    { label: "Pedidos", value: fmtNum(t.orders, 0) },
                  ].map((item) => (
                    <div key={item.label}>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.label}</p>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginTop: 2 }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Margen */}
              <div className="kpi-card">
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>
                  Margen Neto
                </p>
                <p style={{
                  fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1,
                  color: t.margin >= 20 ? "var(--green)" : t.margin >= 10 ? "var(--yellow)" : "var(--red)",
                }}>
                  {fmtPct(t.margin, 1)}
                </p>
                <div style={{ marginTop: 10 }}>
                  <StatusBadge
                    label={t.margin >= 20 ? "Meta ≥20% ✓" : t.margin >= 10 ? "Aceptable" : "Bajo meta"}
                    type={t.margin >= 20 ? "good" : t.margin >= 10 ? "ok" : "bad"}
                  />
                </div>
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--bg-2)", overflow: "hidden" }}>
                    <div style={{
                      height: 8, borderRadius: 4,
                      width: `${Math.min(Math.max(t.margin, 0), 100)}%`,
                      background: t.margin >= 20 ? "var(--green)" : t.margin >= 10 ? "var(--yellow)" : "var(--red)",
                      transition: "width 0.6s ease",
                    }} />
                  </div>
                  <p style={{ fontSize: 10, color: "var(--text-3)" }}>Meta: 20%</p>
                </div>
              </div>

              {/* CPA vs Máximo */}
              <div className="kpi-card">
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>
                  CPA Real / Máximo
                </p>
                <p style={{
                  fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1,
                  color: t.cpa == null ? "var(--text-3)" : t.cpa > cpaMáx ? "var(--red)" : t.cpa > cpaMáx * 0.85 ? "var(--yellow)" : "var(--green)",
                }}>
                  {t.cpa != null ? fmtC(t.cpa) : "—"}
                </p>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
                  Máx: {fmtC(cpaMáx)} · B-E: {fmtC(breakEvenCpa)}
                </p>
                <div style={{ marginTop: 10 }}>
                  <StatusBadge
                    label={t.cpa == null ? "Sin pauta" : t.cpa > cpaMáx ? "Fuera del límite 🔴" : t.cpa > cpaMáx * 0.85 ? "En riesgo 🟡" : "Óptimo 🟢"}
                    type={t.cpa == null ? "neutral" : t.cpa > cpaMáx ? "bad" : t.cpa > cpaMáx * 0.85 ? "ok" : "good"}
                  />
                </div>
              </div>

              {/* ROAS */}
              <div className="kpi-card">
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>
                  ROAS
                </p>
                <p style={{
                  fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1,
                  color: t.roas == null ? "var(--text-3)" : t.roas >= 3 ? "var(--green)" : t.roas >= 2 ? "var(--yellow)" : "var(--red)",
                }}>
                  {t.roas != null ? `${t.roas.toFixed(2)}x` : "—"}
                </p>
                <div style={{ marginTop: 10 }}>
                  <StatusBadge
                    label={t.roas == null ? "Sin pauta" : t.roas >= 3 ? "Excelente" : t.roas >= 2 ? "Bueno" : "Bajo ⚠"}
                    type={t.roas == null ? "neutral" : t.roas >= 3 ? "good" : t.roas >= 2 ? "ok" : "bad"}
                  />
                </div>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>
                  MER: {t.mer?.toFixed(2) ?? "—"}x (eficiencia total)
                </p>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  DESGLOSE WATERFALL + GRÁFICA                   ║
                ╚══════════════════════════════════════════════════╝ */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 20 }}>

              {/* Cascada de costos */}
              <div className="card" style={{ padding: "24px" }}>
                <SectionLabel>De Revenue a Utilidad</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {breakdown.map((item, i) => {
                    const isResult = item.type === "result" || item.type === "negative";
                    const color = item.type === "positive" ? "var(--blue)"
                      : item.type === "cost" ? "var(--red)"
                      : item.value >= 0 ? "var(--green)" : "var(--red)";
                    return (
                      <div key={i} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: isResult ? "12px 14px" : "10px 14px",
                        borderRadius: 8,
                        background: isResult
                          ? item.value >= 0 ? "var(--green-bg)" : "var(--red-bg)"
                          : i % 2 === 0 ? "var(--bg-2)" : "transparent",
                        marginTop: isResult ? 8 : 0,
                        borderTop: isResult ? "2px solid var(--border)" : "none",
                      }}>
                        <span style={{
                          fontSize: isResult ? 13 : 12,
                          fontWeight: isResult ? 700 : 500,
                          color: isResult ? color : "var(--text-2)",
                        }}>
                          {item.label}
                        </span>
                        <span style={{
                          fontSize: isResult ? 15 : 13,
                          fontWeight: isResult ? 800 : 600,
                          color,
                        }}>
                          {item.value >= 0 && !item.label.startsWith("−") ? "" : ""}{fmtC(Math.abs(item.value))}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Distribución de costos */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 12 }}>
                    Distribución del costo
                  </p>
                  {t && [
                    { label: "COGS",    value: t.cogs,     color: "#6366F1", icon: Package },
                    { label: "Flete",   value: t.shipping, color: "#F59E0B", icon: Truck },
                    { label: "Fees",    value: t.fees,     color: "#EC4899", icon: CreditCard },
                    { label: "Ad Spend", value: t.adSpend, color: "#8B5CF6", icon: Zap },
                  ].map((c) => (
                    <div key={c.label} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{c.label}</span>
                        <div style={{ display: "flex", gap: 10 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{fmtC(c.value)}</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)", width: 34, textAlign: "right" }}>
                            {totalCosts > 0 ? ((c.value / totalCosts) * 100).toFixed(0) : 0}%
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: "var(--bg-2)", overflow: "hidden" }}>
                        <div style={{
                          height: 5, borderRadius: 3,
                          width: `${totalCosts > 0 ? (c.value / totalCosts) * 100 : 0}%`,
                          background: c.color,
                          transition: "width 0.6s ease",
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Profit chart */}
              <div className="card" style={{ padding: "24px" }}>
                <SectionLabel>Profit Diario</SectionLabel>
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={profitChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="0" stroke="#F3F4F6" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "#9CA3AF" }}
                        axisLine={false} tickLine={false}
                        interval={Math.max(Math.floor(profitChartData.length / 8), 1)}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#9CA3AF" }}
                        axisLine={false} tickLine={false}
                        tickFormatter={(v) => {
                          if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(0)}k`;
                          return `$${v}`;
                        }}
                        width={48}
                      />
                      <ReferenceLine y={0} stroke="#E5E7EB" strokeWidth={1.5} />
                      <Tooltip content={(props) => <CustomBarTooltip {...props} fmtC={fmtC} />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                      <Bar
                        dataKey="Profit"
                        radius={[4, 4, 0, 0]}
                        fill="#0E766E"
                        // Color rojo para negativos se haría con Cell, pero para simplificar usamos un color fijo
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", marginTop: 8 }}>
                  Verde = días con utilidad positiva · valores en USD base
                </p>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  POR PRODUCTO (Sheet5)                           ║
                ╚══════════════════════════════════════════════════╝ */}
            {topProducts.length > 0 && (
              <div>
                <SectionLabel>Rentabilidad por Producto</SectionLabel>
                <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
                          {["Producto","Pedidos","Revenue","Ad Spend","COGS","Utilidad","Margen","ROAS","Estado"].map((h, i) => (
                            <th key={h} style={{ padding: "10px 14px", textAlign: i > 0 ? "right" : "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {topProducts.map((p, i) => {
                          const margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
                          const roas   = p.adSpend > 0 ? p.revenue / p.adSpend : null;
                          const state  = p.profit < 0 ? "bad" : margin >= 20 ? "good" : "ok";
                          const stateLabel = p.profit < 0 ? "Pérdida" : margin >= 30 ? "Excelente" : margin >= 20 ? "Bueno" : "Justo";
                          const stateBg  = state === "good" ? "#D1FAE5" : state === "ok" ? "#FEF3C7" : "#FEE2E2";
                          const stateCol = state === "good" ? "#065F46" : state === "ok" ? "#92400E" : "#991B1B";
                          const isGlow = p.brandId === "brand_glowmmi";
                          return (
                            <tr key={`${p.code}-${p.name}`} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "var(--bg-2)" }}>
                              <td style={{ padding: "10px 14px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", minWidth: 20 }}>{i + 1}</span>
                                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: isGlow ? "#EC4899" : "#10B981", flexShrink: 0, display: "inline-block" }} />
                                  <div>
                                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>{p.name}</p>
                                    <p style={{ fontSize: 10, color: "var(--text-3)" }}>{p.code}</p>
                                  </div>
                                </div>
                              </td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{p.orders}</td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{fmtC(p.revenue)}</td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "var(--text-2)" }}>{fmtC(p.adSpend)}</td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: "var(--text-2)" }}>{fmtC(p.cogs)}</td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, fontWeight: 700, color: p.profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmtC(p.profit)}</td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, fontWeight: 600, color: margin >= 20 ? "var(--green)" : margin >= 0 ? "var(--yellow)" : "var(--red)" }}>
                                {margin.toFixed(1)}%
                              </td>
                              <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 13, color: roas && roas >= 3 ? "var(--green)" : roas && roas >= 2 ? "var(--yellow)" : roas ? "var(--red)" : "var(--text-3)" }}>
                                {roas ? `${roas.toFixed(2)}x` : "—"}
                              </td>
                              <td style={{ padding: "10px 14px", textAlign: "right" }}>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: stateBg, color: stateCol, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                                  {stateLabel}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ╔══════════════════════════════════════════════════╗
                ║  POR MARCA (resumido)                            ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Desglose por Marca</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
                {data?.byBrand.map((b) => {
                  const isGlow  = b.name.toLowerCase().includes("glow");
                  const color   = isGlow ? "#EC4899" : "#10B981";
                  const bg      = isGlow ? "#FCE7F3" : "#D1FAE5";
                  const textC   = isGlow ? "#BE185D" : "#065F46";
                  const share   = t.gross > 0 ? b.revenue / t.gross : 0;
                  const bAdSpend = t.adSpend * share;
                  const bCogs    = t.cogs * share;
                  const bShip    = t.shipping * share;
                  const bFees    = t.fees * share;
                  const bTotal   = bCogs + bShip + bFees + bAdSpend;
                  const bMargin  = b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0;
                  const bCpa     = bAdSpend > 0 && b.orders > 0 ? bAdSpend / b.orders : 0;
                  const bRoas    = bAdSpend > 0 ? b.revenue / bAdSpend : 0;
                  const revPct   = t.gross > 0 ? (b.revenue / t.gross) * 100 : 0;

                  return (
                    <div key={b.name} className="card" style={{ padding: "24px" }}>
                      {/* Brand header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 18 }}>{isGlow ? "✨" : "🌿"}</span>
                          </div>
                          <div>
                            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{b.name}</p>
                            <p style={{ fontSize: 11, color: "var(--text-3)" }}>{revPct.toFixed(1)}% del revenue total</p>
                          </div>
                        </div>
                        <StatusBadge
                          label={bMargin >= 20 ? "Escalar ⬆" : bMargin >= 10 ? "Mantener ↔" : bMargin >= 0 ? "Revisar ⚠" : "Pausar ⏸"}
                          type={bMargin >= 20 ? "good" : bMargin >= 10 ? "ok" : "bad"}
                        />
                      </div>

                      {/* Metrics grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
                        {[
                          { label: "Revenue", value: fmtC(b.revenue) },
                          { label: "Utilidad", value: fmtC(b.profit), color: b.profit >= 0 ? "var(--green)" : "var(--red)" },
                          { label: "Margen", value: fmtPct(bMargin, 1), color: bMargin >= 20 ? "var(--green)" : bMargin >= 10 ? "var(--yellow)" : "var(--red)" },
                          { label: "Ad Spend", value: fmtC(bAdSpend), color: "var(--yellow)" },
                          { label: "CPA", value: bCpa > 0 ? fmtC(bCpa) : "—" },
                          { label: "ROAS", value: bRoas > 0 ? `${bRoas.toFixed(2)}x` : "—", color: bRoas >= 3 ? "var(--green)" : bRoas >= 2 ? "var(--yellow)" : bRoas > 0 ? "var(--red)" : undefined },
                        ].map((m) => (
                          <div key={m.label} style={{ padding: "12px 14px", background: "var(--bg-2)", borderRadius: 10 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 6 }}>
                              {m.label}
                            </p>
                            <p style={{ fontSize: 15, fontWeight: 800, color: (m as any).color ?? "var(--text)", letterSpacing: "-0.01em" }}>
                              {m.value}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Cost bar */}
                      <div style={{ paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>
                            Costo total: {fmtC(bTotal)}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {b.revenue > 0 ? ((bTotal / b.revenue) * 100).toFixed(1) : 0}% del revenue
                          </span>
                        </div>
                        <div style={{ height: 8, borderRadius: 4, background: "var(--bg-2)", overflow: "hidden" }}>
                          <div style={{
                            height: 8, borderRadius: 4,
                            width: `${Math.min(b.revenue > 0 ? (bTotal / b.revenue) * 100 : 0, 100)}%`,
                            background: `linear-gradient(90deg, ${color}40, ${color})`,
                            transition: "width 0.6s ease",
                          }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  MÉTRICAS POR PEDIDO                             ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Economics por Pedido</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
                {t && [
                  { label: "AOV (precio prom.)", value: fmtC(t.aov), icon: "🛒", sub: "Ticket promedio", color: "#2563EB" },
                  { label: "COGS / pedido",       value: fmtC(cogsPerOrder), icon: "📦", sub: "Costo producto", color: "#6366F1" },
                  { label: "Flete / pedido",      value: fmtC(shipPerOrder), icon: "🚚", sub: "Costo envío", color: "#F59E0B" },
                  { label: "Fees / pedido",       value: fmtC(feesPerOrder), icon: "💳", sub: "Pasarela pago", color: "#EC4899" },
                  { label: "Utilidad / pedido",   value: fmtC(t.orders > 0 ? t.profit / t.orders : 0), icon: t.profit >= 0 ? "💰" : "❌", sub: "Después de todos los costos",
                    color: t.profit >= 0 ? "var(--green)" : "var(--red)" },
                ].map((m) => (
                  <div key={m.label} className="card-flat" style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
                        {m.label}
                      </p>
                      <span style={{ fontSize: 18 }}>{m.icon}</span>
                    </div>
                    <p style={{ fontSize: 22, fontWeight: 800, color: m.color, letterSpacing: "-0.02em" }}>
                      {m.value}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{m.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
