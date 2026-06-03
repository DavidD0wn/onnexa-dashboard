"use client";
import { useEffect, useState } from "react";
import { localDateStr } from "@/lib/utils";
import {
  Settings, Globe, Save, CheckCircle, Wifi, WifiOff,
  DollarSign, Truck, Target, RefreshCw, Database, PlayCircle,
  AlertCircle, BarChart2, Zap,
} from "lucide-react";
import { useCurrency, CURRENCY_INFO, type CurrencyCode } from "@/lib/currency";

interface CountryConfig {
  id: string;
  name: string;
  code: string;
  currency: string;
  exchangeRateToUsd: number;
  gatewayFeePercent: number;
  gatewayFixedFee: number;
  defaultShippingCost: number;
  targetCpa: number | null;
  targetMargin: number | null;
}

const COUNTRY_FLAGS: Record<string, string> = {
  MX: "🇲🇽",
  US: "🇺🇸",
  CL: "🇨🇱",
  CO: "🇨🇴",
};

function Field({
  label, value, onChange, prefix, suffix, step = "0.01",
}: {
  label: string;
  value: number | null;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  step?: string;
}) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 5 }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        {prefix && (
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-3)", pointerEvents: "none" }}>
            {prefix}
          </span>
        )}
        <input
          type="number"
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%",
            paddingLeft: prefix ? 22 : 10,
            paddingRight: suffix ? 30 : 10,
            paddingTop: 8, paddingBottom: 8,
            borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: "var(--bg-2)", border: "1.5px solid var(--border)",
            color: "var(--text)", outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#0E766E")}
          onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-3)", pointerEvents: "none" }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

interface SyncStatus {
  shopify?: { glowmmi?: any; balancea?: any };
  metaAds?: { recordsSaved?: number; error?: string };
  merge?: { updated?: number; skipped?: number; error?: string };
  timestamp?: string;
  totalOrders?: number;
}

interface MergeStatus {
  total: number;
  withAds: number;
  withoutAds: number;
  lastMetaSync?: { status: string; recordsSaved: number; dateFrom: string; dateTo: string; createdAt: string } | null;
}

export default function ConfiguracionPage() {
  const { currency, setCurrency, rates, ratesLoaded, ratesFallback, updatedAt } = useCurrency();
  const [countries, setCountries] = useState<CountryConfig[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState<string | null>(null);
  const [saved, setSaved]         = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing]         = useState(false);
  const [syncResult, setSyncResult]   = useState<SyncStatus | null>(null);
  const [syncDays, setSyncDays]       = useState(3);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(null);
  const [merging, setMerging]         = useState(false);

  useEffect(() => {
    // Load merge status on mount
    fetch("/api/meta-ads/merge-daily")
      .then((r) => r.json())
      .then(setMergeStatus)
      .catch(() => null);
  }, []);

  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/shopify/autosync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: syncDays, secret: "onnexa2024" }),
      });
      const data = await res.json();
      setSyncResult(data);
      // Refresh merge status
      const mr = await fetch("/api/meta-ads/merge-daily").then((r) => r.json());
      setMergeStatus(mr);
    } catch (e: any) {
      setSyncResult({ metaAds: { error: e.message } });
    }
    setSyncing(false);
  };

  const runMerge = async () => {
    setMerging(true);
    try {
      const res = await fetch("/api/meta-ads/merge-daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: "2024-01-01", dateTo: localDateStr() }),
      });
      const data = await res.json();
      setSyncResult((prev) => ({ ...prev, merge: data }));
      const mr = await fetch("/api/meta-ads/merge-daily").then((r) => r.json());
      setMergeStatus(mr);
    } catch (e: any) {
      console.error(e);
    }
    setMerging(false);
  };

  useEffect(() => {
    fetch("/api/configuracion")
      .then((r) => r.json())
      .then((d) => { setCountries(d.countries ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const update = (id: string, field: keyof CountryConfig, value: string) => {
    setCountries((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: parseFloat(value) || 0 } : c))
    );
  };

  const save = async (country: CountryConfig) => {
    setSaving(country.id);
    const res = await fetch("/api/configuracion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(country),
    });
    setSaving(null);
    if (res.ok) {
      setSaved(country.id);
      setTimeout(() => setSaved(null), 2000);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2.5px solid var(--blue)", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Topbar ─────────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid var(--border)",
          }}>
            <Settings size={16} style={{ color: "var(--text-2)" }} />
          </div>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Configuración</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Tasas, comisiones y objetivos por mercado</p>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Moneda del Dashboard ────────────────────────────── */}
        <div className="card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--blue-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Globe size={14} style={{ color: "var(--blue)" }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Moneda del Dashboard</p>

            {/* Live/fallback badge */}
            {ratesLoaded && (
              <span style={{
                marginLeft: "auto", display: "flex", alignItems: "center", gap: 5,
                fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                background: ratesFallback ? "var(--yellow-bg)" : "var(--green-bg)",
                color: ratesFallback ? "var(--yellow-text)" : "var(--green-text)",
              }}>
                {ratesFallback ? <WifiOff size={10} /> : <Wifi size={10} />}
                {ratesFallback ? "Tasas aproximadas (sin conexión)" : "Tasas en vivo"}
              </span>
            )}
          </div>

          <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20, maxWidth: 540 }}>
            Elige la moneda en que se muestran todos los números del dashboard. Los datos se guardan en USD y se convierten en tiempo real.
          </p>

          {/* Currency selector */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            {(["USD", "MXN", "COP"] as CurrencyCode[]).map((c) => {
              const info   = CURRENCY_INFO[c];
              const active = currency === c;
              return (
                <button
                  key={c}
                  onClick={() => setCurrency(c)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 18px",
                    borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
                    background: active ? "#0E766E" : "var(--bg-2)",
                    color:      active ? "#fff"    : "var(--text-2)",
                    border:     active ? "2px solid #0E766E" : "2px solid var(--border)",
                    boxShadow:  active ? "0 2px 12px #0E766E33" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: 18 }}>{info.flag}</span>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{c}</div>
                    <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>{info.label}</div>
                  </div>
                  {active && <CheckCircle size={14} style={{ marginLeft: 4, opacity: 0.8 }} />}
                </button>
              );
            })}
          </div>

          {/* Live rates grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {(["USD", "MXN", "COP"] as CurrencyCode[]).map((c) => {
              const rate = rates[c] ?? 1;
              const info = CURRENCY_INFO[c];
              return (
                <div key={c} style={{
                  borderRadius: 12, padding: "14px 16px", textAlign: "center",
                  background: "var(--bg-2)", border: "1px solid var(--border)",
                }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 6 }}>
                    {info.flag} 1 USD =
                  </p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>
                    {c === "USD" ? "1.00" : new Intl.NumberFormat("es-MX", {
                      minimumFractionDigits: c === "MXN" ? 2 : 0,
                      maximumFractionDigits: c === "MXN" ? 2 : 0,
                    }).format(rate)}
                  </p>
                  <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginTop: 4 }}>{c}</p>
                </div>
              );
            })}
          </div>

          {updatedAt && !ratesFallback && (
            <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 12 }}>
              Última actualización: {new Date(updatedAt).toLocaleString("es-MX")} · Fuente: Open Exchange Rates
            </p>
          )}
          {ratesFallback && (
            <p style={{ fontSize: 10, color: "var(--yellow-text)", marginTop: 12 }}>
              ⚠️ No se pudo conectar al servicio de tasas. Usando tasas aproximadas. Verifica tu conexión.
            </p>
          )}
        </div>

        {/* ── Por mercado ─────────────────────────────────────── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", marginBottom: 14 }}>
            Configuración por mercado
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {countries.map((country) => {
              const flag = COUNTRY_FLAGS[country.code] ?? "🌎";
              const isSaving = saving === country.id;
              const isSaved  = saved  === country.id;

              return (
                <div key={country.id} className="card" style={{ padding: "20px 24px" }}>

                  {/* Country header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                    <span style={{ fontSize: 22 }}>{flag}</span>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{country.name}</p>
                      <p style={{ fontSize: 11, color: "var(--text-3)" }}>{country.currency}</p>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                    {/* Exchange rate */}
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                        <RefreshCw size={10} /> Tipo de cambio
                      </p>
                      <Field
                        label={`1 USD = ? ${country.currency}`}
                        value={country.exchangeRateToUsd}
                        onChange={(v) => update(country.id, "exchangeRateToUsd", v)}
                        prefix="≈"
                      />
                    </div>

                    {/* Gateway */}
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                        <DollarSign size={10} /> Pasarela de pago
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <Field label="Comisión %" value={country.gatewayFeePercent} onChange={(v) => update(country.id, "gatewayFeePercent", v)} suffix="%" step="0.1" />
                        <Field label={`Fijo (${country.currency})`} value={country.gatewayFixedFee} onChange={(v) => update(country.id, "gatewayFixedFee", v)} />
                      </div>
                    </div>

                    {/* Shipping */}
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                        <Truck size={10} /> Costo de envío base
                      </p>
                      <Field
                        label={`Envío base (${country.currency})`}
                        value={country.defaultShippingCost}
                        onChange={(v) => update(country.id, "defaultShippingCost", v)}
                      />
                    </div>

                    {/* Targets */}
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                        <Target size={10} /> Objetivos
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <Field label={`CPA objetivo (${country.currency})`} value={country.targetCpa} onChange={(v) => update(country.id, "targetCpa", v)} />
                        <Field label="Margen objetivo" value={country.targetMargin} onChange={(v) => update(country.id, "targetMargin", v)} suffix="%" step="1" />
                      </div>
                    </div>

                    {/* Save button */}
                    <button
                      onClick={() => save(country)}
                      disabled={isSaving}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                        padding: "10px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                        cursor: isSaving ? "not-allowed" : "pointer",
                        border: "none",
                        background: isSaved ? "var(--green)" : "#0E766E",
                        color: "#fff",
                        opacity: isSaving ? 0.7 : 1,
                        transition: "all 0.2s ease",
                        marginTop: 4,
                      }}
                    >
                      {isSaving ? (
                        <>
                          <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite" }} />
                          Guardando...
                        </>
                      ) : isSaved ? (
                        <><CheckCircle size={14} /> Guardado</>
                      ) : (
                        <><Save size={14} /> Guardar cambios</>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Sincronización de datos ─────────────────────────── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", marginBottom: 14 }}>
            Sincronización de datos
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* Panel estado actual */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(99,102,241,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Database size={14} style={{ color: "#6366f1" }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Estado de la base de datos</p>
              </div>

              {mergeStatus ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Coverage bar */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>Días con gasto publicitario real</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                        {mergeStatus.withAds} / {mergeStatus.total}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 99,
                        background: mergeStatus.withAds > 0 ? "#10b981" : "#ef4444",
                        width: `${mergeStatus.total > 0 ? (mergeStatus.withAds / mergeStatus.total) * 100 : 0}%`,
                        transition: "width 0.6s ease",
                      }} />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                    <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--green-bg)", border: "1px solid var(--green-border, var(--border))" }}>
                      <p style={{ fontSize: 10, color: "var(--green-text, #10b981)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Con ads</p>
                      <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginTop: 2 }}>{mergeStatus.withAds}</p>
                      <p style={{ fontSize: 10, color: "var(--text-3)" }}>días actualizados</p>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: 10, background: mergeStatus.withoutAds > 0 ? "rgba(239,68,68,0.07)" : "var(--bg-2)", border: "1px solid var(--border)" }}>
                      <p style={{ fontSize: 10, color: mergeStatus.withoutAds > 0 ? "#ef4444" : "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Sin ads</p>
                      <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginTop: 2 }}>{mergeStatus.withoutAds}</p>
                      <p style={{ fontSize: 10, color: "var(--text-3)" }}>días sin datos</p>
                    </div>
                  </div>

                  {/* Last Meta sync */}
                  {mergeStatus.lastMetaSync && (
                    <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)", marginTop: 4 }}>
                      <p style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Último sync Meta Ads</p>
                      <p style={{ fontSize: 12, fontWeight: 700, color: mergeStatus.lastMetaSync.status === "success" ? "#10b981" : "#ef4444" }}>
                        {mergeStatus.lastMetaSync.status === "success" ? "✓ Exitoso" : "✗ Error"} — {mergeStatus.lastMetaSync.recordsSaved} registros
                      </p>
                      <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                        {mergeStatus.lastMetaSync.dateFrom} → {mergeStatus.lastMetaSync.dateTo} · {new Date(mergeStatus.lastMetaSync.createdAt).toLocaleString("es-MX")}
                      </p>
                    </div>
                  )}

                  {/* Merge all history button */}
                  {mergeStatus.withoutAds > 0 && (
                    <button
                      onClick={runMerge}
                      disabled={merging}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                        padding: "9px 14px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                        cursor: merging ? "not-allowed" : "pointer", border: "none",
                        background: merging ? "var(--bg-2)" : "rgba(99,102,241,0.1)",
                        color: merging ? "var(--text-3)" : "#6366f1",
                        transition: "all 0.2s",
                      }}
                    >
                      {merging ? (
                        <><div style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid #6366f130", borderTopColor: "#6366f1", animation: "spin 0.7s linear infinite" }} /> Aplicando...</>
                      ) : (
                        <><Zap size={12} /> Aplicar ads históricos a todos los días</>
                      )}
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2.5px solid #6366f1", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
                </div>
              )}
            </div>

            {/* Panel sync manual */}
            <div className="card" style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(16,185,129,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <BarChart2 size={14} style={{ color: "#10b981" }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Sync manual</p>
              </div>

              <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 16, lineHeight: 1.5 }}>
                El sync corre automáticamente todos los días a las <strong>3:07am</strong>. Aquí puedes dispararlo manualmente para obtener datos al momento.
              </p>

              {/* Days selector */}
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8 }}>
                  Rango a sincronizar
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 3, 7, 14, 30].map((d) => (
                    <button
                      key={d}
                      onClick={() => setSyncDays(d)}
                      style={{
                        flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                        cursor: "pointer", transition: "all 0.15s",
                        background: syncDays === d ? "#10b981" : "var(--bg-2)",
                        color: syncDays === d ? "#fff" : "var(--text-2)",
                        border: `1.5px solid ${syncDays === d ? "#10b981" : "var(--border)"}`,
                      }}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Sync button */}
              <button
                onClick={runSync}
                disabled={syncing}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  cursor: syncing ? "not-allowed" : "pointer", border: "none",
                  background: syncing ? "var(--bg-2)" : "#10b981",
                  color: syncing ? "var(--text-3)" : "#fff",
                  boxShadow: syncing ? "none" : "0 2px 12px rgba(16,185,129,0.3)",
                  transition: "all 0.2s",
                }}
              >
                {syncing ? (
                  <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "var(--text-3)", animation: "spin 0.7s linear infinite" }} /> Sincronizando...</>
                ) : (
                  <><PlayCircle size={15} /> Sincronizar ahora ({syncDays} días)</>
                )}
              </button>

              {/* Result */}
              {syncResult && (
                <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)", fontSize: 11 }}>
                  <p style={{ fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
                    {syncResult.timestamp ? `✓ Sync completado · ${new Date(syncResult.timestamp).toLocaleTimeString("es-MX")}` : "Resultado"}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "var(--text-3)" }}>
                    {syncResult.totalOrders !== undefined && (
                      <p>🛍 Shopify: <strong style={{ color: "var(--text)" }}>{syncResult.totalOrders} pedidos</strong> sincronizados</p>
                    )}
                    {syncResult.metaAds?.recordsSaved !== undefined && (
                      <p>📊 Meta Ads: <strong style={{ color: "var(--text)" }}>{syncResult.metaAds.recordsSaved} registros</strong> de gasto</p>
                    )}
                    {syncResult.metaAds?.error && (
                      <p style={{ color: "#ef4444" }}>⚠ Meta Ads: {syncResult.metaAds.error}</p>
                    )}
                    {syncResult.merge?.updated !== undefined && (
                      <p>🔗 Merge: <strong style={{ color: "#10b981" }}>{syncResult.merge.updated} días</strong> actualizados con gasto real</p>
                    )}
                    {syncResult.merge?.error && (
                      <p style={{ color: "#ef4444" }}>⚠ Merge: {syncResult.merge.error}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Info cron */}
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertCircle size={12} style={{ color: "#6366f1", marginTop: 1, flexShrink: 0 }} />
                <p style={{ fontSize: 10, color: "var(--text-3)", lineHeight: 1.5 }}>
                  El cron diario (3:07am) ejecuta Shopify → Meta Ads → Merge automáticamente. Los datos del dashboard siempre muestran la info más reciente.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Notas ───────────────────────────────────────────── */}
        <div style={{
          padding: "16px 20px", borderRadius: 12,
          background: "var(--bg-2)", border: "1px solid var(--border)",
        }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>Notas importantes</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              "El tipo de cambio convierte costos USD a moneda local para calcular márgenes.",
              "El CPA objetivo se usa en la calculadora de oferta y el simulador de escenarios.",
              "Los cambios se aplican inmediatamente a todos los cálculos del dashboard.",
            ].map((note) => (
              <p key={note} style={{ fontSize: 12, color: "var(--text-3)" }}>• {note}</p>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
