"use client";
import { useState, useEffect, useCallback } from "react";
import { Mail, RefreshCw, Send, CheckCircle, XCircle, Clock, BookOpen, AlertCircle } from "lucide-react";

/* ── Tipos ───────────────────────────────────────────────────── */
interface EbookOrder {
  shopifyOrderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string;
  ebookCount: number;
  status: "pending" | "sent" | "error";
  sentAt: string | null;
  errorMsg: string | null;
  createdAt: string;
}

interface Summary {
  total: number;
  pending: number;
  sent: number;
  error: number;
}

/* ── Colores ─────────────────────────────────────────────────── */
const C = {
  bg:      "#F8FAFB",
  card:    "#FFFFFF",
  border:  "#E5E7EB",
  text:    "#111827",
  muted:   "#6B7280",
  accent:  "#0E766E",
  accentL: "#ECFDF5",
  red:     "#EF4444",
  redL:    "#FEF2F2",
  yellow:  "#F59E0B",
  yellowL: "#FFFBEB",
  blue:    "#3B82F6",
  blueL:   "#EFF6FF",
};

/* ── Badge de estado ─────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; Icon: any }> = {
    sent:    { label: "Enviado",   color: C.accent, bg: C.accentL, Icon: CheckCircle },
    pending: { label: "Pendiente", color: C.yellow, bg: C.yellowL, Icon: Clock       },
    error:   { label: "Error",     color: C.red,    bg: C.redL,    Icon: XCircle     },
  };
  const s = map[status] ?? map.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 600, padding: "3px 10px",
      borderRadius: 20, background: s.bg, color: s.color,
    }}>
      <s.Icon size={11} />
      {s.label}
    </span>
  );
}

/* ── Tarjeta de resumen ──────────────────────────────────────── */
function SummaryCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "16px 20px", minWidth: 120,
    }}>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* ── Página principal ────────────────────────────────────────── */
export default function HerbioticEbooksPage() {
  const [orders, setOrders]     = useState<EbookOrder[]>([]);
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [loading, setLoading]   = useState(false);
  const [sending, setSending]   = useState<string | null>(null); // orderId | "all"
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/herbiotic/ebooks");
      const data = await res.json();
      if (data.ok) {
        setOrders(data.orders);
        setSummary(data.summary);
      } else {
        showToast(data.error ?? "Error al cargar órdenes", false);
      }
    } catch {
      showToast("Error de conexión", false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const sendOne = async (orderId: string, orderNumber: string) => {
    setSending(orderId);
    try {
      const res  = await fetch("/api/herbiotic/ebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyOrderId: orderId }),
      });
      const data = await res.json();
      if (data.ok && data.sent > 0) {
        showToast(`✅ Ebook enviado a ${orderNumber}`, true);
        fetchOrders();
      } else {
        const err = data.details?.[0]?.reason ?? data.error ?? "Error desconocido";
        showToast(`❌ ${orderNumber}: ${err}`, false);
        fetchOrders();
      }
    } catch {
      showToast("Error de conexión", false);
    } finally {
      setSending(null);
    }
  };

  const sendAll = async () => {
    setSending("all");
    try {
      const res  = await fetch("/api/herbiotic/ebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendAll: true }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          `✅ ${data.sent} enviados${data.errors > 0 ? ` · ${data.errors} errores` : ""}`,
          data.errors === 0
        );
        fetchOrders();
      } else {
        showToast(data.error ?? "Error al enviar", false);
      }
    } catch {
      showToast("Error de conexión", false);
    } finally {
      setSending(null);
    }
  };

  const pendingCount = summary?.pending ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 28 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 24, zIndex: 1000,
          background: toast.ok ? C.accentL : C.redL,
          border: `1px solid ${toast.ok ? C.accent : C.red}`,
          color: toast.ok ? C.accent : C.red,
          padding: "10px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: C.accentL, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <BookOpen size={20} color={C.accent} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: C.text, margin: 0 }}>
              HerBiotic — Envío de Ebooks
            </h1>
            <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
              Clientes que compran x2 reciben 1 ebook · x3 reciben 2 ebooks
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={fetchOrders}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.card, color: C.text, fontSize: 13, fontWeight: 500,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            Actualizar
          </button>

          <button
            onClick={sendAll}
            disabled={sending !== null || pendingCount === 0}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: pendingCount === 0 || sending !== null ? "#D1FAE5" : C.accent,
              color: pendingCount === 0 || sending !== null ? C.accent : "#fff",
              fontSize: 13, fontWeight: 600,
              cursor: pendingCount === 0 || sending !== null ? "not-allowed" : "pointer",
            }}
          >
            <Send size={14} />
            {sending === "all"
              ? "Enviando..."
              : `Enviar todos los pendientes (${pendingCount})`}
          </button>
        </div>
      </div>

      {/* Resumen */}
      {summary && (
        <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
          <SummaryCard label="Total órdenes"  value={summary.total}   color={C.text}   bg={C.card} />
          <SummaryCard label="Pendientes"     value={summary.pending} color={C.yellow} bg={C.yellowL} />
          <SummaryCard label="Enviados"       value={summary.sent}    color={C.accent} bg={C.accentL} />
          <SummaryCard label="Con error"      value={summary.error}   color={C.red}    bg={C.redL} />
        </div>
      )}

      {/* Tabla */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, overflow: "hidden",
      }}>
        {/* Cabecera */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr 160px 80px 100px 90px",
          gap: 12, padding: "10px 20px",
          background: "#F9FAFB", borderBottom: `1px solid ${C.border}`,
        }}>
          {["Orden", "Correo cliente", "Fecha compra", "Ebooks", "Estado", "Acción"].map((h) => (
            <span key={h} style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase" }}>
              {h}
            </span>
          ))}
        </div>

        {/* Filas */}
        {loading && orders.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted, fontSize: 14 }}>
            Cargando órdenes de Shopify...
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: C.muted, fontSize: 14 }}>
            No se encontraron órdenes de HerBiotic
          </div>
        ) : (
          orders.map((order, i) => (
            <div
              key={order.shopifyOrderId}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 160px 80px 100px 90px",
                gap: 12, padding: "12px 20px", alignItems: "center",
                borderBottom: i < orders.length - 1 ? `1px solid ${C.border}` : "none",
                background: order.status === "error" ? "#FFF9F9" : "transparent",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {order.orderNumber}
              </span>

              <div>
                <div style={{ fontSize: 13, color: C.text }}>
                  {order.customerEmail || <span style={{ color: C.muted, fontStyle: "italic" }}>Sin correo</span>}
                </div>
                {order.customerName && (
                  <div style={{ fontSize: 11, color: C.muted }}>{order.customerName}</div>
                )}
              </div>

              <span style={{ fontSize: 12, color: C.muted }}>
                {new Date(order.createdAt).toLocaleDateString("es-MX", {
                  day: "2-digit", month: "short", year: "numeric",
                })}
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Mail size={13} color={C.accent} />
                <span style={{
                  fontSize: 12, fontWeight: 600, color: C.accent,
                  background: C.accentL, padding: "2px 8px", borderRadius: 12,
                }}>
                  {order.ebookCount} {order.ebookCount === 1 ? "ebook" : "ebooks"}
                </span>
              </div>

              <div>
                <StatusBadge status={order.status} />
                {order.status === "error" && order.errorMsg && (
                  <div style={{ fontSize: 10, color: C.red, marginTop: 3, maxWidth: 120 }}
                    title={order.errorMsg}>
                    {order.errorMsg.slice(0, 40)}{order.errorMsg.length > 40 ? "…" : ""}
                  </div>
                )}
                {order.status === "sent" && order.sentAt && (
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                    {new Date(order.sentAt).toLocaleDateString("es-MX", {
                      day: "2-digit", month: "short",
                    })}
                  </div>
                )}
              </div>

              <div>
                {order.status !== "sent" ? (
                  <button
                    onClick={() => sendOne(order.shopifyOrderId, order.orderNumber)}
                    disabled={sending !== null}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 12px", borderRadius: 7, border: "none",
                      background: sending === order.shopifyOrderId ? C.accentL : C.accent,
                      color: sending === order.shopifyOrderId ? C.accent : "#fff",
                      fontSize: 12, fontWeight: 600,
                      cursor: sending !== null ? "not-allowed" : "pointer",
                    }}
                  >
                    {sending === order.shopifyOrderId ? (
                      <RefreshCw size={11} style={{ animation: "spin 1s linear infinite" }} />
                    ) : (
                      <Send size={11} />
                    )}
                    {sending === order.shopifyOrderId ? "…" : "Enviar"}
                  </button>
                ) : (
                  <span style={{ fontSize: 11, color: C.accent }}>✓ Listo</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
