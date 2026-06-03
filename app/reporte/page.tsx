"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw, ChevronDown, ChevronRight, TrendingUp, TrendingDown, BarChart3, Download, Settings, Zap, Save } from "lucide-react";
import { fmtNum, localDateStr } from "@/lib/utils";

/* ─── Types ──────────────────────────────────────────────────── */
interface PeriodData {
  revenue: number; discounts: number; returns: number; netRevenue: number;
  cogs: number; shipping: number; fees: number; handling: number;
  adSpend: number; adFacebook: number; adGoogle: number; adSnapchat: number; adTiktok: number;
  taxes: number; other: number; marketing: number; office: number; customCosts: number;
  grossProfit: number; grossMargin: number;
  netProfit: number; netMargin: number;
  chargebacks: number; orders: number; units: number; aov: number;
  // Injected fixed costs (prorated per period)
  appCosts?: number;
  salaryFernanda?: number; salaryJefa?: number; otherFixed?: number;
  totalFixed?: number;
}

interface PeriodColumn {
  label: string; from: string; to: string;
  data: PeriodData;
}

interface FCItem { id: string; name: string; amountUsd: number; active: boolean; }

interface PnLResponse {
  from: string; to: string; granularity: string;
  columns: PeriodColumn[];
  total: { label: string; data: PeriodData };
  appCosts?:   { monthlyTotal: number };
  fixedCosts?: { monthlyTotal: number; salaries: FCItem[]; other: FCItem[] };
}

/* ─── helpers ────────────────────────────────────────────────── */
function fmtUSD(v: number, showSign = false): string {
  const abs = Math.abs(v);
  const s   = abs.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  if (showSign && v < 0) return `-${s}`;
  return s;
}
function fmtPctVal(v: number): string { return `${v >= 0 ? "" : ""}${v.toFixed(2)}%`; }

/* ─── Row definitions ────────────────────────────────────────── */
type RowType = "section" | "data" | "subtotal" | "result" | "sub";

interface RowDef {
  key: string;
  label: string;
  type: RowType;
  getValue?: (d: PeriodData) => number;
  isPercent?: boolean;
  isNegative?: boolean;     // render as (value) when negative
  highlight?: boolean;      // bold + border
  children?: RowDef[];
  color?: "green" | "red" | "auto"; // auto = green if positive, red if negative
  indent?: number;
}

const ROWS: RowDef[] = [
  { key: "grossSales",   label: "Ventas Brutas",       type: "data",    getValue: d => d.revenue,     indent: 0 },
  { key: "discounts",    label: "Descuentos",           type: "data",    getValue: d => d.discounts,   indent: 0, isNegative: true },
  { key: "returns",      label: "Devoluciones",         type: "data",    getValue: d => d.returns,     indent: 0, isNegative: true },
  { key: "revenue",      label: "Revenue",              type: "subtotal", getValue: d => d.netRevenue,  highlight: true },
  { key: "cogs",         label: "COGS",                 type: "data",    getValue: d => d.cogs,        indent: 0, isNegative: true },
  { key: "shipping",     label: "Costo de Envío",       type: "data",    getValue: d => d.shipping,    indent: 0, isNegative: true },
  { key: "fees",         label: "Fees de Pasarela",     type: "data",    getValue: d => d.fees,        indent: 0, isNegative: true },
  { key: "handling",     label: "Handling Fees",        type: "data",    getValue: d => d.handling,    indent: 0, isNegative: true },
  {
    key: "adSpend", label: "Total Ad Spend", type: "data",
    getValue: d => d.adSpend, indent: 0, isNegative: true,
    children: [
      { key: "adFacebook", label: "Facebook Ads", type: "sub", getValue: d => d.adFacebook, isNegative: true, indent: 1 },
      { key: "adGoogle",   label: "Google Ads",   type: "sub", getValue: d => d.adGoogle,   isNegative: true, indent: 1 },
      { key: "adSnapchat", label: "Snapchat Ads", type: "sub", getValue: d => d.adSnapchat, isNegative: true, indent: 1 },
      { key: "adTiktok",   label: "TikTok Ads",   type: "sub", getValue: d => d.adTiktok,   isNegative: true, indent: 1 },
    ],
  },
  {
    key: "customCosts", label: "Costos Adicionales", type: "data",
    getValue: d => d.customCosts, indent: 0, isNegative: true,
    children: [
      { key: "taxes",     label: "Impuestos Pagados", type: "sub", getValue: d => d.taxes,    isNegative: true, indent: 1 },
      { key: "marketing", label: "Marketing",         type: "sub", getValue: d => d.marketing, isNegative: true, indent: 1 },
      { key: "office",    label: "Gastos de Oficina", type: "sub", getValue: d => d.office,   isNegative: true, indent: 1 },
      { key: "other",     label: "Sin Categoría",     type: "sub", getValue: d => d.other,    isNegative: true, indent: 1 },
    ],
  },
  { key: "chargebacks",  label: "Chargebacks",         type: "data",    getValue: d => d.chargebacks,  indent: 0, isNegative: true, color: "red" },
  // ── Sistemas (apps) ───────────────────────────────────────────
  { key: "sistemas",     label: "Sistemas / Apps",     type: "data",    getValue: d => d.appCosts ?? 0,   indent: 0, isNegative: true },
  // ── Gastos operativos (salarios + fijos) ──────────────────────
  {
    key: "gastosOp", label: "Gastos Operativos", type: "data",
    getValue: d => (d.salaryFernanda ?? 0) + (d.salaryJefa ?? 0) + (d.otherFixed ?? 0),
    indent: 0, isNegative: true,
    children: [
      { key: "salaryFernanda", label: "Salario Fernanda", type: "sub", getValue: d => d.salaryFernanda ?? 0, isNegative: true, indent: 1 },
      { key: "salaryJefa",     label: "Salario Jefa",     type: "sub", getValue: d => d.salaryJefa     ?? 0, isNegative: true, indent: 1 },
      { key: "otherFixed",     label: "Otros Gastos",     type: "sub", getValue: d => d.otherFixed     ?? 0, isNegative: true, indent: 1 },
    ],
  },
  { key: "totalCosts",   label: "Total de Costos",     type: "subtotal",
    getValue: d => d.cogs + d.shipping + d.fees + d.handling + d.adSpend + d.customCosts + d.chargebacks + (d.appCosts ?? 0) + (d.salaryFernanda ?? 0) + (d.salaryJefa ?? 0) + (d.otherFixed ?? 0),
    highlight: true, isNegative: true },
  { key: "grossProfit",  label: "Utilidad Bruta",      type: "result",  getValue: d => d.grossProfit,  highlight: true, color: "auto" },
  { key: "netProfit",    label: "Utilidad Neta",       type: "result",
    getValue: d => d.netProfit - (d.appCosts ?? 0) - (d.salaryFernanda ?? 0) - (d.salaryJefa ?? 0) - (d.otherFixed ?? 0),
    highlight: true, color: "auto" },
  { key: "netMargin",    label: "Margen Neto",         type: "result",  getValue: d => d.netMargin,    highlight: true, isPercent: true, color: "auto" },
];

/* ─── PnL Row component ──────────────────────────────────────── */
function PnLRow({
  row, cols, total, expanded, onToggle,
}: {
  row: RowDef;
  cols: PeriodColumn[];
  total: { label: string; data: PeriodData };
  expanded: boolean;
  onToggle?: () => void;
}) {
  const allData = [...cols.map(c => c.data), total.data];

  const cellStyle = (val: number, row: RowDef): React.CSSProperties => {
    if (row.color === "red") return { color: "#DC2626", fontWeight: 600 };
    if (row.color === "auto") {
      return { color: val >= 0 ? "#059669" : "#DC2626", fontWeight: 700 };
    }
    if (row.type === "subtotal" || row.type === "result") return { fontWeight: 700, color: "var(--text)" };
    return { color: "var(--text-2)" };
  };

  const renderValue = (d: PeriodData) => {
    if (!row.getValue) return null;
    const val = row.getValue(d);
    if (row.isPercent) return <span style={{ ...cellStyle(val, row) }}>{fmtPctVal(val)}</span>;
    if (row.isNegative && val !== 0) return <span style={{ ...cellStyle(val, row) }}>({fmtUSD(val)})</span>;
    return <span style={{ ...cellStyle(val, row) }}>{fmtUSD(val)}</span>;
  };

  const isHighlight = row.type === "subtotal" || row.type === "result";
  const hasChildren = row.children && row.children.length > 0;

  return (
    <>
      <tr
        style={{
          background: isHighlight ? "var(--bg-2)" : "transparent",
          borderTop:  isHighlight ? "2px solid var(--border)" : "1px solid var(--border)",
          cursor:     hasChildren ? "pointer" : "default",
        }}
        onClick={hasChildren ? onToggle : undefined}
      >
        {/* Label cell */}
        <td style={{
          padding: "9px 16px 9px " + (8 + (row.indent ?? 0) * 20) + "px",
          minWidth: 200,
          position: "sticky", left: 0,
          background: isHighlight ? "var(--bg-2)" : "var(--card)",
          zIndex: 1,
          borderRight: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {hasChildren && (
              <span style={{ color: "var(--text-3)", flexShrink: 0 }}>
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            )}
            {row.type === "sub" && (
              <span style={{ width: 16, flexShrink: 0, display: "inline-block" }} />
            )}
            <span style={{
              fontSize: isHighlight ? 13 : 12,
              fontWeight: isHighlight ? 700 : 500,
              color: isHighlight ? "var(--text)" : "var(--text-2)",
            }}>
              {row.label}
            </span>
          </div>
        </td>
        {/* Data cells */}
        {allData.map((d, i) => (
          <td key={i} style={{
            padding: "9px 20px",
            textAlign: "right",
            fontSize: isHighlight ? 13 : 12,
            whiteSpace: "nowrap",
            background: i === allData.length - 1 ? "var(--bg-2)" : "transparent",
            borderLeft:  i === allData.length - 1 ? "2px solid var(--border)" : "none",
            fontFamily: "monospace",
          }}>
            {renderValue(d)}
          </td>
        ))}
      </tr>
      {/* Sub-rows */}
      {hasChildren && expanded && row.children!.map((child) => (
        <tr key={child.key} style={{ background: "transparent" }}>
          <td style={{
            padding: "7px 16px 7px " + (8 + ((child.indent ?? 0)) * 20 + 20) + "px",
            position: "sticky", left: 0,
            background: "var(--card)",
            borderRight: "1px solid var(--border)",
            zIndex: 1,
          }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{child.label}</span>
          </td>
          {allData.map((d, i) => {
            if (!child.getValue) return <td key={i} />;
            const val = child.getValue(d);
            return (
              <td key={i} style={{
                padding: "7px 20px",
                textAlign: "right",
                fontSize: 11,
                color: val === 0 ? "var(--text-4)" : "var(--text-3)",
                whiteSpace: "nowrap",
                background: i === allData.length - 1 ? "var(--bg-2)" : "transparent",
                borderLeft: i === allData.length - 1 ? "2px solid var(--border)" : "none",
                fontFamily: "monospace",
              }}>
                {val !== 0 ? `(${fmtUSD(val)})` : <span style={{ opacity: 0.35 }}>$0.00</span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function ReportePage() {
  const [data, setData]         = useState<PnLResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [granularity, setGran]  = useState<"weekly" | "monthly">("weekly");
  const [brand, setBrand]       = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["adSpend", "gastosOp"]));
  const [exporting, setExporting] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [syncingApps, setSyncingApps] = useState(false);
  const [savingFC,  setSavingFC]  = useState(false);
  // Fixed cost editors (local state, saved on demand)
  const [fcFernanda, setFcFernanda] = useState(0);
  const [fcJefa,     setFcJefa]     = useState(0);
  const [fcOther,    setFcOther]    = useState(0);

  // Date range: default last 19 days (May 1–19 matches the TrueProfit example)
  const today = new Date();
  const defaultTo   = localDateStr(today);
  const defaultFrom = localDateStr(new Date(today.getFullYear(), today.getMonth(), 1));
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo,   setDateTo]   = useState(defaultTo);

  // Helper: days in a period (inclusive)
  function periodDays(from: string, to: string) {
    return Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / 86400000 + 1);
  }
  // Prorate a monthly amount to a period
  function prorate(monthly: number, from: string, to: string) {
    return monthly * periodDays(from, to) / 30;
  }

  // Inject fixed costs into each column's data
  function injectFixed(raw: PnLResponse, fernanda: number, jefa: number, other: number): PnLResponse {
    const appMonthly = raw.appCosts?.monthlyTotal ?? 0;
    const inject = (d: PeriodData, from: string, to: string): PeriodData => ({
      ...d,
      appCosts:       prorate(appMonthly, from, to),
      salaryFernanda: prorate(fernanda,   from, to),
      salaryJefa:     prorate(jefa,       from, to),
      otherFixed:     prorate(other,      from, to),
    });
    const totalDays = periodDays(raw.from, raw.to);
    return {
      ...raw,
      columns: raw.columns.map(c => ({ ...c, data: inject(c.data, c.from, c.to) })),
      total:   { ...raw.total, data: inject(raw.total.data, raw.from, raw.to) },
    };
  }

  const load = useCallback(() => {
    setLoading(true);
    setApiError(null);
    const p = new URLSearchParams({ from: dateFrom, to: dateTo, granularity, brand });
    fetch(`/api/p-and-l?${p}`)
      .then(r => r.json())
      .then((d: any) => {
        if (d?.error) { setApiError(d.error); setData(null); }
        else if (!d?.columns || !d?.total) { setApiError("Respuesta inesperada del servidor"); setData(null); }
        else {
          // Init fixed cost editors from API response
          const fc = d.fixedCosts ?? {};
          const salFernanda = fc.salaries?.find((s: FCItem) => s.id === "salary-fernanda")?.amountUsd ?? 0;
          const salJefa     = fc.salaries?.find((s: FCItem) => s.id === "salary-jefa")?.amountUsd     ?? 0;
          const otherAmt    = (fc.other ?? []).filter((o: FCItem) => o.active).reduce((s: number, o: FCItem) => s + o.amountUsd, 0);
          setFcFernanda(salFernanda);
          setFcJefa(salJefa);
          setFcOther(otherAmt);
          setData(injectFixed(d as PnLResponse, salFernanda, salJefa, otherAmt));
        }
        setLoading(false);
      })
      .catch((e) => { setApiError(e?.message ?? "Error al cargar el reporte"); setLoading(false); });
  }, [dateFrom, dateTo, granularity, brand]);

  // Re-inject when user changes fixed cost values without reloading
  const applyFixed = useCallback(() => {
    if (!data) return;
    setData(d => d ? injectFixed(d, fcFernanda, fcJefa, fcOther) : null);
  }, [data, fcFernanda, fcJefa, fcOther]);

  const syncApps = async () => {
    setSyncingApps(true);
    try {
      const res = await fetch("/api/apps/sync-shopify", { method: "POST" });
      const r   = await res.json();
      alert(`✅ Apps sincronizadas: ${r.synced} de Shopify + ${r.manual} manuales`);
      load(); // reload to pick up new app costs
    } catch { alert("Error al sincronizar apps"); }
    setSyncingApps(false);
  };

  const saveFixedCosts = async () => {
    setSavingFC(true);
    try {
      await Promise.all([
        fetch("/api/fixed-costs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "salary-fernanda", name: "Salario Fernanda", amountUsd: fcFernanda, active: true, section: "salaries" }) }),
        fetch("/api/fixed-costs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "salary-jefa",     name: "Salario Jefa",     amountUsd: fcJefa,     active: true, section: "salaries" }) }),
        fetch("/api/fixed-costs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "other-misc",      name: "Otros Gastos",     amountUsd: fcOther,    active: true, section: "other"    }) }),
      ]);
      applyFixed();
    } catch { alert("Error al guardar"); }
    setSavingFC(false);
  };

  useEffect(() => { load(); }, [load]);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams({ from: dateFrom, to: dateTo, brand });
      const res = await fetch(`/api/export/pnl?${p}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `reporte-pnl-${dateFrom}-al-${dateTo}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setExporting(false);
    }
  };

  const toggleRow = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Summary KPIs from total (use ?. on both levels to avoid TypeError)
  const tot = data?.total?.data;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>

          <div style={{ marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              Reporte P&L
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              Estado de resultados por período
            </p>
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {/* Granularity */}
          {(["weekly", "monthly"] as const).map((g) => (
            <button key={g} onClick={() => setGran(g)} style={{
              padding: "5px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: granularity === g ? "#12304A" : "transparent",
              color: granularity === g ? "#fff" : "var(--text-2)",
              border: `1.5px solid ${granularity === g ? "#12304A" : "var(--border)"}`,
              cursor: "pointer",
            }}>
              {g === "weekly" ? "Semanal" : "Mensual"}
            </button>
          ))}

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {/* Date range */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12 }} />
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
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
              background: brand === b.value ? (b.value === "brand_glowmmi" ? "#FCE7F3" : b.value === "brand_balancea" ? "#D1FAE5" : "#EEF2FF") : "transparent",
              color: brand === b.value ? (b.value === "brand_glowmmi" ? "#BE185D" : b.value === "brand_balancea" ? "#065F46" : "#3730A3") : "var(--text-2)",
              border: `1.5px solid ${brand === b.value ? "currentColor" : "var(--border)"}`,
              cursor: "pointer",
            }}>
              {b.label}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          <button onClick={syncApps} disabled={syncingApps} title="Sincronizar costos de apps desde Shopify" style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid #6366F1",
            color: "#6366F1", fontSize: 12, fontWeight: 600, cursor: syncingApps ? "not-allowed" : "pointer",
          }}>
            <Zap size={13} style={{ animation: syncingApps ? "spin 1s linear infinite" : "none" }} />
            {syncingApps ? "Sincronizando..." : "Sync Apps"}
          </button>

          <button onClick={() => setShowConfig(p => !p)} title="Configurar gastos fijos (salarios, otros)" style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: showConfig ? "#F59E0B18" : "var(--card)",
            border: `1.5px solid ${showConfig ? "#F59E0B" : "var(--border)"}`,
            color: showConfig ? "#F59E0B" : "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <Settings size={13} /> Gastos Fijos
          </button>

          <button onClick={exportExcel} disabled={exporting || loading} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 16px", borderRadius: 8,
            background: exporting ? "#064E3B" : "#059669",
            border: "1.5px solid #059669",
            color: "#fff", fontSize: 12, fontWeight: 700, cursor: exporting ? "not-allowed" : "pointer",
            opacity: exporting ? 0.8 : 1,
            transition: "all 0.15s",
          }}>
            <Download size={13} className={exporting ? "animate-spin" : ""} />
            {exporting ? "Generando..." : "Exportar Excel"}
          </button>

          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {/* ── Config Panel: Gastos Fijos ─────────────────────────── */}
      {showConfig && (
        <div style={{ margin: "0 32px", background: "var(--card)", border: "1px solid #F59E0B44", borderRadius: 12, padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Settings size={14} color="#F59E0B" />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Gastos Fijos Mensuales</span>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Se prorratan por período en el P&L</span>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            {[
              { label: "Salario Fernanda", val: fcFernanda, set: setFcFernanda },
              { label: "Salario Jefa",     val: fcJefa,     set: setFcJefa     },
              { label: "Otros Gastos",     val: fcOther,    set: setFcOther    },
            ].map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>{f.label} / mes (USD)</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>$</span>
                  <input
                    type="number" step="1" min="0"
                    value={f.val}
                    onChange={e => f.set(Number(e.target.value))}
                    style={{ width: 120, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-2)", color: "var(--text)", fontSize: 13, fontWeight: 600 }}
                  />
                </div>
              </div>
            ))}
            <button
              onClick={saveFixedCosts}
              disabled={savingFC}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, border: "none", background: savingFC ? "#B45309" : "#F59E0B", color: "#000", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
            >
              <Save size={13} /> {savingFC ? "Guardando…" : "Guardar y Aplicar"}
            </button>
            <div style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center" }}>
              Total mensual fijo: <strong style={{ color: "#F59E0B" }}>${(fcFernanda + fcJefa + fcOther).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            💡 <strong>Sistemas / Apps</strong> se sincroniza automáticamente desde Shopify con el botón "Sync Apps". Los demás gastos los configuras aquí.
          </div>
        </div>
      )}

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Loading */}
        {loading && !data && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
              <p style={{ color: "var(--text-3)", fontSize: 13 }}>Cargando reporte...</p>
            </div>
          </div>
        )}

        {/* Error */}
        {!loading && apiError && (
          <div style={{
            padding: "20px 24px", borderRadius: 12,
            background: "var(--red-bg)",
            borderLeft: "4px solid var(--red)",
            borderTop: "1px solid var(--red)",
            borderRight: "1px solid var(--red)",
            borderBottom: "1px solid var(--red)",
          }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--red-text)", marginBottom: 6 }}>
              ⚠️ Error al generar el reporte
            </p>
            <p style={{ fontSize: 13, color: "var(--red-text)", opacity: 0.85 }}>{apiError}</p>
            <button onClick={load} style={{
              marginTop: 14, padding: "7px 16px", borderRadius: 8,
              background: "var(--red)", color: "#fff",
              border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              Reintentar
            </button>
          </div>
        )}

        {data && tot && (
          <>
            {/* ── Summary KPI cards ──────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
              {[
                {
                  label: "Revenue Total", value: fmtUSD(tot.netRevenue),
                  sub: `${fmtNum(tot.orders, 0)} pedidos · ${fmtNum(tot.units, 0)} uds.`,
                  color: "#2563EB", icon: <BarChart3 size={14} style={{ color: "#2563EB" }} />,
                },
                {
                  label: "Ut. Bruta Total", value: fmtUSD(tot.grossProfit),
                  sub: `${tot.grossMargin.toFixed(1)}% margen bruto`,
                  color: tot.grossProfit >= 0 ? "#10B981" : "#DC2626",
                  icon: tot.grossProfit >= 0 ? <TrendingUp size={14} style={{ color: "#10B981" }} /> : <TrendingDown size={14} style={{ color: "#DC2626" }} />,
                },
                {
                  label: "Ut. Neta Total", value: fmtUSD(tot.netProfit),
                  sub: `${tot.netMargin.toFixed(2)}% margen neto`,
                  color: tot.netProfit >= 0 ? "#10B981" : "#DC2626",
                  icon: tot.netProfit >= 0 ? <TrendingUp size={14} style={{ color: "#10B981" }} /> : <TrendingDown size={14} style={{ color: "#DC2626" }} />,
                },
                {
                  label: "Total Ad Spend", value: fmtUSD(tot.adSpend),
                  sub: `${tot.netRevenue > 0 ? (tot.adSpend / tot.netRevenue * 100).toFixed(1) : 0}% del revenue`,
                  color: "#F59E0B", icon: <BarChart3 size={14} style={{ color: "#F59E0B" }} />,
                },
                {
                  label: "AOV Promedio", value: fmtUSD(tot.aov),
                  sub: `${fmtNum(tot.orders, 0)} pedidos totales`,
                  color: "#7C3AED", icon: <BarChart3 size={14} style={{ color: "#7C3AED" }} />,
                },
              ].map((k) => (
                <div key={k.label} className="kpi-card" style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>{k.label}</p>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: k.color + "18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {k.icon}
                    </div>
                  </div>
                  <p style={{ fontSize: 22, fontWeight: 800, color: k.color, letterSpacing: "-0.02em", lineHeight: 1 }}>{k.value}</p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{k.sub}</p>
                </div>
              ))}
            </div>

            {/* ── P&L Table ──────────────────────────────────────── */}
            <div className="card" style={{ overflow: "hidden" }}>
              {/* Table header bar */}
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Estado de Resultados — P&L</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                    {data.from} · {data.from} al {data.to} · {data.columns.length} período{data.columns.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                    Haz clic en una fila para expandir sub-categorías
                  </span>
                </div>
              </div>

              {/* Scrollable table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  {/* Column headers */}
                  <thead>
                    <tr style={{ background: "var(--bg-2)", borderBottom: "2px solid var(--border)" }}>
                      <th style={{
                        textAlign: "left", padding: "12px 16px",
                        fontSize: 11, fontWeight: 700, color: "var(--text-3)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        position: "sticky", left: 0, background: "var(--bg-2)",
                        borderRight: "1px solid var(--border)", minWidth: 200, zIndex: 2,
                      }}>
                        Concepto
                      </th>
                      {data.columns.map((col, i) => (
                        <th key={i} style={{
                          textAlign: "right", padding: "12px 20px",
                          fontSize: 11, fontWeight: 700, color: "var(--text-3)",
                          textTransform: "uppercase", letterSpacing: "0.06em",
                          whiteSpace: "nowrap", minWidth: 160,
                        }}>
                          {col.label}
                        </th>
                      ))}
                      {/* Total column */}
                      <th style={{
                        textAlign: "right", padding: "12px 20px",
                        fontSize: 11, fontWeight: 700, color: "var(--text)",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        background: "var(--bg-2)", borderLeft: "2px solid var(--border)",
                        whiteSpace: "nowrap", minWidth: 160,
                      }}>
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <PnLRow
                        key={row.key}
                        row={row}
                        cols={data.columns}
                        total={data.total}
                        expanded={expanded.has(row.key)}
                        onToggle={() => toggleRow(row.key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Empty state */}
              {data.columns.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)" }}>Sin datos para este período</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
                    Selecciona un rango de fechas con datos registrados
                  </p>
                </div>
              )}
            </div>

            {/* ── Insight bar at bottom ──────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              {data.columns.map((col) => {
                const d = col.data;
                const isProfit = d.netProfit >= 0;
                return (
                  <div key={col.label} className="card-flat" style={{ padding: "16px 20px" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>
                      {col.label}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[
                        { label: "Revenue", value: fmtUSD(d.netRevenue), color: "var(--text)" },
                        { label: "Ut. Bruta", value: fmtUSD(d.grossProfit), color: d.grossProfit >= 0 ? "var(--green)" : "var(--red)" },
                        { label: "Ut. Neta", value: fmtUSD(d.netProfit), color: isProfit ? "var(--green)" : "var(--red)" },
                        { label: "Margen", value: fmtPctVal(d.netMargin), color: isProfit ? "var(--green)" : "var(--red)" },
                      ].map(item => (
                        <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{item.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: item.color, fontFamily: "monospace" }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
