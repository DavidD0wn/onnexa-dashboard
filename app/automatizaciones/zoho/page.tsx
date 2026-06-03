"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Mail, RefreshCw, CheckCircle, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2,
  Save, ToggleLeft, ToggleRight, Zap, Info, Link2,
} from "lucide-react";

/* ── tipos ───────────────────────────────────────────────────── */
interface ZohoConfig {
  id: string;
  emailAddress: string;
  displayName?: string;
  autoReplyEnabled: boolean;
  lastSyncAt?: string;
}

interface Conv {
  id: string;
  fromEmail: string;
  fromName?: string;
  subject: string;
  inboundText: string;
  outboundText?: string;
  ruleMatched?: string;
  status: string;
  hidden: boolean;
  errorMsg?: string;
  createdAt: string;
}

interface Rule {
  id: string;
  name: string;
  keywords: string;
  response: string;
  priority: number;
  isActive: boolean;
  matchCount: number;
}

/* ── colores ─────────────────────────────────────────────────── */
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

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  replied:          { label: "Respondido",     color: C.accent, bg: C.accentL },
  needs_attention:  { label: "Atención manual", color: C.yellow, bg: C.yellowL },
  escalated:        { label: "Escalado",        color: C.red,    bg: C.redL    },
  skipped:          { label: "Omitido",         color: C.muted,  bg: "#F3F4F6" },
  error:            { label: "Error",           color: C.red,    bg: C.redL    },
  pending:          { label: "Pendiente",       color: C.blue,   bg: C.blueL   },
};

/* ── helpers ─────────────────────────────────────────────────── */
function Badge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, color: C.muted, bg: "#F3F4F6" };
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px",
      borderRadius: 20, background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 120,
    }}>
      <p style={{ fontSize: 24, fontWeight: 700, color: color ?? C.text, margin: 0 }}>{value}</p>
      <p style={{ fontSize: 12, color: C.muted, margin: "2px 0 0" }}>{label}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function ZohoPage() {
  const [loading,     setLoading]     = useState(true);
  const [connected,   setConnected]   = useState(false);
  const [authUrl,     setAuthUrl]     = useState("");
  const [config,      setConfig]      = useState<ZohoConfig | null>(null);
  const [tab,         setTab]         = useState("estado");
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState<string>("");
  const [convs,       setConvs]       = useState<Conv[]>([]);
  const [stats,       setStats]       = useState<Record<string, number>>({});
  const [convFilter,  setConvFilter]  = useState("all");
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [rules,       setRules]       = useState<Rule[]>([]);
  const [editRule,    setEditRule]    = useState<Rule | null>(null);
  const [newRule,     setNewRule]     = useState(false);

  /* ── carga inicial ─────────────────────────────────── */
  const loadConfig = useCallback(async () => {
    const res  = await fetch("/api/automatizaciones/zoho");
    const data = await res.json();
    setConnected(data.connected);
    setAuthUrl(data.authUrl);
    setConfig(data.config ?? null);
    setLoading(false);
  }, []);

  const loadConvs = useCallback(async () => {
    const url  = convFilter === "all"
      ? "/api/automatizaciones/zoho/conversations?limit=100"
      : `/api/automatizaciones/zoho/conversations?status=${convFilter}&limit=100`;
    const res  = await fetch(url);
    const data = await res.json();
    setConvs(data.items ?? []);
    setStats(data.stats ?? {});
  }, [convFilter]);

  const loadRules = useCallback(async () => {
    const res  = await fetch("/api/automatizaciones/zoho/rules");
    const data = await res.json();
    setRules(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    if (!connected) return;
    if (tab === "bandeja")  loadConvs();
    if (tab === "reglas")   loadRules();
    if (tab === "estado")   { loadConvs(); loadRules(); }
  }, [tab, connected, convFilter, loadConvs, loadRules]);

  /* ── auto-sync cada 5 min ──────────────────────────── */
  useEffect(() => {
    if (!connected) return;
    const iv = setInterval(() => handleSync(true), 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [connected]);

  /* ── acciones ──────────────────────────────────────── */
  const handleSync = async (silent = false) => {
    if (!silent) setSyncing(true);
    setSyncResult("");
    try {
      const res  = await fetch("/api/automatizaciones/zoho/process");
      const data = await res.json();
      if (!silent) {
        const r = data.results?.[0];
        if (r?.error) setSyncResult("❌ " + r.error);
        else setSyncResult(`✅ Procesados: ${r?.processed ?? 0} | Respondidos: ${r?.replied ?? 0} | Atención: ${r?.skipped ?? 0}`);
      }
      loadConfig();
      if (tab === "bandeja" || tab === "estado") loadConvs();
    } catch (e: any) {
      if (!silent) setSyncResult("❌ " + e.message);
    } finally {
      if (!silent) setSyncing(false);
    }
  };

  const toggleAutoReply = async () => {
    if (!config) return;
    const res  = await fetch("/api/automatizaciones/zoho", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ autoReplyEnabled: !config.autoReplyEnabled }),
    });
    const data = await res.json();
    setConfig((c) => c ? { ...c, autoReplyEnabled: data.autoReplyEnabled } : c);
  };

  const hideConv = async (id: string, hidden: boolean) => {
    await fetch("/api/automatizaciones/zoho/conversations/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ id, hidden }),
    });
    setConvs((cs) => cs.filter((c) => c.id !== id));
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveRule = async (rule: Partial<Rule>) => {
    const keywordsArr = typeof rule.keywords === "string"
      ? rule.keywords.split(",").map((k) => k.trim()).filter(Boolean)
      : rule.keywords ?? [];

    if (rule.id) {
      await fetch("/api/automatizaciones/zoho/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ ...rule, keywords: keywordsArr }),
      });
    } else {
      await fetch("/api/automatizaciones/zoho/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ ...rule, keywords: keywordsArr }),
      });
    }
    setEditRule(null);
    setNewRule(false);
    loadRules();
  };

  const deleteRule = async (id: string) => {
    if (!confirm("¿Eliminar esta regla?")) return;
    await fetch(`/api/automatizaciones/zoho/rules?id=${id}`, { method: "DELETE" });
    loadRules();
  };

  const toggleRule = async (r: Rule) => {
    await fetch("/api/automatizaciones/zoho/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ ...r, isActive: !r.isActive }),
    });
    loadRules();
  };

  /* ── render: no conectado ─────────────────────────── */
  if (loading) {
    return (
      <div style={{ padding: 40, color: C.muted, fontSize: 14 }}>Cargando...</div>
    );
  }

  if (!connected) {
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <Mail size={28} color={C.accent} />
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bot Zoho Mail</h1>
            <p style={{ fontSize: 13, color: C.muted, margin: "2px 0 0" }}>
              Respuestas automáticas a correos de clientes
            </p>
          </div>
        </div>

        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 16, padding: 32,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: C.accentL,
            display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20,
          }}>
            <Mail size={28} color={C.accent} />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>
            Conecta tu cuenta Zoho Mail
          </h2>
          <p style={{ fontSize: 14, color: C.muted, margin: "0 0 24px", lineHeight: 1.6 }}>
            Una vez conectada, el bot leerá los correos entrantes, detectará
            palabras clave y responderá automáticamente — sin costo adicional.
          </p>

          <div style={{
            background: "#F8FAFB", borderRadius: 10, padding: 16,
            marginBottom: 24, fontSize: 13, color: C.muted,
          }}>
            <strong style={{ color: C.text, display: "block", marginBottom: 6 }}>
              ✅ Lo que hace el bot:
            </strong>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 2 }}>
              <li>Detecta preguntas de rastreo / tracking</li>
              <li>Responde preguntas de precio y envío</li>
              <li>Escala quejas serias para revisión manual</li>
              <li>Marca correos como leídos tras responder</li>
            </ul>
          </div>

          <a
            href={authUrl}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "13px 20px", borderRadius: 10,
              background: C.accent, color: "#fff",
              fontWeight: 600, fontSize: 14, textDecoration: "none",
            }}
          >
            <Link2 size={16} />
            Conectar cuenta Zoho Mail
          </a>
        </div>
      </div>
    );
  }

  /* ── render: conectado ────────────────────────────── */
  const tabs = ["estado", "bandeja", "reglas", "instrucciones"];
  const tabLabels: Record<string, string> = {
    estado: "Estado", bandeja: "Bandeja", reglas: "Reglas", instrucciones: "Instrucciones",
  };

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1000, fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Mail size={24} color={C.accent} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Bot Zoho Mail</h1>
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>{config?.emailAddress}</p>
          </div>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "3px 10px",
            borderRadius: 20, background: C.accentL, color: C.accent,
          }}>
            ● Activo
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {config?.lastSyncAt && (
            <span style={{ fontSize: 11, color: C.muted }}>
              Último sync: {new Date(config.lastSyncAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => handleSync(false)}
            disabled={syncing}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8,
              background: C.accent, color: "#fff", border: "none",
              fontWeight: 600, fontSize: 13, cursor: syncing ? "not-allowed" : "pointer",
              opacity: syncing ? 0.7 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Sincronizando..." : "Sincronizar"}
          </button>
        </div>
      </div>

      {syncResult && (
        <div style={{
          padding: "10px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13,
          background: syncResult.startsWith("✅") ? C.accentL : C.redL,
          color:      syncResult.startsWith("✅") ? C.accent   : C.red,
        }}>
          {syncResult}
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 2, marginBottom: 24,
        borderBottom: `1px solid ${C.border}`, paddingBottom: 0,
      }}>
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 16px", background: "none", border: "none",
              borderBottom: tab === t ? `2px solid ${C.accent}` : "2px solid transparent",
              color: tab === t ? C.accent : C.muted,
              fontWeight: tab === t ? 600 : 400,
              fontSize: 14, cursor: "pointer", marginBottom: -1,
            }}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {/* ── Tab: Estado ───────────────────────────────── */}
      {tab === "estado" && (
        <div>
          {/* KPIs */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
            <Stat label="Respondidos"     value={stats.replied         ?? 0} color={C.accent} />
            <Stat label="Atención manual" value={stats.needs_attention ?? 0} color={C.yellow} />
            <Stat label="Escalados"       value={stats.escalated       ?? 0} color={C.red}    />
            <Stat label="Con error"       value={stats.error           ?? 0} color={C.red}    />
            <Stat label="Omitidos"        value={stats.skipped         ?? 0} color={C.muted}  />
          </div>

          {/* Auto-reply toggle */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: "16px 20px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 16,
          }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>Auto-respuesta</p>
              <p style={{ fontSize: 12, color: C.muted, margin: "2px 0 0" }}>
                {config?.autoReplyEnabled
                  ? "El bot responde automáticamente los correos con regla coincidente"
                  : "El bot solo registra los correos, sin responder"}
              </p>
            </div>
            <button
              onClick={toggleAutoReply}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
            >
              {config?.autoReplyEnabled
                ? <ToggleRight size={32} color={C.accent} />
                : <ToggleLeft  size={32} color={C.muted}  />}
            </button>
          </div>

          {/* Top reglas */}
          {rules.filter((r) => r.matchCount > 0).length > 0 && (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20,
            }}>
              <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 12px" }}>Reglas más activadas</p>
              {rules
                .filter((r) => r.matchCount > 0)
                .sort((a, b) => b.matchCount - a.matchCount)
                .slice(0, 5)
                .map((r) => (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{ fontSize: 13 }}>{r.name}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "2px 10px",
                      borderRadius: 20, background: C.accentL, color: C.accent,
                    }}>
                      {r.matchCount}×
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Bandeja ──────────────────────────────── */}
      {tab === "bandeja" && (
        <div>
          {/* Filtro */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {["all", "needs_attention", "escalated", "replied", "error", "skipped"].map((s) => (
              <button
                key={s}
                onClick={() => setConvFilter(s)}
                style={{
                  padding: "5px 14px", borderRadius: 20, border: `1px solid ${C.border}`,
                  background: convFilter === s ? C.accent : C.card,
                  color:      convFilter === s ? "#fff"   : C.muted,
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}
              >
                {s === "all" ? "Todos" : STATUS_LABEL[s]?.label ?? s}
                {s !== "all" && stats[s] ? ` (${stats[s]})` : ""}
              </button>
            ))}
          </div>

          {convs.length === 0 ? (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 40, textAlign: "center", color: C.muted, fontSize: 14,
            }}>
              No hay correos con este filtro.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {convs.map((c) => {
                const exp  = expanded.has(c.id);
                const isAlert = c.status === "escalated" || c.status === "needs_attention";
                return (
                  <div
                    key={c.id}
                    style={{
                      background: C.card,
                      border: `1px solid ${isAlert ? (c.status === "escalated" ? C.red : C.yellow) : C.border}`,
                      borderRadius: 10,
                      overflow: "hidden",
                    }}
                  >
                    {/* Fila principal */}
                    <div
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px", cursor: "pointer",
                      }}
                      onClick={() => toggleExpand(c.id)}
                    >
                      <Mail size={14} color={C.muted} style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, fontSize: 13, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.fromName ? `${c.fromName} <${c.fromEmail}>` : c.fromEmail}
                        </p>
                        <p style={{ fontSize: 12, color: C.muted, margin: "1px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {c.subject}
                        </p>
                      </div>
                      <Badge status={c.status} />
                      {c.ruleMatched && (
                        <span style={{ fontSize: 11, color: C.muted }}>{c.ruleMatched}</span>
                      )}
                      <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>
                        {new Date(c.createdAt).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); hideConv(c.id, true); }}
                        title="Ocultar"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.muted }}
                      >
                        <EyeOff size={14} />
                      </button>
                      {exp ? <ChevronUp size={14} color={C.muted} /> : <ChevronDown size={14} color={C.muted} />}
                    </div>

                    {/* Detalle expandido */}
                    {exp && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 14px", background: "#FAFAFA" }}>
                        <div style={{ marginBottom: 10 }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: C.muted, margin: "0 0 4px", textTransform: "uppercase" }}>
                            Correo recibido
                          </p>
                          <p style={{
                            fontSize: 13, color: C.text, margin: 0,
                            background: "#F3F4F6", borderRadius: 8, padding: "8px 12px",
                            whiteSpace: "pre-wrap", lineHeight: 1.6,
                          }}>
                            {c.inboundText.slice(0, 800)}{c.inboundText.length > 800 ? "..." : ""}
                          </p>
                        </div>
                        {c.outboundText && (
                          <div>
                            <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, margin: "0 0 4px", textTransform: "uppercase" }}>
                              Respuesta enviada
                            </p>
                            <p style={{
                              fontSize: 13, color: C.text, margin: 0,
                              background: C.accentL, borderRadius: 8, padding: "8px 12px",
                              whiteSpace: "pre-wrap", lineHeight: 1.6,
                            }}>
                              {c.outboundText}
                            </p>
                          </div>
                        )}
                        {c.errorMsg && (
                          <p style={{ fontSize: 12, color: C.red, margin: "8px 0 0" }}>
                            ❌ {c.errorMsg}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Reglas ───────────────────────────────── */}
      {tab === "reglas" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              onClick={() => { setNewRule(true); setEditRule(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 8,
                background: C.accent, color: "#fff", border: "none",
                fontWeight: 600, fontSize: 13, cursor: "pointer",
              }}
            >
              <Plus size={14} /> Nueva regla
            </button>
          </div>

          {/* Formulario nueva / editar */}
          {(newRule || editRule) && (
            <RuleForm
              rule={editRule ?? undefined}
              onSave={saveRule}
              onCancel={() => { setEditRule(null); setNewRule(false); }}
            />
          )}

          {rules.length === 0 ? (
            <div style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 12, padding: 40, textAlign: "center", color: C.muted, fontSize: 14,
            }}>
              No hay reglas todavía. Haz click en "Nueva regla" para crear una.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {rules.map((r) => (
                <div
                  key={r.id}
                  style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 10, padding: "12px 14px",
                    display: "flex", alignItems: "flex-start", gap: 12,
                    opacity: r.isActive ? 1 : 0.55,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
                      <span style={{
                        fontSize: 10, padding: "1px 7px", borderRadius: 20,
                        background: "#F3F4F6", color: C.muted,
                      }}>
                        Prioridad {r.priority}
                      </span>
                      {r.matchCount > 0 && (
                        <span style={{
                          fontSize: 10, padding: "1px 7px", borderRadius: 20,
                          background: C.accentL, color: C.accent,
                        }}>
                          {r.matchCount}× activada
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
                      {(() => {
                        try {
                          const kws: string[] = JSON.parse(r.keywords);
                          return kws.slice(0, 6).map((k) => (
                            <span key={k} style={{
                              fontSize: 11, padding: "1px 8px", borderRadius: 20,
                              background: C.blueL, color: C.blue,
                            }}>
                              {k}
                            </span>
                          ));
                        } catch { return null; }
                      })()}
                    </div>
                    <p style={{
                      fontSize: 12, color: C.muted, margin: 0,
                      whiteSpace: "pre-wrap", lineHeight: 1.5,
                    }}>
                      {r.response.slice(0, 120)}{r.response.length > 120 ? "..." : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => toggleRule(r)} title="Activar/Desactivar" style={iconBtn}>
                      {r.isActive
                        ? <ToggleRight size={16} color={C.accent} />
                        : <ToggleLeft  size={16} color={C.muted}  />}
                    </button>
                    <button onClick={() => { setEditRule(r); setNewRule(false); }} title="Editar" style={iconBtn}>
                      <Save size={14} color={C.muted} />
                    </button>
                    <button onClick={() => deleteRule(r.id)} title="Eliminar" style={iconBtn}>
                      <Trash2 size={14} color={C.red} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Instrucciones ────────────────────────── */}
      {tab === "instrucciones" && (
        <div style={{ maxWidth: 700 }}>
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 24, marginBottom: 16,
          }}>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
              <CheckCircle size={20} color={C.accent} />
              <p style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Cuenta conectada</p>
            </div>
            <p style={{ fontSize: 14, color: C.muted, margin: "0 0 8px" }}>
              <strong style={{ color: C.text }}>Email:</strong> {config?.emailAddress}
            </p>
            <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>
              El bot sincroniza automáticamente cada 5 minutos cuando la ventana está abierta.
              También puedes sincronizar manualmente con el botón "Sincronizar".
            </p>
          </div>

          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 12, padding: 24, marginBottom: 16,
          }}>
            <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 16px" }}>¿Cómo funciona?</p>
            {[
              ["1", "Sincronización", "El bot lee los correos no leídos de tu bandeja de entrada en Zoho Mail."],
              ["2", "Detección", "Busca palabras clave en el asunto y cuerpo de cada correo."],
              ["3", "Respuesta automática", "Si encuentra una regla que coincide, envía la respuesta configurada."],
              ["4", "Escalación", "Si nadie sabe responder o el cliente parece muy molesto, el correo queda marcado en la Bandeja para revisión manual."],
              ["5", "Sin duplicados", "Cada correo solo se procesa una vez. Los procesados quedan registrados en la Bandeja."],
            ].map(([num, title, desc]) => (
              <div key={num} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: C.accentL, color: C.accent,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 13, flexShrink: 0,
                }}>
                  {num}
                </div>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 2px" }}>{title}</p>
                  <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: C.yellowL, border: `1px solid #FDE68A`,
            borderRadius: 12, padding: 16, fontSize: 13, color: "#92400E",
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0 }}>
                <strong>Nota sobre el servidor local:</strong> El bot solo sincroniza cuando el dashboard
                está abierto en el navegador (auto-sync cada 5 min). Para sincronización continua
                en producción, despliega en Vercel o Railway.
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ── Formulario de regla ─────────────────────────────────────── */
const iconBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: 6, borderRadius: 6, display: "flex", alignItems: "center",
};

interface RuleFormProps {
  rule?: Rule;
  onSave: (r: Partial<Rule>) => void;
  onCancel: () => void;
}

function RuleForm({ rule, onSave, onCancel }: RuleFormProps) {
  const kws = rule
    ? (() => { try { return (JSON.parse(rule.keywords) as string[]).join(", "); } catch { return rule.keywords; } })()
    : "";

  const [form, setForm] = useState({
    id:       rule?.id ?? "",
    name:     rule?.name ?? "",
    keywords: kws,
    response: rule?.response ?? "",
    priority: rule?.priority ?? 3,
    isActive: rule?.isActive ?? true,
  });

  const C2 = { border: "#E5E7EB", bg: "#F9FAFB" };

  const input: React.CSSProperties = {
    width: "100%", padding: "8px 12px", borderRadius: 8,
    border: `1px solid ${C2.border}`, background: C2.bg,
    fontSize: 13, outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{
      background: "#FFFFFF", border: `2px solid ${C.accent}`,
      borderRadius: 12, padding: 20, marginBottom: 16,
    }}>
      <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 14px" }}>
        {rule ? "Editar regla" : "Nueva regla"}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Nombre</label>
          <input style={input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ej: 🔍 Rastreo de pedido" />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Prioridad</label>
          <input style={input} type="number" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: parseInt(e.target.value) || 1 }))} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
          Palabras clave <span style={{ color: "#6B7280", fontWeight: 400 }}>(separadas por coma)</span>
        </label>
        <input style={input} value={form.keywords} onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))} placeholder="rastreo, tracking, mi pedido, donde esta" />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>
          Respuesta <span style={{ color: "#6B7280", fontWeight: 400 }}>({"{nombre}"} = nombre del cliente)</span>
        </label>
        <textarea
          style={{ ...input, minHeight: 120, resize: "vertical", fontFamily: "inherit" }}
          value={form.response}
          onChange={(e) => setForm((f) => ({ ...f, response: e.target.value }))}
          placeholder="Hola {nombre} 💚 Gracias por escribirnos..."
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`,
            background: "white", fontSize: 13, cursor: "pointer", fontWeight: 500,
          }}
        >
          Cancelar
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name || !form.keywords || !form.response}
          style={{
            padding: "8px 16px", borderRadius: 8, border: "none",
            background: C.accent, color: "#fff",
            fontSize: 13, cursor: "pointer", fontWeight: 600,
            opacity: (!form.name || !form.keywords || !form.response) ? 0.5 : 1,
          }}
        >
          Guardar
        </button>
      </div>
    </div>
  );
}
