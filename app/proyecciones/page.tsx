"use client";
import { useEffect, useState, useCallback } from "react";
import { useCurrency } from "@/lib/currency";
import { fmtNum, fmtPct } from "@/lib/utils";
import { RefreshCw, TrendingUp, TrendingDown, Zap, Calendar } from "lucide-react";

interface TotalsData {
  orders: number; gross: number; net: number;
  adSpend: number; cogs: number; shipping: number; fees: number;
  profit: number; margin: number; cpa: number | null; roas: number | null; aov: number;
}
interface ChartPoint { date: string; glowmmi: number; balancea: number; profit: number; adSpend: number }
interface DashboardResp { totals: TotalsData; chartData: ChartPoint[] }

function StatusBadge({ label, type }: { label: string; type: "good" | "ok" | "bad" | "neutral" }) {
  const s = {
    good:    { background: "var(--green-bg)",  color: "var(--green-text)" },
    ok:      { background: "var(--yellow-bg)", color: "var(--yellow-text)" },
    bad:     { background: "var(--red-bg)",    color: "var(--red-text)" },
    neutral: { background: "var(--bg-2)",      color: "var(--text-3)" },
  };
  return (
    <span style={{ ...s[type], display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", textTransform: "uppercase" }}>
      {label}
    </span>
  );
}

const BASE_PERIODS = [
  { label: "7 días",  days: 7  },
  { label: "14 días", days: 14 },
  { label: "30 días", days: 30 },
  { label: "60 días", days: 60 },
];

export default function ProyeccionesPage() {
  const { fmtC } = useCurrency();
  const [baseDays, setBaseDays]   = useState(30);
  const [growth, setGrowth]       = useState(0); // % growth rate per month
  const [data, setData]           = useState<DashboardResp | null>(null);
  const [loading, setLoading]     = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/dashboard?days=${baseDays}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [baseDays]);

  useEffect(() => { load(); }, [load]);

  const t = data?.totals;

  // Daily averages from base period
  const avgRevDay   = t ? t.gross   / baseDays : 0;
  const avgProfDay  = t ? t.profit  / baseDays : 0;
  const avgOrdsDay  = t ? t.orders  / baseDays : 0;
  const avgSpendDay = t ? t.adSpend / baseDays : 0;

  // Apply growth rate to project next 30 days
  const growthFactor = 1 + growth / 100;
  const proj30Rev    = avgRevDay   * 30 * growthFactor;
  const proj30Profit = avgProfDay  * 30 * growthFactor;
  const proj30Ords   = avgOrdsDay  * 30 * growthFactor;
  const proj30Spend  = avgSpendDay * 30 * growthFactor;
  const projMargin   = proj30Rev > 0 ? (proj30Profit / proj30Rev) * 100 : 0;

  // Scenarios: conservative -20%, base 0%, optimistic +20%
  const scenarios = [
    { label: "Pesimista", factor: 0.80, color: "#DC2626", bg: "var(--red-bg)", textColor: "var(--red-text)", icon: TrendingDown, badge: "bad" as const },
    { label: "Base",      factor: 1.00, color: "#2563EB", bg: "#EFF6FF",       textColor: "#1D4ED8",          icon: TrendingUp,   badge: "neutral" as const },
    { label: "Optimista", factor: 1.20, color: "#059669", bg: "var(--green-bg)", textColor: "var(--green-text)", icon: TrendingUp, badge: "good" as const },
  ];

  // Mini bar chart for historical data
  const chartData = data?.chartData ?? [];
  const maxRev = Math.max(...chartData.map((d) => d.glowmmi + d.balancea), 1);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* Topbar */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Proyecciones</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Proyecta los próximos 30 días basado en tu histórico</p>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Controls ── */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>

            {/* Base period */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>
                Período base (histórico)
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                {BASE_PERIODS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => setBaseDays(p.days)}
                    style={{
                      padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                      border: "1.5px solid var(--border)", cursor: "pointer",
                      background: baseDays === p.days ? "#0E766E" : "var(--card)",
                      color: baseDays === p.days ? "#fff" : "var(--text-2)",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Growth rate */}
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
                  Tasa de crecimiento esperada
                </p>
                <span style={{
                  fontSize: 14, fontWeight: 800,
                  color: growth > 0 ? "var(--green)" : growth < 0 ? "var(--red)" : "var(--text-3)",
                }}>
                  {growth > 0 ? "+" : ""}{growth}%
                </span>
              </div>
              <input
                type="range"
                min={-50} max={100} step={5}
                value={growth}
                onChange={(e) => setGrowth(Number(e.target.value))}
                style={{ width: "100%", accentColor: "#0E766E" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>−50%</span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>0%</span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>+100%</span>
              </div>
            </div>

            {/* Reset */}
            <button
              onClick={() => setGrowth(0)}
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: "1.5px solid var(--border)", cursor: "pointer",
                background: "var(--card)", color: "var(--text-2)",
              }}
            >
              Resetear
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : t ? (
          <>
            {/* ── Daily averages (base) ── */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Calendar size={14} style={{ color: "var(--text-3)" }} />
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Promedio diario — últimos {baseDays} días
                </p>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                {[
                  { label: "Revenue / día",   value: fmtC(avgRevDay),   color: "#2563EB" },
                  { label: "Utilidad / día",  value: fmtC(avgProfDay),  color: avgProfDay >= 0 ? "var(--green)" : "var(--red)" },
                  { label: "Pedidos / día",   value: fmtNum(avgOrdsDay, 1), color: "#7C3AED" },
                  { label: "Margen promedio", value: fmtPct(t.margin, 1), color: t.margin >= 20 ? "var(--green)" : t.margin >= 10 ? "var(--yellow)" : "var(--red)" },
                ].map((c) => (
                  <div key={c.label} className="kpi-card">
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>
                      {c.label}
                    </p>
                    <p style={{ fontSize: 26, fontWeight: 800, color: c.color, letterSpacing: "-0.02em", lineHeight: 1 }}>
                      {c.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Projection main card ── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

              {/* Projected 30-day metrics */}
              <div className="card" style={{
                padding: "28px 32px",
                background: growth > 0
                  ? "linear-gradient(135deg, #064E3B 0%, #065F46 100%)"
                  : growth < 0
                  ? "linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)"
                  : "linear-gradient(135deg, #12304A 0%, #1a4060 100%)",
                border: "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                  <Zap size={18} style={{ color: "rgba(255,255,255,0.7)" }} />
                  <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Proyección próximos 30 días
                  </p>
                  {growth !== 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      padding: "2px 10px", borderRadius: 20,
                      background: growth > 0 ? "rgba(52,211,153,0.25)" : "rgba(252,165,165,0.25)",
                      color: growth > 0 ? "#34D399" : "#FCA5A5",
                    }}>
                      {growth > 0 ? "+" : ""}{growth}% crecimiento
                    </span>
                  )}
                </div>

                <p style={{ fontSize: 48, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1, marginBottom: 8 }}>
                  {fmtC(proj30Rev)}
                </p>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", marginBottom: 24 }}>
                  Revenue proyectado
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
                  {[
                    { label: "Utilidad",  value: fmtC(proj30Profit),  color: proj30Profit >= 0 ? "#34D399" : "#FCA5A5" },
                    { label: "Margen",    value: fmtPct(projMargin, 1), color: projMargin >= 20 ? "#34D399" : projMargin >= 10 ? "#FDE68A" : "#FCA5A5" },
                    { label: "Pedidos",   value: fmtNum(proj30Ords, 0), color: "#A5B4FC" },
                    { label: "Ad Spend",  value: fmtC(proj30Spend),    color: "#FCD34D" },
                  ].map((item) => (
                    <div key={item.label}>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{item.label}</p>
                      <p style={{ fontSize: 18, fontWeight: 800, color: item.color }}>{item.value}</p>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 24, padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.08)" }}>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                    Basado en promedio de <strong style={{ color: "#fff" }}>{fmtC(avgRevDay)}/día</strong> de los últimos {baseDays} días
                    {growth !== 0 && <> con un factor de crecimiento de <strong style={{ color: growth > 0 ? "#34D399" : "#FCA5A5" }}>{growth > 0 ? "+" : ""}{growth}%</strong></>}
                  </p>
                </div>
              </div>

              {/* Mini chart: historical */}
              <div className="card" style={{ padding: "24px" }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Histórico — Revenue diario</p>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>Últimos {baseDays} días (referencia para la proyección)</p>

                {chartData.length > 0 ? (
                  <div>
                    {/* Bar chart */}
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120, marginBottom: 8 }}>
                      {chartData.slice(-30).map((d, i) => {
                        const total = d.glowmmi + d.balancea;
                        const h = maxRev > 0 ? (total / maxRev) * 100 : 0;
                        const profitPos = d.profit >= 0;
                        return (
                          <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <div
                              title={`${d.date}: ${fmtC(total)}`}
                              style={{
                                width: "100%",
                                height: `${Math.max(h, 2)}%`,
                                borderRadius: "2px 2px 0 0",
                                background: profitPos ? "#0E766E" : "#DC2626",
                                opacity: 0.85,
                                transition: "height 0.3s ease",
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {/* X axis labels */}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      {[chartData[Math.max(0, chartData.length - 30)], chartData[Math.floor(chartData.length - 15)], chartData[chartData.length - 1]].filter(Boolean).map((d) => (
                        <span key={d.date} style={{ fontSize: 9, color: "var(--text-3)" }}>{d.date.slice(5)}</span>
                      ))}
                    </div>
                    {/* Legend */}
                    <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "#0E766E" }} />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Día rentable</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: "#DC2626" }} />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Día a pérdida</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>Sin datos históricos</p>
                )}
              </div>
            </div>

            {/* ── 3 Scenarios ── */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Escenarios para los próximos 30 días
                </p>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {scenarios.map((s) => {
                  const ScenarioIcon = s.icon;
                  const sRev    = avgRevDay    * 30 * growthFactor * s.factor;
                  const sProfit = avgProfDay   * 30 * growthFactor * s.factor;
                  const sOrds   = avgOrdsDay   * 30 * growthFactor * s.factor;
                  const sMargin = sRev > 0 ? (sProfit / sRev) * 100 : 0;
                  const totalFactor = growthFactor * s.factor;
                  const pctVsBase = ((totalFactor - 1) * 100);
                  return (
                    <div key={s.label} className="card" style={{ padding: "24px", border: `2px solid ${s.color}20` }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: s.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <ScenarioIcon size={15} style={{ color: s.color }} />
                          </div>
                          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{s.label}</p>
                        </div>
                        <StatusBadge
                          label={pctVsBase > 0 ? `+${pctVsBase.toFixed(0)}%` : pctVsBase < 0 ? `${pctVsBase.toFixed(0)}%` : "Base"}
                          type={s.badge}
                        />
                      </div>

                      <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>Revenue</p>
                      <p style={{ fontSize: 32, fontWeight: 900, color: s.color, letterSpacing: "-0.02em", lineHeight: 1, marginBottom: 20 }}>
                        {fmtC(sRev)}
                      </p>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {[
                          { label: "Utilidad",  value: fmtC(sProfit), color: sProfit >= 0 ? "var(--green)" : "var(--red)" },
                          { label: "Margen",    value: fmtPct(sMargin, 1), color: sMargin >= 20 ? "var(--green)" : sMargin >= 10 ? "var(--yellow)" : "var(--red)" },
                          { label: "Pedidos",   value: fmtNum(sOrds, 0), color: "var(--text)" },
                        ].map((m) => (
                          <div key={m.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{m.label}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</span>
                          </div>
                        ))}
                      </div>

                      <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 14 }}>
                        {s.factor < 1 ? `${((1 - s.factor) * 100).toFixed(0)}% por debajo del escenario base` :
                         s.factor > 1 ? `${((s.factor - 1) * 100).toFixed(0)}% por encima del escenario base` :
                         "Proyección directa sin ajuste adicional"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Assumptions note ── */}
            <div className="card" style={{ padding: "18px 24px", background: "var(--bg-2)" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>⚠️ Supuestos de la proyección</p>
              <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
                Las proyecciones asumen que el comportamiento histórico de los últimos <strong>{baseDays} días</strong> se mantiene constante, ajustado por la tasa de crecimiento seleccionada ({growth > 0 ? "+" : ""}{growth}%).
                El gasto publicitario proyectado es proporcional al histórico. <strong>Los escenarios no incluyen variables externas</strong> como estacionalidad, cambios en costos o pausas de pauta.
                Ad Spend histórico en el período base: <strong>{fmtC(t.adSpend)}</strong> ({fmtC(avgSpendDay)}/día).
              </p>
            </div>
          </>
        ) : null}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
