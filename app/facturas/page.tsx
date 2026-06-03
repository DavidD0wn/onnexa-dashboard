"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { localDateStr } from "@/lib/utils";
import {
  Upload, FileText, CheckCircle2, AlertTriangle, Clock,
  ChevronDown, ChevronRight, Trash2, DollarSign,
  Package, BarChart3, Search, RefreshCw, X,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────────────────── */
type Escalon = {
  id: string; productCode: string; productName: string; units: number;
  costMx: number | null; costUs: number | null; costCl: number | null;
};
type InvoiceItem = {
  id: string; lineitemName: string; productCode: string | null;
  quantity: number; costCharged: number; costExpected: number | null;
  isFree: boolean; hasDiscrepancy: boolean;
  discrepancyType: string | null; discrepancyDetail: string | null;
};
type InvoiceOrder = {
  id: string; orderNumber: string; country: string;
  totalCost: number; status: string; discrepancies: string;
  items: InvoiceItem[];
};
type Invoice = {
  id: string; filename: string; brandId: string;
  dateFrom: string | null; dateTo: string | null;
  invoiceMonth: string | null; totalAmount: number;
  totalOrders: number; totalUnits: number;
  discrepancyCount: number; status: string;
  dateOfPayment: string | null; paymentMethod: string | null;
  notes: string | null; createdAt: string;
  orders?: InvoiceOrder[];
};

/* ─── Helpers ────────────────────────────────────────────────────────────────── */
const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const BRAND_COLOR: Record<string, string> = {
  brand_glowmmi: "#EC4899",
  brand_balancea: "#10B981",
};
const BRAND_LABEL: Record<string, string> = {
  brand_glowmmi: "Glowmmi",
  brand_balancea: "Balancea",
};

const ORDER_STATUS = {
  ok:          { icon: "✅", label: "OK",            bg: "#D1FAE5", color: "#065F46", border: "#6EE7B7" },
  discrepancy: { icon: "⚠️", label: "Discrepancia",  bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
  not_found:   { icon: "❌", label: "No encontrada", bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5" },
  cancelled:   { icon: "🚫", label: "Cancelada",     bg: "#FEF3C7", color: "#92400E", border: "#FCD34D" },
};

/* ─── Order detail table ──────────────────────────────────────────────────────── */
function OrderTable({ orders }: { orders: InvoiceOrder[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "ok" | "discrepancy" | "not_found">("all");

  const visible = orders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (search && !o.orderNumber.includes(search)) return false;
    return true;
  });

  const allOk = orders.every((o) => o.status === "ok");

  return (
    <div>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar # orden…"
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12, width: 160,
            background: "#161B22", border: "1px solid #2D3748",
            color: "#F0F4F8", outline: "none",
          }}
        />
        {(["all","ok","discrepancy","not_found"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
            background: filter === f ? "#3D4F6A" : "#1C2433",
            color: filter === f ? "#F0F4F8" : "#64748B",
          }}>
            {f === "all" ? `Todas (${orders.length})` : f === "ok" ? `✅ OK (${orders.filter(o=>o.status==="ok").length})` : f === "discrepancy" ? `⚠️ Difer. (${orders.filter(o=>o.status==="discrepancy").length})` : `❌ No encontradas (${orders.filter(o=>o.status==="not_found").length})`}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748B" }}>
          {visible.length} / {orders.length} órdenes
        </span>
      </div>

      {/* no-escalones notice */}
      {allOk && orders[0]?.items?.some(i => i.costExpected === null && !i.isFree) && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 8, background: "#1e293b", border: "1px solid #334155" }}>
          <p style={{ fontSize: 12, color: "#94A3B8", margin: 0 }}>
            💡 <strong style={{ color: "#CBD5E1" }}>Sin escalones de costo configurados</strong> — la comparación de precios requiere que cargues los costos en la pestaña "Escalones de Costo". Por ahora solo se valida si la orden existe en Shopify.
          </p>
        </div>
      )}

      {/* table */}
      <div style={{ overflowX: "auto", maxHeight: 500, overflowY: "auto", borderRadius: 10, border: "1px solid #2D3748" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1, background: "#161B22" }}>
            <tr>
              {["#Orden","Estado","País","Producto","Unid","Cobrado","Esperado","Diferencia"].map((h) => (
                <th key={h} style={{
                  padding: "10px 14px", textAlign: h === "#Orden" || h === "Producto" ? "left" : "right",
                  fontSize: 10, fontWeight: 700, color: "#64748B",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  borderBottom: "1px solid #2D3748", whiteSpace: "nowrap",
                  ...(h === "#Orden" ? { textAlign: "left" } : {}),
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((order) => {
              const st = ORDER_STATUS[order.status as keyof typeof ORDER_STATUS] ?? ORDER_STATUS.ok;
              const rowBg = order.status === "not_found" ? "#1a0f0f"
                          : order.status === "discrepancy" ? "#1a1500"
                          : "transparent";

              // If order has items, render one row per item (grouped under order)
              if (order.items && order.items.length > 0) {
                return order.items.map((item, idx) => {
                  const diff = item.costExpected !== null ? item.costCharged - item.costExpected : null;
                  return (
                    <tr key={`${order.id}-${item.id}`} style={{
                      background: item.hasDiscrepancy ? "#1a1200" : rowBg,
                      borderBottom: "1px solid #2D3748",
                    }}>
                      {/* Order # — only on first item row */}
                      <td style={{ padding: "9px 14px", verticalAlign: "middle" }}>
                        {idx === 0 && (
                          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#F0F4F8" }}>
                            {order.orderNumber}
                          </span>
                        )}
                      </td>
                      {/* Status — only on first item row */}
                      <td style={{ padding: "9px 14px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                        {idx === 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20,
                            background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                          }}>
                            {st.icon} {st.label}
                          </span>
                        )}
                      </td>
                      {/* Country — only on first */}
                      <td style={{ padding: "9px 14px", textAlign: "right", verticalAlign: "middle" }}>
                        {idx === 0 && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8" }}>{order.country}</span>
                        )}
                      </td>
                      {/* Product name */}
                      <td style={{ padding: "9px 14px", verticalAlign: "middle", maxWidth: 220 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {item.isFree && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 10, background: "#2D3748", color: "#94A3B8" }}>GRATIS</span>}
                          <span style={{ color: item.hasDiscrepancy ? "#fca5a5" : "#F0F4F8", fontWeight: item.hasDiscrepancy ? 600 : 400, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                            {item.lineitemName}
                          </span>
                          {item.productCode && (
                            <span style={{ fontSize: 9, color: "#818cf8", background: "#1e1b4b", padding: "1px 6px", borderRadius: 10, border: "1px solid #3730a3", flexShrink: 0 }}>
                              {item.productCode}
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Units */}
                      <td style={{ padding: "9px 14px", textAlign: "right", color: "#94A3B8", verticalAlign: "middle" }}>
                        {item.quantity}
                      </td>
                      {/* Cobrado */}
                      <td style={{ padding: "9px 14px", textAlign: "right", fontWeight: 600, verticalAlign: "middle" }}>
                        <span style={{ color: item.hasDiscrepancy ? "#fca5a5" : "#F0F4F8" }}>
                          {fmt(item.costCharged)}
                        </span>
                      </td>
                      {/* Esperado */}
                      <td style={{ padding: "9px 14px", textAlign: "right", verticalAlign: "middle" }}>
                        {item.costExpected !== null
                          ? <span style={{ color: "#34d399", fontWeight: 600 }}>{fmt(item.costExpected)}</span>
                          : <span style={{ color: "#475569" }}>—</span>
                        }
                      </td>
                      {/* Diferencia */}
                      <td style={{ padding: "9px 14px", textAlign: "right", verticalAlign: "middle" }}>
                        {diff !== null ? (
                          <span style={{
                            fontWeight: 700, fontSize: 12,
                            padding: "2px 8px", borderRadius: 6,
                            background: diff > 0.05 ? "#7f1d1d" : diff < -0.05 ? "#064e3b" : "#1e293b",
                            color:      diff > 0.05 ? "#fca5a5" : diff < -0.05 ? "#6ee7b7" : "#64748B",
                          }}>
                            {diff >= 0 ? "+" : ""}{fmt(diff)}
                          </span>
                        ) : (
                          <span style={{ color: "#475569" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                });
              }

              // Fallback: order with no items (e.g. not_found)
              return (
                <tr key={order.id} style={{ background: rowBg, borderBottom: "1px solid #2D3748" }}>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 13, color: "#F0F4F8" }}>
                      {order.orderNumber}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                      {st.icon} {st.label}
                    </span>
                  </td>
                  <td style={{ padding: "12px 14px", textAlign: "right" }}>
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>{order.country}</span>
                  </td>
                  <td colSpan={5} style={{ padding: "12px 14px", color: "#64748B", fontSize: 12 }}>
                    Sin líneas de producto registradas
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────────── */
export default function FacturasPage() {
  const [invoices,      setInvoices]      = useState<Invoice[]>([]);
  const [escalones,     setEscalones]     = useState<Escalon[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [uploading,     setUploading]     = useState(false);
  const [activeTab,     setActiveTab]     = useState<"facturas" | "escalones">("facturas");
  const [selectedId,    setSelectedId]    = useState<string | null>(null);
  const [selected,      setSelected]      = useState<Invoice | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [brandFilter,   setBrandFilter]   = useState<"all" | "brand_glowmmi" | "brand_balancea">("all");
  const [uploadBrand,   setUploadBrand]   = useState<"brand_glowmmi" | "brand_balancea">("brand_glowmmi");
  const [dragOver,      setDragOver]      = useState(false);
  const [payModal,      setPayModal]      = useState<Invoice | null>(null);
  const [payForm,       setPayForm]       = useState({ date: "", method: "Transferencia", notes: "" });
  const [escalonSearch, setEscalonSearch] = useState("");
  const [newEsc,        setNewEsc]        = useState({ productCode: "", productName: "", units: 1, costMx: "", costUs: "", costCl: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  /* ─── Load ─── */
  const loadInvoices = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/facturas");
    const d = await r.json();
    setInvoices(Array.isArray(d) ? d : []);
    setLoading(false);
  }, []);

  const loadEscalones = useCallback(async () => {
    const r = await fetch("/api/facturas/escalones");
    const d = await r.json();
    setEscalones(Array.isArray(d) ? d : []);
  }, []);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    const r = await fetch(`/api/facturas/${id}`);
    const d = await r.json();
    setSelected(d);
    setDetailLoading(false);
  }, []);

  useEffect(() => { loadInvoices(); loadEscalones(); }, [loadInvoices, loadEscalones]);

  /* ─── Actions ─── */
  async function handleUpload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file); fd.append("brandId", uploadBrand);
    try {
      const r = await fetch("/api/facturas", { method: "POST", body: fd });
      const d = await r.json();
      if (d.error) { alert("Error: " + d.error); return; }
      await loadInvoices();
      if (d.id) openDetail(d.id);
    } catch (e: any) { alert("Error: " + e.message); }
    finally { setUploading(false); }
  }

  async function markPaid() {
    if (!payModal) return;
    await fetch("/api/facturas", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: payModal.id, status: "paid", dateOfPayment: payForm.date || null, paymentMethod: payForm.method, notes: payForm.notes }),
    });
    setPayModal(null);
    await loadInvoices();
    if (selected?.id === payModal.id) openDetail(payModal.id);
  }

  async function deleteInvoice(id: string) {
    if (!confirm("¿Eliminar esta factura y todos sus datos?")) return;
    await fetch(`/api/facturas/${id}`, { method: "DELETE" });
    if (selectedId === id) { setSelectedId(null); setSelected(null); }
    await loadInvoices();
  }

  async function saveEscalon(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/facturas/escalones", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productCode: newEsc.productCode.trim().toUpperCase(),
        productName: newEsc.productName.trim(),
        units: Number(newEsc.units),
        costMx: newEsc.costMx ? Number(newEsc.costMx) : null,
        costUs: newEsc.costUs ? Number(newEsc.costUs) : null,
        costCl: newEsc.costCl ? Number(newEsc.costCl) : null,
      }),
    });
    setNewEsc({ productCode: "", productName: "", units: 1, costMx: "", costUs: "", costCl: "" });
    await loadEscalones();
  }

  /* ─── Derived ─── */
  const filtered     = invoices.filter((i) => brandFilter === "all" || i.brandId === brandFilter);
  const totalPending = filtered.filter((i) => i.status === "pending").reduce((s, i) => s + i.totalAmount, 0);
  const totalPaid    = filtered.filter((i) => i.status === "paid").reduce((s, i) => s + i.totalAmount, 0);
  const totalDisc    = filtered.reduce((s, i) => s + i.discrepancyCount, 0);
  const filtEsc      = escalones.filter((e) =>
    !escalonSearch || e.productCode.toLowerCase().includes(escalonSearch.toLowerCase()) ||
    e.productName.toLowerCase().includes(escalonSearch.toLowerCase())
  );
  const escByProduct: Record<string, Escalon[]> = {};
  for (const e of filtEsc) {
    if (!escByProduct[e.productCode]) escByProduct[e.productCode] = [];
    escByProduct[e.productCode].push(e);
  }

  const pendingCount = filtered.filter((i) => i.status === "pending").length;
  const paidCount    = filtered.filter((i) => i.status === "paid").length;

  /* ─── Input style helper ─── */
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: "1.5px solid var(--border)", background: "var(--card)",
    color: "var(--text)", fontSize: 13, outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1280 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>
            📦 Facturas Proveedor
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>
            Analiza, compara y controla los cobros del proveedor vs. tus pedidos reales
          </p>
        </div>
        {/* Brand filter pills */}
        <div style={{ display: "flex", gap: 6 }}>
          {(["all", "brand_glowmmi", "brand_balancea"] as const).map((b) => (
            <button key={b} onClick={() => setBrandFilter(b)} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1.5px solid",
              borderColor: brandFilter === b ? (b === "brand_glowmmi" ? "#EC4899" : b === "brand_balancea" ? "#10B981" : "#6366f1") : "var(--border)",
              background:  brandFilter === b ? (b === "brand_glowmmi" ? "#EC4899" : b === "brand_balancea" ? "#10B981" : "#6366f1") : "var(--card)",
              color: brandFilter === b ? "#fff" : "var(--text-2)",
            }}>
              {b === "all" ? "Todas" : BRAND_LABEL[b]}
            </button>
          ))}
        </div>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        {[
          { icon: Clock,        label: "Por pagar",     value: fmt(totalPending), sub: `${pendingCount} factura${pendingCount !== 1 ? "s" : ""}`, accent: "#F59E0B", bg: "#FEF3C7" },
          { icon: CheckCircle2, label: "Pagado",        value: fmt(totalPaid),    sub: `${paidCount} factura${paidCount !== 1 ? "s" : ""}`,    accent: "#10B981", bg: "#D1FAE5" },
          { icon: FileText,     label: "Total",         value: String(filtered.length), sub: `${filtered.reduce((s, i) => s + i.totalOrders, 0)} órdenes`, accent: "#6366f1", bg: "#EEF2FF" },
          { icon: AlertTriangle,label: "Discrepancias", value: String(totalDisc), sub: "líneas con diferencia", accent: totalDisc > 0 ? "#EF4444" : "#10B981", bg: totalDisc > 0 ? "#FEE2E2" : "#D1FAE5" },
        ].map((k) => (
          <div key={k.label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: k.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <k.icon size={16} color={k.accent} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {k.label}
              </span>
            </div>
            <p style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: "0 0 2px" }}>{k.value}</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "var(--bg-2)", padding: 4, borderRadius: 12, width: "fit-content" }}>
        {(["facturas", "escalones"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none",
            background: activeTab === t ? "var(--card)" : "transparent",
            color:      activeTab === t ? "var(--text)" : "var(--text-3)",
            boxShadow:  activeTab === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
          }}>
            {t === "facturas" ? "📄 Facturas" : "💰 Escalones de Costo"}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: FACTURAS                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "facturas" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 20, alignItems: "start" }}>

          {/* ── Left column ─────────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Upload zone */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>
                Subir factura Excel
              </p>

              {/* Brand toggle */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
                {(["brand_glowmmi", "brand_balancea"] as const).map((b) => (
                  <button key={b} onClick={() => setUploadBrand(b)} style={{
                    padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                    cursor: "pointer", border: "1.5px solid",
                    borderColor: uploadBrand === b ? BRAND_COLOR[b] : "var(--border)",
                    background:  uploadBrand === b ? BRAND_COLOR[b] : "var(--card)",
                    color:       uploadBrand === b ? "#fff" : "var(--text-2)",
                  }}>
                    {BRAND_LABEL[b]}
                  </button>
                ))}
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                onClick={() => fileRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "#6366f1" : "var(--border)"}`,
                  borderRadius: 12, padding: "28px 16px", textAlign: "center", cursor: "pointer",
                  background: dragOver ? "#EEF2FF" : "var(--bg-2)",
                  transition: "all 0.15s",
                }}
              >
                {uploading ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <RefreshCw size={24} color="#6366f1" style={{ animation: "spin 1s linear infinite" }} />
                    <p style={{ fontSize: 13, color: "#6366f1", fontWeight: 600, margin: 0 }}>
                      Procesando vs Shopify…
                    </p>
                  </div>
                ) : (
                  <>
                    <Upload size={28} color="var(--text-3)" style={{ marginBottom: 10 }} />
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", margin: "0 0 4px" }}>
                      Arrastra el .xlsx aquí
                    </p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>o haz clic para seleccionar</p>
                  </>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
              />
            </div>

            {/* Invoice list */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                  Historial
                </p>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>{filtered.length}</span>
              </div>

              {loading ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                  <RefreshCw size={18} style={{ animation: "spin 1s linear infinite", marginBottom: 8 }} />
                  <p style={{ margin: 0 }}>Cargando…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center" }}>
                  <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>Sin facturas</p>
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Sube un Excel para empezar</p>
                </div>
              ) : (
                <div>
                  {filtered.map((inv) => {
                    const isSelected = selectedId === inv.id;
                    const bColor = BRAND_COLOR[inv.brandId] ?? "#6366f1";
                    return (
                      <div key={inv.id} onClick={() => openDetail(inv.id)} style={{
                        padding: "12px 18px", cursor: "pointer",
                        borderBottom: "1px solid var(--border)",
                        borderLeft: `3px solid ${isSelected ? bColor : "transparent"}`,
                        background: isSelected ? "var(--bg-2)" : "transparent",
                        transition: "background 0.12s",
                      }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "0 0 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {inv.filename.replace(/\.(xlsx|xls)$/i, "")}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0 }}>
                              {inv.totalOrders} órdenes · {fmtDate(inv.dateFrom)}
                              {inv.dateTo && inv.dateTo !== inv.dateFrom ? ` – ${fmtDate(inv.dateTo)}` : ""}
                            </p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 3px" }}>
                              {fmt(inv.totalAmount)}
                            </p>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
                              background: inv.status === "paid" ? "#D1FAE5" : "#FEF3C7",
                              color:      inv.status === "paid" ? "#065F46" : "#92400E",
                            }}>
                              {inv.status === "paid" ? "✅ Pagada" : "⏳ Pendiente"}
                            </span>
                          </div>
                        </div>
                        {inv.discrepancyCount > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
                              background: "#FEE2E2", color: "#991B1B", border: "1px solid #FCA5A5",
                            }}>
                              ⚠️ {inv.discrepancyCount} discrepancia{inv.discrepancyCount !== 1 ? "s" : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel: invoice detail ──────────────────────────────────── */}
          <div>
            {detailLoading && (
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 60, textAlign: "center" }}>
                <RefreshCw size={28} color="var(--text-3)" style={{ animation: "spin 1s linear infinite" }} />
                <p style={{ color: "var(--text-3)", marginTop: 12, fontSize: 14 }}>Cargando detalle…</p>
              </div>
            )}

            {!detailLoading && !selected && (
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 60, textAlign: "center" }}>
                <FileText size={40} color="var(--text-3)" style={{ marginBottom: 14, opacity: 0.5 }} />
                <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: "0 0 6px" }}>
                  Selecciona una factura
                </p>
                <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                  Haz clic en cualquier factura de la lista para ver el desglose completo
                </p>
              </div>
            )}

            {!detailLoading && selected && (
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>

                {/* Header */}
                <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: BRAND_COLOR[selected.brandId] ?? "#6366f1" }} />
                      <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                        {selected.filename}
                      </h2>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
                      {BRAND_LABEL[selected.brandId] ?? selected.brandId} ·{" "}
                      {fmtDate(selected.dateFrom)}
                      {selected.dateTo && selected.dateTo !== selected.dateFrom ? ` – ${fmtDate(selected.dateTo)}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {selected.status === "pending" ? (
                      <button
                        onClick={() => { setPayModal(selected); setPayForm({ date: localDateStr(), method: "Transferencia", notes: "" }); }}
                        style={{
                          padding: "8px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700,
                          background: "#10B981", border: "none", color: "#fff", cursor: "pointer",
                        }}
                      >
                        ✅ Marcar pagada
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 9, background: "#D1FAE5", color: "#065F46" }}>
                        ✅ Pagada {selected.dateOfPayment ? fmtDate(selected.dateOfPayment) : ""}
                      </span>
                    )}
                    <button
                      onClick={() => deleteInvoice(selected.id)}
                      style={{ padding: 8, borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border)", cursor: "pointer", display: "flex" }}
                      title="Eliminar"
                    >
                      <Trash2 size={14} color="#EF4444" />
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderBottom: "1px solid var(--border)" }}>
                  {[
                    { label: "Total factura", value: fmt(selected.totalAmount), accent: "#6366f1" },
                    { label: "Órdenes",        value: String(selected.totalOrders),     accent: "var(--text)" },
                    { label: "Unidades",       value: String(selected.totalUnits),      accent: "var(--text)" },
                    { label: "Discrepancias",  value: String(selected.discrepancyCount), accent: selected.discrepancyCount > 0 ? "#EF4444" : "#10B981" },
                  ].map((s) => (
                    <div key={s.label} style={{ padding: "16px 20px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: s.accent, margin: "0 0 3px" }}>{s.value}</p>
                      <p style={{ fontSize: 11, color: "var(--text-3)", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                        {s.label}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Discrepancy summary */}
                {selected.discrepancyCount > 0 && (
                  <div style={{ margin: "16px 20px", padding: "14px 16px", borderRadius: 10, background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#991B1B", margin: "0 0 8px" }}>
                      ⚠️ {selected.discrepancyCount} orden{selected.discrepancyCount !== 1 ? "es" : ""} con problemas
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selected.orders?.filter((o) => o.status !== "ok").map((o) => (
                        <span key={o.id} style={{
                          fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                          background: "#fff", border: "1px solid #FCA5A5", color: "#991B1B",
                        }}>
                          {o.orderNumber} — {ORDER_STATUS[o.status as keyof typeof ORDER_STATUS]?.label ?? o.status}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Order list */}
                <div style={{ padding: "4px 20px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 0 12px" }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                      Detalle por orden ({selected.orders?.length ?? 0})
                    </p>
                  </div>
                  <OrderTable orders={selected.orders ?? []} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ESCALONES DE COSTO                                               */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "escalones" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20, alignItems: "start" }}>

          {/* Add form */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
              Agregar / actualizar escalón
            </p>
            <form onSubmit={saveEscalon} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { key: "productCode" as const, label: "Código",  placeholder: "HB01, DC01…" },
                { key: "productName" as const, label: "Producto", placeholder: "Mascarilla Coreana" },
              ].map((f) => (
                <div key={f.key}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {f.label}
                  </label>
                  <input
                    value={newEsc[f.key]} required
                    onChange={(e) => setNewEsc((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder} style={inputStyle}
                  />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Unidades
                </label>
                <input
                  type="number" min={1} required value={newEsc.units}
                  onChange={(e) => setNewEsc((p) => ({ ...p, units: Number(e.target.value) }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {(["costMx", "costUs", "costCl"] as const).map((k, i) => (
                  <div key={k}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 4, textTransform: "uppercase" }}>
                      {["MX", "US", "CL"][i]}
                    </label>
                    <input
                      type="number" step="0.01"
                      value={newEsc[k]}
                      onChange={(e) => setNewEsc((p) => ({ ...p, [k]: e.target.value }))}
                      placeholder="8.50"
                      style={{ ...inputStyle, padding: "8px 10px" }}
                    />
                  </div>
                ))}
              </div>
              <button type="submit" style={{
                width: "100%", padding: "10px 0", borderRadius: 9, background: "#6366f1",
                border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                marginTop: 4,
              }}>
                Guardar escalón
              </button>
            </form>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
              Si ya existe el escalón (misma clave + unidades) se actualiza automáticamente.
            </p>
          </div>

          {/* Table */}
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                Escalones actuales <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({escalones.length})</span>
              </p>
              <div style={{ position: "relative" }}>
                <Search size={13} color="var(--text-3)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
                <input
                  value={escalonSearch}
                  onChange={(e) => setEscalonSearch(e.target.value)}
                  placeholder="Buscar producto…"
                  style={{ ...inputStyle, paddingLeft: 30, width: 200 }}
                />
              </div>
            </div>

            {Object.keys(escByProduct).length === 0 ? (
              <div style={{ padding: 48, textAlign: "center" }}>
                <Package size={32} color="var(--text-3)" style={{ opacity: 0.4, marginBottom: 12 }} />
                <p style={{ fontSize: 14, color: "var(--text-3)", margin: 0 }}>Sin escalones registrados</p>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Agrega el primero desde el formulario</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
                      {["Producto", "Unidades", "Costo MX", "Costo US", "Costo CL", ""].map((h) => (
                        <th key={h} style={{
                          padding: "10px 16px", textAlign: h === "" || h === "Unidades" ? "center" : h === "Producto" ? "left" : "right",
                          fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em",
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(escByProduct).map(([code, rows]) =>
                      rows.map((e, i) => (
                        <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          {i === 0 ? (
                            <td rowSpan={rows.length} style={{ padding: "12px 16px", verticalAlign: "top" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", background: "#EEF2FF", padding: "2px 8px", borderRadius: 20, display: "inline-block", marginBottom: 4 }}>
                                {code}
                              </div>
                              <div style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>{e.productName}</div>
                            </td>
                          ) : null}
                          <td style={{ padding: "10px 16px", textAlign: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", background: "var(--bg-2)", padding: "2px 8px", borderRadius: 6 }}>{e.units}u</span>
                          </td>
                          {[e.costMx, e.costUs, e.costCl].map((cost, ci) => (
                            <td key={ci} style={{ padding: "10px 16px", textAlign: "right", fontSize: 13, color: cost != null ? "var(--text)" : "var(--text-3)", fontWeight: cost != null ? 500 : 400 }}>
                              {cost != null ? fmt(cost) : "—"}
                            </td>
                          ))}
                          <td style={{ padding: "10px 16px", textAlign: "center" }}>
                            <button
                              onClick={async () => { if (!confirm("¿Eliminar?")) return; await fetch(`/api/facturas/escalones?id=${e.id}`, { method: "DELETE" }); loadEscalones(); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: 4, borderRadius: 4, display: "flex" }}
                            >
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: Marcar como pagada ───────────────────────────────────────── */}
      {payModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20, width: "100%", maxWidth: 420, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                Registrar pago
              </h3>
              <button onClick={() => setPayModal(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 20 }}>
              {payModal.filename} · <strong style={{ color: "var(--text)" }}>{fmt(payModal.totalAmount)}</strong>
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Fecha de pago
                </label>
                <input type="date" value={payForm.date}
                  onChange={(e) => setPayForm((p) => ({ ...p, date: e.target.value }))}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Método de pago
                </label>
                <select value={payForm.method}
                  onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value }))}
                  style={inputStyle}
                >
                  {["Transferencia", "Wise", "PayPal", "Tarjeta", "Otro"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", display: "block", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Notas (opcional)
                </label>
                <input value={payForm.notes} placeholder="Referencia, banco, etc."
                  onChange={(e) => setPayForm((p) => ({ ...p, notes: e.target.value }))}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button onClick={() => setPayModal(null)} style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: "var(--bg-2)", border: "1px solid var(--border)", color: "var(--text-2)",
              }}>
                Cancelar
              </button>
              <button onClick={markPaid} style={{
                flex: 1, padding: "10px 0", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: "#10B981", border: "none", color: "#fff",
              }}>
                ✅ Confirmar pago
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
