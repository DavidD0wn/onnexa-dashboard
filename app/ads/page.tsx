"use client";
import { useEffect, useState, useCallback } from "react";
import { fmtNum, localDateStr, daysAgoLocal } from "@/lib/utils";
import { useFilters } from "@/lib/filters";
import { useCurrency } from "@/lib/currency";
import { RefreshCw, BarChart3, TrendingUp } from "lucide-react";

interface DashboardData {
  totals: {
    orders: number; gross: number; net: number;
    adSpend: number; cogs: number; shipping: number; fees: number;
    profit: number; margin: number; cpa: number | null; roas: number | null; aov: number; mer: number | null;
  };
  byBrand: Array<{ name: string; revenue: number; profit: number; orders: number }>;
}

interface MetaTotals {
  spend: number; impressions: number; clicks: number; purchases: number;
  conversionValue: number; roas: number; cpa: number; ctr: number; cpc: number; cpm: number;
}
interface MetaCampaign {
  campaignName: string; brandId: string;
  accountId: string; accountName: string;
  isActive: boolean; lastDateStr: string;
  spend: number; clicks: number; purchases: number;
  conversionValue: number; roas: number; cpa: number; ctr: number; impressions: number;
}

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

export default function AdsPage() {
  const { days, isCustom, customFrom, customTo } = useFilters();
  const { fmtC } = useCurrency();

  // Dashboard data (for cost structure)
  const [dash,    setDash]    = useState<DashboardData | null>(null);
  // Meta Ads real data
  const [metaTot, setMetaTot] = useState<MetaTotals | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [brandFilter, setBrandFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [loading,  setLoading]  = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  // Load dashboard (cost data)
  const loadDash = useCallback(() => {
    const params = new URLSearchParams();
    if (isCustom && customFrom && customTo) { params.set("from", customFrom); params.set("to", customTo); }
    else params.set("days", String(days));
    fetch(`/api/dashboard?${params}`)
      .then(r => r.json())
      .then(d => setDash(d))
      .catch(() => {});
  }, [days, isCustom, customFrom, customTo]);

  // Load Meta Ads real data
  const loadMeta = useCallback(async () => {
    const today = localDateStr();
    const from  = isCustom && customFrom ? customFrom : daysAgoLocal(days - 1);
    const to    = isCustom && customTo ? customTo : today;
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (brandFilter) params.set("brandId", brandFilter);
    const res  = await fetch(`/api/meta-ads/insights?${params}`);
    const data = await res.json();
    setMetaTot(data.totals ?? null);
    setCampaigns(data.campaigns ?? []);
  }, [days, isCustom, customFrom, customTo, brandFilter]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadDash(), loadMeta()]).finally(() => setLoading(false));
  }, [loadDash, loadMeta]);

  useEffect(() => {
    fetch("/api/meta-ads/sync")
      .then(r => r.json())
      .then(d => { if (d.lastSync?.createdAt) setLastSync(new Date(d.lastSync.createdAt).toLocaleString("es-MX")); });
  }, []);

  async function doSync() {
    setSyncing(true);
    const today = localDateStr();
    const from  = daysAgoLocal(30);
    const res   = await fetch("/api/meta-ads/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateFrom: from, dateTo: today }),
    });
    const d = await res.json();
    if (d.ok) { setLastSync(new Date().toLocaleString("es-MX")); await loadMeta(); }
    else alert("Error: " + d.error);
    setSyncing(false);
  }

  const t   = dash?.totals;
  const m   = metaTot;

  // Use Meta Ads real spend for CPA analysis
  const adSpend       = m?.spend ?? 0;
  const realPurchases = m?.purchases ?? 0;
  const realRoas      = m?.roas ?? null;
  const realCpa       = m?.cpa ?? null;

  const cogsPerOrder  = t && t.orders > 0 ? t.cogs / t.orders : 0;
  const shipPerOrder  = t && t.orders > 0 ? t.shipping / t.orders : 0;
  const feesPerOrder  = t && t.orders > 0 ? t.fees / t.orders : 0;
  const breakEvenCpa  = t && t.orders > 0 ? (t.gross - t.cogs - t.shipping - t.fees) / t.orders : 0;
  const cpaMáx        = t ? t.aov - cogsPerOrder - shipPerOrder - feesPerOrder - (t.aov * 0.15) : 0;
  const spendPct      = t && t.gross > 0 ? (adSpend / t.gross) * 100 : 0;
  const dailySpend    = adSpend / days;
  const dailyOrders   = t ? t.orders / days : 0;

  const cpaStatus = t && cpaMáx > 0 && realCpa !== null
    ? realCpa > cpaMáx        ? "bad"
    : realCpa > cpaMáx * 0.85 ? "ok"
    : "good"
    : "neutral";
  const cpaEmoji = cpaStatus === "bad" ? "🔴" : cpaStatus === "ok" ? "🟡" : "🟢";

  const fmt2 = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const roasC = (r: number) => r >= 3 ? "var(--green)" : r >= 2 ? "var(--yellow)" : "var(--red)";

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* Topbar */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Publicidad</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              Meta Ads · {days === 1 ? "hoy" : `últimos ${days} días`} · <strong style={{ color: "var(--text-2)" }}>todos los montos en USD</strong>
              {lastSync && ` · sync: ${lastSync}`}
            </p>
          </div>
          <div style={{ flex: 1 }} />
          {/* Brand filter */}
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
            {[{ id: "", l: "Todas" }, { id: "brand_glowmmi", l: "Glowmmi" }, { id: "brand_balancea", l: "Balancea" }].map(b => (
              <button key={b.id} onClick={() => setBrandFilter(b.id)} style={{
                padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                background: brandFilter === b.id ? "var(--primary)" : "var(--card)",
                color: brandFilter === b.id ? "#fff" : "var(--text-2)",
              }}>{b.l}</button>
            ))}
          </div>
          <button onClick={doSync} disabled={syncing} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
            background: "var(--primary)", color: "#fff", fontSize: 12, fontWeight: 600,
            cursor: "pointer", border: "none", opacity: syncing ? 0.6 : 1,
          }}>
            <RefreshCw size={13} style={{ animation: syncing ? "spin 0.8s linear infinite" : "none" }} />
            {syncing ? "Sincronizando..." : "Sincronizar 30d"}
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {loading && !m ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : (
          <>
            {/* ── Fila 1: Spend + eficiencia ── */}
            <div>
              <SectionLabel>Gasto publicitario (Meta Ads real)</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 14 }}>

                {/* Hero: Ad Spend */}
                <div className="card" style={{ padding: "28px 32px", background: "linear-gradient(135deg, #78350F 0%, #92400E 100%)", border: "none" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>
                    Ad Spend Total
                  </p>
                  <p style={{ fontSize: 48, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>
                    ${fmt2(adSpend)}
                  </p>
                  <div style={{ marginTop: 16, display: "flex", gap: 28 }}>
                    {[
                      { label: "Por día",      value: `$${fmt2(dailySpend)}` },
                      { label: "Compras",       value: fmtNum(realPurchases, 0) },
                      { label: "Impresiones",   value: (m?.impressions ?? 0).toLocaleString() },
                    ].map((item) => (
                      <div key={item.label}>
                        <p style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.label}</p>
                        <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginTop: 2 }}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ROAS */}
                <div className="kpi-card">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>ROAS</p>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: (realRoas != null ? roasC(realRoas) : "var(--text-3)") + "20", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <BarChart3 size={14} style={{ color: realRoas != null ? roasC(realRoas) : "var(--text-3)" }} />
                    </div>
                  </div>
                  <p style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1, color: realRoas != null ? roasC(realRoas) : "var(--text-3)" }}>
                    {realRoas != null ? `${fmt2(realRoas)}x` : "—"}
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <StatusBadge label={realRoas != null ? (realRoas >= 3 ? "Excelente ✓" : realRoas >= 2 ? "Bueno" : "Bajo ⚠") : "Sin datos"} type={realRoas != null ? (realRoas >= 3 ? "good" : realRoas >= 2 ? "ok" : "bad") : "neutral"} />
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Por cada $1 invertido</p>
                </div>

                {/* CPC / CTR */}
                <div className="kpi-card">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>Clics</p>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "#7C3AED20", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <TrendingUp size={14} style={{ color: "#7C3AED" }} />
                    </div>
                  </div>
                  <p style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1, color: "#7C3AED" }}>
                    {(m?.clicks ?? 0).toLocaleString()}
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <StatusBadge label={`CTR ${fmt2(m?.ctr ?? 0)}%`} type="neutral" />
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>CPC: ${fmt2(m?.cpc ?? 0)}</p>
                </div>

                {/* Spend % */}
                <div className="kpi-card">
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>
                    Spend / Revenue
                  </p>
                  <p style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1, color: spendPct <= 25 ? "var(--green)" : spendPct <= 35 ? "var(--yellow)" : "var(--red)" }}>
                    {spendPct > 0 ? `${spendPct.toFixed(1)}%` : "—"}
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <StatusBadge
                      label={spendPct <= 0 ? "Sin ventas" : spendPct <= 25 ? "Eficiente ✓" : spendPct <= 35 ? "Aceptable" : "Alto ⚠"}
                      type={spendPct <= 0 ? "neutral" : spendPct <= 25 ? "good" : spendPct <= 35 ? "ok" : "bad"}
                    />
                  </div>
                  {spendPct > 0 && (
                    <div style={{ marginTop: 14, height: 6, borderRadius: 3, background: "var(--bg-2)", overflow: "hidden" }}>
                      <div style={{ height: 6, borderRadius: 3, width: `${Math.min(spendPct, 100)}%`, background: spendPct <= 25 ? "var(--green)" : spendPct <= 35 ? "var(--yellow)" : "var(--red)", transition: "width 0.6s ease" }} />
                    </div>
                  )}
                  <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>Meta: ≤25%</p>
                </div>
              </div>
            </div>

            {/* ── Fila 2: CPA analysis ── */}
            {t && (
              <div>
                <SectionLabel>Análisis de CPA</SectionLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>

                  {/* CPA Real */}
                  <div className="card" style={{ padding: "24px", background: cpaStatus === "bad" ? "var(--red-bg)" : cpaStatus === "ok" ? "var(--yellow-bg)" : cpaStatus === "good" ? "var(--green-bg)" : "var(--card)", border: "none" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>CPA Real (Meta Ads)</p>
                    <p style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em", lineHeight: 1, color: cpaStatus === "bad" ? "var(--red-text)" : cpaStatus === "ok" ? "var(--yellow-text)" : cpaStatus === "good" ? "var(--green-text)" : "var(--text-3)" }}>
                      {realCpa != null && realCpa > 0 ? fmtC(realCpa) : "—"}
                    </p>
                    <p style={{ fontSize: 13, fontWeight: 700, marginTop: 12, color: cpaStatus === "bad" ? "var(--red-text)" : cpaStatus === "ok" ? "var(--yellow-text)" : cpaStatus === "good" ? "var(--green-text)" : "var(--text-3)" }}>
                      {cpaEmoji} {cpaStatus === "bad" ? "CPA fuera del límite máximo" : cpaStatus === "ok" && realCpa != null ? `${((realCpa / cpaMáx) * 100).toFixed(0)}% del CPA máximo` : cpaStatus === "neutral" ? "Sin gasto publicitario" : "CPA dentro del rango óptimo"}
                    </p>
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${cpaStatus === "bad" ? "var(--red)" : cpaStatus === "ok" ? "var(--yellow)" : "var(--green)"}40` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Break-even CPA</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>{fmtC(breakEvenCpa)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>CPA Máximo (15%)</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)" }}>{fmtC(cpaMáx)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Límites */}
                  <div className="card" style={{ padding: "24px" }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Límites de CPA</p>
                    <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>Zonas de rentabilidad sobre tu AOV actual</p>
                    {[
                      { label: "🟢 Zona óptima (CPA ≤75% máx.)", range: `≤ ${fmtC(cpaMáx * 0.75)}`, color: "var(--green-bg)", textColor: "var(--green-text)" },
                      { label: "🟡 Zona de riesgo (CPA 75–100% máx.)", range: `${fmtC(cpaMáx * 0.75)} – ${fmtC(cpaMáx)}`, color: "var(--yellow-bg)", textColor: "var(--yellow-text)" },
                      { label: "🔴 Zona de pérdida (CPA > máx.)", range: `> ${fmtC(cpaMáx)}`, color: "var(--red-bg)", textColor: "var(--red-text)" },
                    ].map((zone) => (
                      <div key={zone.label} style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 8, background: zone.color }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: zone.textColor, marginBottom: 2 }}>{zone.label}</p>
                        <p style={{ fontSize: 13, fontWeight: 800, color: zone.textColor }}>{zone.range}</p>
                      </div>
                    ))}
                    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                      <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
                        <strong>CPA Máximo</strong> = AOV − COGS/orden − Flete/orden − Fees/orden − 15%
                      </p>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                        = {fmtC(t.aov)} − {fmtC(cogsPerOrder)} − {fmtC(shipPerOrder)} − {fmtC(feesPerOrder)} − {fmtC(t.aov * 0.15)} = <span style={{ color: "#0E766E" }}>{fmtC(cpaMáx)}</span>
                      </p>
                    </div>
                  </div>

                  {/* Por marca */}
                  <div className="card" style={{ padding: "24px" }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Por Marca</p>
                    <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>Spend real de Meta Ads</p>
                    {["brand_glowmmi", "brand_balancea"].map((bId) => {
                      const bCamps = campaigns.filter(c => c.brandId === bId);
                      const bSpend = bCamps.reduce((s, c) => s + c.spend, 0);
                      const bPurch = bCamps.reduce((s, c) => s + c.purchases, 0);
                      const bConv  = bCamps.reduce((s, c) => s + c.conversionValue, 0);
                      const bRoas  = bSpend > 0 ? bConv / bSpend : 0;
                      const bCpa   = bPurch > 0 ? bSpend / bPurch : 0;
                      const isGlow = bId === "brand_glowmmi";
                      return (
                        <div key={bId} style={{ marginBottom: 14, padding: "14px 16px", borderRadius: 12, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isGlow ? "#EC4899" : "#10B981" }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{isGlow ? "Glowmmi" : "Balancea"}</span>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                            {[
                              { label: "Spend", value: `$${fmt2(bSpend)}`,              color: "var(--yellow)" },
                              { label: "CPA",   value: bCpa > 0 ? `$${fmt2(bCpa)}` : "—", color: "var(--text)" },
                              { label: "ROAS",  value: bRoas > 0 ? `${fmt2(bRoas)}x` : "—", color: bRoas >= 3 ? "var(--green)" : bRoas >= 2 ? "var(--yellow)" : bRoas > 0 ? "var(--red)" : "var(--text-3)" },
                            ].map(m2 => (
                              <div key={m2.label} style={{ textAlign: "center" }}>
                                <p style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{m2.label}</p>
                                <p style={{ fontSize: 13, fontWeight: 800, color: m2.color }}>{m2.value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── Campañas ── */}
            <div>
              {/* Header + filtros */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  Campañas
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                {/* Status filter */}
                <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                  {([
                    { id: "all",    label: `Todas (${campaigns.length})` },
                    { id: "active", label: `🟢 Activas (${campaigns.filter(c => c.isActive).length})` },
                    { id: "paused", label: `⏸ Pausadas (${campaigns.filter(c => !c.isActive).length})` },
                  ] as const).map(opt => (
                    <button key={opt.id} onClick={() => setStatusFilter(opt.id)} style={{
                      padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                      background: statusFilter === opt.id ? "var(--primary)" : "var(--card)",
                      color: statusFilter === opt.id ? "#fff" : "var(--text-2)",
                    }}>{opt.label}</button>
                  ))}
                </div>
                <span style={{ fontSize: 10, color: "var(--text-3)", fontStyle: "italic" }}>
                  "Activa" = tuvo gasto en los últimos 3 días
                </span>
              </div>

              <div className="card" style={{ overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Estado</th>
                        <th>Campaña</th>
                        <th>Cuenta</th>
                        <th>Marca</th>
                        <th style={{ textAlign: "right" }}>Gasto USD</th>
                        <th style={{ textAlign: "right" }}>Compras</th>
                        <th style={{ textAlign: "right" }}>Ingresos</th>
                        <th style={{ textAlign: "right" }}>ROAS</th>
                        <th style={{ textAlign: "right" }}>CPA</th>
                        <th style={{ textAlign: "right" }}>CTR</th>
                        <th style={{ textAlign: "right" }}>Clics</th>
                        <th style={{ textAlign: "right" }}>Último gasto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {campaigns
                        .filter(c => statusFilter === "all" ? true : statusFilter === "active" ? c.isActive : !c.isActive)
                        .map((c, i) => (
                        <tr key={i} style={{ opacity: c.isActive ? 1 : 0.65 }}>
                          {/* Estado */}
                          <td>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                              background: c.isActive ? "#D1FAE5" : "var(--bg-2)",
                              color:      c.isActive ? "#065F46" : "var(--text-3)",
                            }}>
                              {c.isActive ? "🟢 Activa" : "⏸ Pausada"}
                            </span>
                          </td>
                          {/* Nombre */}
                          <td style={{ fontWeight: 600, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.campaignName}>
                            {c.campaignName}
                          </td>
                          {/* Cuenta */}
                          <td style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.accountName}>
                            {c.accountName}
                          </td>
                          {/* Marca */}
                          <td>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                              background: c.brandId === "brand_glowmmi" ? "#fce7f3" : "#dbeafe",
                              color:      c.brandId === "brand_glowmmi" ? "#be185d" : "#1d4ed8" }}>
                              {c.brandId === "brand_glowmmi" ? "Glowmmi" : "Balancea"}
                            </span>
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>${fmt2(c.spend)}</td>
                          <td style={{ textAlign: "right" }}>{c.purchases}</td>
                          <td style={{ textAlign: "right" }}>${fmt2(c.conversionValue)}</td>
                          <td style={{ textAlign: "right", fontWeight: 800, color: roasC(c.roas) }}>{c.roas > 0 ? `${fmt2(c.roas)}x` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{c.purchases > 0 ? `$${fmt2(c.cpa)}` : "—"}</td>
                          <td style={{ textAlign: "right" }}>{fmt2(c.ctr)}%</td>
                          <td style={{ textAlign: "right" }}>{c.clicks.toLocaleString()}</td>
                          <td style={{ textAlign: "right", fontSize: 11, color: "var(--text-3)" }}>{c.lastDateStr}</td>
                        </tr>
                      ))}
                      {campaigns.length === 0 && (
                        <tr><td colSpan={12} style={{ textAlign: "center", padding: 32, color: "var(--text-3)", fontSize: 13 }}>
                          Sin datos — haz clic en "Sincronizar 30d"
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
