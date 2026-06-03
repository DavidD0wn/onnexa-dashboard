"use client";
import { useEffect, useState, useCallback } from "react";
import { fmtNum, fmtPct } from "@/lib/utils";
import { useFilters } from "@/lib/filters";
import { useCurrency } from "@/lib/currency";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  TrendingUp, TrendingDown, RefreshCw, Calendar,
  Download, Search, ChevronUp, ChevronDown,
} from "lucide-react";

interface DailyRow {
  id: string;
  date: string;
  brandName: string;
  countryName: string;
  ordersCount: number;
  grossRevenue: number;
  netRevenue: number;
  adSpend: number;
  cogs: number;
  shippingCost: number;
  fees: number;
  netProfit: number;
  netMargin: number;
  aov: number;
  cpa?: number;
  roas?: number;
}

function StatusBadge({ label, type }: { label: string; type: "good" | "ok" | "bad" | "neutral" }) {
  const s = {
    good:    { background: "var(--green-bg)",  color: "var(--green-text)" },
    ok:      { background: "var(--yellow-bg)", color: "var(--yellow-text)" },
    bad:     { background: "var(--red-bg)",    color: "var(--red-text)" },
    neutral: { background: "var(--bg-2)",      color: "var(--text-3)" },
  };
  return (
    <span
      style={{
        ...s[type],
        display: "inline-flex", alignItems: "center",
        padding: "2px 8px", borderRadius: 20,
        fontSize: 10, fontWeight: 700,
        letterSpacing: "0.02em", textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

type SortKey = "date" | "ordersCount" | "grossRevenue" | "netProfit" | "netMargin" | "adSpend" | "cpa" | "roas";

export default function VentasPage() {
  const { days } = useFilters();
  const { fmtC } = useCurrency();
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>("all");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/ventas?days=" + days)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  /* ── Derived / totals ── */
  const filtered = rows.filter((r) => {
    const matchSearch = search === "" ||
      r.brandName.toLowerCase().includes(search.toLowerCase()) ||
      r.countryName.toLowerCase().includes(search.toLowerCase()) ||
      format(new Date(r.date), "d MMM", { locale: es }).toLowerCase().includes(search.toLowerCase());
    const matchBrand = brandFilter === "all" || r.brandName.toLowerCase().includes(brandFilter);
    return matchSearch && matchBrand;
  });

  const sorted = [...filtered].sort((a, b) => {
    let va: number | string = (a as any)[sortKey] ?? 0;
    let vb: number | string = (b as any)[sortKey] ?? 0;
    if (sortKey === "date") { va = a.date; vb = b.date; }
    if (sortAsc) return va > vb ? 1 : -1;
    return va < vb ? 1 : -1;
  });

  const totals = filtered.reduce(
    (acc, r) => ({
      orders: acc.orders + r.ordersCount,
      revenue: acc.revenue + r.grossRevenue,
      adSpend: acc.adSpend + r.adSpend,
      profit: acc.profit + r.netProfit,
      cogs: acc.cogs + r.cogs,
    }),
    { orders: 0, revenue: 0, adSpend: 0, profit: 0, cogs: 0 }
  );
  const avgMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;
  const avgRoas   = totals.adSpend > 0 ? totals.revenue / totals.adSpend : 0;
  const avgCpa    = totals.orders > 0 ? totals.adSpend / totals.orders : 0;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortIcon = ({ k }: { k: SortKey }) =>
    sortKey === k ? (
      sortAsc ? <ChevronUp size={11} style={{ marginLeft: 3 }} /> : <ChevronDown size={11} style={{ marginLeft: 3 }} />
    ) : null;

  const thBtn = (k: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      onClick={() => handleSort(k)}
      style={{
        textAlign: align,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        {label}<SortIcon k={k} />
      </span>
    </th>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Topbar ─────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              Ventas Diarias
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              Últimos {days} días · {filtered.length} registros
            </p>
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)" }} />

          {/* Brand quick filter */}
          {["all", "glowmmi", "balancea"].map((b) => (
            <button
              key={b}
              onClick={() => setBrandFilter(b)}
              className="filter-pill"
              style={brandFilter === b ? {
                background: b === "glowmmi" ? "#EC4899" : b === "balancea" ? "#10B981" : "#2563EB",
                borderColor: "transparent", color: "#fff",
              } : {}}
            >
              {b === "all" ? "Todas" : b === "glowmmi" ? "Glowmmi" : "Balancea"}
            </button>
          ))}

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--bg-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "7px 12px",
          }}>
            <Search size={13} style={{ color: "var(--text-3)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar fecha, marca, país..."
              style={{
                background: "transparent", border: "none", outline: "none",
                fontSize: 12, color: "var(--text)", width: 200,
              }}
            />
          </div>

          {/* Export */}
          <button style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <Download size={13} />
            Exportar CSV
          </button>

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

        {/* ── Totals row ──────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>
          {[
            { label: "Revenue Total", value: fmtC(totals.revenue), color: "#2563EB", icon: "💰",
              sub: `${fmtNum(totals.orders, 0)} órdenes` },
            { label: "Ad Spend Total", value: fmtC(totals.adSpend), color: "#F59E0B", icon: "📢",
              sub: `${(totals.adSpend / (totals.revenue || 1) * 100).toFixed(1)}% del revenue` },
            { label: "CPA Promedio", value: fmtC(avgCpa), color: "#7C3AED", icon: "🎯",
              sub: "Costo por adquisición" },
            { label: "ROAS Promedio", value: `${avgRoas.toFixed(2)}x`, color: avgRoas >= 3 ? "#00A676" : avgRoas >= 2 ? "#F59E0B" : "#DC2626", icon: "📊",
              sub: avgRoas >= 3 ? "Excelente" : avgRoas >= 2 ? "Bueno" : "Bajo" },
            { label: "Utilidad Neta", value: fmtC(totals.profit), color: totals.profit >= 0 ? "#00A676" : "#DC2626", icon: totals.profit >= 0 ? "📈" : "📉",
              sub: `Margen ${fmtPct(avgMargin, 1)}` },
          ].map((c) => (
            <div key={c.label} className="kpi-card">
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
                  {c.label}
                </p>
                <span style={{ fontSize: 18 }}>{c.icon}</span>
              </div>
              <p style={{ fontSize: 22, fontWeight: 800, color: c.color, letterSpacing: "-0.02em", lineHeight: 1 }}>
                {c.value}
              </p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>{c.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Table ───────────────────────────────── */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={15} style={{ color: "var(--text-3)" }} />
            <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
              Detalle diario — {sorted.length} filas
            </p>
            <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 4 }}>
              · Haz clic en los encabezados para ordenar
            </span>
          </div>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E",
                animation: "spin 0.8s linear infinite",
              }} />
            </div>
          ) : sorted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-3)" }}>
              <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Sin datos de ventas diarias</p>
              <p style={{ fontSize: 12 }}>Importa datos desde Shopify o Meta Ads</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {thBtn("date", "Fecha")}
                    <th>Marca</th>
                    <th>País</th>
                    {thBtn("ordersCount", "Órdenes", "right")}
                    {thBtn("grossRevenue", "Revenue", "right")}
                    {thBtn("adSpend", "Ad Spend", "right")}
                    {thBtn("cpa", "CPA", "right")}
                    {thBtn("roas", "ROAS", "right")}
                    {thBtn("netProfit", "Utilidad", "right")}
                    {thBtn("netMargin", "Margen", "right")}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const isGlow = r.brandName.toLowerCase().includes("glow");
                    const roasVal = r.roas ?? (r.adSpend > 0 ? r.grossRevenue / r.adSpend : 0);
                    return (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Calendar size={12} style={{ color: "var(--text-4)" }} />
                            {format(new Date(r.date), "d MMM yyyy", { locale: es })}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "2px 8px", borderRadius: 20,
                            fontSize: 11, fontWeight: 700,
                            background: isGlow ? "#FCE7F3" : "#D1FAE5",
                            color: isGlow ? "#BE185D" : "#065F46",
                          }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: "50%",
                              background: isGlow ? "#EC4899" : "#10B981",
                              flexShrink: 0,
                            }} />
                            {r.brandName}
                          </span>
                        </td>
                        <td style={{ color: "var(--text-2)", fontSize: 12 }}>{r.countryName}</td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: "var(--text)" }}>
                          {fmtNum(r.ordersCount, 0)}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text)" }}>
                          {fmtC(r.grossRevenue)}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--yellow)", fontWeight: 600 }}>
                          {fmtC(r.adSpend)}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--text-2)" }}>
                          {r.cpa ? fmtC(r.cpa) : r.adSpend > 0 && r.ordersCount > 0 ? fmtC(r.adSpend / r.ordersCount) : "—"}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {roasVal > 0 ? (
                            <StatusBadge
                              label={`${roasVal.toFixed(2)}x`}
                              type={roasVal >= 3 ? "good" : roasVal >= 2 ? "ok" : "bad"}
                            />
                          ) : "—"}
                        </td>
                        <td style={{
                          textAlign: "right", fontWeight: 700,
                          color: r.netProfit >= 0 ? "var(--green)" : "var(--red)",
                        }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            {r.netProfit >= 0
                              ? <TrendingUp size={11} style={{ color: "var(--green)" }} />
                              : <TrendingDown size={11} style={{ color: "var(--red)" }} />
                            }
                            {fmtC(r.netProfit)}
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <StatusBadge
                            label={fmtPct(r.netMargin, 1)}
                            type={r.netMargin >= 20 ? "good" : r.netMargin >= 10 ? "ok" : "bad"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
