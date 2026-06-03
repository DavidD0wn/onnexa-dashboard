"use client";
import { useState, useCallback } from "react";
import { FileText, Download, RefreshCw, Calendar, TrendingUp, Package, DollarSign, Zap } from "lucide-react";
import { useFilters } from "@/lib/filters";

type ReportType = "weekly" | "monthly" | "brand" | "products" | "custom";

interface ReportConfig {
  type: ReportType;
  label: string;
  icon: React.ReactNode;
  desc: string;
  sections: string[];
}

const REPORTS: ReportConfig[] = [
  {
    type: "weekly", label: "Reporte Semanal", icon: <Calendar size={20} />, desc: "Resumen de la semana: ventas, pauta, rentabilidad y comparativa vs semana anterior.",
    sections: ["KPIs generales", "Revenue por día", "Top productos", "Ad Spend por marca", "Novedades y alertas"],
  },
  {
    type: "monthly", label: "Reporte Mensual", icon: <TrendingUp size={20} />, desc: "Análisis completo del mes con tendencias, mejores días, productos estrella y recomendaciones.",
    sections: ["Resumen ejecutivo", "P&L mensual", "KPIs vs mes anterior", "Top 10 productos", "Análisis de rentabilidad"],
  },
  {
    type: "brand", label: "Reporte por Marca", icon: <Zap size={20} />, desc: "Comparativa Glowmmi vs Balancea: revenue, margen, ROAS, pedidos y evolución.",
    sections: ["Glowmmi vs Balancea", "Revenue por marca", "Rentabilidad por marca", "Tendencia ROAS", "Ad Spend breakdown"],
  },
  {
    type: "products", label: "Reporte de Productos", icon: <Package size={20} />, desc: "Ranking completo de productos por revenue, margen y rentabilidad.",
    sections: ["Top 20 productos", "Margen por producto", "ROAS y CPA por producto", "Productos en pérdida", "Recomendaciones de precio"],
  },
  {
    type: "custom", label: "Reporte Personalizado", icon: <FileText size={20} />, desc: "Selecciona el período y las secciones que quieres incluir.",
    sections: ["Seleccionable"],
  },
];

const SECTIONS_ALL = [
  "KPIs generales", "Revenue por día", "Top productos", "Ad Spend", "P&L completo",
  "Novedades y alertas", "Rentabilidad por producto", "ROAS y CPA", "Comparativa marcas", "Proyecciones",
];

export default function ReportesPage() {
  const { days } = useFilters();
  const [selected, setSelected] = useState<ReportType | null>(null);
  const [brand,    setBrand]    = useState<"all"|"glowmmi"|"balancea">("all");
  const [period,   setPeriod]   = useState<"7"|"30"|"90">("30");
  const [customSections, setCustomSections] = useState<string[]>(SECTIONS_ALL.slice(0, 5));
  const [generating, setGenerating] = useState(false);
  const [generated,  setGenerated]  = useState<{ url: string; filename: string; generatedAt: string } | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const loadPreview = useCallback(async (type: ReportType) => {
    setLoadingPreview(true);
    const params = new URLSearchParams({ type, brand, period });
    try {
      const res  = await fetch(`/api/reportes/preview?${params}`);
      const data = await res.json();
      setPreviewData(data);
    } catch {}
    setLoadingPreview(false);
  }, [brand, period]);

  const selectReport = (type: ReportType) => {
    setSelected(type);
    setGenerated(null);
    loadPreview(type);
  };

  const handleGenerate = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const sections = selected === "custom" ? customSections : REPORTS.find((r) => r.type === selected)?.sections ?? [];
      const res = await fetch("/api/reportes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selected, brand, period, sections }),
      });
      if (!res.ok) throw new Error("Error al generar");

      // El endpoint devuelve HTML — crear Blob y abrir en nueva pestaña para imprimir/guardar PDF
      const blob     = await res.blob();
      const filename = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `reporte-${selected}.html`;
      const url      = URL.createObjectURL(blob);

      // Abrir en nueva pestaña (el usuario puede imprimir → PDF desde ahí)
      window.open(url, "_blank");

      setGenerated({ url, filename, generatedAt: new Date().toLocaleString("es-MX") });
    } catch {}
    setGenerating(false);
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>📄 Reportes PDF</h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>Genera reportes ejecutivos con los datos más importantes de tu operación</p>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["all","glowmmi","balancea"] as const).map((b) => (
            <button key={b} onClick={() => setBrand(b)} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1.5px solid",
              borderColor: brand === b ? (b === "glowmmi" ? "#EC4899" : b === "balancea" ? "#10B981" : "#6366f1") : "var(--border)",
              background:  brand === b ? (b === "glowmmi" ? "#EC4899" : b === "balancea" ? "#10B981" : "#6366f1") : "var(--card)",
              color: brand === b ? "#fff" : "var(--text-2)",
            }}>
              {b === "all" ? "Todas las marcas" : b === "glowmmi" ? "Glowmmi" : "Balancea"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["7","30","90"] as const).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1.5px solid ${period === p ? "#6366f1" : "var(--border)"}`,
              background: period === p ? "#6366f1" : "var(--card)",
              color: period === p ? "#fff" : "var(--text-2)",
            }}>
              {p === "7" ? "7 días" : p === "30" ? "30 días" : "90 días"}
            </button>
          ))}
        </div>
      </div>

      {/* Report type selector */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
        {REPORTS.map((r) => (
          <div key={r.type} onClick={() => selectReport(r.type)} style={{
            background: selected === r.type ? "#EEF2FF" : "var(--card)",
            border: `1.5px solid ${selected === r.type ? "#6366f1" : "var(--border)"}`,
            borderRadius: 14, padding: "18px 20px", cursor: "pointer",
            transition: "all 0.15s",
          }}>
            <div style={{ color: selected === r.type ? "#6366f1" : "var(--text-3)", marginBottom: 10 }}>{r.icon}</div>
            <p style={{ fontSize: 14, fontWeight: 700, color: selected === r.type ? "#4338CA" : "var(--text)", marginBottom: 6 }}>{r.label}</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Selected report detail */}
      {selected && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "start" }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
                {REPORTS.find((r) => r.type === selected)?.label} · {brand === "all" ? "Todas las marcas" : brand} · {period} días
              </h2>

              {/* Sections */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-3)", marginBottom: 10 }}>Secciones incluidas</p>
                {selected === "custom" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {SECTIONS_ALL.map((s) => (
                      <button key={s} onClick={() => setCustomSections((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])} style={{
                        padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: `1.5px solid ${customSections.includes(s) ? "#6366f1" : "var(--border)"}`,
                        background: customSections.includes(s) ? "#EEF2FF" : "var(--card)",
                        color: customSections.includes(s) ? "#4338CA" : "var(--text-2)",
                      }}>
                        {customSections.includes(s) ? "✓ " : ""}{s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {REPORTS.find((r) => r.type === selected)?.sections.map((s) => (
                      <span key={s} style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#EEF2FF", color: "#4338CA", border: "1.5px solid #C7D2FE" }}>
                        ✓ {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Preview data */}
              {loadingPreview && <p style={{ color: "var(--text-3)", fontSize: 13 }}>Cargando preview…</p>}
              {previewData && !loadingPreview && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, padding: "16px 0", borderTop: "1px solid var(--border)" }}>
                  {[
                    { label: "Revenue", value: fmt(previewData.revenue ?? 0) },
                    { label: "Pedidos", value: previewData.orders ?? 0 },
                    { label: "Margen", value: fmtPct(previewData.margin ?? 0) },
                    { label: "ROAS", value: previewData.roas ? `${previewData.roas.toFixed(1)}x` : "N/A" },
                  ].map((k) => (
                    <div key={k.label}>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>{k.label}</p>
                      <p style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{k.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Generate button */}
            <div style={{ textAlign: "right" }}>
              <button onClick={handleGenerate} disabled={generating || (selected === "custom" && customSections.length === 0)} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", borderRadius: 10,
                background: "#6366f1", border: "none", color: "#fff", fontSize: 14, fontWeight: 700,
                cursor: "pointer", opacity: generating ? 0.7 : 1,
              }}>
                {generating ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                {generating ? "Generando…" : "Generar PDF"}
              </button>
              {generated && (
                <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, background: "#D1FAE5", border: "1.5px solid #6EE7B7" }}>
                  <p style={{ fontSize: 12, color: "#065F46", fontWeight: 700 }}>✅ Reporte generado</p>
                  <p style={{ fontSize: 11, color: "#047857", marginTop: 2 }}>{generated.generatedAt}</p>
                  <a href={generated.url} target="_blank" rel="noopener noreferrer" download={generated.filename}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 12, fontWeight: 700, color: "#065F46", textDecoration: "none" }}>
                    <Download size={12} /> {generated.filename}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info about PDF */}
      <div style={{ marginTop: 28, padding: "14px 18px", borderRadius: 12, background: "var(--card)", border: "1px solid var(--border)" }}>
        <p style={{ fontSize: 13, color: "var(--text-3)" }}>
          💡 El reporte se abre en una nueva pestaña como HTML. Para guardarlo como PDF: <strong style={{ color: "var(--text-2)" }}>Ctrl+P → Guardar como PDF</strong> (o usa el botón de imprimir dentro del reporte).
        </p>
      </div>
    </div>
  );
}
