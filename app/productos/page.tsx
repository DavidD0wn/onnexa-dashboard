"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import React from "react";
import {
  Package, Search, TrendingUp, TrendingDown, BarChart3,
  DollarSign, ShoppingCart, Zap, Target, RefreshCw,
  ChevronDown, ChevronUp, BookOpen, Gift, Globe, Filter,
} from "lucide-react";
import { useCurrency } from "@/lib/currency";
import { useFilters } from "@/lib/filters";
import { fmtNum, fmtPct } from "@/lib/utils";

/* ─── Status config ──────────────────────────────────────────── */
const STATUS_CFG: Record<string, { label: string; bg: string; color: string }> = {
  winner:          { label: "🏆 Ganador",        bg: "#D1FAE5", color: "#065F46" },
  scaling:         { label: "↑ Escalando",        bg: "#DBEAFE", color: "#1E40AF" },
  active:          { label: "✓ Activo",           bg: "#F3F4F6", color: "#374151" },
  test:            { label: "⚗ En test",          bg: "#FEF3C7", color: "#92400E" },
  in_construction: { label: "🔧 Construyendo",    bg: "#EDE9FE", color: "#5B21B6" },
  research:        { label: "🔍 Investigando",    bg: "#F3F4F6", color: "#6B7280" },
  paused:          { label: "⏸ Pausado",          bg: "#FEF3C7", color: "#92400E" },
  loser:           { label: "✗ Perdedor",         bg: "#FEE2E2", color: "#991B1B" },
  archived:        { label: "Archivado",          bg: "#F3F4F6", color: "#9CA3AF" },
};
const STATUS_ORDER = ["winner","scaling","active","test","in_construction","research","paused","loser","archived"];

const BRANDS = [
  { label: "Todas",    value: "all" },
  { label: "Glowmmi",  value: "brand_glowmmi" },
  { label: "Balancea", value: "brand_balancea" },
];

/* ─── Product type classifier ────────────────────────────────── */
// Sincronizado con la regex de /costos y analytics/route.ts.
// "otro" eliminado: todo producto real es físico (aunque no tenga COGS cargados).
type ProductType = "físico" | "digital" | "upsell";

function classifyProduct(name: string): ProductType {
  // Upsell: versiones extendidas, add-ons de pedido, protecciones
  if (/protección de pedido|proteccion de pedido|rendimiento extendido|rendimiento m[aá]ximo|pureza extendida|reafirmante|vitamina c|youtful/i.test(name))
    return "upsell";
  // Digital: ebooks, guías, protocolos, trackers, planes, etc.
  if (/ebook|eook|guía|guia|brocha|protocolo|recetario|protección|proteccion|calendario|hábitos|habitos|menú|menu|plan de gym|plan anti|método|metodo|ritual|agenda|21d|reto |challenge|tracker|poros|glow desde|fórmula pro|formula pro|rutina anti|lifting desde/i.test(name))
    return "digital";
  return "físico";
}

const TYPE_CONFIG: Record<ProductType, { label: string; color: string; bg: string; border: string; emoji: string }> = {
  físico:  { label: "Físico",   color: "#065F46", bg: "#D1FAE5", border: "#6EE7B7", emoji: "📦" },
  digital: { label: "Digital",  color: "#1E40AF", bg: "#DBEAFE", border: "#93C5FD", emoji: "📱" },
  upsell:  { label: "Upsell",   color: "#92400E", bg: "#FEF3C7", border: "#FCD34D", emoji: "⚡" },
};

/* ─── Types ──────────────────────────────────────────────────── */
interface ProductAnalytics {
  id: string; name: string; status: string;
  brandId: string; brandName: string; countryName: string; storeName: string;
  supplierName?: string; notes?: string;
  costUsd: number; priceUsd: number; shippingUsd: number;
  targetMargin?: number; targetCpa?: number; margin: number;
  revenue: number; orders: number; units: number; profit: number; adSpend: number;
  roas: number | null; realCpa: number | null; aov: number;
  hasData: boolean;
  costTiers: Array<{ qty: string; costUsd: number; landedUsd: number }>;
}

/* ─── Helper ─────────────────────────────────────────────────── */
function StatusBadge({ s }: { s: string }) {
  const cfg = STATUS_CFG[s] ?? STATUS_CFG["active"];
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20,
      background: cfg.bg, color: cfg.color, whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-3)" }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function FilterPill({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className="filter-pill"
      style={active ? { background: color ?? "#2563EB", borderColor: color ?? "#2563EB", color: "#fff" } : {}}
    >
      {label}
    </button>
  );
}

function KpiMini({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="kpi-card">
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 12 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

/* ─── Expandable row ─────────────────────────────────────────── */
function ProductRow({ p, fmtC }: { p: ProductAnalytics; fmtC: (v: number) => string }) {
  const [open, setOpen] = useState(false);
  const brandColor = p.brandId === "brand_glowmmi" ? "#EC4899" : "#10B981";
  const marginColor = p.margin >= 40 ? "var(--green)" : p.margin >= 25 ? "var(--yellow)" : "var(--red)";
  const roasColor   = p.roas === null ? "var(--text-3)" : p.roas >= 3 ? "var(--green)" : p.roas >= 2 ? "var(--yellow)" : "var(--red)";
  const pType = classifyProduct(p.name);
  const tc    = TYPE_CONFIG[pType];

  return (
    <>
      <tr
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: brandColor, flexShrink: 0 }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <p style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{p.name}</p>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                  background: tc.bg, color: tc.color, border: `1px solid ${tc.border}`,
                  whiteSpace: "nowrap",
                }}>
                  {tc.emoji} {tc.label}
                </span>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-3)" }}>{p.brandName} · {p.countryName}</p>
            </div>
          </div>
        </td>
        <td><StatusBadge s={p.status} /></td>

        {/* Catalog pricing */}
        <td style={{ textAlign: "right" }}>
          <p style={{ fontWeight: 600, fontSize: 13 }}>{fmtC(p.priceUsd)}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)" }}>Precio</p>
        </td>
        <td style={{ textAlign: "right" }}>
          <p style={{ fontWeight: 600, fontSize: 13 }}>{fmtC(p.costUsd)}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)" }}>Proveedor</p>
        </td>
        <td style={{ textAlign: "right" }}>
          <p style={{ fontWeight: 700, fontSize: 13, color: marginColor }}>{fmtPct(p.margin, 1)}</p>
          <p style={{ fontSize: 11, color: "var(--text-3)" }}>Margen cat.</p>
        </td>

        {/* Sales metrics */}
        <td style={{ textAlign: "right" }}>
          {p.hasData ? (
            <>
              <p style={{ fontWeight: 700, fontSize: 13 }}>{fmtC(p.revenue)}</p>
              <p style={{ fontSize: 11, color: "var(--text-3)" }}>{fmtNum(p.orders, 0)} pedidos</p>
            </>
          ) : (
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>Sin datos</span>
          )}
        </td>
        <td style={{ textAlign: "right" }}>
          {p.hasData ? (
            <p style={{ fontWeight: 700, fontSize: 13, color: p.profit >= 0 ? "var(--green)" : "var(--red)" }}>
              {fmtC(p.profit)}
            </p>
          ) : <span style={{ fontSize: 11, color: "var(--text-4)" }}>—</span>}
        </td>
        <td style={{ textAlign: "right" }}>
          {p.hasData ? (
            <p style={{ fontWeight: 600, fontSize: 13, color: roasColor }}>
              {p.roas !== null ? `${p.roas.toFixed(2)}x` : "—"}
            </p>
          ) : <span style={{ fontSize: 11, color: "var(--text-4)" }}>—</span>}
        </td>
        <td style={{ textAlign: "right" }}>
          {p.hasData ? (
            <p style={{ fontSize: 13, color: "var(--text-2)" }}>{fmtC(p.adSpend)}</p>
          ) : <span style={{ fontSize: 11, color: "var(--text-4)" }}>—</span>}
        </td>
        <td style={{ textAlign: "right" }}>
          <button style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: 4 }}>
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </td>
      </tr>

      {/* Expanded detail */}
      {open && (
        <tr>
          <td colSpan={10} style={{ padding: 0, background: "var(--bg-2)" }}>
            <div style={{ padding: "16px 24px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>

              {/* Cost breakdown */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                  Estructura de Costo
                </p>
                {[
                  { label: "Precio venta",    value: p.priceUsd },
                  { label: "Costo proveedor", value: -p.costUsd },
                  { label: "Flete",           value: -p.shippingUsd },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>{row.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: row.value < 0 ? "var(--red)" : "var(--green)" }}>
                      {row.value >= 0 ? fmtC(row.value) : `−${fmtC(Math.abs(row.value))}`}
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Margen estimado</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: marginColor }}>{fmtPct(p.margin, 1)}</span>
                </div>
                {p.targetMargin && (
                  <p style={{ fontSize: 11, color: p.margin >= p.targetMargin ? "var(--green-text)" : "var(--yellow-text)" }}>
                    Target: {fmtPct(p.targetMargin, 0)}  {p.margin >= p.targetMargin ? "✓" : "⚠"}
                  </p>
                )}
              </div>

              {/* Cost tiers */}
              {p.costTiers.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                    Escalones de Costo
                  </p>
                  {p.costTiers.map((t) => (
                    <div key={t.qty} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>Qty {t.qty}</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Unit: {fmtC(t.costUsd)}</span>
                        <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 8 }}>Landed: {fmtC(t.landedUsd)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Performance */}
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                  Performance (período)
                </p>
                {p.hasData ? (
                  <>
                    {[
                      { label: "Revenue",     value: fmtC(p.revenue) },
                      { label: "Pedidos",     value: fmtNum(p.orders, 0) },
                      { label: "Unidades",    value: fmtNum(p.units, 0) },
                      { label: "Ad Spend",    value: fmtC(p.adSpend) },
                      { label: "ROAS",        value: p.roas !== null ? `${p.roas.toFixed(2)}x` : "—" },
                      { label: "CPA Real",    value: p.realCpa !== null ? fmtC(p.realCpa) : "—" },
                      { label: "AOV",         value: fmtC(p.aov) },
                      { label: "Utilidad",    value: fmtC(p.profit), color: p.profit >= 0 ? "var(--green)" : "var(--red)" },
                    ].map((row) => (
                      <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ fontSize: 12, color: "var(--text-2)" }}>{row.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: (row as any).color ?? "var(--text)" }}>{row.value}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ padding: "20px 0", textAlign: "center" }}>
                    <p style={{ fontSize: 12, color: "var(--text-3)" }}>Sin datos de ventas para este período.</p>
                    <p style={{ fontSize: 11, color: "var(--text-4)", marginTop: 4 }}>Importa métricas diarias con productId para ver performance.</p>
                  </div>
                )}
                {p.supplierName && (
                  <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Proveedor: <strong>{p.supplierName}</strong></p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function ProductosPage() {
  const { fmtC } = useCurrency();
  const { days, isCustom, customFrom, customTo } = useFilters();
  const [data, setData] = useState<{ products: ProductAnalytics[]; totals: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter,   setTypeFilter]   = useState<"all" | ProductType>("all");
  const [profitFilter, setProfitFilter] = useState<"all" | "winners" | "losers">("all");
  const [sortBy, setSortBy] = useState<"name" | "revenue" | "margin" | "profit" | "roas">("revenue");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isCustom && customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", String(days));
    }
    if (selectedBrand !== "all") params.set("brandId", selectedBrand);
    fetch(`/api/products/analytics?${params}`)
      .then((r) => r.json())
      .then((d) => {
        // API returns { rows, totals } — map to expected shape { products, totals }
        const rawRows = d.rows ?? d.products ?? [];
        const products: ProductAnalytics[] = rawRows.map((r: any, i: number) => ({
          id:           r.id   ?? `row-${i}`,
          name:         r.name ?? "Producto",
          status:       r.status ?? "active",
          brandId:      r.brandId ?? "",
          brandName:    r.brandName ?? "",
          countryName:  r.countryName ?? "—",
          storeName:    r.storeName  ?? "—",
          supplierName: r.supplierName ?? null,
          notes:        r.notes ?? null,
          costUsd:      r.costPerUnit ?? r.costUsd ?? 0,
          priceUsd:     r.priceUsd ?? 0,
          shippingUsd:  r.shippingUsd ?? 0,
          targetMargin: r.targetMargin ?? null,
          targetCpa:    r.targetCpa   ?? null,
          margin:       r.netMargin   ?? r.margin  ?? 0,
          revenue:      r.revenueUsd  ?? r.revenue ?? 0,
          orders:       r.orders      ?? 0,
          units:        r.units       ?? 0,
          profit:       r.netProfit   ?? r.profit  ?? 0,
          adSpend:      r.adSpendUsd  ?? r.adSpend ?? 0,
          roas:         r.roas        ?? null,
          realCpa:      r.cpa         ?? r.realCpa ?? null,
          aov:          r.orders > 0  ? (r.revenueUsd / r.orders) : 0,
          hasData:      (r.revenueUsd ?? 0) > 0,
          costTiers:    r.costTiers   ?? [],
        }));
        setData({ products, totals: d.totals ?? {} });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [days, selectedBrand, isCustom, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list: typeof data.products = Array.isArray(data.products) ? data.products : [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.supplierName?.toLowerCase().includes(q));
    }
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    if (typeFilter   !== "all") list = list.filter((p) => classifyProduct(p.name) === typeFilter);
    if (profitFilter === "winners") list = list.filter((p) => p.profit > 0);
    if (profitFilter === "losers")  list = list.filter((p) => p.profit < 0);
    return [...list].sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sortBy === "name")    return dir * a.name.localeCompare(b.name);
      if (sortBy === "revenue") return dir * (a.revenue - b.revenue);
      if (sortBy === "margin")  return dir * (a.margin - b.margin);
      if (sortBy === "profit")  return dir * (a.profit - b.profit);
      if (sortBy === "roas")    return dir * ((a.roas ?? -1) - (b.roas ?? -1));
      return 0;
    });
  }, [data, search, statusFilter, typeFilter, profitFilter, sortBy, sortDir]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortBy(col); setSortDir("desc"); }
  };

  // Computed KPIs
  const products   = Array.isArray(data?.products) ? data!.products : [];
  const winners    = products.filter((p) => p.status === "winner").length;
  const inTest     = products.filter((p) => p.status === "test").length;
  const total      = products.length;
  const avgMargin  = total > 0 ? (products.reduce((s, p) => s + p.margin, 0) / total) : 0;

  // Breakdown físico vs digital
  const fisicos    = products.filter((p) => classifyProduct(p.name) === "físico");
  const digitales  = products.filter((p) => classifyProduct(p.name) === "digital");
  const upsells    = products.filter((p) => classifyProduct(p.name) === "upsell");
  const revFisico  = fisicos.reduce((s, p) => s + p.revenue, 0);
  const revDigital = digitales.reduce((s, p) => s + p.revenue, 0);
  const revUpsell  = upsells.reduce((s, p) => s + p.revenue, 0);
  const totalRev   = revFisico + revDigital + revUpsell;
  const pctDigital = totalRev > 0 ? ((revDigital + revUpsell) / totalRev) * 100 : 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Topbar ─────────────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              Product Analytics
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              Rentabilidad por producto · últimos {days} días
            </p>
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {BRANDS.map((b) => (
            <FilterPill key={b.value} label={b.label} active={selectedBrand === b.value}
              onClick={() => setSelectedBrand(b.value)}
              color={b.value === "brand_glowmmi" ? "#EC4899" : b.value === "brand_balancea" ? "#10B981" : undefined}
            />
          ))}

          <div style={{ flex: 1 }} />

          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── KPI row ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          <KpiMini label="Revenue Total"  value={fmtC(data?.totals?.revenueUsd ?? data?.totals?.revenue ?? 0)} sub={`${fmtNum(total, 0)} productos`}  color="var(--blue)" />
          <KpiMini label="Utilidad Neta"  value={fmtC(data?.totals?.netProfit ?? data?.totals?.profit ?? 0)} sub="Revenue − COGS − Ads − Fees"       color={(data?.totals?.netProfit ?? data?.totals?.profit ?? 0) >= 0 ? "var(--green)" : "var(--red)"} />
          <KpiMini label="Margen Prom."   value={fmtPct(avgMargin, 1)}    sub={`${winners} ganadores · ${inTest} en test`} color={avgMargin >= 35 ? "var(--green)" : avgMargin >= 20 ? "var(--yellow)" : "var(--red)"} />
          <KpiMini label="COGS Total"     value={fmtC(data?.totals?.cogsUsd ?? 0)} sub={`${fisicos.length} físicos con costo`}  color="var(--yellow)" />
        </div>

        {/* ── Breakdown físico / digital ───────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "📦 Físicos",  count: fisicos.length,   rev: revFisico,  color: "#10B981", border: "#6EE7B7", bg: "#D1FAE5", pct: totalRev > 0 ? (revFisico / totalRev) * 100 : 0 },
            { label: "📱 Digitales", count: digitales.length, rev: revDigital, color: "#3B82F6", border: "#93C5FD", bg: "#DBEAFE", pct: totalRev > 0 ? (revDigital / totalRev) * 100 : 0 },
            { label: "⚡ Upsells",  count: upsells.length,   rev: revUpsell,  color: "#D97706", border: "#FCD34D", bg: "#FEF3C7", pct: totalRev > 0 ? (revUpsell / totalRev) * 100 : 0 },
          ].map((t) => (
            <div key={t.label} className="card" style={{ padding: "14px 18px", borderLeft: `4px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: t.color, marginBottom: 4 }}>{t.label}</p>
                <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>{fmtC(t.rev)}</p>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{t.count} producto{t.count !== 1 ? "s" : ""}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: t.color }}>{t.pct.toFixed(1)}%</p>
                <p style={{ fontSize: 10, color: "var(--text-3)" }}>del revenue</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Table ───────────────────────────────────────────── */}
        <div>
          <SectionLabel>Catálogo de Productos</SectionLabel>
          <div className="card" style={{ overflow: "hidden" }}>
            {/* Toolbar */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap",
            }}>
              {/* Search */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8, flex: "0 0 260px",
                background: "var(--bg-2)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "7px 12px",
              }}>
                <Search size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto..."
                  style={{ background: "none", border: "none", outline: "none", fontSize: 12, color: "var(--text)", width: "100%" }}
                />
              </div>

              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--bg-2)", fontSize: 12, color: "var(--text)", cursor: "pointer",
                }}
              >
                <option value="all">Todos los estados</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_CFG[s]?.label ?? s}</option>
                ))}
              </select>

              {/* Type filter chips */}
              <div style={{ display: "flex", gap: 4 }}>
                {([
                  { v: "all",     l: "Todos"       },
                  { v: "físico",  l: "📦 Físico"   },
                  { v: "digital", l: "📱 Digital"  },
                  { v: "upsell",  l: "⚡ Upsell"   },
                ] as { v: "all" | ProductType; l: string }[]).map((s) => {
                  const tc = s.v !== "all" ? TYPE_CONFIG[s.v] : null;
                  return (
                    <button
                      key={s.v}
                      onClick={() => setTypeFilter(s.v)}
                      style={{
                        padding: "5px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                        cursor: "pointer", border: `1px solid ${typeFilter === s.v && tc ? tc.border : "var(--border)"}`,
                        background: typeFilter === s.v && tc ? tc.bg : "var(--bg-2)",
                        color: typeFilter === s.v && tc ? tc.color : typeFilter === s.v ? "var(--text)" : "var(--text-3)",
                        transition: "all 0.15s",
                      }}
                    >{s.l}</button>
                  );
                })}
              </div>

              {/* Profit filter chips */}
              <div style={{ display: "flex", gap: 4 }}>
                {([
                  { v: "all",     l: "Rentabilidad",  bg: "var(--bg-2)",           border: "var(--border)",   color: "var(--text-3)"  },
                  { v: "winners", l: "✅ Ganadores",   bg: "#D1FAE5",               border: "#6EE7B7",         color: "#065F46"        },
                  { v: "losers",  l: "🔴 Perdedores",  bg: "#FEE2E2",               border: "#FCA5A5",         color: "#991B1B"        },
                ] as { v: "all" | "winners" | "losers"; l: string; bg: string; border: string; color: string }[]).map((s) => (
                  <button
                    key={s.v}
                    onClick={() => setProfitFilter(s.v)}
                    style={{
                      padding: "5px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                      cursor: "pointer",
                      border: `1px solid ${profitFilter === s.v ? s.border : "var(--border)"}`,
                      background: profitFilter === s.v ? s.bg : "var(--bg-2)",
                      color: profitFilter === s.v ? s.color : "var(--text-3)",
                      transition: "all 0.15s",
                    }}
                  >{s.l}</button>
                ))}
              </div>

              <div style={{ flex: 1 }} />
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>
                {filtered.length} producto{filtered.length !== 1 ? "s" : ""}
                {typeFilter !== "all" && <span style={{ color: TYPE_CONFIG[typeFilter].color, fontWeight: 700 }}> · {TYPE_CONFIG[typeFilter].emoji} {TYPE_CONFIG[typeFilter].label}</span>}
                {profitFilter === "winners" && <span style={{ color: "#065F46", fontWeight: 700 }}> · ✅ Ganadores</span>}
                {profitFilter === "losers"  && <span style={{ color: "#991B1B", fontWeight: 700 }}> · 🔴 Perdedores</span>}
              </p>
            </div>

            {loading ? (
              <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E", animation: "spin 0.8s linear infinite" }} />
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ cursor: "pointer" }} onClick={() => toggleSort("name")}>
                        Producto {sortBy === "name" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th>Estado</th>
                      <th style={{ textAlign: "right" }}>Precio</th>
                      <th style={{ textAlign: "right" }}>COGS</th>
                      <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("margin")}>
                        Margen {sortBy === "margin" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("revenue")}>
                        Revenue {sortBy === "revenue" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("profit")}>
                        Utilidad {sortBy === "profit" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("roas")}>
                        ROAS {sortBy === "roas" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                      </th>
                      <th style={{ textAlign: "right" }}>Ad Spend</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ textAlign: "center", padding: 40, color: "var(--text-3)", fontSize: 13 }}>
                          {search ? `Sin resultados para "${search}"` : "Sin productos. Agrégalos en Configuración."}
                        </td>
                      </tr>
                    ) : (
                      filtered.map((p) => <ProductRow key={p.id} p={p} fmtC={fmtC} />)
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Margen por producto (visual bar chart) ──────────── */}
        {!loading && filtered.length > 0 && (
          <div>
            <SectionLabel>Comparativa de Márgenes</SectionLabel>
            <div className="card" style={{ padding: "24px 28px" }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
                Margen de catálogo por producto
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...filtered]
                  .sort((a, b) => b.margin - a.margin)
                  .slice(0, 12)
                  .map((p) => {
                    const pct = Math.min(Math.max(p.margin, 0), 100);
                    const color = pct >= 40 ? "#10B981" : pct >= 25 ? "#F59E0B" : "#DC2626";
                    return (
                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 200, flexShrink: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name}
                          </p>
                          <p style={{ fontSize: 10, color: "var(--text-3)" }}>{p.brandName}</p>
                        </div>
                        <div style={{ flex: 1, height: 8, background: "var(--bg-2)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
                        </div>
                        <div style={{ width: 60, textAlign: "right", flexShrink: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color }}>{fmtPct(p.margin, 1)}</span>
                        </div>
                        <div style={{ width: 80, textAlign: "right", flexShrink: 0 }}>
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{fmtC(p.priceUsd)}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
