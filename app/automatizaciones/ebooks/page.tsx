"use client";
import React, { useState, useEffect, useCallback } from "react";
import { BookOpen, RefreshCw, Send, CheckCircle, XCircle, Clock, Mail, RotateCcw } from "lucide-react";

/* ── Tipos ───────────────────────────────────────────────────── */
interface EbookOrder {
  shopifyOrderId: string;
  orderNumber:    string;
  customerEmail:  string;
  customerName:   string;
  ebookCount:     number;
  status:         "pending" | "sent" | "error";
  sentAt:         string | null;
  errorMsg:       string | null;
  createdAt:      string;
}

interface Summary { total: number; pending: number; sent: number; error: number; }

/* ── Tabs de productos ───────────────────────────────────────── */
const PRODUCTS = [
  { key: "herbiotic",   label: "HerBiotic™",   color: "#0E766E" },
  { key: "cutting-mix", label: "Cutting Mix™",  color: "#7C3AED" },
];

/* ── Paleta ──────────────────────────────────────────────────── */
const C = {
  bg: "#F8FAFB", card: "#FFFFFF", border: "#E5E7EB",
  text: "#111827", muted: "#6B7280",
  green: "#0E766E", greenL: "#ECFDF5",
  purple: "#7C3AED", purpleL: "#F5F3FF",
  red: "#EF4444", redL: "#FEF2F2",
  yellow: "#F59E0B", yellowL: "#FFFBEB",
  blue: "#3B82F6", blueL: "#EFF6FF",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
    sent:    { label: "Enviado",   color: C.green,  bg: C.greenL,  Icon: CheckCircle },
    pending: { label: "Pendiente", color: C.yellow, bg: C.yellowL, Icon: Clock       },
    error:   { label: "Error",     color: C.red,    bg: C.redL,    Icon: XCircle     },
  };
  const s = map[status] ?? map.pending;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4,
      fontSize:11, fontWeight:600, padding:"3px 10px", borderRadius:20,
      background:s.bg, color:s.color }}>
      <s.Icon size={11}/> {s.label}
    </span>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`,
      borderRadius:12, padding:"14px 18px", minWidth:110 }}>
      <div style={{ fontSize:24, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{label}</div>
    </div>
  );
}

/* ── Página ──────────────────────────────────────────────────── */
export default function EbooksPage() {
  const [activeProduct, setActiveProduct] = useState(PRODUCTS[0].key);
  const [orders,  setOrders]  = useState<EbookOrder[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [toast,   setToast]   = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchOrders = useCallback(async (productKey = activeProduct) => {
    setLoading(true);
    setOrders([]);
    setSummary(null);
    try {
      const res  = await fetch(`/api/ebooks?product=${productKey}`);
      const data = await res.json();
      if (data.ok) { setOrders(data.orders); setSummary(data.summary); }
      else showToast(data.error ?? "Error al cargar", false);
    } catch { showToast("Error de conexión", false); }
    finally  { setLoading(false); }
  }, [activeProduct]);

  useEffect(() => { fetchOrders(activeProduct); }, [activeProduct]);

  const sendOne = async (orderId: string, orderNumber: string) => {
    setSending(orderId);
    try {
      const res  = await fetch("/api/ebooks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey: activeProduct, shopifyOrderId: orderId }),
      });
      const data = await res.json();
      if (data.ok && data.sent > 0) { showToast(`✅ Ebook enviado a ${orderNumber}`, true); fetchOrders(); }
      else { showToast(`❌ ${orderNumber}: ${data.details?.[0]?.reason ?? data.error ?? "Error"}`, false); fetchOrders(); }
    } catch { showToast("Error de conexión", false); }
    finally  { setSending(null); }
  };

  const sendAll = async () => {
    setSending("all");
    try {
      const res  = await fetch("/api/ebooks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productKey: activeProduct, sendAll: true }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`✅ ${data.sent} enviados${data.errors > 0 ? ` · ${data.errors} errores` : ""}`, data.errors === 0);
        fetchOrders();
      } else showToast(data.error ?? "Error al enviar", false);
    } catch { showToast("Error de conexión", false); }
    finally  { setSending(null); }
  };

  const resetErrors = async () => {
    await fetch("/api/ebooks", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productKey: activeProduct }),
    });
    fetchOrders();
  };

  const pendingCount = summary?.pending ?? 0;
  const errorCount   = summary?.error   ?? 0;
  const accentColor  = PRODUCTS.find((p) => p.key === activeProduct)?.color ?? C.green;

  return (
    <div style={{ minHeight:"100vh", background:C.bg, padding:28 }}>

      {/* Toast */}
      {toast && (
        <div style={{ position:"fixed", top:20, right:24, zIndex:1000,
          background: toast.ok ? C.greenL : C.redL,
          border:`1px solid ${toast.ok ? C.green : C.red}`,
          color: toast.ok ? C.green : C.red,
          padding:"10px 18px", borderRadius:10, fontSize:13, fontWeight:600,
          boxShadow:"0 4px 12px rgba(0,0,0,0.1)" }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:40, height:40, borderRadius:10,
            background:`${accentColor}18`, display:"flex", alignItems:"center", justifyContent:"center" }}>
            <BookOpen size={20} color={accentColor}/>
          </div>
          <div>
            <h1 style={{ fontSize:20, fontWeight:700, color:C.text, margin:0 }}>Envío de Ebooks</h1>
            <p style={{ fontSize:12, color:C.muted, margin:0 }}>
              Envía automáticamente los ebooks de cada producto a tus clientes de Shopify
            </p>
          </div>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          {errorCount > 0 && (
            <button onClick={resetErrors}
              style={{ display:"flex", alignItems:"center", gap:5,
                padding:"7px 14px", borderRadius:8, border:`1px solid ${C.red}`,
                background:C.redL, color:C.red, fontSize:12, fontWeight:600, cursor:"pointer" }}>
              <RotateCcw size={13}/> Reintentar errores ({errorCount})
            </button>
          )}
          <button onClick={() => fetchOrders()} disabled={loading}
            style={{ display:"flex", alignItems:"center", gap:6,
              padding:"7px 14px", borderRadius:8, border:`1px solid ${C.border}`,
              background:C.card, color:C.text, fontSize:13, fontWeight:500,
              cursor: loading ? "not-allowed" : "pointer" }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }}/>
            Actualizar
          </button>
          <button onClick={sendAll}
            disabled={sending !== null || pendingCount === 0}
            style={{ display:"flex", alignItems:"center", gap:6,
              padding:"7px 16px", borderRadius:8, border:"none",
              background: (pendingCount === 0 || sending !== null) ? `${accentColor}25` : accentColor,
              color: (pendingCount === 0 || sending !== null) ? accentColor : "#fff",
              fontSize:13, fontWeight:600,
              cursor: (pendingCount === 0 || sending !== null) ? "not-allowed" : "pointer" }}>
            <Send size={13}/>
            {sending === "all" ? "Enviando…" : `Enviar todos los pendientes (${pendingCount})`}
          </button>
        </div>
      </div>

      {/* Tabs de producto */}
      <div style={{ display:"flex", gap:6, marginBottom:20 }}>
        {PRODUCTS.map((p) => {
          const active = p.key === activeProduct;
          return (
            <button key={p.key} onClick={() => setActiveProduct(p.key)}
              style={{ padding:"8px 18px", borderRadius:20,
                background: active ? p.color : C.card,
                color: active ? "#fff" : C.muted,
                fontSize:13, fontWeight:600, cursor:"pointer",
                boxShadow: active ? `0 2px 8px ${p.color}40` : "none",
                border: active ? "none" : `1px solid ${C.border}` } as React.CSSProperties}>
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Resumen */}
      {summary && (
        <div style={{ display:"flex", gap:12, marginBottom:20, flexWrap:"wrap" }}>
          <SummaryCard label="Total"      value={summary.total}   color={C.text}   />
          <SummaryCard label="Pendientes" value={summary.pending} color={C.yellow} />
          <SummaryCard label="Enviados"   value={summary.sent}    color={accentColor} />
          <SummaryCard label="Con error"  value={summary.error}   color={C.red}    />
        </div>
      )}

      {/* Tabla */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden" }}>
        {/* Cabecera */}
        <div style={{ display:"grid", gridTemplateColumns:"110px 1fr 155px 80px 100px 85px",
          gap:12, padding:"9px 20px",
          background:"#F9FAFB", borderBottom:`1px solid ${C.border}` }}>
          {["Orden","Correo cliente","Fecha compra","Ebooks","Estado","Acción"].map((h) => (
            <span key={h} style={{ fontSize:10, fontWeight:700, color:C.muted, textTransform:"uppercase" }}>{h}</span>
          ))}
        </div>

        {loading ? (
          <div style={{ padding:48, textAlign:"center", color:C.muted, fontSize:14 }}>
            Cargando órdenes desde Shopify…
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding:48, textAlign:"center", color:C.muted, fontSize:14 }}>
            No se encontraron órdenes con ebooks para este producto
          </div>
        ) : (
          orders.map((order, i) => (
            <div key={`${order.shopifyOrderId}`}
              style={{ display:"grid", gridTemplateColumns:"110px 1fr 155px 80px 100px 85px",
                gap:12, padding:"11px 20px", alignItems:"center",
                borderBottom: i < orders.length - 1 ? `1px solid ${C.border}` : "none",
                background: order.status === "error" ? "#FFF9F9" : "transparent" }}>

              <span style={{ fontSize:13, fontWeight:600, color:C.text }}>
                {order.orderNumber}
              </span>

              <div>
                <div style={{ fontSize:13, color:C.text }}>
                  {order.customerEmail || <span style={{ color:C.muted, fontStyle:"italic" }}>Sin correo</span>}
                </div>
                {order.customerName && (
                  <div style={{ fontSize:11, color:C.muted }}>{order.customerName}</div>
                )}
              </div>

              <span style={{ fontSize:12, color:C.muted }}>
                {new Date(order.createdAt).toLocaleDateString("es-MX", {
                  day:"2-digit", month:"short", year:"numeric" })}
              </span>

              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ fontSize:12, fontWeight:600, color:accentColor,
                  background:`${accentColor}18`, padding:"2px 8px", borderRadius:12 }}>
                  {order.ebookCount} {order.ebookCount === 1 ? "ebook" : "ebooks"}
                </span>
              </div>

              <div>
                <StatusBadge status={order.status}/>
                {order.status === "error" && order.errorMsg && (
                  <div style={{ fontSize:10, color:C.red, marginTop:3, maxWidth:120 }}
                    title={order.errorMsg}>
                    {order.errorMsg.slice(0,45)}{order.errorMsg.length > 45 ? "…" : ""}
                  </div>
                )}
                {order.status === "sent" && order.sentAt && (
                  <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                    {new Date(order.sentAt).toLocaleDateString("es-MX", { day:"2-digit", month:"short" })}
                  </div>
                )}
              </div>

              <div>
                {order.status !== "sent" ? (
                  <button onClick={() => sendOne(order.shopifyOrderId, order.orderNumber)}
                    disabled={sending !== null}
                    style={{ display:"flex", alignItems:"center", gap:4,
                      padding:"5px 11px", borderRadius:7, border:"none",
                      background: sending === order.shopifyOrderId ? `${accentColor}20` : accentColor,
                      color: sending === order.shopifyOrderId ? accentColor : "#fff",
                      fontSize:12, fontWeight:600,
                      cursor: sending !== null ? "not-allowed" : "pointer" }}>
                    {sending === order.shopifyOrderId
                      ? <RefreshCw size={11} style={{ animation:"spin 1s linear infinite" }}/>
                      : <Send size={11}/>}
                    {sending === order.shopifyOrderId ? "…" : "Enviar"}
                  </button>
                ) : (
                  <span style={{ fontSize:11, color:accentColor }}>✓ Listo</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
