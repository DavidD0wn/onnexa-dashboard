"use client";
import { useEffect, useState, useCallback } from "react";
import { localDateStr } from "@/lib/utils";
import {
  Plus, Pencil, Trash2, RefreshCw, Download,
  ShoppingBag, Megaphone, Truck, BarChart2, Headphones,
  Palette, DollarSign, Package, MoreHorizontal, CheckCircle2, XCircle,
} from "lucide-react";
import type { AppEntry } from "@/app/api/apps/route";

/* ─── Types ──────────────────────────────────────────────────── */
interface AppWithMonthly extends AppEntry { monthlyUsd: number }
interface AppsResponse {
  apps:         AppWithMonthly[];
  totalMonthly: number;
  totalAnnual:  number;
  byStore:      Record<string, number>;
  byCategory:   Record<string, number>;
}

/* ─── Config ─────────────────────────────────────────────────── */
const STORES = [
  { value: "all",            label: "Ambas Tiendas",  color: "#0E766E", bg: "#CCFBF1" },
  { value: "brand_glowmmi",  label: "Glowmmi",        color: "#BE185D", bg: "#FCE7F3" },
  { value: "brand_balancea", label: "Balancea",        color: "#065F46", bg: "#D1FAE5" },
];

const CATEGORIES: { value: AppEntry["category"]; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "plataforma", label: "Plataforma",      icon: <ShoppingBag size={13} />, color: "#6366F1" },
  { value: "marketing",  label: "Marketing",        icon: <Megaphone   size={13} />, color: "#EC4899" },
  { value: "envio",      label: "Envío",            icon: <Truck       size={13} />, color: "#0EA5E9" },
  { value: "analitica",  label: "Analítica",        icon: <BarChart2   size={13} />, color: "#F59E0B" },
  { value: "atencion",   label: "Atención a Cliente",icon: <Headphones size={13} />, color: "#10B981" },
  { value: "diseno",     label: "Diseño / Tema",    icon: <Palette     size={13} />, color: "#8B5CF6" },
  { value: "finanzas",   label: "Finanzas",         icon: <DollarSign  size={13} />, color: "#F97316" },
  { value: "inventario", label: "Inventario",       icon: <Package     size={13} />, color: "#14B8A6" },
  { value: "otro",       label: "Otro",             icon: <MoreHorizontal size={13}/>, color: "#6B7280" },
];

const CYCLES: { value: AppEntry["billingCycle"]; label: string }[] = [
  { value: "monthly",  label: "Mensual" },
  { value: "annual",   label: "Anual (÷12 mensual)" },
  { value: "one-time", label: "Pago único" },
];

const EMPTY: Omit<AppEntry, "id"> = {
  name: "", store: "all", category: "otro",
  costUsd: 0, billingCycle: "monthly",
  active: true, startDate: localDateStr(), notes: "",
};

/* ─── Helpers ────────────────────────────────────────────────── */
const fmtUSD  = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const catInfo = (v: string) => CATEGORIES.find((c) => c.value === v) ?? CATEGORIES[CATEGORIES.length - 1];
const storeInfo = (v: string) => STORES.find((s) => s.value === v) ?? STORES[0];

/* ─── Form Modal ─────────────────────────────────────────────── */
function AppModal({
  initial, onSave, onClose,
}: {
  initial: Partial<AppEntry>;
  onSave: (data: Omit<AppEntry, "id"> & { id?: string }) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Omit<AppEntry, "id"> & { id?: string }>({
    ...EMPTY, ...initial,
  });
  const set = (k: keyof typeof form, v: any) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--card)", borderRadius: 16, padding: 32, width: 520,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", border: "1px solid var(--border)",
      }} onClick={(e) => e.stopPropagation()}>

        <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 24 }}>
          {form.id ? "Editar Aplicación" : "Agregar Aplicación"}
        </p>

        {/* Name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
            Nombre de la App *
          </label>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="ej. Klaviyo, ReConvert, Loox..."
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>

        {/* Store + Category row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              Tienda
            </label>
            <select value={form.store} onChange={(e) => set("store", e.target.value)}
              style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}>
              {STORES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              Categoría
            </label>
            <select value={form.category} onChange={(e) => set("category", e.target.value as AppEntry["category"])}
              style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Cost + Cycle */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              Costo (USD) *
            </label>
            <input
              type="number" min="0" step="0.01"
              value={form.costUsd || ""}
              onChange={(e) => set("costUsd", parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              Ciclo de Cobro
            </label>
            <select value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value as AppEntry["billingCycle"])}
              style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}>
              {CYCLES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Monthly preview */}
        {form.costUsd > 0 && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-2)", marginBottom: 16, display: "flex", gap: 16 }}>
            <div>
              <p style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Costo mensual</p>
              <p style={{ fontSize: 15, fontWeight: 800, color: "#0E766E" }}>
                {fmtUSD(form.billingCycle === "annual" ? form.costUsd / 12 : form.billingCycle === "monthly" ? form.costUsd : 0)}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase" }}>Costo anual</p>
              <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
                {fmtUSD(form.billingCycle === "annual" ? form.costUsd : form.billingCycle === "monthly" ? form.costUsd * 12 : form.costUsd)}
              </p>
            </div>
          </div>
        )}

        {/* Start date + Active */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              Fecha de Inicio
            </label>
            <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)}
              style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
              Estado
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {[true, false].map((v) => (
                <button key={String(v)} onClick={() => set("active", v)} style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: "1.5px solid",
                  borderColor: form.active === v ? (v ? "#059669" : "#DC2626") : "var(--border)",
                  background: form.active === v ? (v ? "#D1FAE5" : "#FEE2E2") : "transparent",
                  color: form.active === v ? (v ? "#065F46" : "#7F1D1D") : "var(--text-3)",
                  cursor: "pointer",
                }}>
                  {v ? "✓ Activa" : "✗ Inactiva"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
            Notas (opcional)
          </label>
          <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
            placeholder="Plan, descuento por anualidad, cupón..."
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12, boxSizing: "border-box" }} />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 8, border: "1.5px solid var(--border)", background: "transparent", color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Cancelar
          </button>
          <button
            disabled={!form.name.trim() || form.costUsd < 0}
            onClick={() => onSave(form)}
            style={{ padding: "9px 24px", borderRadius: 8, border: "none", background: "#0E766E", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: !form.name.trim() ? 0.5 : 1 }}>
            {form.id ? "Guardar Cambios" : "Agregar App"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────── */
export default function AppsPage() {
  const [data, setData]       = useState<AppsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState<Partial<AppEntry> | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [filterStore, setFilterStore]   = useState<string>("all-filter");
  const [filterCat,   setFilterCat]     = useState<string>("all-filter");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/apps")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (form: Omit<AppEntry, "id"> & { id?: string }) => {
    const method = form.id ? "PATCH" : "POST";
    await fetch("/api/apps", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setModal(null);
    load();
  };

  const remove = async (id: string) => {
    setDeleting(id);
    await fetch("/api/apps", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setDeleting(null);
    load();
  };

  const toggleActive = async (app: AppWithMonthly) => {
    await fetch("/api/apps", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...app, active: !app.active }) });
    load();
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/export/apps");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a"); a.href = url;
      a.download = `costos-apps-${localDateStr()}.xlsx`;
      a.click(); URL.revokeObjectURL(url);
    } catch { } finally { setExporting(false); }
  };

  /* Filtered apps */
  const filtered = (data?.apps ?? []).filter((a) => {
    if (filterStore !== "all-filter" && a.store !== filterStore) return false;
    if (filterCat   !== "all-filter" && a.category !== filterCat) return false;
    if (filterStatus === "active"   && !a.active) return false;
    if (filterStatus === "inactive" && a.active)  return false;
    return true;
  });

  const activeTotal   = (data?.apps ?? []).filter((a) => a.active).reduce((s, a) => s + a.monthlyUsd, 0);
  const inactiveCount = (data?.apps ?? []).filter((a) => !a.active).length;

  /* Group by category for the chart */
  const catTotals = CATEGORIES.map((c) => ({
    ...c,
    total: (data?.apps ?? []).filter((a) => a.active && a.category === c.value).reduce((s, a) => s + a.monthlyUsd, 0),
  })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total);

  const maxCat = Math.max(...catTotals.map((c) => c.total), 1);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Costos de Aplicaciones</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Apps de Shopify · Suscripciones mensuales</p>
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {/* Filters */}
          <select value={filterStore} onChange={(e) => setFilterStore(e.target.value)}
            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12 }}>
            <option value="all-filter">Todas las tiendas</option>
            {STORES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12 }}>
            <option value="all-filter">Todas las categorías</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            style={{ padding: "5px 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12 }}>
            <option value="all">Todas</option>
            <option value="active">Solo activas</option>
            <option value="inactive">Solo inactivas</option>
          </select>

          <div style={{ flex: 1 }} />

          <button onClick={exportExcel} disabled={exporting || !data?.apps.length} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "#059669", border: "none",
            color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            opacity: !data?.apps.length ? 0.5 : 1,
          }}>
            <Download size={13} /> {exporting ? "Generando..." : "Excel"}
          </button>

          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "var(--card)", border: "1.5px solid var(--border)", color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>

          <button onClick={() => setModal({})} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", borderRadius: 8, background: "#12304A", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            <Plus size={14} /> Agregar App
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {loading && !data && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
              <p style={{ color: "var(--text-3)", fontSize: 13 }}>Cargando apps...</p>
            </div>
          </div>
        )}

        {data && (
          <>
            {/* ── KPI Cards ──────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
              {/* Total mensual */}
              <div className="kpi-card" style={{ background: "linear-gradient(135deg, #0E766E 0%, #047857 100%)", border: "none" }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>
                  Total Mensual
                </p>
                <p style={{ fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  {fmtUSD(activeTotal)}
                </p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 6 }}>
                  {fmtUSD(activeTotal * 12)} / año
                </p>
              </div>

              {/* Por tienda */}
              {STORES.map((s) => {
                const val = (data?.byStore[s.value] ?? 0);
                return (
                  <div key={s.value} className="kpi-card">
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 12 }}>
                      {s.label}
                    </p>
                    <p style={{ fontSize: 22, fontWeight: 800, color: s.color, letterSpacing: "-0.02em", lineHeight: 1 }}>
                      {fmtUSD(val)}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                      {activeTotal > 0 ? `${((val / activeTotal) * 100).toFixed(0)}% del total` : "—"}
                    </p>
                  </div>
                );
              })}

              {/* Apps activas */}
              <div className="kpi-card">
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 12 }}>
                  Apps Activas
                </p>
                <p style={{ fontSize: 26, fontWeight: 900, color: "#12304A", letterSpacing: "-0.02em", lineHeight: 1 }}>
                  {data.apps.filter((a) => a.active).length}
                </p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                  {inactiveCount > 0 ? `+ ${inactiveCount} inactiva${inactiveCount !== 1 ? "s" : ""}` : "todas activas"}
                </p>
              </div>
            </div>

            {/* ── Category breakdown ────────────────────────────── */}
            {catTotals.length > 0 && (
              <div className="card" style={{ padding: "20px 24px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
                  Gasto Mensual por Categoría
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {catTotals.map((c) => (
                    <div key={c.value}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: c.color }}>{c.icon}</span>
                          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{c.label}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {((c.total / maxCat) * 100).toFixed(0)}%
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontFamily: "monospace", minWidth: 80, textAlign: "right" }}>
                            {fmtUSD(c.total)}
                          </span>
                        </div>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(c.total / maxCat) * 100}%`, borderRadius: 99, background: c.color, transition: "width 0.4s ease" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Apps Table ────────────────────────────────────── */}
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Detalle de Aplicaciones</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                    {filtered.length} app{filtered.length !== 1 ? "s" : ""} · {fmtUSD(filtered.filter(a=>a.active).reduce((s,a)=>s+a.monthlyUsd,0))} /mes (filtrado)
                  </p>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", marginBottom: 8 }}>
                    {data.apps.length === 0 ? "Sin apps registradas" : "Sin resultados con estos filtros"}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>
                    {data.apps.length === 0
                      ? "Agrega las apps que tienes instaladas en Shopify para ver el costo mensual total."
                      : "Prueba cambiando los filtros de arriba."}
                  </p>
                  {data.apps.length === 0 && (
                    <button onClick={() => setModal({})} style={{ padding: "10px 24px", borderRadius: 8, background: "#0E766E", border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                      + Agregar primera app
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Aplicación</th>
                        <th>Tienda</th>
                        <th>Categoría</th>
                        <th style={{ textAlign: "right" }}>Costo</th>
                        <th>Ciclo</th>
                        <th style={{ textAlign: "right" }}>Mensual</th>
                        <th style={{ textAlign: "right" }}>Anual</th>
                        <th>Estado</th>
                        <th style={{ textAlign: "center" }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.sort((a, b) => b.monthlyUsd - a.monthlyUsd).map((app) => {
                        const cat   = catInfo(app.category);
                        const store = storeInfo(app.store);
                        const annualCost = app.billingCycle === "annual" ? app.costUsd : app.billingCycle === "monthly" ? app.costUsd * 12 : app.costUsd;
                        return (
                          <tr key={app.id} style={{ opacity: app.active ? 1 : 0.5 }}>
                            <td>
                              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{app.name}</div>
                              {app.notes && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{app.notes}</div>}
                            </td>
                            <td>
                              <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: store.bg, color: store.color }}>
                                {store.label}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: cat.color }}>{cat.icon}</span>
                                <span style={{ fontSize: 12, color: "var(--text-2)" }}>{cat.label}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>
                              {fmtUSD(app.costUsd)}
                            </td>
                            <td>
                              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                                {app.billingCycle === "monthly" ? "Mensual" : app.billingCycle === "annual" ? "Anual" : "Único"}
                              </span>
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "#0E766E" }}>
                              {app.monthlyUsd > 0 ? fmtUSD(app.monthlyUsd) : <span style={{ color: "var(--text-4)", fontSize: 11 }}>—</span>}
                            </td>
                            <td style={{ textAlign: "right", fontFamily: "monospace", color: "var(--text-2)" }}>
                              {fmtUSD(annualCost)}
                            </td>
                            <td>
                              <button onClick={() => toggleActive(app)} style={{
                                display: "flex", alignItems: "center", gap: 5,
                                padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                border: "1px solid",
                                borderColor: app.active ? "#059669" : "var(--border)",
                                background: app.active ? "#D1FAE5" : "transparent",
                                color: app.active ? "#065F46" : "var(--text-3)",
                                cursor: "pointer",
                              }}>
                                {app.active
                                  ? <><CheckCircle2 size={11} /> Activa</>
                                  : <><XCircle size={11} /> Inactiva</>}
                              </button>
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                                <button onClick={() => setModal(app)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-3)", cursor: "pointer" }}>
                                  <Pencil size={12} />
                                </button>
                                <button onClick={() => remove(app.id)} disabled={deleting === app.id} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #FEE2E2", background: "transparent", color: "#DC2626", cursor: "pointer" }}>
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Totals row */}
                    {filtered.length > 0 && (
                      <tfoot>
                        <tr style={{ background: "var(--bg-2)", borderTop: "2px solid var(--border)" }}>
                          <td colSpan={5} style={{ padding: "10px 16px", fontWeight: 700, fontSize: 13 }}>
                            Total ({filtered.filter(a=>a.active).length} apps activas)
                          </td>
                          <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 800, fontSize: 14, color: "#0E766E", padding: "10px 16px" }}>
                            {fmtUSD(filtered.filter(a=>a.active).reduce((s,a)=>s+a.monthlyUsd,0))}
                          </td>
                          <td style={{ textAlign: "right", fontFamily: "monospace", fontWeight: 700, color: "var(--text)", padding: "10px 16px" }}>
                            {fmtUSD(filtered.filter(a=>a.active).reduce((s,a)=>s+(a.billingCycle==="annual"?a.costUsd:a.billingCycle==="monthly"?a.costUsd*12:a.costUsd),0))}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* ── Info note ─────────────────────────────────────── */}
            <div style={{ padding: "14px 18px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)", borderLeftWidth: 4, borderLeftColor: "#6366F1" }}>
              <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--text-2)" }}>ℹ️ Sobre esta sección:</strong> La API de Shopify no expone los cargos de otras aplicaciones —
                solo ve los generados por la app propia. Registra aquí manualmente las apps que tienes instaladas para tener
                visibilidad total del costo de tu stack de Shopify. Incluye el plan de Shopify, apps de email, reviews,
                tracking, etc.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {modal !== null && (
        <AppModal
          initial={modal}
          onSave={save}
          onClose={() => setModal(null)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
