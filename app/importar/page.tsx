"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Upload, Link2, FileText, CheckCircle, XCircle, Clock,
  RefreshCw, AlertTriangle, ShoppingBag, Database, Zap,
} from "lucide-react";

type ImportRecord = {
  id: string; type: string; filename: string; status: string;
  totalRows: number; importedRows: number; errorRows: number;
  errors?: string; createdAt: string;
};

const SHEET_PRESETS = [
  { label: "Ventas Diarias (Glowmmi)", url: "https://docs.google.com/spreadsheets/d/1YECNTC0sQ7gzQl-dGn3CiPj4MYfdzkNAkOLyhBhEyrU/export?format=csv&gid=843860358", type: "ventas" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const cfg = {
    success: { label: "Exitoso", color: "var(--green-text)", bg: "var(--green-bg)" },
    partial:  { label: "Parcial",  color: "var(--yellow-text)", bg: "var(--yellow-bg)" },
    error:    { label: "Error",    color: "var(--red-text)",    bg: "var(--red-bg)" },
  }[status] ?? { label: status, color: "var(--text-3)", bg: "var(--bg-2)" };

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
      background: cfg.bg, color: cfg.color,
    }}>
      {status === "success" ? <CheckCircle size={10} /> : status === "partial" ? <AlertTriangle size={10} /> : <XCircle size={10} />}
      {cfg.label}
    </span>
  );
}

export default function ImportarPage() {
  const [tab, setTab]         = useState<"url" | "paste">("url");
  const [dataType, setDataType] = useState<"ventas" | "productos">("ventas");
  const [url, setUrl]         = useState("");
  const [csvText, setCsvText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ imported: number; total: number; errors: string[] } | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Shopify sync
  const [shopifyStore, setShopifyStore]   = useState<"glowmmi" | "balancea">("glowmmi");
  const [shopifyDays, setShopifyDays]     = useState(7);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyResult, setShopifyResult] = useState<any>(null);
  const [shopifyError, setShopifyError]   = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    setLoadingHistory(true);
    fetch("/api/import")
      .then((r) => r.json())
      .then((d) => { setHistory(d.imports ?? []); setLoadingHistory(false); })
      .catch(() => setLoadingHistory(false));
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleImport = async () => {
    setLoading(true); setResult(null); setError(null);
    try {
      const body: any = { type: dataType };
      if (tab === "url") body.url = url; else body.csvText = csvText;
      const res  = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Error al importar");
      else { setResult(data); loadHistory(); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleShopifySync = async () => {
    setShopifyLoading(true); setShopifyResult(null); setShopifyError(null);
    try {
      const res  = await fetch("/api/shopify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: shopifyStore, days: shopifyDays }) });
      const data = await res.json();
      if (!res.ok) setShopifyError(data.error ?? "Error al conectar con Shopify");
      else { setShopifyResult(data); loadHistory(); }
    } catch (e: any) { setShopifyError(e.message); }
    finally { setShopifyLoading(false); }
  };

  const canSubmit = tab === "url" ? url.trim() !== "" : csvText.trim() !== "";

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13,
    border: "1.5px solid var(--border)", background: "var(--bg-2)",
    color: "var(--text)", outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* Topbar */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Upload size={16} style={{ color: "var(--blue)" }} />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Importar Datos</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Google Sheets · CSV · Shopify</p>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Shopify Sync (primero, es lo más usado) ── */}
        <div className="card" style={{ padding: "24px 28px" }}>
          <SectionLabel>Sincronizar con Shopify</SectionLabel>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 14, alignItems: "flex-end" }}>
            {/* Tienda */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 8 }}>Tienda</p>
              <div style={{ display: "flex", gap: 8 }}>
                {(["glowmmi", "balancea"] as const).map((s) => {
                  const isGlow = s === "glowmmi";
                  const active = shopifyStore === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setShopifyStore(s)}
                      style={{
                        flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 12, fontWeight: 700,
                        border: `1.5px solid ${active ? (isGlow ? "#EC4899" : "#10B981") : "var(--border)"}`,
                        background: active ? (isGlow ? "#FCE7F3" : "#D1FAE5") : "var(--bg-2)",
                        color: active ? (isGlow ? "#BE185D" : "#065F46") : "var(--text-3)",
                        cursor: "pointer",
                      }}
                    >
                      {isGlow ? "Glowmmi" : "Balancea"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Días */}
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 8 }}>Período</p>
              <div style={{ display: "flex", gap: 8 }}>
                {[7, 14, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setShopifyDays(d)}
                    style={{
                      flex: 1, padding: "9px 0", borderRadius: 10, fontSize: 12, fontWeight: 600,
                      border: `1.5px solid ${shopifyDays === d ? "var(--blue)" : "var(--border)"}`,
                      background: shopifyDays === d ? "var(--blue-bg)" : "var(--bg-2)",
                      color: shopifyDays === d ? "var(--blue)" : "var(--text-3)",
                      cursor: "pointer",
                    }}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {/* Info */}
            <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg-2)", border: "1.5px solid var(--border)" }}>
              <p style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Sincronizando</p>
              <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginTop: 3 }}>
                {shopifyStore === "glowmmi" ? "Glowmmi" : "Balancea"} · últimos {shopifyDays} días
              </p>
            </div>

            {/* Botón */}
            <button
              onClick={handleShopifySync}
              disabled={shopifyLoading}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 22px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: shopifyLoading ? "var(--bg-2)" : "#10B981",
                color: shopifyLoading ? "var(--text-4)" : "#fff",
                border: "none", cursor: shopifyLoading ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {shopifyLoading
                ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />Sincronizando...</>
                : <><ShoppingBag size={14} />Sincronizar</>
              }
            </button>
          </div>

          {/* Result */}
          {shopifyResult && (
            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 12, background: "var(--green-bg)", border: "1px solid var(--green)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <CheckCircle size={15} style={{ color: "var(--green)" }} />
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green-text)" }}>
                  {shopifyResult.store} — {shopifyResult.ordersTotal} órdenes sincronizadas · {shopifyResult.daysSynced} días guardados
                </p>
              </div>
              {shopifyResult.preview?.length > 0 && (
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {shopifyResult.preview.map((p: any) => (
                    <div key={p.date} style={{ fontSize: 11, color: "var(--text-3)" }}>
                      <span style={{ fontWeight: 600 }}>{p.date}</span> · {p.orders} órd · <span style={{ color: "var(--green-text)", fontWeight: 700 }}>${p.revenue}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {shopifyError && (
            <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 12, background: "var(--red-bg)", border: "1px solid var(--red)" }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--red-text)" }}>❌ {shopifyError}</p>
            </div>
          )}
        </div>

        {/* ── Importar CSV / Google Sheets ── */}
        <div className="card" style={{ padding: "24px 28px" }}>
          <SectionLabel>Importar CSV / Google Sheets</SectionLabel>

          {/* Tipo de datos */}
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            {[
              { key: "ventas",    label: "Ventas Diarias",  color: "var(--blue)", bg: "var(--blue-bg)" },
              { key: "productos", label: "Productos",       color: "var(--purple)", bg: "var(--purple-bg)" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setDataType(t.key as any)}
                style={{
                  padding: "8px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: `1.5px solid ${dataType === t.key ? t.color : "var(--border)"}`,
                  background: dataType === t.key ? t.bg : "var(--bg-2)",
                  color: dataType === t.key ? t.color : "var(--text-3)",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tabs fuente */}
          <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--border)" }}>
            {[
              { key: "url",   label: "URL de Google Sheets", icon: Link2 },
              { key: "paste", label: "Pegar CSV",            icon: FileText },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key as any)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "10px 20px", fontSize: 13, fontWeight: 600,
                    background: "transparent", border: "none", cursor: "pointer",
                    color: tab === t.key ? "var(--blue)" : "var(--text-3)",
                    borderBottom: `2px solid ${tab === t.key ? "var(--blue)" : "transparent"}`,
                    marginBottom: -2,
                  }}
                >
                  <Icon size={13} /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === "url" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 8 }}>URL de exportación (Google Sheets → Archivo → Descargar → CSV)</p>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=..."
                  style={inputStyle}
                />
              </div>

              {SHEET_PRESETS.length > 0 && (
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", marginBottom: 10 }}>Accesos rápidos</p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {SHEET_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => { setUrl(p.url); setDataType(p.type as any); }}
                        style={{
                          padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                          background: "var(--blue-bg)", color: "var(--blue)",
                          border: "1px solid var(--blue)", cursor: "pointer",
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ padding: "12px 16px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>Columnas esperadas — Ventas Diarias</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.6 }}>
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>Fecha</code>{" · "}
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>Marca</code>{" · "}
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>País</code>{" · "}
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>Pedidos</code>{" · "}
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>Ventas USD</code>{" · "}
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>Pauta</code>{" · "}
                  <code style={{ background: "var(--border)", padding: "1px 5px", borderRadius: 4 }}>Utilidad USD</code>
                </p>
                <p style={{ fontSize: 10, color: "var(--text-4)", marginTop: 6 }}>Los nombres de columna se detectan automáticamente — no tienen que ser exactos.</p>
              </div>
            </div>
          )}

          {tab === "paste" && (
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 8 }}>Pega el contenido CSV (copia desde Google Sheets o descarga el .csv)</p>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={8}
                placeholder={"Fecha,Marca,País,Pedidos,Ventas USD,Pauta,CPA,Utilidad USD,Margen\n01/05/2026,Glowmmi,México,15,524.85,120,8,89.30,17%\n..."}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
              />
            </div>
          )}

          {/* Alerts */}
          {result && (
            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 12, background: "var(--green-bg)", border: "1px solid var(--green)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <CheckCircle size={15} style={{ color: "var(--green)" }} />
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green-text)" }}>
                  {result.imported} de {result.total} filas importadas correctamente
                </p>
              </div>
              {result.errors.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "var(--yellow-text)", marginBottom: 4 }}>Advertencias:</p>
                  {result.errors.map((e, i) => <p key={i} style={{ fontSize: 11, color: "var(--text-3)" }}>{e}</p>)}
                </div>
              )}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 16, padding: "14px 18px", borderRadius: 12, background: "var(--red-bg)", border: "1px solid var(--red)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <XCircle size={15} style={{ color: "var(--red)" }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--red-text)" }}>{error}</p>
              </div>
            </div>
          )}

          {/* Submit */}
          <div style={{ marginTop: 20 }}>
            <button
              onClick={handleImport}
              disabled={loading || !canSubmit}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "11px 28px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                background: canSubmit && !loading ? "var(--blue)" : "var(--bg-2)",
                color: canSubmit && !loading ? "#fff" : "var(--text-4)",
                border: "none", cursor: canSubmit && !loading ? "pointer" : "not-allowed",
              }}
            >
              {loading
                ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.8s linear infinite" }} />Importando...</>
                : <><Upload size={14} />Importar datos</>
              }
            </button>
          </div>
        </div>

        {/* ── Historial ── */}
        <div className="card" style={{ padding: "24px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Clock size={14} style={{ color: "var(--text-3)" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Historial de importaciones</p>
            </div>
            <button
              onClick={loadHistory}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: "var(--bg-2)", border: "1.5px solid var(--border)",
                color: "var(--text-3)", cursor: "pointer",
              }}
            >
              <RefreshCw size={12} className={loadingHistory ? "animate-spin" : ""} />
              Actualizar
            </button>
          </div>

          {loadingHistory ? (
            <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2.5px solid var(--border)", borderTopColor: "var(--blue)", animation: "spin 0.8s linear infinite" }} />
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-3)" }}>
              <Database size={28} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
              <p style={{ fontSize: 14, fontWeight: 600 }}>Sin importaciones aún</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Usa Shopify o CSV para empezar</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th style={{ textAlign: "center" }}>Estado</th>
                    <th style={{ textAlign: "right" }}>Filas</th>
                    <th style={{ textAlign: "right" }}>Importadas</th>
                    <th style={{ textAlign: "right" }}>Errores</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((imp) => (
                    <tr key={imp.id}>
                      <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                        {new Date(imp.createdAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td>
                        <span style={{
                          padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                          background: imp.type === "ventas" ? "var(--blue-bg)" : "var(--purple-bg)",
                          color: imp.type === "ventas" ? "var(--blue)" : "var(--purple)",
                        }}>
                          {imp.type === "ventas" ? "Ventas" : "Productos"}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}><StatusChip status={imp.status} /></td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "var(--text)" }}>{imp.totalRows}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green-text)" }}>{imp.importedRows}</td>
                      <td style={{ textAlign: "right", color: imp.errorRows > 0 ? "var(--red-text)" : "var(--text-3)", fontWeight: imp.errorRows > 0 ? 700 : 400 }}>
                        {imp.errorRows}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Instrucciones ── */}
        <div className="card" style={{ padding: "20px 24px", background: "var(--bg-2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Zap size={14} style={{ color: "var(--yellow)" }} />
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Cómo obtener la URL de Google Sheets</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              "Abre tu hoja en Google Sheets",
              "Ve a Archivo → Compartir → Publicar en la web → elige la hoja → Valores separados por comas → Publicar",
              "Copia la URL que te da (termina en ?format=csv&gid=...)",
              "Pégala arriba en el campo URL y dale a Importar",
            ].map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 12 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  background: "var(--blue-bg)", color: "var(--blue)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 800,
                }}>
                  {i + 1}
                </span>
                <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, paddingTop: 2 }}>{step}</p>
              </div>
            ))}
            <p style={{ fontSize: 11, color: "var(--yellow-text)", marginTop: 4, paddingLeft: 34 }}>
              ⚠ La hoja debe estar publicada como pública para que la URL funcione.
            </p>
          </div>
        </div>

      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
