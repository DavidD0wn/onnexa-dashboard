"use client";
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { useFilters } from "@/lib/filters";

/* ─── Types ──────────────────────────────────────────────────── */
interface ProductMetrics {
  name: string; variant: string; brandName: string; brandColor: string;
  revenueUsd: number; units: number; orders: number;
  costPerUnit: number; cogsUsd: number; adSpendUsd: number;
  grossProfit: number; grossMargin: number;
  netProfit: number; netMargin: number;
  roas: number | null; cpa: number | null;
}

interface PriceAnalysis {
  product: ProductMetrics;
  currentAov: number;
  recommendation: "raise" | "lower" | "hold" | "test";
  urgency: "high" | "medium" | "low";
  reasoning: string[];
  suggestedPrice: number | null;
  potentialRevGain: number | null;
  potentialMarginGain: number | null;
}

/* ─── Helpers ────────────────────────────────────────────────── */
const usd = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const REC_CONFIG = {
  raise: { label: "↑ Subir precio",   bg: "#D1FAE5", color: "#065F46", icon: TrendingUp,     desc: "Hay margen para subir sin perder conversión" },
  lower: { label: "↓ Bajar precio",   bg: "#FEE2E2", color: "#991B1B", icon: TrendingDown,   desc: "Precio alto puede estar frenando conversión" },
  hold:  { label: "= Mantener",        bg: "#F3F4F6", color: "#374151", icon: Minus,          desc: "Precio en punto óptimo actual" },
  test:  { label: "⚗ A/B Test precio", bg: "#EDE9FE", color: "#5B21B6", icon: AlertTriangle, desc: "Datos insuficientes, prueba variantes" },
};

function analyzeProduct(p: ProductMetrics): PriceAnalysis {
  const aov     = p.orders > 0 ? p.revenueUsd / p.orders : 0;
  const reasons: string[] = [];
  let rec: PriceAnalysis["recommendation"] = "hold";
  let urgency: PriceAnalysis["urgency"] = "low";
  let suggestedPrice: number | null = null;
  let potentialRevGain: number | null = null;
  let potentialMarginGain: number | null = null;

  // Low margin → investigate pricing or costs
  if (p.netMargin < 10 && p.netProfit < 0) {
    rec = "raise"; urgency = "high";
    reasons.push(`Margen neto negativo (${p.netMargin.toFixed(1)}%) — producto perdiendo dinero`);
    if (aov > 0) {
      suggestedPrice = aov * 1.25;
      potentialMarginGain = 25 - p.netMargin;
    }
  } else if (p.netMargin < 15) {
    rec = "raise"; urgency = "medium";
    reasons.push(`Margen neto bajo (${p.netMargin.toFixed(1)}%) — objetivo mínimo 20%`);
    if (aov > 0) {
      suggestedPrice = aov * 1.15;
      potentialMarginGain = 20 - p.netMargin;
    }
  } else if (p.netMargin >= 40) {
    rec = "test"; urgency = "low";
    reasons.push(`Margen alto (${p.netMargin.toFixed(1)}%) — podrías bajar precio y ganar volumen`);
    if (aov > 0) {
      suggestedPrice = aov * 0.90;
      potentialRevGain = p.revenueUsd * 0.15; // estimate 15% more orders
    }
  }

  // ROAS signals
  if (p.roas !== null) {
    if (p.roas < 1.5 && rec !== "raise") {
      rec = "raise"; urgency = urgency === "low" ? "medium" : urgency;
      reasons.push(`ROAS bajo (${p.roas.toFixed(2)}x) — cada peso en ads no se recupera`);
    } else if (p.roas > 5) {
      reasons.push(`ROAS excelente (${p.roas.toFixed(2)}x) — hay demanda, evalúa subir precio`);
      if (rec === "hold") { rec = "raise"; urgency = "medium"; }
    } else if (p.roas >= 2.5 && p.roas <= 5) {
      reasons.push(`ROAS saludable (${p.roas.toFixed(2)}x)`);
    }
  }

  // Units / orders signal
  if (p.orders < 5 && rec === "hold") {
    rec = "test"; urgency = "low";
    reasons.push("Pocas órdenes en el período — datos insuficientes para decisión definitiva");
  }

  // CPA vs AOV
  if (p.cpa !== null && aov > 0) {
    const cpaRatio = p.cpa / aov;
    if (cpaRatio > 0.4) {
      reasons.push(`CPA alto (${usd(p.cpa)}) vs AOV (${usd(aov)}) — ratio ${(cpaRatio * 100).toFixed(0)}%`);
      if (rec === "hold") { rec = "raise"; urgency = "medium"; }
    } else if (cpaRatio < 0.15) {
      reasons.push(`CPA muy eficiente (${usd(p.cpa)}) — ${(cpaRatio * 100).toFixed(0)}% del AOV`);
    }
  }

  if (reasons.length === 0) {
    reasons.push("Métricas dentro de rangos saludables. Mantén precio y monitorea.");
  }

  if (potentialRevGain !== null) {
    potentialRevGain = Math.round(potentialRevGain);
  }
  if (potentialMarginGain !== null) {
    potentialMarginGain = Math.round(potentialMarginGain * 10) / 10;
  }

  return { product: p, currentAov: aov, recommendation: rec, urgency, reasoning: reasons, suggestedPrice, potentialRevGain, potentialMarginGain };
}

/* ─── Component ──────────────────────────────────────────────── */
export default function PricingAnalysisPage() {
  const { days, isCustom, customFrom, customTo } = useFilters();
  const [products, setProducts] = useState<ProductMetrics[]>([]);
  const [analyses, setAnalyses] = useState<PriceAnalysis[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [store,    setStore]    = useState<"all"|"glowmmi"|"balancea">("all");
  const [recFilter, setRecFilter] = useState<"all"|PriceAnalysis["recommendation"]>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isCustom && customFrom && customTo) { params.set("from", customFrom); params.set("to", customTo); }
    else params.set("days", String(days));
    params.set("store", store);
    try {
      const res  = await fetch(`/api/products/analytics?${params}`);
      const data = await res.json();
      const rows: ProductMetrics[] = data.rows ?? [];
      const analyzed = rows
        .filter((p) => p.revenueUsd > 0 || p.units > 0)
        .map(analyzeProduct)
        .sort((a, b) => {
          const urgOrd = { high: 0, medium: 1, low: 2 };
          return urgOrd[a.urgency] - urgOrd[b.urgency] || b.product.revenueUsd - a.product.revenueUsd;
        });
      setProducts(rows);
      setAnalyses(analyzed);
    } catch {}
    setLoading(false);
  }, [days, isCustom, customFrom, customTo, store]);

  useEffect(() => { load(); }, [load]);

  const filtered = analyses.filter((a) => recFilter === "all" || a.recommendation === recFilter);
  const counts = { raise: analyses.filter((a) => a.recommendation === "raise").length, lower: analyses.filter((a) => a.recommendation === "lower").length, hold: analyses.filter((a) => a.recommendation === "hold").length, test: analyses.filter((a) => a.recommendation === "test").length };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>💰 Análisis de Precios</h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>
            Recomendaciones automáticas basadas en margen, ROAS, CPA y AOV — últimos {days} días
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(["all","glowmmi","balancea"] as const).map((s) => (
            <button key={s} onClick={() => setStore(s)} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1.5px solid",
              borderColor: store === s ? (s === "glowmmi" ? "#EC4899" : s === "balancea" ? "#10B981" : "#6366f1") : "var(--border)",
              background:  store === s ? (s === "glowmmi" ? "#EC4899" : s === "balancea" ? "#10B981" : "#6366f1") : "var(--card)",
              color: store === s ? "#fff" : "var(--text-2)",
            }}>
              {s === "all" ? "Todas" : s === "glowmmi" ? "Glowmmi" : "Balancea"}
            </button>
          ))}
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "var(--card)", border: "1.5px solid var(--border)", color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {analyses.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          {(Object.entries(REC_CONFIG) as [PriceAnalysis["recommendation"], typeof REC_CONFIG["raise"]][]).map(([key, cfg]) => {
            const Icon = cfg.icon;
            return (
              <div key={key} onClick={() => setRecFilter(recFilter === key ? "all" : key)} style={{
                background: recFilter === key ? cfg.bg : "var(--card)",
                border: `1.5px solid ${recFilter === key ? cfg.color + "44" : "var(--border)"}`,
                borderRadius: 14, padding: "16px 20px", cursor: "pointer", transition: "all 0.15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Icon size={16} style={{ color: cfg.color }} />
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: cfg.color }}>{cfg.label}</p>
                </div>
                <p style={{ fontSize: 28, fontWeight: 800, color: cfg.color, lineHeight: 1 }}>{counts[key]}</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{cfg.desc}</p>
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <div style={{ padding: 60, textAlign: "center" }}>
          <RefreshCw size={28} style={{ color: "var(--text-3)", animation: "spin 1s linear infinite" }} />
          <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 12 }}>Analizando productos…</p>
        </div>
      )}

      {!loading && analyses.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>📊</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Sin datos de productos</p>
          <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 6 }}>No se encontraron ventas en el período seleccionado.</p>
        </div>
      )}

      {/* Analysis cards */}
      {!loading && filtered.map((a, i) => {
        const cfg = REC_CONFIG[a.recommendation];
        const Icon = cfg.icon;
        const isHighUrgency = a.urgency === "high";
        return (
          <div key={`${a.product.name}-${a.product.variant}-${i}`} style={{
            background: "var(--card)", border: `1px solid ${isHighUrgency ? "#FCA5A5" : "var(--border)"}`,
            borderLeft: `4px solid ${isHighUrgency ? "#DC2626" : a.urgency === "medium" ? "#D97706" : "var(--border)"}`,
            borderRadius: 12, padding: "18px 22px", marginBottom: 12,
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>
              <div>
                {/* Product name + brand */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>{a.product.name}</span>
                  {a.product.variant && <span style={{ fontSize: 12, color: "var(--text-3)", background: "var(--bg-2)", padding: "1px 7px", borderRadius: 8 }}>{a.product.variant}</span>}
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: a.product.brandColor, display: "inline-block" }} />
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{a.product.brandName}</span>
                </div>

                {/* Metrics row */}
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 12 }}>
                  {[
                    { label: "Revenue",     value: usd(a.product.revenueUsd),             color: "var(--text-2)" },
                    { label: "AOV actual",  value: usd(a.currentAov),                     color: "var(--text-2)" },
                    { label: "Mg. neto",    value: `${a.product.netMargin.toFixed(1)}%`,  color: a.product.netMargin >= 20 ? "#10B981" : a.product.netMargin >= 0 ? "#D97706" : "#DC2626" },
                    { label: "ROAS",        value: a.product.roas ? `${a.product.roas.toFixed(2)}x` : "N/A", color: "var(--text-2)" },
                    { label: "CPA",         value: a.product.cpa ? usd(a.product.cpa) : "N/A", color: "var(--text-2)" },
                    { label: "Pedidos",     value: String(a.product.orders),               color: "var(--text-2)" },
                  ].map((m) => (
                    <div key={m.label}>
                      <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--text-3)", marginBottom: 2 }}>{m.label}</p>
                      <p style={{ fontSize: 15, fontWeight: 700, color: m.color }}>{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* Reasoning */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {a.reasoning.map((r, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 7, fontSize: 13, color: "var(--text-2)" }}>
                      <span style={{ marginTop: 2, flexShrink: 0 }}>
                        {i === 0 ? (a.recommendation === "raise" ? "⬆" : a.recommendation === "lower" ? "⬇" : a.recommendation === "test" ? "⚗" : "✓") : "·"}
                      </span>
                      {r}
                    </div>
                  ))}
                </div>

                {/* Potential gains */}
                {(a.suggestedPrice || a.potentialRevGain || a.potentialMarginGain) && (
                  <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                    {a.suggestedPrice && (
                      <div style={{ background: cfg.bg, padding: "6px 12px", borderRadius: 8 }}>
                        <p style={{ fontSize: 10, color: cfg.color, fontWeight: 600, marginBottom: 2 }}>Precio sugerido</p>
                        <p style={{ fontSize: 16, fontWeight: 800, color: cfg.color }}>{usd(a.suggestedPrice)}</p>
                      </div>
                    )}
                    {a.potentialMarginGain && (
                      <div style={{ background: "#D1FAE5", padding: "6px 12px", borderRadius: 8 }}>
                        <p style={{ fontSize: 10, color: "#065F46", fontWeight: 600, marginBottom: 2 }}>Margen potencial</p>
                        <p style={{ fontSize: 16, fontWeight: 800, color: "#065F46" }}>+{a.potentialMarginGain}pp</p>
                      </div>
                    )}
                    {a.potentialRevGain && (
                      <div style={{ background: "#DBEAFE", padding: "6px 12px", borderRadius: 8 }}>
                        <p style={{ fontSize: 10, color: "#1E40AF", fontWeight: 600, marginBottom: 2 }}>Revenue adicional est.</p>
                        <p style={{ fontSize: 16, fontWeight: 800, color: "#1E40AF" }}>+{usd(a.potentialRevGain)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Recommendation badge */}
              <div style={{ textAlign: "right" }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 10, background: cfg.bg,
                  border: `1.5px solid ${cfg.color}33`,
                }}>
                  <Icon size={14} style={{ color: cfg.color }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                </div>
                <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
                  {a.urgency === "high" ? "🔴 Urgente" : a.urgency === "medium" ? "🟡 Revisar" : "🟢 Monitorear"}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
