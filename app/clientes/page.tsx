"use client";
import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { RefreshCw, Users, TrendingUp, TrendingDown, DollarSign, Target, Repeat } from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────── */
interface Cohort {
  month: string; label: string;
  newCustomers: number; revenue: number;
  ltv: number; cac: number; ratio: number;
  repurchaseRate: number;
  monthlyLtv: number[];
}
interface LtvData {
  allTime: { customers: number; repurchaseRate: number; revenue: number; ltv: number; cac: number; ltvCacRatio: number };
  period:  { from: string; to: string; newCustomers: number; repurchaseRate: number; revenue: number; ltv: number; cac: number; ltvCacRatio: number };
  cohorts:      Cohort[];
  chartData:    { label: string; ltv: number; cac: number; ratio: number }[];
  maxLtv:       number;
  periodMonths: number;
}

/* ─── Helpers ────────────────────────────────────────────────── */
function fmtUSD(v: number) { return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtRatio(v: number) { return `${v.toFixed(2)} : 1`; }

/* ─── Heatmap cell color ─────────────────────────────────────── */
function ltvHeat(ltv: number, maxLtv: number): string {
  if (maxLtv === 0 || ltv === 0) return "transparent";
  const pct = Math.min(ltv / maxLtv, 1);
  // Scale from light teal to dark teal
  const lightness = Math.round(90 - pct * 52); // 90% → 38%
  const sat       = Math.round(40 + pct * 40);
  return `hsl(172, ${sat}%, ${lightness}%)`;
}

/* ─── KPI stat card ──────────────────────────────────────────── */
function StatCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub?: string; color: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  return (
    <div className="kpi-card" style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
          {label}
        </p>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <p style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

/* ─── Custom tooltip for the LTV:CAC chart ──────────────────── */
function LtvTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
      <p style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", marginBottom: 8 }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: p.color }} />
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>{p.name}:</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
            {p.dataKey === "ratio" ? fmtRatio(p.value) : fmtUSD(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function ClientesPage() {
  const [data, setData]       = useState<LtvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [brand, setBrand]     = useState("all");

  // Period: default current month back 6 months
  const today = new Date();
  const toM   = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const fromD = new Date(today); fromD.setMonth(fromD.getMonth() - 5);
  const fromM = `${fromD.getFullYear()}-${String(fromD.getMonth() + 1).padStart(2, "0")}`;
  const [dateFrom, setDateFrom] = useState(fromM);
  const [dateTo,   setDateTo]   = useState(toM);

  const load = useCallback(() => {
    setLoading(true);
    const p = new URLSearchParams({ from: dateFrom, to: dateTo, brand });
    fetch(`/api/ltv?${p}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [dateFrom, dateTo, brand]);

  useEffect(() => { load(); }, [load]);

  const at = data?.allTime;
  const per = data?.period;

  /* Column labels for cohort matrix: 1st Month … Nth Month */
  const maxCols = data ? Math.max(...data.cohorts.map(c => c.monthlyLtv.length), 1) : 1;
  const colLabels = Array.from({ length: maxCols }, (_, i) =>
    i === 0 ? "1er Mes" : `${i + 1}° Mes`
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Customer Lifetime Value</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>LTV · CAC · Cohortes mensuales</p>
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {/* Month range */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="month" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12 }} />
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>—</span>
            <input type="month" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12 }} />
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {/* Brand */}
          {[
            { label: "Todas",    value: "all" },
            { label: "Glowmmi",  value: "brand_glowmmi" },
            { label: "Balancea", value: "brand_balancea" },
          ].map(b => (
            <button key={b.value} onClick={() => setBrand(b.value)} style={{
              padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: brand === b.value
                ? (b.value === "brand_glowmmi" ? "#FCE7F3" : b.value === "brand_balancea" ? "#D1FAE5" : "#CCFBF1")
                : "transparent",
              color: brand === b.value
                ? (b.value === "brand_glowmmi" ? "#BE185D" : b.value === "brand_balancea" ? "#065F46" : "#0F766E")
                : "var(--text-2)",
              border: `1.5px solid ${brand === b.value ? "currentColor" : "var(--border)"}`,
              cursor: "pointer",
            }}>
              {b.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "var(--card)", border: "1.5px solid var(--border)", color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Loading */}
        {loading && !data && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
              <p style={{ color: "var(--text-3)", fontSize: 13 }}>Cargando datos de clientes...</p>
            </div>
          </div>
        )}

        {data && at && per && (
          <>
            {/* ╔══════════════════════════════════════════════════╗
                ║  ALL-TIME OVERVIEW                               ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  Vista General — Todo el Tiempo
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14 }}>
                <StatCard label="Clientes Totales" value={at.customers.toLocaleString("es-MX")} sub="histórico completo" color="#2563EB" icon={Users} />
                <StatCard label="Tasa de Recompra" value={`${at.repurchaseRate}%`} sub="clientes que vuelven" color="#7C3AED" icon={Repeat} />
                <StatCard label="Revenue Total" value={fmtUSD(at.revenue)} sub="ingresos históricos" color="#10B981" icon={DollarSign} />
                <StatCard label="LTV Promedio" value={fmtUSD(at.ltv)} sub="revenue / cliente" color="#0E766E" icon={TrendingUp} />
                <StatCard label="CAC Promedio" value={fmtUSD(at.cac)} sub="ad spend / cliente" color="#F59E0B" icon={Target} />
                <div className="kpi-card" style={{
                  background: at.ltvCacRatio >= 3 ? "linear-gradient(135deg, #065F46 0%, #047857 100%)"
                             : at.ltvCacRatio >= 1 ? "linear-gradient(135deg, #1E3A5F 0%, #1E40AF 100%)"
                             : "linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)",
                  border: "none",
                }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>LTV:CAC Ratio</p>
                  <p style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtRatio(at.ltvCacRatio)}</p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 6 }}>
                    {at.ltvCacRatio >= 3 ? "Excelente — escala con confianza" : at.ltvCacRatio >= 1 ? "Positivo — LTV > CAC" : "Negativo — revisar adquisición"}
                  </p>
                </div>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  PERIOD OVERVIEW + CHART side by side            ║
                ╚══════════════════════════════════════════════════╝ */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }}>

              {/* Period KPIs */}
              <div className="card" style={{ padding: "24px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Resumen del Período</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 20 }}>{per.from} al {per.to}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {[
                    { label: "Nuevos Clientes",   value: per.newCustomers.toLocaleString("es-MX"),    color: "#2563EB" },
                    { label: "Tasa de Recompra",  value: `${per.repurchaseRate}%`,                    color: "#7C3AED" },
                    { label: "Revenue",           value: fmtUSD(per.revenue),                         color: "#10B981" },
                    { label: "LTV",               value: fmtUSD(per.ltv),                             color: "#0E766E" },
                    { label: "CAC",               value: fmtUSD(per.cac),                             color: "#F59E0B" },
                    { label: "LTV:CAC Ratio",     value: fmtRatio(per.ltvCacRatio),                   color: per.ltvCacRatio >= 1 ? "#10B981" : "#DC2626" },
                  ].map((row, i, arr) => (
                    <div key={row.label} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "11px 0",
                      borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: "var(--text-2)" }}>{row.label}</span>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontFamily: "monospace" }}>
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* LTV:CAC Chart */}
              <div className="card" style={{ padding: "24px 28px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>LTV vs CAC por Mes de Adquisición</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 20 }}>Barras = LTV & CAC · Línea = Ratio</p>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={data.chartData} margin={{ top: 5, right: 40, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-3)" }} axisLine={false} tickLine={false} />
                    <YAxis
                      yAxisId="money"
                      tickFormatter={v => `$${Math.round(v)}`}
                      tick={{ fontSize: 11, fill: "var(--text-3)" }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      yAxisId="ratio"
                      orientation="right"
                      tickFormatter={v => `${v.toFixed(1)}x`}
                      tick={{ fontSize: 11, fill: "var(--text-3)" }}
                      axisLine={false} tickLine={false}
                      domain={[0, "auto"]}
                    />
                    <Tooltip content={<LtvTooltip />} />
                    <Legend
                      formatter={(val) => <span style={{ fontSize: 11, color: "var(--text-2)" }}>{val}</span>}
                    />
                    <Bar yAxisId="money" dataKey="ltv" name="LTV" fill="#458FFF" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    <Bar yAxisId="money" dataKey="cac" name="CAC" fill="#D67CE8" radius={[4, 4, 0, 0]} maxBarSize={32} />
                    <Line
                      yAxisId="ratio"
                      type="monotone"
                      dataKey="ratio"
                      name="LTV:CAC Ratio"
                      stroke="#EED133"
                      strokeWidth={2.5}
                      dot={{ fill: "#EED133", r: 4, strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  COHORT MATRIX — Lifetime Value                  ║
                ╚══════════════════════════════════════════════════╝ */}
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Lifetime Value por Cohorte</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>LTV acumulado por mes de adquisición · color más intenso = mayor valor</p>
                </div>
                {/* Heatmap legend */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>Bajo</span>
                  <div style={{ display: "flex", gap: 2 }}>
                    {[0.1, 0.3, 0.5, 0.7, 0.9, 1.0].map(p => (
                      <div key={p} style={{ width: 18, height: 14, borderRadius: 3, background: ltvHeat(p * 500, 500) }} />
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>Alto</span>
                </div>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "10px 20px", fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 180, position: "sticky", left: 0, background: "var(--bg-2)", zIndex: 2, borderRight: "1px solid var(--border)" }}>
                        Mes de 1ª Compra
                      </th>
                      {colLabels.map((lbl) => (
                        <th key={lbl} style={{ textAlign: "right", padding: "10px 20px", fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 120 }}>
                          {lbl}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.map((cohort, ri) => (
                      <tr key={cohort.month} style={{ borderBottom: "1px solid var(--border)" }}>
                        {/* Row label */}
                        <td style={{ padding: "12px 20px", position: "sticky", left: 0, background: "var(--card)", borderRight: "1px solid var(--border)", zIndex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{cohort.label}</p>
                          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                            {cohort.newCustomers.toLocaleString("es-MX")} clientes
                          </p>
                        </td>
                        {/* LTV cells — triangular: only show observed months */}
                        {colLabels.map((_, ci) => {
                          const val = cohort.monthlyLtv[ci];
                          const hasValue = val !== undefined;
                          return (
                            <td key={ci} style={{
                              padding: "12px 20px",
                              textAlign: "right",
                              background: hasValue ? ltvHeat(val, data.maxLtv) : "transparent",
                              borderLeft: "1px solid var(--border)",
                            }}>
                              {hasValue ? (
                                <span style={{
                                  fontSize: 13, fontWeight: 600,
                                  color: val / data.maxLtv > 0.6 ? "#fff" : "var(--text)",
                                }}>
                                  {fmtUSD(val)}
                                </span>
                              ) : (
                                <span style={{ fontSize: 12, color: "var(--text-4)", opacity: 0.3 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.cohorts.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)" }}>Sin datos de cohortes</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>Selecciona un período con ventas registradas</p>
                </div>
              )}
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  DETAIL TABLE — LTV:CAC per month                ║
                ╚══════════════════════════════════════════════════╝ */}
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Detalle por Mes de Adquisición</p>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>Métricas de cohorte mensual</p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Mes de 1ª Compra</th>
                      <th style={{ textAlign: "right" }}>Nuevos Clientes</th>
                      <th style={{ textAlign: "right" }}>Tasa Recompra</th>
                      <th style={{ textAlign: "right" }}>Revenue</th>
                      <th style={{ textAlign: "right" }}>LTV</th>
                      <th style={{ textAlign: "right" }}>CAC</th>
                      <th style={{ textAlign: "right" }}>LTV:CAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.map((c) => {
                      const ratioOk = c.ratio >= 1;
                      const ratioGood = c.ratio >= 3;
                      return (
                        <tr key={c.month}>
                          <td style={{ fontWeight: 600 }}>{c.label}</td>
                          <td style={{ textAlign: "right", color: "var(--text-2)" }}>
                            {c.newCustomers.toLocaleString("es-MX")}
                          </td>
                          <td style={{ textAlign: "right", color: "var(--text-3)" }}>
                            {c.repurchaseRate}%
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 600, fontFamily: "monospace" }}>
                            {fmtUSD(c.revenue)}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: "#0E766E", fontFamily: "monospace" }}>
                            {fmtUSD(c.ltv)}
                          </td>
                          <td style={{ textAlign: "right", color: "#F59E0B", fontWeight: 600, fontFamily: "monospace" }}>
                            {fmtUSD(c.cac)}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span style={{
                              display: "inline-block", padding: "3px 10px", borderRadius: 20,
                              fontSize: 12, fontWeight: 700,
                              background: ratioGood ? "var(--green-bg)" : ratioOk ? "var(--blue-bg)" : "var(--red-bg)",
                              color: ratioGood ? "var(--green-text)" : ratioOk ? "var(--blue-text)" : "var(--red-text)",
                            }}>
                              {fmtRatio(c.ratio)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Data source note ─────────────────────────────── */}
            <div style={{ padding: "14px 18px", borderRadius: 10, background: "var(--green-bg)", border: "1px solid var(--green)", borderLeftWidth: 4 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--green-text)" }}>
                ✅ Datos reales de Shopify (read_customers activo): LTV y tasa de recompra calculados con historial individual de cada cliente
                ({at.customers.toLocaleString("es-MX")} clientes · Glowmmi + Balancea).
                El CAC se obtiene del gasto en ads registrado.
              </p>
            </div>

            {/* ── Frecuencia de compra (Glowmmi) ───────────────── */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Frecuencia de compra — Glowmmi</p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 16 }}>
                De 5,223 clientes registrados · Solo 1,426 han comprado (27.3%) · Solo 17 clientes tienen 2+ órdenes (1.2% repeat rate)
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[
                  { label: "0 órdenes",    count: 3797, pct: 72.7, note: "Registrados sin compra", color: "var(--border)" },
                  { label: "1 orden",       count: 1409, pct: 27.0, note: "Compradores únicos",    color: "#0E766E" },
                  { label: "2–3 órdenes",  count: 17,   pct: 0.3,  note: "Clientes repeat",       color: "#15803d" },
                  { label: "4+ órdenes",   count: 0,    pct: 0.0,  note: "Clientes VIP",          color: "#166534" },
                ].map((seg) => (
                  <div key={seg.label} style={{ flex: 1, minWidth: 140, background: "var(--bg)", borderRadius: 10,
                    padding: "14px 16px", border: `2px solid ${seg.color}20` }}>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>{seg.label}</p>
                    <p style={{ fontSize: 22, fontWeight: 800, color: seg.color === "var(--border)" ? "var(--text-3)" : seg.color }}>
                      {seg.count.toLocaleString("es-MX")}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{seg.pct}% · {seg.note}</p>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 12 }}>
                💡 <strong>Oportunidad:</strong> 3,797 clientes con email registrado y 0 compras — candidatos ideales para campaña de retención/winback.
              </p>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
