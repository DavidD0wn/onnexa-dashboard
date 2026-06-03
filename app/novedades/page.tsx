"use client";
import { useEffect, useState, useCallback } from "react";
import { Bell, RefreshCw, AlertTriangle, Clock, Info, Package, FileText, ExternalLink, CheckCircle, Truck } from "lucide-react";

type Severity = "critical" | "warning" | "info";
type AlertType = "unfulfilled" | "no_tracking" | "cancelled" | "delivery_issue" | "invoice_unpaid" | "invoice_discrepancy";

interface NovedadAlert {
  id: string; type: AlertType; severity: Severity;
  title: string; detail: string;
  orderName?: string; store?: string; brandColor?: string;
  shopUrl?: string; orderId?: string;
  createdAt: string; daysSince?: number;
}

interface Counts { critical: number; warning: number; info: number; total: number }

const TYPE_LABELS: Record<AlertType, string> = {
  unfulfilled:          "Sin enviar",
  no_tracking:          "Sin tracking",
  cancelled:            "Cancelada",
  delivery_issue:       "Problema entrega",
  invoice_unpaid:       "Factura pendiente",
  invoice_discrepancy:  "Discrepancia factura",
};

const TYPE_ICONS: Record<AlertType, React.ReactNode> = {
  unfulfilled:         <Package       size={16} />,
  no_tracking:         <Clock         size={16} />,
  cancelled:           <CheckCircle   size={16} />,
  delivery_issue:      <Truck         size={16} />,
  invoice_unpaid:      <FileText      size={16} />,
  invoice_discrepancy: <AlertTriangle size={16} />,
};

const SEV_STYLES: Record<Severity, { bg: string; color: string; border: string; dot: string; label: string }> = {
  critical: { bg: "#FEE2E2", color: "#991B1B", border: "#FCA5A5", dot: "#DC2626", label: "Crítico" },
  warning:  { bg: "#FEF3C7", color: "#92400E", border: "#FCD34D", dot: "#D97706", label: "Atención" },
  info:     { bg: "#DBEAFE", color: "#1E40AF", border: "#93C5FD", dot: "#3B82F6", label: "Info"    },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export default function NovedadesPage() {
  const [alerts,  setAlerts]  = useState<NovedadAlert[]>([]);
  const [counts,  setCounts]  = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [filter,  setFilter]  = useState<"all"|Severity|AlertType>("all");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/novedades");
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setAlerts(data.alerts ?? []);
      setCounts(data.counts ?? null);
      setLastUpdated(new Date());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = alerts.filter((a) => {
    if (filter === "all") return true;
    if (filter === "critical" || filter === "warning" || filter === "info") return a.severity === filter;
    return a.type === filter;
  });

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <Bell size={22} /> Novedades
            {counts && counts.total > 0 && (
              <span style={{ fontSize: 13, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: counts.critical > 0 ? "#FEE2E2" : "#FEF3C7", color: counts.critical > 0 ? "#991B1B" : "#92400E" }}>
                {counts.total} alerta{counts.total !== 1 ? "s" : ""}
              </span>
            )}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>
            Pedidos sin enviar · Sin tracking · Cancelaciones · Facturas pendientes
            {lastUpdated && <span style={{ marginLeft: 8 }}>· Actualizado {lastUpdated.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>
        </div>
        <button onClick={load} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 9,
          background: "var(--card)", border: "1.5px solid var(--border)", color: "var(--text-2)",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Actualizar
        </button>
      </div>

      {/* Severity summary */}
      {counts && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          {[
            { key: "all",      value: counts.total,    bg: "var(--card)", color: "var(--text)",  border: "var(--border)", dot: "var(--text-3)", label: "Total"       },
            { key: "critical", value: counts.critical, ...SEV_STYLES.critical, label: "🔴 Crítico"  },
            { key: "warning",  value: counts.warning,  ...SEV_STYLES.warning,  label: "🟡 Atención" },
            { key: "info",     value: counts.info,     ...SEV_STYLES.info,     label: "🔵 Info"     },
          ].map((k) => (
            <div key={k.key} onClick={() => setFilter(k.key as any)} style={{
              background: filter === k.key ? (k.bg === "var(--card)" ? "var(--bg-2)" : k.bg) : "var(--card)",
              border: `1.5px solid ${filter === k.key ? (k.border === "var(--border)" ? "var(--text-3)" : k.border) : "var(--border)"}`,
              borderRadius: 14, padding: "16px 20px", cursor: "pointer",
              transition: "all 0.15s",
            }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: k.color === "var(--text)" ? "var(--text-3)" : k.color, marginBottom: 6 }}>{k.label}</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Type filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {(Object.entries(TYPE_LABELS) as [AlertType, string][]).map(([t, label]) => {
          const count = alerts.filter((a) => a.type === t).length;
          if (count === 0) return null;
          return (
            <button key={t} onClick={() => setFilter(filter === t ? "all" : t)} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 12px",
              borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1.5px solid ${filter === t ? "#374151" : "var(--border)"}`,
              background: filter === t ? "var(--bg-2)" : "var(--card)",
              color: filter === t ? "var(--text)" : "var(--text-2)",
            }}>
              {TYPE_ICONS[t]} {label} ({count})
            </button>
          );
        })}
      </div>

      {error && <div style={{ padding: 14, borderRadius: 10, background: "#FEE2E2", color: "#991B1B", marginBottom: 16 }}>Error: {error}</div>}

      {loading && (
        <div style={{ padding: 60, textAlign: "center" }}>
          <RefreshCw size={28} style={{ color: "var(--text-3)", animation: "spin 1s linear infinite" }} />
          <p style={{ color: "var(--text-3)", fontSize: 14, marginTop: 12 }}>Consultando Shopify y base de datos…</p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: 48, textAlign: "center" }}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>🎉</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>¡Sin novedades!</p>
          <p style={{ fontSize: 14, color: "var(--text-3)", marginTop: 6 }}>
            {alerts.length === 0 ? "Todo está al día — ningún pedido ni factura requiere atención." : "No hay alertas con ese filtro."}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((alert) => {
            const sev = SEV_STYLES[alert.severity];
            return (
              <div key={alert.id} style={{
                background: "var(--card)", border: "1px solid var(--border)",
                borderLeft: `4px solid ${sev.dot}`, borderRadius: 12, padding: "14px 18px",
                display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: sev.bg, color: sev.color,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {TYPE_ICONS[alert.type]}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{alert.title}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: sev.bg, color: sev.color, textTransform: "uppercase" }}>
                      {sev.label}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: "var(--bg-2)", color: "var(--text-3)" }}>
                      {TYPE_LABELS[alert.type]}
                    </span>
                    {alert.store && (
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: alert.brandColor, display: "inline-block" }} />
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-2)" }}>{alert.detail}</p>
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{fmtDate(alert.createdAt)}</p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {alert.daysSince !== undefined && (
                    <span style={{ fontSize: 18, fontWeight: 800, color: sev.color }}>{alert.daysSince}d</span>
                  )}
                  {alert.shopUrl && alert.orderId && (
                    <div>
                      <a href={`https://${alert.shopUrl}/admin/orders/${alert.orderId}`} target="_blank" rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#3B82F6", textDecoration: "none", marginTop: 4 }}>
                        Shopify <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
