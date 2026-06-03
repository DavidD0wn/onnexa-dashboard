"use client";
import { useEffect, useState, useCallback } from "react";
import {
  MessageCircle, Settings, CheckCircle2, XCircle,
  Clock, AlertCircle, Copy, RefreshCw, Zap, Bot, Eye, EyeOff,
  ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Plus, Trash2,
  Tag, Edit3, Save, X,
} from "lucide-react";

function IgIcon({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <circle cx="12" cy="12" r="4"/>
      <circle cx="17.5" cy="6.5" r="1" fill={color} stroke="none"/>
    </svg>
  );
}

/* ── Tipos ───────────────────────────────────────────────────── */
interface Config {
  id: string | null; platform: string; pageId: string;
  pageAccessToken: string; igAccountId: string;
  autoReplyEnabled: boolean; replyToComments: boolean; replyToDMs: boolean;
  systemPrompt: string; signatureText: string; brandContext: string;
  appId: string; verifyToken: string;
}
interface Conversation {
  id: string; platform: string; type: string; senderId: string;
  senderName: string | null; inboundText: string; outboundText: string | null;
  ruleMatched: string | null; status: string; hidden: boolean;
  errorMsg: string | null; createdAt: string;
}
interface Rule {
  id: string; name: string; keywords: string; response: string;
  isActive: boolean; priority: number; matchCount: number;
}
interface Stats { total: number; replied: number; pending: number; error: number; skipped: number; }

const STATUS_COLOR: Record<string, string> = {
  replied:          "#10B981",
  pending:          "#F59E0B",
  error:            "#EF4444",
  skipped:          "#6B7280",
  escalated:        "#EF4444",
  needs_attention:  "#F59E0B",
};
const STATUS_LABEL: Record<string, string> = {
  replied:          "Respondido",
  pending:          "Pendiente",
  error:            "Error",
  skipped:          "Omitido",
  escalated:        "🚨 Atiende tú",
  needs_attention:  "⚠️ Sin respuesta",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-CO", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 4, color: copied ? "#10B981" : "var(--text-muted)", fontSize: 12, borderRadius: 6 }}>
      {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
      {copied ? "Copiado" : "Copiar"}
    </button>
  );
}

const TABS = ["Estado", "Reglas", "Bandeja", "Configuración", "Instrucciones"] as const;
type Tab = typeof TABS[number];

const EMPTY_RULE: Omit<Rule, "id" | "matchCount"> = { name: "", keywords: "[]", response: "", isActive: true, priority: 0 };

/* ── Variables disponibles ───────────────────────────────────── */
const VARS = ["{nombre}", "{plataforma}"];

/* ═══════════════════════════════════════════════════════════════ */
export default function MetaBotPage() {
  const [tab,           setTab]          = useState<Tab>("Estado");
  const [config,        setConfig]       = useState<Config | null>(null);
  const [form,          setForm]         = useState<Config | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [rules,         setRules]        = useState<Rule[]>([]);
  const [stats,         setStats]        = useState<Stats>({ total: 0, replied: 0, pending: 0, error: 0, skipped: 0 });
  const [loading,       setLoading]      = useState(true);
  const [saving,        setSaving]       = useState(false);
  const [saved,         setSaved]        = useState(false);
  const [showToken,     setShowToken]    = useState(false);
  const [filterStatus,  setFilterStatus] = useState<string>("");
  const [showHidden,    setShowHidden]   = useState(false);
  const [expandedConv,  setExpandedConv] = useState<string | null>(null);
  // Reglas
  const [editingRule,   setEditingRule]  = useState<(Omit<Rule,"id"|"matchCount"> & { id?: string }) | null>(null);
  const [kwInput,       setKwInput]      = useState("");

  const loadData = useCallback(async () => {
    const [cfgRes, convRes, rulesRes] = await Promise.all([
      fetch("/api/automatizaciones/meta"),
      fetch(`/api/automatizaciones/meta/conversations?limit=100${filterStatus ? "&status=" + filterStatus : ""}`),
      fetch("/api/automatizaciones/meta/rules"),
    ]);
    const cfg   = await cfgRes.json();
    const conv  = await convRes.json();
    const rls   = await rulesRes.json();
    setConfig(cfg); setForm(cfg);
    setConversations(conv.items ?? []);
    setStats(conv.counts ?? { total: 0, replied: 0, pending: 0, error: 0, skipped: 0 });
    setRules(rls);
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSaveConfig = async () => {
    if (!form) return;
    setSaving(true);
    await fetch("/api/automatizaciones/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000); loadData();
  };
  const toggleAutoReply = async () => {
    if (!form) return;
    const nf = { ...form, autoReplyEnabled: !form.autoReplyEnabled };
    setForm(nf);
    await fetch("/api/automatizaciones/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nf) });
    loadData();
  };
  const hideConv = async (id: string, hidden: boolean) => {
    await fetch("/api/automatizaciones/meta/conversations/hide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, hidden }) });
    setConversations(prev => prev.map(c => c.id === id ? { ...c, hidden } : c));
  };
  const saveRule = async () => {
    if (!editingRule) return;
    if (editingRule.id) {
      await fetch("/api/automatizaciones/meta/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingRule) });
    } else {
      await fetch("/api/automatizaciones/meta/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingRule) });
    }
    setEditingRule(null); loadData();
  };
  const deleteRule = async (id: string) => {
    await fetch("/api/automatizaciones/meta/rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    loadData();
  };
  const toggleRule = async (rule: Rule) => {
    await fetch("/api/automatizaciones/meta/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rule, keywords: rule.keywords, isActive: !rule.isActive }) });
    loadData();
  };
  const addKeyword = () => {
    if (!kwInput.trim() || !editingRule) return;
    const kws: string[] = JSON.parse(editingRule.keywords);
    if (!kws.includes(kwInput.trim())) {
      setEditingRule({ ...editingRule, keywords: JSON.stringify([...kws, kwInput.trim()]) });
    }
    setKwInput("");
  };
  const removeKeyword = (kw: string) => {
    if (!editingRule) return;
    const kws: string[] = JSON.parse(editingRule.keywords);
    setEditingRule({ ...editingRule, keywords: JSON.stringify(kws.filter(k => k !== kw)) });
  };

  /* ── Estilos ─────────────────────────────────────────────────*/
  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, marginBottom: 16 };
  const lbl:  React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 6, display: "block" };
  const inp:  React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 14, outline: "none", boxSizing: "border-box" as const };
  const txa:  React.CSSProperties = { ...inp, minHeight: 100, resize: "vertical" as const, fontFamily: "inherit", lineHeight: 1.6 };

  const visibleConvs = conversations.filter(c => showHidden ? true : !c.hidden);

  if (loading) return <main style={{ padding: "32px 40px" }}><p style={{ color: "var(--text-muted)" }}>Cargando...</p></main>;

  const isConnected = !!(form?.pageAccessToken);
  const webhookUrl  = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/meta` : "/api/webhooks/meta";

  return (
    <main style={{ padding: "32px 40px", maxWidth: 980, margin: "0 auto" }}>

      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#833AB4,#FD1D1D,#FCB045)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IgIcon size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bot Meta</h1>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Instagram · Facebook — respuestas automáticas por reglas</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Auto-respuesta</span>
          <button onClick={toggleAutoReply} style={{ background: "none", border: "none", cursor: "pointer", color: form?.autoReplyEnabled ? "#10B981" : "var(--text-muted)", display: "flex", alignItems: "center" }}>
            {form?.autoReplyEnabled ? <ToggleRight size={38} strokeWidth={1.5} /> : <ToggleLeft size={38} strokeWidth={1.5} />}
          </button>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", marginBottom: 24, borderBottom: "2px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 20px", background: "none", border: "none", cursor: "pointer", fontSize: 14, fontWeight: tab === t ? 700 : 400, color: tab === t ? "var(--accent)" : "var(--text-muted)", borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent", marginBottom: -2 }}>
            {t}{t === "Reglas" && ` (${rules.length})`}
          </button>
        ))}
      </div>

      {/* ════ TAB: ESTADO ════════════════════════════════════════ */}
      {tab === "Estado" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
            {[
              { label: "Total mensajes",  value: stats.total,   color: "#6366F1", icon: MessageCircle },
              { label: "Respondidos",     value: stats.replied, color: "#10B981", icon: CheckCircle2  },
              { label: "🚨 Atiende tú",  value: (stats as any).escalated + (stats as any).needs_attention || 0, color: "#EF4444", icon: AlertCircle, onClick: () => setTab("Bandeja") },
              { label: "Sin regla",       value: stats.skipped, color: "#6B7280", icon: Clock         },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} onClick={(s as any).onClick} style={{ ...card, padding: 18, marginBottom: 0, display: "flex", alignItems: "center", gap: 14, cursor: (s as any).onClick ? "pointer" : "default" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: s.color+"18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={18} color={s.color} />
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{s.value}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>{s.label}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Estado del bot</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 20, background: isConnected ? "#10B98118" : "#EF444418", border: `1px solid ${isConnected ? "#10B98140" : "#EF444440"}` }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: isConnected ? "#10B981" : "#EF4444", boxShadow: isConnected ? "0 0 0 2px #10B98130" : "none" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: isConnected ? "#10B981" : "#EF4444" }}>{isConnected ? "Conectado" : "Sin Page Token"}</span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                { label: "Reglas activas",   value: rules.filter(r => r.isActive).length + " / " + rules.length },
                { label: "Auto-respuesta",   value: form?.autoReplyEnabled ? "✅ Activa" : "❌ Inactiva" },
                { label: "Responde a",       value: [form?.replyToComments && "Comentarios", form?.replyToDMs && "DMs"].filter(Boolean).join(" + ") || "Nada" },
              ].map(s => (
                <div key={s.label} style={{ padding: "14px 16px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Top reglas */}
          {rules.length > 0 && (
            <div style={card}>
              <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Reglas más activas</h2>
              {[...rules].sort((a,b) => b.matchCount - a.matchCount).slice(0,5).map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.isActive ? "#10B981" : "#6B7280", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{r.name}</span>
                  <span style={{ fontSize: 12, padding: "2px 10px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", fontWeight: 600 }}>{r.matchCount} activaciones</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ════ TAB: REGLAS ════════════════════════════════════════ */}
      {tab === "Reglas" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
              Cuando alguien escribe algo que coincide con una palabra clave, el bot responde automáticamente con la plantilla configurada.
            </p>
            <button
              onClick={() => { setEditingRule({ ...EMPTY_RULE }); setKwInput(""); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 10, background: "var(--accent)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", flexShrink: 0, marginLeft: 16 }}>
              <Plus size={16} /> Nueva regla
            </button>
          </div>

          {/* Variables disponibles */}
          <div style={{ marginBottom: 16, padding: "12px 16px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Variables en respuestas:</span>
            {VARS.map(v => (
              <code key={v} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "var(--accent)18", border: "1px solid var(--accent)40", color: "var(--accent)" }}>{v}</code>
            ))}
          </div>

          {/* Editor de regla */}
          {editingRule && (
            <div style={{ ...card, border: "2px solid var(--accent)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{editingRule.id ? "Editar regla" : "Nueva regla"}</h3>
                <button onClick={() => setEditingRule(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}><X size={18} /></button>
              </div>
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label style={lbl}>Nombre de la regla</label>
                  <input style={inp} placeholder="ej: Precio / Costo" value={editingRule.name} onChange={e => setEditingRule({ ...editingRule, name: e.target.value })} />
                </div>
                <div>
                  <label style={lbl}>Palabras clave (escribe y presiona Enter)</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)", minHeight: 50, alignItems: "center" }}>
                    {(JSON.parse(editingRule.keywords) as string[]).map(kw => (
                      <span key={kw} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: "var(--accent)18", border: "1px solid var(--accent)40", fontSize: 12, fontWeight: 600 }}>
                        {kw}
                        <button onClick={() => removeKeyword(kw)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--text-muted)" }}><X size={11} /></button>
                      </span>
                    ))}
                    <input
                      value={kwInput}
                      onChange={e => setKwInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addKeyword(); } }}
                      placeholder="Escribe y presiona Enter..."
                      style={{ border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13, minWidth: 160 }}
                    />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Respuesta automática</label>
                  <textarea style={txa} value={editingRule.response} onChange={e => setEditingRule({ ...editingRule, response: e.target.value })} placeholder="Hola {nombre}! 😊 ..." />
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-muted)" }}>Usa {"{nombre}"} para el nombre del usuario y {"{plataforma}"} para Instagram o Facebook.</p>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <label style={lbl}>Prioridad (mayor = primero)</label>
                    <input type="number" style={inp} value={editingRule.priority} onChange={e => setEditingRule({ ...editingRule, priority: parseInt(e.target.value) || 0 })} />
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 20 }}>
                    <input type="checkbox" checked={editingRule.isActive} onChange={e => setEditingRule({ ...editingRule, isActive: e.target.checked })} style={{ accentColor: "var(--accent)", width: 16, height: 16 }} />
                    <span style={{ fontSize: 14 }}>Activa</span>
                  </label>
                </div>
                <button onClick={saveRule} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 10, background: "var(--accent)", border: "none", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                  <Save size={16} /> Guardar regla
                </button>
              </div>
            </div>
          )}

          {/* Lista de reglas */}
          {rules.length === 0 ? (
            <div style={{ ...card, textAlign: "center", padding: 48 }}>
              <Tag size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
              <p style={{ color: "var(--text-muted)", margin: 0 }}>Sin reglas aún — crea la primera</p>
            </div>
          ) : (
            [...rules].sort((a,b) => b.priority - a.priority).map(rule => {
              const kws: string[] = JSON.parse(rule.keywords);
              return (
                <div key={rule.id} style={{ ...card, marginBottom: 10, padding: 18, opacity: rule.isActive ? 1 : 0.6 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                    <button onClick={() => toggleRule(rule)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 2, flexShrink: 0 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 4, background: rule.isActive ? "var(--accent)" : "var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {rule.isActive && <CheckCircle2 size={11} color="#fff" />}
                      </div>
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{rule.name}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text-muted)" }}>P{rule.priority}</span>
                        <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 10, background: "#10B98118", border: "1px solid #10B98140", color: "#10B981", fontWeight: 600, marginLeft: "auto" }}>{rule.matchCount} activaciones</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                        {kws.map(kw => (
                          <span key={kw} style={{ padding: "2px 10px", borderRadius: 20, background: "var(--accent)12", border: "1px solid var(--accent)30", fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>{kw}</span>
                        ))}
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{rule.response}</p>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button onClick={() => { setEditingRule({ ...rule }); setKwInput(""); }} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                        <Edit3 size={13} /> Editar
                      </button>
                      <button onClick={() => deleteRule(rule.id)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #EF444430", background: "#EF444408", cursor: "pointer", color: "#EF4444", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}

      {/* ════ TAB: BANDEJA ═══════════════════════════════════════ */}
      {tab === "Bandeja" && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {["", "escalated", "needs_attention", "replied", "skipped", "error"].map(s => {
              const isAlert = s === "escalated" || s === "needs_attention";
              const active  = filterStatus === s;
              return (
                <button key={s} onClick={() => setFilterStatus(s)} style={{
                  padding: "6px 14px", borderRadius: 20, border: "1.5px solid",
                  borderColor: active ? (isAlert ? "#EF4444" : "var(--accent)") : "var(--border)",
                  background: active ? (isAlert ? "#EF4444" : "var(--accent)") : (isAlert ? "#EF444408" : "transparent"),
                  color: active ? "#fff" : (isAlert ? "#EF4444" : "var(--text-muted)"),
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}>
                  {s === "" ? `Todo (${stats.total})` : `${STATUS_LABEL[s] ?? s} (${(stats as any)[s] ?? 0})`}
                </button>
              );
            })}
            <button onClick={() => setShowHidden(!showHidden)} style={{ marginLeft: "auto", padding: "6px 14px", borderRadius: 20, border: "1.5px solid var(--border)", background: showHidden ? "var(--bg)" : "transparent", color: "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {showHidden ? <Eye size={12} /> : <EyeOff size={12} />} {showHidden ? "Ocultar los ocultos" : "Ver ocultos"}
            </button>
            <button onClick={loadData} style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
              <RefreshCw size={12} /> Refrescar
            </button>
          </div>

          {visibleConvs.length === 0 ? (
            <div style={{ ...card, textAlign: "center", padding: 48 }}>
              <Bot size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
              <p style={{ color: "var(--text-muted)", margin: 0 }}>Sin conversaciones aún</p>
            </div>
          ) : (
            visibleConvs.map(c => {
              const needsAction = c.status === "escalated" || c.status === "needs_attention";
              return (
              <div key={c.id} style={{ ...card, marginBottom: 8, padding: 0, overflow: "hidden", opacity: c.hidden ? 0.5 : 1, border: needsAction ? "1.5px solid #EF444450" : "1px solid var(--border)", boxShadow: needsAction && !c.hidden ? "0 0 0 3px #EF444410" : "none" }}>
                <div onClick={() => setExpandedConv(expandedConv === c.id ? null : c.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: c.platform === "instagram" ? "#833AB418" : "#1877F218", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {c.platform === "instagram" ? <IgIcon size={14} color="#833AB4" /> : <MessageCircle size={14} color="#1877F2" />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{c.senderName ?? c.senderId.slice(0,12)+"..."}</span>
                      <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--bg)", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{c.type}</span>
                      {c.ruleMatched && <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 8, background: "#6366F115", color: "#6366F1", fontWeight: 600 }}>↳ {c.ruleMatched}</span>}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.inboundText}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: (STATUS_COLOR[c.status]??"#6B7280")+"18", color: STATUS_COLOR[c.status]??"#6B7280", fontWeight: 700 }}>{STATUS_LABEL[c.status]??c.status}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDate(c.createdAt)}</span>
                    {/* Ocultar botón */}
                    <button onClick={e => { e.stopPropagation(); hideConv(c.id, !c.hidden); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--text-muted)", display: "flex" }} title={c.hidden ? "Mostrar" : "Ocultar"}>
                      {c.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    {expandedConv === c.id ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                  </div>
                </div>
                {expandedConv === c.id && (
                  <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                      <div>
                        <p style={{ ...lbl, marginBottom: 6 }}>Mensaje recibido</p>
                        <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", fontSize: 13, lineHeight: 1.6 }}>{c.inboundText}</div>
                      </div>
                      <div>
                        <p style={{ ...lbl, marginBottom: 6 }}>Respuesta enviada</p>
                        <div style={{ padding: "12px 14px", borderRadius: 10, background: c.outboundText ? "#10B98110" : "var(--bg)", border: `1px solid ${c.outboundText ? "#10B98130" : "var(--border)"}`, fontSize: 13, lineHeight: 1.6, color: c.outboundText ? "var(--text)" : "var(--text-muted)" }}>
                          {c.outboundText ?? (c.status === "error" ? `⚠️ ${c.errorMsg}` : c.status === "skipped" ? "Sin regla que aplique" : "—")}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              );
            })
          )}
        </>
      )}

      {/* ════ TAB: CONFIGURACIÓN ═════════════════════════════════ */}
      {tab === "Configuración" && form && (
        <>
          <div style={card}>
            <h2 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 700 }}>Tokens de acceso</h2>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={lbl}>Page ID de Facebook</label>
                <input style={inp} value={form.pageId} onChange={e => setForm({...form, pageId: e.target.value})} placeholder="ej: 777013192170595" />
              </div>
              <div>
                <label style={lbl}>Page Access Token</label>
                <div style={{ position: "relative" }}>
                  <input style={{ ...inp, paddingRight: 40 }} type={showToken ? "text" : "password"} value={form.pageAccessToken} onChange={e => setForm({...form, pageAccessToken: e.target.value})} />
                  <button onClick={() => setShowToken(!showToken)} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                    {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div style={card}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>Comportamiento</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {[
                { key: "replyToComments", label: "Responder comentarios", desc: "Responde comentarios en tus posts" },
                { key: "replyToDMs",      label: "Responder DMs",         desc: "Responde mensajes directos" },
              ].map(o => (
                <label key={o.key} style={{ display: "flex", alignItems: "flex-start", gap: 14, cursor: "pointer", padding: "12px 16px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--bg)" }}>
                  <input type="checkbox" checked={(form as any)[o.key]} onChange={e => setForm({...form, [o.key]: e.target.checked} as Config)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                  <div>
                    <p style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 600 }}>{o.label}</p>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{o.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button onClick={handleSaveConfig} disabled={saving} style={{ width: "100%", padding: "14px", borderRadius: 12, background: saved ? "#10B981" : "var(--accent)", border: "none", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {saving ? <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> : saved ? <CheckCircle2 size={16} /> : <Settings size={16} />}
            {saving ? "Guardando..." : saved ? "¡Guardado!" : "Guardar configuración"}
          </button>
        </>
      )}

      {/* ════ TAB: INSTRUCCIONES ═════════════════════════════════ */}
      {tab === "Instrucciones" && form && (
        <div style={{ display: "grid", gap: 16 }}>
          {[
            { n: 1, title: "Webhook URL (para Meta Developers)", content: <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", fontFamily: "monospace", fontSize: 13 }}>
                <span style={{ flex: 1 }}>{webhookUrl}</span><CopyBtn value={webhookUrl} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", fontFamily: "monospace", fontSize: 13 }}>
                <span style={{ flex: 1, color: "var(--text-muted)", fontSize: 11 }}>Verify Token:</span>
                <span style={{ flex: 2 }}>{form.verifyToken}</span><CopyBtn value={form.verifyToken} />
              </div>
            </div> },
            { n: 2, title: "Suscríbete a los eventos en Meta Developers", content: <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["messages","comments","messaging_postbacks"].map(e => (
                <span key={e} style={{ padding: "5px 14px", borderRadius: 20, background: "#10B98115", border: "1px solid #10B98140", color: "#10B981", fontSize: 12, fontWeight: 700, fontFamily: "monospace" }}>✅ {e}</span>
              ))}
            </div> },
            { n: 3, title: "Crea reglas en el tab Reglas", content: <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>Configura palabras clave y respuestas automáticas. Ya tienes 7 reglas prediseñadas para precio, rastreo, envíos, disponibilidad y más. Edítalas con tus textos y links reales.</p> },
            { n: 4, title: "⚠️ ngrok se reinicia cada sesión", content: <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>La URL de ngrok cambia cada vez que lo reinicias. Cuando eso pase, corre ngrok de nuevo y actualiza la Callback URL en Meta Developers. Para producción, despliega en Vercel o Railway con dominio fijo.</p> },
          ].map(s => (
            <div key={s.n} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{s.n}</div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{s.title}</h3>
              </div>
              {s.content}
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
