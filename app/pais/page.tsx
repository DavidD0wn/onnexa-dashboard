"use client";
import { useEffect, useState, useCallback } from "react";
import { Globe, TrendingUp, TrendingDown, RefreshCw, AlertTriangle } from "lucide-react";
import { useFilters } from "@/lib/filters";
import { useCurrency } from "@/lib/currency";

interface CountryKpi {
  name: string;
  code: string;
  currency: string;
  exchangeRate: number;
  revenue: number;
  net: number;
  profit: number;
  orders: number;
  units: number;
  adSpend: number;
  cogs: number;
  shipping: number;
  fees: number;
}

const COUNTRY_FLAGS: Record<string, string> = { MX: "🇲🇽", US: "🇺🇸", CL: "🇨🇱" };
const COUNTRY_COLORS: Record<string, string> = { MX: "#EF4444", US: "#3B82F6", CL: "#F59E0B" };

function safe(v: number | null, decimals = 2): string {
  if (v === null || !isFinite(v)) return "—";
  return v.toFixed(decimals);
}

export default function PaisPage() {
  const { days, brand, isCustom, customFrom, customTo } = useFilters();
  const { fmtC } = useCurrency();
  const [countries, setCountries] = useState<CountryKpi[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isCustom && customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", String(days));
    }
    if (brand !== "all") params.set("brand", brand);
    fetch(`/api/dashboard?${params}`)
      .then((r) => r.json())
      .then((d) => { setCountries(d.byCountry ?? []); setLoading(false); });
  }, [days, brand, isCustom, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const total = countries.reduce(
    (acc, c) => ({ revenue: acc.revenue + c.revenue, profit: acc.profit + c.profit, orders: acc.orders + c.orders, adSpend: acc.adSpend + c.adSpend }),
    { revenue: 0, profit: 0, orders: 0, adSpend: 0 }
  );

  const derive = (c: CountryKpi) => {
    const margin  = c.revenue > 0 ? (c.profit / c.revenue) * 100 : null;
    const cpa     = c.orders > 0 && c.adSpend > 0 ? c.adSpend / c.orders : null;
    const roas    = c.adSpend > 0 ? c.revenue / c.adSpend : null;
    const mer     = c.adSpend > 0 ? c.revenue / c.adSpend : null;
    const aov     = c.orders > 0 ? c.revenue / c.orders : null;
    const cpaBe   = c.orders > 0 ? (c.revenue - c.cogs - c.shipping - c.fees) / c.orders : null;
    const profitPerOrder = c.orders > 0 ? c.profit / c.orders : null;
    const revenueLocal = c.revenue * (c.exchangeRate ?? 1);
    return { margin, cpa, roas, mer, aov, cpaBe, profitPerOrder, revenueLocal };
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2.5px solid var(--blue)", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* Topbar */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Globe size={16} style={{ color: "var(--blue)" }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>KPIs por País</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Comparativo México · USA · Chile · Últimos {days} días</p>
            </div>
          </div>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "var(--card)", border: "1.5px solid var(--border)", color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw size={13} />Actualizar
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Chile warning */}
        {countries.some((c) => c.code === "CL") && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderRadius: 10, background: "var(--yellow-bg)", border: "1px solid var(--yellow)", borderLeftWidth: 4 }}>
            <AlertTriangle size={15} style={{ color: "var(--yellow)", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--yellow-text)" }}>
              🇨🇱 Chile — Conversión CLP/USD en revisión. Valida la tasa de cambio antes de usar la utilidad como definitiva.
            </span>
          </div>
        )}

        {/* Summary KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {[
            { label: "Revenue Total",  value: fmtC(total.revenue), sub: `${countries.length} mercados activos` },
            { label: "Utilidad Total", value: fmtC(total.profit),  sub: total.revenue > 0 ? `${((total.profit / total.revenue) * 100).toFixed(1)}% margen` : "—" },
            { label: "Pedidos Total",  value: String(total.orders), sub: `${days} días` },
            { label: "Ad Spend Total", value: fmtC(total.adSpend), sub: total.revenue > 0 ? `${((total.adSpend / total.revenue) * 100).toFixed(1)}% del revenue` : "—" },
          ].map((k) => (
            <div key={k.label} className="kpi-card">
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>{k.label}</p>
              <p style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>{k.sub}</p>
            </div>
          ))}
        </div>

        {/* Per-country cards */}
        {countries.length === 0 ? (
          <div className="card" style={{ padding: "48px", textAlign: "center" }}>
            <p style={{ fontSize: 14, color: "var(--text-3)" }}>No hay datos de países para este período.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
            {countries.map((c) => {
              const d = derive(c);
              const flag = COUNTRY_FLAGS[c.code] ?? "🌎";
              const color = COUNTRY_COLORS[c.code] ?? "var(--blue)";
              const isChile = c.code === "CL";
              const revenueShare = total.revenue > 0 ? (c.revenue / total.revenue) * 100 : 0;

              return (
                <div key={c.name} className="card" style={{ padding: "24px", position: "relative", overflow: "hidden" }}>

                  {/* Color accent bar top */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: "12px 12px 0 0" }} />

                  {/* Header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, marginTop: 8 }}>
                    <span style={{ fontSize: 28 }}>{flag}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{c.name}</p>
                      <p style={{ fontSize: 11, color: "var(--text-3)" }}>{c.currency} · {revenueShare.toFixed(1)}% del revenue total</p>
                    </div>
                    {isChile && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: "var(--yellow-bg)", color: "var(--yellow-text)" }}>
                        ⚠ En revisión
                      </span>
                    )}
                  </div>

                  {/* Revenue share bar */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--bg-2)" }}>
                      <div style={{ height: "100%", borderRadius: 3, background: color, width: `${Math.min(revenueShare, 100)}%`, transition: "width 0.6s ease" }} />
                    </div>
                  </div>

                  {/* KPI Grid — Row 1: Financiero */}
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>Financiero</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                    {[
                      { label: "Revenue USD",     value: fmtC(c.revenue) },
                      { label: "Utilidad",        value: fmtC(c.profit),   color: c.profit >= 0 ? "var(--green)" : "var(--red)" },
                      { label: "Margen",          value: d.margin !== null ? `${d.margin.toFixed(1)}%` : "—", color: d.margin !== null ? (d.margin >= 20 ? "var(--green)" : d.margin >= 10 ? "var(--yellow)" : "var(--red)") : "var(--text-3)" },
                      { label: "Pedidos",         value: String(c.orders) },
                      { label: "AOV USD",         value: d.aov !== null ? fmtC(d.aov) : "—" },
                      { label: "Util/Pedido",     value: d.profitPerOrder !== null ? fmtC(d.profitPerOrder) : "—", color: (d.profitPerOrder ?? 0) >= 0 ? "var(--green)" : "var(--red)" },
                    ].map((m) => (
                      <div key={m.label}>
                        <p style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3 }}>{m.label}</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: m.color ?? "var(--text)" }}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{ height: 1, background: "var(--border)", marginBottom: 14 }} />

                  {/* KPI Grid — Row 2: Publicidad */}
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>Publicidad</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                    {[
                      { label: "Ad Spend",  value: fmtC(c.adSpend) },
                      { label: "CPA Real",  value: d.cpa !== null ? fmtC(d.cpa) : "Sin pauta",   color: d.cpa !== null && d.cpaBe !== null ? (d.cpa > d.cpaBe ? "var(--red)" : "var(--green)") : "var(--text-3)" },
                      { label: "CPA BE",    value: d.cpaBe !== null ? fmtC(d.cpaBe) : "—" },
                      { label: "ROAS",      value: d.roas !== null ? `${d.roas.toFixed(2)}x` : "—", color: d.roas !== null ? (d.roas >= 3 ? "var(--green)" : d.roas >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)" },
                      { label: "MER",       value: d.mer  !== null ? `${d.mer.toFixed(2)}x`  : "—" },
                      { label: "Δ CPA/BE",  value: d.cpa !== null && d.cpaBe !== null ? (d.cpaBe - d.cpa >= 0 ? `+${fmtC(d.cpaBe - d.cpa)}` : fmtC(d.cpaBe - d.cpa)) : "—", color: d.cpa !== null && d.cpaBe !== null ? (d.cpaBe - d.cpa >= 0 ? "var(--green)" : "var(--red)") : "var(--text-3)" },
                    ].map((m) => (
                      <div key={m.label}>
                        <p style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3 }}>{m.label}</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: m.color ?? "var(--text)" }}>{m.value}</p>
                      </div>
                    ))}
                  </div>

                  <div style={{ height: 1, background: "var(--border)", marginBottom: 14 }} />

                  {/* KPI Grid — Row 3: Costos */}
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>Estructura de Costos</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                    {[
                      { label: "COGS",     value: fmtC(c.cogs),     pct: c.revenue > 0 ? (c.cogs / c.revenue * 100).toFixed(0) : "0" },
                      { label: "Flete",    value: fmtC(c.shipping),  pct: c.revenue > 0 ? (c.shipping / c.revenue * 100).toFixed(0) : "0" },
                      { label: "Fees",     value: fmtC(c.fees),      pct: c.revenue > 0 ? (c.fees / c.revenue * 100).toFixed(0) : "0" },
                      { label: "Ad Spend", value: fmtC(c.adSpend),   pct: c.revenue > 0 ? (c.adSpend / c.revenue * 100).toFixed(0) : "0" },
                    ].map((m) => (
                      <div key={m.label} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                        <p style={{ fontSize: 9, color: "var(--text-3)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</p>
                        <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{m.value}</p>
                        <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>{m.pct}% rev</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Comparison table */}
        {countries.length > 1 && (
          <div className="card" style={{ overflow: "hidden" }}>
            <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Comparativo por País</p>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>Todos los mercados en USD · Últimos {days} días</p>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>País</th>
                    <th style={{ textAlign: "right" }}>Revenue USD</th>
                    <th style={{ textAlign: "right" }}>% Total</th>
                    <th style={{ textAlign: "right" }}>Pedidos</th>
                    <th style={{ textAlign: "right" }}>AOV</th>
                    <th style={{ textAlign: "right" }}>Utilidad</th>
                    <th style={{ textAlign: "right" }}>Margen</th>
                    <th style={{ textAlign: "right" }}>CPA Real</th>
                    <th style={{ textAlign: "right" }}>CPA BE</th>
                    <th style={{ textAlign: "right" }}>ROAS</th>
                    <th style={{ textAlign: "right" }}>Util/Pedido</th>
                  </tr>
                </thead>
                <tbody>
                  {countries.map((c) => {
                    const d = derive(c);
                    const flag = COUNTRY_FLAGS[c.code] ?? "🌎";
                    const color = COUNTRY_COLORS[c.code] ?? "var(--blue)";
                    const revenueShare = total.revenue > 0 ? (c.revenue / total.revenue) * 100 : 0;

                    return (
                      <tr key={c.name}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{flag} {c.name}</span>
                          </div>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{fmtC(c.revenue)}</td>
                        <td style={{ textAlign: "right", color: "var(--text-3)" }}>{revenueShare.toFixed(1)}%</td>
                        <td style={{ textAlign: "right" }}>{c.orders}</td>
                        <td style={{ textAlign: "right" }}>{d.aov !== null ? fmtC(d.aov) : "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: c.profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmtC(c.profit)}</td>
                        <td style={{ textAlign: "right" }}>
                          {d.margin !== null ? (
                            <span style={{ fontWeight: 700, color: d.margin >= 20 ? "var(--green)" : d.margin >= 10 ? "var(--yellow)" : "var(--red)" }}>
                              {d.margin.toFixed(1)}%
                            </span>
                          ) : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: d.cpa !== null && d.cpaBe !== null ? (d.cpa > d.cpaBe ? "var(--red)" : "var(--green)") : "var(--text-3)", fontWeight: 600 }}>
                          {d.cpa !== null ? fmtC(d.cpa) : "Sin pauta"}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--text-2)" }}>{d.cpaBe !== null ? fmtC(d.cpaBe) : "—"}</td>
                        <td style={{ textAlign: "right", color: d.roas !== null ? (d.roas >= 3 ? "var(--green)" : d.roas >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)", fontWeight: 600 }}>
                          {d.roas !== null ? `${d.roas.toFixed(2)}x` : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: (d.profitPerOrder ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                          {d.profitPerOrder !== null ? fmtC(d.profitPerOrder) : "—"}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Total row */}
                  <tr style={{ background: "var(--bg-2)", fontWeight: 700 }}>
                    <td style={{ fontWeight: 700, color: "var(--text)" }}>🌎 Total</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: "var(--text)" }}>{fmtC(total.revenue)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-3)" }}>100%</td>
                    <td style={{ textAlign: "right" }}>{total.orders}</td>
                    <td style={{ textAlign: "right" }}>{total.orders > 0 ? fmtC(total.revenue / total.orders) : "—"}</td>
                    <td style={{ textAlign: "right", fontWeight: 800, color: total.profit >= 0 ? "var(--green)" : "var(--red)" }}>{fmtC(total.profit)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ fontWeight: 700, color: total.revenue > 0 ? ((total.profit / total.revenue) >= 0.2 ? "var(--green)" : (total.profit / total.revenue) >= 0.1 ? "var(--yellow)" : "var(--red)") : "var(--text-3)" }}>
                        {total.revenue > 0 ? `${((total.profit / total.revenue) * 100).toFixed(1)}%` : "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", color: "var(--text-2)" }}>{total.orders > 0 && total.adSpend > 0 ? fmtC(total.adSpend / total.orders) : "Sin pauta"}</td>
                    <td style={{ textAlign: "right", color: "var(--text-2)" }}>—</td>
                    <td style={{ textAlign: "right", color: "var(--text-2)" }}>{total.adSpend > 0 ? `${(total.revenue / total.adSpend).toFixed(2)}x` : "—"}</td>
                    <td style={{ textAlign: "right", color: total.profit >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                      {total.orders > 0 ? fmtC(total.profit / total.orders) : "—"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
