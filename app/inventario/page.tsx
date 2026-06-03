"use client";
import { useEffect, useState, useCallback } from "react";
import { Truck, RefreshCw, AlertTriangle, Clock, CheckCircle, Package, Search, ExternalLink } from "lucide-react";

/* ─── Types ──────────────────────────────────────────────────── */
interface PendingOrder {
  id: string;
  name: string;
  createdAt: string;
  daysPending: number;
  customerName: string;
  email: string;
  total: string;
  currency: string;
  country: string;
  items: { title: string; qty: number }[];
  store: string;
  brandColor: string;
  shopUrl: string;
}

interface SummaryData {
  total: number;
  urgent: number;
  warning: number;
  recent: number;
}

const MON_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAY_NAMES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MON_NAMES[d.getMonth()]}`;
}

function urgencyStyle(days: number) {
  if (days > 7)  return { bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5", label: "URGENTE", leftBorder: "#DC2626" };
  if (days >= 3) return { bg: "#FEF3C7", color: "#92400E", border: "#FCD34D", label: "Atención", leftBorder: "#D97706" };
  return           { bg: "#DBEAFE",  color: "#1E40AF", border: "#93C5FD", label: "Reciente",  leftBorder: "#3B82F6" };
}

export default function PedidosPendientesPage() {
  const [orders,  setOrders]  = useState<PendingOrder[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [store,   setStore]   = useState<"all"|"glowmmi"|"balancea">("all");
  const [search,  setSearch]  = useState("");
  const [urgency, setUrgency] = useState<"all"|"urgent"|"warning"|"recent">("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/shopify/pending-orders?store=${store}`);
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setOrders(data.orders ?? []);
      setSummary(data.summary ?? null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [store]);

  useEffect(() => { load(); }, [load]);

  const filtered = orders.filter((o) => {
    if (search) {
      const q = search.toLowerCase();
      if (!o.name.toLowerCase().includes(q) && !o.customerName.toLowerCase().includes(q) && !o.email.toLowerCase().includes(q)) return false;
    }
    if (urgency === "urgent"  && o.daysPending <= 7)  return false;
    if (urgency === "warning" && (o.daysPending < 3 || o.daysPending > 7)) return false;
    if (urgency === "recent"  && o.daysPending >= 3)  return false;
    return true;
  });

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0 }}>📦 Pedidos Pendientes de Envío</h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>Órdenes pagadas sin fulfillment — en tiempo real desde Shopify</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["all","glowmmi","balancea"] as const).map((s) => (
            <button key={s} onClick={() => setStore(s)} style={{
              padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: "1.5px solid",
              borderColor: store === s ? (s === "glowmmi" ? "#EC4899" : s === "balancea" ? "#10B981" : "#6366f1") : "var(--border)",
              background:  store === s ? (s === "glowmmi" ? "#EC4899" : s === "balancea" ? "#10B981" : "#6366f1") : "var(--card)",
              color: store === s ? "#fff" : "var(--text-2)",
            }}>
              {s === "all" ? "Todas" : s === "glowmmi" ? "🛍️ Glowmmi" : "🌿 Balancea"}
            </button>
          ))}
          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)", color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Total Pendientes", value: summary.total,   color: "#6366f1", sub: "sin enviar" },
            { label: "⚠️ URGENTES +7d",  value: summary.urgent,  color: "#DC2626", sub: "más de 7 días" },
            { label: "🟡 Atención 3-7d", value: summary.warning, color: "#D97706", sub: "3 a 7 días" },
            { label: "🔵 Recientes <3d", value: summary.recent,  color: "#2563EB", sub: "menos de 3 días" },
          ].map((k) => (
            <div key={k.label} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 20px" }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8 }}>{k.label}</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{k.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar orden, cliente, email…"
            style={{ width: "100%", padding: "8px 10px 8px 32px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        </div>
        {(["all","urgent","warning","recent"] as const).map((u) => {
          const counts = { all: orders.length, urgent: summary?.urgent ?? 0, warning: summary?.warning ?? 0, recent: summary?.recent ?? 0 };
          const labels = { all: "Todos", urgent: "⚠️ Urgentes", warning: "🟡 Atención", recent: "🔵 Recientes" };
          const activeColors = { all: "#374151", urgent: "#991B1B", warning: "#92400E", recent: "#1E40AF" };
          const activeBgs   = { all: "var(--bg-2)", urgent: "#FEE2E2", warning: "#FEF3C7", recent: "#DBEAFE" };
          return (
            <button key={u} onClick={() => setUrgency(u)} style={{
              padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1.5px solid ${urgency === u ? "transparent" : "var(--border)"}`,
              background: urgency === u ? activeBgs[u] : "var(--card)",
              color: urgency === u ? activeColors[u] : "var(--text-2)",
            }}>
              {labels[u]} ({counts[u]})
            </button>
          );
        })}
      </div>

      {error && <div style={{ padding: 14, borderRadius: 10, background: "#FEE2E2", color: "#991B1B", marginBottom: 16 }}>Error: {error}</div>}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
          <div style={{ textAlign: "center" }}>
            <RefreshCw size={28} style={{ color: "var(--text-3)", animation: "spin 1s linear infinite" }} />
            <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 12 }}>Consultando Shopify…</p>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>✅</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
            {orders.length === 0 ? "¡Todo al día!" : "No hay órdenes con ese filtro"}
          </p>
          <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 6 }}>
            {orders.length === 0 ? "No hay pedidos pendientes de envío ahora mismo." : `${orders.length} órdenes en total — cambia los filtros.`}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((order) => {
            const urg = urgencyStyle(order.daysPending);
            return (
              <div key={order.id} style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderLeft: `4px solid ${urg.leftBorder}`, borderRadius: 12, padding: "16px 20px",
                display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 16, alignItems: "start",
              }}>
                <div style={{ paddingTop: 2 }}>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 20, fontSize: 10, fontWeight: 800, textTransform: "uppercase", background: urg.bg, color: urg.color, border: `1px solid ${urg.border}`, whiteSpace: "nowrap" }}>
                    {urg.label}
                  </span>
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text)" }}>{order.name}</span>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: order.brandColor, display: "inline-block" }} />
                    <span style={{ fontSize: 12, color: "var(--text-3)" }}>{order.store === "glowmmi" ? "Glowmmi" : "Balancea"}</span>
                    {order.country && <span style={{ fontSize: 11, color: "var(--text-3)", background: "var(--bg-2)", padding: "1px 7px", borderRadius: 10 }}>{order.country}</span>}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8 }}><strong>{order.customerName}</strong> · {order.email}</p>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {order.items.map((item, i) => (
                      <span key={i} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: "var(--bg-2)", color: "var(--text-2)", border: "1px solid var(--border)" }}>
                        {item.qty}× {item.title}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 12, color: "var(--text-3)" }}>{fmtDate(order.createdAt)}</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: urg.color, lineHeight: 1.2, marginTop: 2 }}>{order.daysPending}d</p>
                  <p style={{ fontSize: 10, color: "var(--text-3)" }}>sin enviar</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{order.currency} {order.total}</p>
                  <a href={`https://${order.shopUrl}/admin/orders/${order.id}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 11, color: "#3B82F6", textDecoration: "none" }}>
                    Ver en Shopify <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
