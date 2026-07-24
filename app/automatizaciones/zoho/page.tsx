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
// Paleta ligada al tema: usar variables CSS para que el modo oscuro funcione.
// (Antes eran colores fijos y en oscuro el texto quedaba ilegible.)
const C = {
  bg:      "var(--bg-2)",
  card:    "var(--card)",
  border:  "var(--border)",
  text:    "var(--text)",
  muted:   "var(--text-3)",
  accent:  "var(--green)",
  accentL: "var(--green-bg)",
  red:     "var(--red)",
  redL:    "var(--red-bg)",
  yellow:  "var(--yellow)",
  yellowL: "var(--yellow-bg)",
  blue:    "var(--blue)",
  blueL:   "var(--blue-bg)",
};

// Colores de marca que sí deben ser fijos, con fondo suave por tema
const BRAND = {
  Glowmmi:  { fg: "var(--glowmmi)",  bg: "var(--glowmmi-bg)"  },
  Balancea: { fg: "var(--balancea)", bg: "var(--balancea-bg)" },
} as const;

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  replied:          { label: "Respondido",     color: C.accent, bg: C.accentL },
  needs_attention:  { label: "Atención manual", color: C.yellow, bg: C.yellowL },
  escalated:        { label: "Escalado",        color: C.red,    bg: C.redL    },
  skipped:          { label: "Omitido",         color: C.muted,  bg: C.bg },
  error:            { label: "Error",           color: C.red,    bg: C.redL    },
  pending:          { label: "Pendiente",       color: C.blue,   bg: C.blueL   },
};

/* ── helpers ─────────────────────────────────────────────────── */
function Badge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, color: C.muted, bg: C.bg };
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
  const [convFilter,  setConvFilter]  = useState("pendiente");
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [rules,       setRules]       = useState<Rule[]>([]);
  const [editRule,    setEditRule]    = useState<Rule | null>(null);
  const [newRule,     setNewRule]     = useState(false);
  const [draftEdits,  setDraftEdits]  = useState<Record<string, string>>({});
  const [draftBusy,   setDraftBusy]   = useState<string>("");
  const [draftMsg,    setDraftMsg]    = useState<string>("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [configs,     setConfigs]     = useState<any[]>([]);
  const [rep,         setRep]         = useState<any>(null);
  const [repDias,     setRepDias]     = useState(30);

  /* ── carga inicial ─────────────────────────────────── */
  const loadConfig = useCallback(async () => {
    const res  = await fetch("/api/automatizaciones/zoho");
    const data = await res.json();
    setConnected(data.connected);
    setAuthUrl(data.authUrl);
    setConfig(data.config ?? null);
    setConfigs(data.configs ?? []);
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

  // Quita una conversación de la lista tras enviarla o descartarla
  const dropConv = (id: string) => setConvs((cs) => cs.filter((c: any) => c.id !== id));

  const loadRules = useCallback(async () => {
    const res  = await fetch("/api/automatizaciones/zoho/rules");
    const data = await res.json();
    setRules(Array.isArray(data) ? data : []);
  }, []);

  const loadRep = useCallback(async () => {
    const res  = await fetch(`/api/automatizaciones/zoho/reportes?dias=${repDias}`);
    const data = await res.json();
    setRep(data);
  }, [repDias]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    if (!connected) return;
    if (tab === "bandeja")     loadConvs();
    if (tab === "reglas")      loadRules();
    if (tab === "reportes")    loadRep();
    if (tab === "estado")      { loadConvs(); loadRules(); }
  }, [tab, connected, convFilter, loadConvs, loadRules, loadRep]);

  /* ── Sin auto-sync ─────────────────────────────────────
     Antes se sincronizaba solo cada 5 min: eso mantenía la base despierta
     y gastaba horas del plan gratis de Neon. Ahora el sync es MANUAL:
     solo cuando das clic en "Sincronizar". */

  /* ── acciones ──────────────────────────────────────── */
  const handleSync = async (silent = false) => {
    if (!silent) setSyncing(true);
    setSyncResult("");
    try {
      const res  = await fetch("/api/automatizaciones/zoho/process");
      const data = await res.json();
      if (!silent) {
        const errs = (data.results ?? []).filter((r: any) => r.error);
        if (errs.length) {
          setSyncResult("❌ " + errs.map((e: any) => `${e.email}: ${e.error}`).join(" · "));
        } else {
          // Sumar todos los buzones (Glowmmi + Balancea)
          const tot = (data.results ?? []).reduce(
            (a: any, r: any) => ({
              processed: a.processed + (r.processed ?? 0),
              replied:   a.replied   + (r.replied   ?? 0),
              skipped:   a.skipped   + (r.skipped   ?? 0),
            }),
            { processed: 0, replied: 0, skipped: 0 }
          );
          const detalle = (data.results ?? [])
            .map((r: any) => `${r.email?.split("@")[1]?.split(".")[0] ?? r.email}: ${r.processed ?? 0}`)
            .join(" · ");
          const pend = data.pendientes
            ? ` — quedan ${data.pendientes} sin procesar, vuelve a dar Sincronizar`
            : "";
          setSyncResult(`✅ Revisados ${tot.processed} correos (${detalle})${pend}`);
        }
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

  /* ── acciones de borradores IA ─────────────────────── */
  const sendDraft = async (id: string) => {
    // Bloqueo global: si ya hay un envío en curso, ignorar clics extra.
    // Evita disparar 20 envíos en paralelo (lo que saturó y tumbó la app).
    if (draftBusy) return;
    setDraftBusy(id); setDraftMsg("");
    const text = draftEdits[id];   // texto editado, si lo hay
    try {
      const res  = await fetch(`/api/automatizaciones/zoho/drafts/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:   JSON.stringify(text !== undefined ? { text } : {}),
      });
      const data = await res.json();
      if (data.error) { setDraftMsg("❌ " + data.error); return; }
      const dest = (convs.find((c: any) => c.id === id) as any)?.fromEmail ?? "";
      setDraftMsg("✅ Enviado a " + dest);
      dropConv(id);
      loadConvs();
    } catch (e: any) {
      setDraftMsg("❌ No se pudo enviar: " + (e?.message ?? "error de red"));
    } finally {
      setDraftBusy("");
    }
  };

  const discardDraft = async (id: string) => {
    if (draftBusy) return;
    if (!confirm("¿Descartar este borrador? No se enviará.")) return;
    setDraftBusy(id);
    try {
      await fetch(`/api/automatizaciones/zoho/drafts/${id}`, { method: "DELETE" });
      dropConv(id);
      loadConvs();
    } finally {
      setDraftBusy("");
    }
  };

  const [regenBusy, setRegenBusy] = useState(false);
  const regenerarBorradores = async () => {
    if (regenBusy || draftBusy) return;
    if (!confirm("Rehacer los borradores pendientes con las reglas actuales. Los que ya editaste se sobrescribirán. ¿Continuar?")) return;
    setRegenBusy(true); setDraftMsg("");
    try {
      let total = 0, pend = 1;
      // por tandas de 8 hasta terminar (respeta el límite de Groq)
      while (pend > 0) {
        const res  = await fetch("/api/automatizaciones/zoho/regenerar", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 8 }),
        });
        const data = await res.json();
        if (data.error) { setDraftMsg("❌ " + data.error); break; }
        total += data.regenerados ?? 0;
        pend   = data.pendientes ?? 0;
        setDraftMsg(`♻️ Regenerando… ${total} listos, faltan ${pend}`);
        if ((data.regenerados ?? 0) === 0) break;   // seguridad anti-bucle
      }
      setDraftMsg(`✅ ${total} borradores regenerados con las reglas nuevas`);
      loadConvs();
    } catch (e: any) {
      setDraftMsg("❌ " + (e?.message ?? "error"));
    } finally {
      setRegenBusy(false);
    }
  };

  const [envioMasivo, setEnvioMasivo] = useState(false);
  const enviarTodos = async () => {
    if (envioMasivo || regenBusy || draftBusy) return;
    const nDraft = stats["draft"] ?? 0;
    if (nDraft === 0) { setDraftMsg("No hay borradores listos para enviar."); return; }
    if (!confirm(
      `Se enviarán ${nDraft} respuestas a clientes reales, como respuesta a su correo.\n\n` +
      `Los marcados para revisión manual NO se envían.\n\n¿Continuar?`
    )) return;

    setEnvioMasivo(true); setDraftMsg("");
    let total = 0; const errores: string[] = [];
    try {
      let pend = nDraft;
      while (pend > 0) {
        const res  = await fetch("/api/automatizaciones/zoho/enviar-todos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 10 }),
        });
        const data = await res.json();
        if (data.error) { setDraftMsg("❌ " + data.error); break; }
        total += data.enviados ?? 0;
        (data.fallidos ?? []).forEach((f: any) => errores.push(`${f.email}: ${f.error}`));
        pend = data.pendientes ?? 0;
        setDraftMsg(`📤 Enviando… ${total} listos, faltan ${pend}`);
        // si una tanda no envió nada y siguen quedando, cortar (evita bucle infinito)
        if ((data.enviados ?? 0) === 0) break;
      }
      const resumen = `✅ ${total} respuestas enviadas`;
      setDraftMsg(errores.length ? `${resumen} · ⚠️ ${errores.length} con error: ${errores.slice(0, 2).join(" | ")}` : resumen);
      loadConvs();
    } catch (e: any) {
      setDraftMsg("❌ " + (e?.message ?? "error de red"));
    } finally {
      setEnvioMasivo(false);
    }
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
            Autoriza el acceso a <strong>contact@glowmmi.store</strong>. El bot leerá los
            correos entrantes, detectará palabras clave y responderá automáticamente.
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
  const tabs = ["estado", "bandeja", "reportes", "reglas", "instrucciones"];
  const pendientes = stats["pendiente"] ?? 0;
  const tabLabels: Record<string, string> = {
    estado: "Estado",
    bandeja: `Bandeja${pendientes ? ` (${pendientes})` : ""}`,
    reportes: "Reportes",
    reglas: "Reglas", instrucciones: "Instrucciones",
  };

  return (
    <div style={{ padding: "24px 32px", width: "100%", fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Mail size={24} color={C.accent} />
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: C.text }}>Bot Zoho Mail</h1>
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

      {/* Buzones conectados — el bot puede leer Glowmmi y Balancea a la vez */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "12px 16px", marginBottom: 16, borderRadius: 10,
        background: C.card, border: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Buzones conectados
        </span>
        {configs.map((c) => (
          <span key={c.id} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 20,
            background: BRAND[c.brand as keyof typeof BRAND]?.bg ?? C.bg,
            color:      BRAND[c.brand as keyof typeof BRAND]?.fg ?? C.text,
          }}>
            ● {c.emailAddress}
          </span>
        ))}
        {!configs.some((c) => c.brand === "Balancea") && (
          <a href={authUrl} style={{
            fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20,
            border: `1px dashed ${C.border}`, color: C.muted, textDecoration: "none",
          }}>
            + Conectar Balancea
          </a>
        )}
        {!configs.some((c) => c.brand === "Glowmmi") && (
          <a href={authUrl} style={{
            fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20,
            border: `1px dashed ${C.border}`, color: C.muted, textDecoration: "none",
          }}>
            + Conectar Glowmmi
          </a>
        )}
      </div>

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

      {/* ── Tab: Bandeja unificada (correo + respuesta juntos) ────────── */}
      {tab === "bandeja" && (
        <div>
          {/* Barra de filtros */}
          <div style={{
            display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
            marginBottom: 16, padding: "12px 16px", borderRadius: 10,
            background: C.card, border: `1px solid ${C.border}`,
          }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Estado</span>
              {([["pendiente", "Pendientes"], ["replied", "Enviados"], ["skipped", "Descartados"], ["all", "Todos"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setConvFilter(v)} style={{
                  padding: "5px 13px", borderRadius: 20, fontSize: 12,
                  fontWeight: convFilter === v ? 700 : 500, cursor: "pointer",
                  border: `1px solid ${convFilter === v ? C.accent : C.border}`,
                  background: convFilter === v ? C.accentL : "transparent",
                  color: convFilter === v ? C.accent : C.muted,
                }}>
                  {label}{v !== "all" && stats[v] ? ` (${stats[v]})` : ""}
                </button>
              ))}
            </div>

            <div style={{ width: 1, height: 22, background: C.border }} />

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tienda</span>
              {["all", "Glowmmi", "Balancea"].map((b) => {
                const on = brandFilter === b;
                const br = BRAND[b as keyof typeof BRAND];
                return (
                  <button key={b} onClick={() => setBrandFilter(b)} style={{
                    padding: "5px 13px", borderRadius: 20, fontSize: 12,
                    fontWeight: on ? 700 : 500, cursor: "pointer",
                    border: `1px solid ${on ? (br?.fg ?? C.accent) : C.border}`,
                    background: on ? (br?.bg ?? C.accentL) : "transparent",
                    color: on ? (br?.fg ?? C.accent) : C.muted,
                  }}>
                    {b === "all" ? "Todas" : b}
                  </button>
                );
              })}
            </div>

            <div style={{ flex: 1 }} />
            {(stats["draft"] ?? 0) > 0 && (
              <button
                onClick={enviarTodos}
                disabled={envioMasivo || regenBusy || !!draftBusy}
                title="Envía todas las respuestas listas, cada una como respuesta al correo del cliente"
                style={{
                  fontSize: 12, fontWeight: 700, padding: "6px 15px", borderRadius: 8,
                  cursor: envioMasivo ? "wait" : "pointer",
                  background: C.accent, border: `1px solid ${C.accent}`, color: "#fff",
                  opacity: (envioMasivo || regenBusy || draftBusy) ? 0.6 : 1,
                }}>
                {envioMasivo ? "📤 Enviando…" : `📤 Enviar todos (${stats["draft"] ?? 0})`}
              </button>
            )}
            <button
              onClick={regenerarBorradores}
              disabled={regenBusy || !!draftBusy || envioMasivo}
              title="Rehace los borradores pendientes con las reglas actuales de la IA"
              style={{
                fontSize: 12, fontWeight: 600, padding: "6px 13px", borderRadius: 8,
                cursor: regenBusy ? "wait" : "pointer",
                background: C.accentL, border: `1px solid ${C.accent}`, color: C.accent,
                opacity: (regenBusy || draftBusy) ? 0.6 : 1,
              }}>
              {regenBusy ? "♻️ Regenerando…" : "♻️ Regenerar con IA"}
            </button>
            <button onClick={loadConvs} style={{
              fontSize: 12, padding: "6px 13px", borderRadius: 8, cursor: "pointer",
              background: "transparent", border: `1px solid ${C.border}`, color: C.text,
            }}>↻ Actualizar</button>
          </div>

          {draftMsg && (
            <div style={{
              fontSize: 13, padding: "10px 14px", borderRadius: 8, marginBottom: 12,
              background: draftMsg.startsWith("✅") ? C.accentL : C.redL,
              color:      draftMsg.startsWith("✅") ? C.accent  : C.red,
            }}>{draftMsg}</div>
          )}

          {(() => {
            const list = convs.filter((c: any) => brandFilter === "all" || c.brand === brandFilter);

            if (list.length === 0) return (
              <div style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                padding: 48, textAlign: "center", color: C.muted, fontSize: 14,
              }}>
                No hay correos con estos filtros.
              </div>
            );

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {list.map((c: any) => {
                  const pendiente = ["draft", "escalated", "needs_attention"].includes(c.status);
                  const edited    = draftEdits[c.id] ?? c.aiDraft ?? "";
                  const conf      = Math.round((c.aiConfidence ?? 0) * 100);
                  const br        = BRAND[c.brand as keyof typeof BRAND];
                  const st        = STATUS_LABEL[c.status] ?? { label: c.status, color: C.muted, bg: C.bg };
                  const respuesta = c.outboundText ?? c.aiDraft ?? "";

                  return (
                    <div key={c.id} style={{
                      background: C.card,
                      border: `1px solid ${pendiente ? C.accent : C.border}`,
                      borderRadius: 12, overflow: "hidden",
                    }}>
                      {/* Cabecera */}
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 12,
                        padding: "14px 18px", borderBottom: `1px solid ${C.border}`,
                        flexWrap: "wrap",
                      }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: C.text }}>
                            {c.subject || "(sin asunto)"}
                          </p>
                          <p style={{ fontSize: 12, color: C.muted, margin: "3px 0 0" }}>
                            {c.fromName ? `${c.fromName} · ` : ""}{c.fromEmail}
                            {c.mailbox ? <> → <span style={{ color: br?.fg }}>{c.mailbox}</span></> : null}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          {c.brand && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: br?.bg, color: br?.fg }}>
                              {c.brand}
                            </span>
                          )}
                          {c.caseType && (
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: C.bg, color: C.muted }}>
                              {c.caseType}
                            </span>
                          )}
                          {conf > 0 && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                              background: C.bg, color: conf >= 75 ? C.accent : conf >= 50 ? C.yellow : C.red,
                            }}>{conf}%</span>
                          )}
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        </div>
                      </div>

                      {/* Cuerpo: correo recibido | respuesta */}
                      <div className="zoho-split" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
                        {/* Correo del cliente */}
                        <div style={{ padding: "14px 18px", borderRight: `1px solid ${C.border}`, minWidth: 0 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                            Correo recibido
                          </p>
                          <div style={{
                            fontSize: 13, lineHeight: 1.55, color: C.text, whiteSpace: "pre-wrap",
                            maxHeight: expanded.has(c.id) ? "none" : 150, overflow: "hidden",
                          }}>
                            {c.inboundText || "(sin contenido)"}
                          </div>
                          {(c.inboundText ?? "").length > 260 && (
                            <button onClick={() => toggleExpand(c.id)} style={{
                              marginTop: 6, fontSize: 12, background: "none", border: "none",
                              color: C.accent, cursor: "pointer", padding: 0, fontWeight: 600,
                            }}>
                              {expanded.has(c.id) ? "Ver menos" : "Ver todo"}
                            </button>
                          )}
                        </div>

                        {/* Respuesta */}
                        <div style={{ padding: "14px 18px", minWidth: 0 }}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                            {pendiente ? "Respuesta sugerida (editable)" : "Respuesta enviada"}
                          </p>

                          {pendiente ? (
                            <>
                              {Array.isArray(c.needsData) && c.needsData.length > 0 && (
                                <div style={{ fontSize: 12, background: C.yellowL, color: C.yellow, padding: "7px 11px", borderRadius: 8, marginBottom: 8 }}>
                                  Falta: {c.needsData.join(", ")}
                                </div>
                              )}
                              <textarea
                                value={edited}
                                onChange={(e) => setDraftEdits((p) => ({ ...p, [c.id]: e.target.value }))}
                                rows={Math.min(14, Math.max(6, edited.split("\n").length + 1))}
                                style={{
                                  width: "100%", boxSizing: "border-box", padding: 11,
                                  fontSize: 13, lineHeight: 1.55, borderRadius: 8,
                                  border: `1px solid ${C.border}`, background: C.bg,
                                  fontFamily: "inherit", color: C.text, resize: "vertical",
                                }}
                              />
                              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                <button
                                  onClick={() => sendDraft(c.id)}
                                  disabled={!!draftBusy || !edited.trim()}
                                  style={{
                                    fontSize: 13, fontWeight: 600, padding: "9px 18px", borderRadius: 8,
                                    background: C.accent, color: "#fff", border: "none",
                                    cursor: draftBusy ? "wait" : "pointer",
                                    opacity: (draftBusy && draftBusy !== c.id) || !edited.trim() ? 0.5 : 1,
                                  }}>
                                  {draftBusy === c.id ? "Enviando…" : "Aprobar y enviar"}
                                </button>
                                <button
                                  onClick={() => discardDraft(c.id)}
                                  disabled={!!draftBusy}
                                  style={{
                                    fontSize: 13, padding: "9px 16px", borderRadius: 8,
                                    background: "transparent", color: C.red,
                                    border: `1px solid ${C.border}`,
                                    cursor: draftBusy ? "not-allowed" : "pointer",
                                    opacity: draftBusy ? 0.5 : 1,
                                  }}>
                                  Descartar
                                </button>
                              </div>
                            </>
                          ) : (
                            <div style={{
                              fontSize: 13, lineHeight: 1.55, color: respuesta ? C.text : C.muted,
                              whiteSpace: "pre-wrap", background: C.bg, padding: 11, borderRadius: 8,
                              border: `1px solid ${C.border}`,
                            }}>
                              {respuesta || "(sin respuesta — este correo se descartó o se omitió)"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* ── Tab: Reportes ─────────────────────────────── */}
      {tab === "reportes" && (
        <div>
          {/* Rango */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Período</span>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setRepDias(d)} style={{
                padding: "5px 13px", borderRadius: 20, fontSize: 12,
                fontWeight: repDias === d ? 700 : 500, cursor: "pointer",
                border: `1px solid ${repDias === d ? C.accent : C.border}`,
                background: repDias === d ? C.accentL : "transparent",
                color: repDias === d ? C.accent : C.muted,
              }}>{d} días</button>
            ))}
          </div>

          {!rep ? (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 48, textAlign: "center", color: C.muted }}>
              Cargando reportes…
            </div>
          ) : (
            <>
              {/* Resumen */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <Stat label="Correos recibidos" value={rep.total} />
                <Stat label="De clientes reales" value={rep.reales} color={C.accent} />
                <Stat label="Ruido filtrado" value={rep.ruido} color={C.muted} />
                <Stat label="Glowmmi" value={rep.porMarca?.Glowmmi ?? 0} color="var(--glowmmi)" />
                <Stat label="Balancea" value={rep.porMarca?.Balancea ?? 0} color="var(--balancea)" />
              </div>

              {/* De qué nos escriben */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px", marginBottom: 16 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>¿De qué nos escriben?</p>
                <p style={{ fontSize: 12, color: C.muted, margin: "0 0 18px" }}>
                  Motivo de cada correo, de mayor a menor. Lo de arriba es lo que más te cuesta tiempo.
                </p>

                {(rep.casos ?? []).length === 0 ? (
                  <p style={{ fontSize: 13, color: C.muted }}>Aún no hay correos clasificados en este período.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {rep.casos.map((c: any) => {
                      const pct = rep.reales > 0 ? (c.total / rep.reales) * 100 : 0;
                      return (
                        <div key={c.caso}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{c.label}</span>
                            <span style={{ fontSize: 12, color: C.muted }}>
                              <b style={{ color: C.text, fontSize: 14 }}>{c.total}</b> · {pct.toFixed(0)}%
                            </span>
                          </div>
                          {/* Barra apilada por tienda */}
                          <div style={{ display: "flex", height: 9, borderRadius: 6, overflow: "hidden", background: C.bg }}>
                            <div title={`Glowmmi: ${c.Glowmmi}`} style={{
                              width: `${rep.reales > 0 ? (c.Glowmmi / rep.reales) * 100 : 0}%`,
                              background: "var(--glowmmi)",
                            }} />
                            <div title={`Balancea: ${c.Balancea}`} style={{
                              width: `${rep.reales > 0 ? (c.Balancea / rep.reales) * 100 : 0}%`,
                              background: "var(--balancea)",
                            }} />
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                            {c.Glowmmi > 0 && <span style={{ fontSize: 11, color: "var(--glowmmi)" }}>Glowmmi {c.Glowmmi}</span>}
                            {c.Balancea > 0 && <span style={{ fontSize: 11, color: "var(--balancea)" }}>Balancea {c.Balancea}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                {/* Volumen por día */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 14px" }}>Correos por día</p>
                  {(rep.serie ?? []).length === 0 ? (
                    <p style={{ fontSize: 13, color: C.muted }}>Sin datos.</p>
                  ) : (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 110 }}>
                      {rep.serie.map((d: any) => {
                        const max = Math.max(...rep.serie.map((x: any) => x.n));
                        return (
                          <div key={d.fecha} title={`${d.fecha}: ${d.n}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{
                              width: "100%", borderRadius: 3, background: C.accent,
                              height: `${max > 0 ? (d.n / max) * 90 : 0}px`, minHeight: 3,
                            }} />
                            <span style={{ fontSize: 9, color: C.muted }}>{d.fecha.slice(8)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Clientes que escriben varias veces */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                  <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>Escriben más de una vez</p>
                  <p style={{ fontSize: 12, color: C.muted, margin: "0 0 14px" }}>
                    Suele indicar que no quedaron conformes con la primera respuesta.
                  </p>
                  {(rep.repetidores ?? []).length === 0 ? (
                    <p style={{ fontSize: 13, color: C.muted }}>Nadie escribió dos veces. 👌</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {rep.repetidores.map((r: any) => (
                        <div key={r.email} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                          <b style={{ color: r.n >= 3 ? C.red : C.yellow, flexShrink: 0, marginLeft: 10 }}>{r.n}×</b>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
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
                      <span style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{r.name}</span>
                      <span style={{
                        fontSize: 10, padding: "1px 7px", borderRadius: 20,
                        background: C.bg, color: C.muted,
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
