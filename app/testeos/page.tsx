"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { CalendarDays, LayoutGrid, RefreshCw, Table2, Target } from "lucide-react";
import { useCurrency } from "@/lib/currency";
import { useFilters } from "@/lib/filters";
import { fmtNum } from "@/lib/utils";

/* ─── Tipos ─────────────────────────────────────────────── */
interface Prod {
  id: string; name: string; brandId: string; productType: string;
  shopifyStatus?: "active" | "draft";
  revenue: number; units: number; orders: number;
  cogs: number; adSpend: number; profit: number;
  margin: number; grossMargin: number; roas: number | null; cpa: number | null;
}

interface DailyProd {
  id: string; date: string; name: string; brandId: string; productType: string;
  revenue: number; units: number; orders: number;
  cogs: number; adSpend: number; profit: number;
  margin: number; roas: number | null;
}

const BRANDS = [
  { label: "Todas", value: "all" },
  { label: "Glowmmi", value: "brand_glowmmi", color: "#EC4899" },
  { label: "Balancea", value: "brand_balancea", color: "#10B981" },
];

const C = {
  card: "var(--card)", bg: "var(--bg-2)", border: "var(--border)",
  text: "var(--text)", muted: "var(--text-3)",
};

function normalizeProductKey(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .split(/\s*(?:\||—|–)\s*/)[0]
    .replace(/\s+x\d+\s*$/i, "")
    .replace(/\s+\d+\s*\+\s*\d+.*$/i, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return base || name.trim().toLowerCase();
}

type CatalogProduct = {
  brand: "glowmmi" | "balancea";
  productId: string;
  title: string;
  status: "active" | "draft";
};

/* ═══════════════════════════════════════════════════════════ */
export default function TesteosPage() {
  const { fmtC } = useCurrency();
  const { days, isCustom, customFrom, customTo } = useFilters();
  const [rows, setRows] = useState<Prod[]>([]);
  const [dailyRows, setDailyRows] = useState<DailyProd[]>([]);
  const [loading, setLoading] = useState(true);
  const [brand, setBrand] = useState("all");
  const [selId, setSelId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"table" | "summary">("table");

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("includeDaily", "1");
    if (isCustom && customFrom && customTo) { params.set("from", customFrom); params.set("to", customTo); }
    else params.set("days", String(days));
    if (brand !== "all") params.set("brandId", brand);
    Promise.all([
      fetch(`/api/products/analytics?${params}`),
      fetch("/api/products/shopify-catalog"),
    ])
      .then(async ([analyticsResponse, catalogResponse]) => {
        const data = await analyticsResponse.json();
        if (!analyticsResponse.ok) throw new Error(data.error ?? "No se pudieron cargar los testeos");
        const catalogData = catalogResponse.ok
          ? await catalogResponse.json().catch(() => ({ products: [] }))
          : { products: [] };
        return { data, catalog: (catalogData.products ?? []) as CatalogProduct[] };
      })
      .then(({ data: d, catalog }) => {
        const raw = d.rows ?? d.products ?? [];
        const grouped = new Map<string, Prod>();
        for (const r of raw) {
          const name = r.name ?? "Producto";
          const brandId = r.brandId ?? "";
          const id = `${brandId}||${normalizeProductKey(name)}`;
          const current = grouped.get(id) ?? {
            id,
            name,
            brandId,
            productType: r.productType ?? "físico",
            revenue: 0,
            units: 0,
            orders: 0,
            cogs: 0,
            adSpend: 0,
            profit: 0,
            margin: 0,
            grossMargin: 0,
            roas: null,
            cpa: null,
          };
          current.revenue += r.revenueUsd ?? 0;
          current.units += r.units ?? 0;
          current.orders += r.orders ?? 0;
          current.cogs += r.cogsUsd ?? 0;
          current.adSpend += r.adSpendUsd ?? 0;
          current.profit += r.netProfit ?? 0;
          grouped.set(id, current);
        }
        const mapped: Prod[] = [...grouped.values()].map((p) => ({
          ...p,
          margin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0,
          grossMargin: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue) * 100 : 0,
          roas: p.adSpend > 0 ? p.revenue / p.adSpend : null,
          cpa: p.adSpend > 0 && p.orders > 0 ? p.adSpend / p.orders : null,
        }));

        const catalogById = new Map<string, CatalogProduct>();
        for (const product of catalog) {
          if (product.status !== "active" && product.status !== "draft") continue;
          const brandId = `brand_${product.brand}`;
          if (brand !== "all" && brandId !== brand) continue;
          const id = `${brandId}||${normalizeProductKey(product.title)}`;
          const previous = catalogById.get(id);
          if (!previous || (previous.status === "draft" && product.status === "active")) {
            catalogById.set(id, product);
          }
        }

        const merged = new Map(mapped.map((product) => [product.id, product]));
        for (const [id, catalogProduct] of catalogById) {
          const brandId = `brand_${catalogProduct.brand}`;
          const current = merged.get(id);
          if (current) {
            current.name = catalogProduct.title;
            current.shopifyStatus = catalogProduct.status;
            continue;
          }
          merged.set(id, {
            id,
            name: catalogProduct.title,
            brandId,
            productType: "físico",
            shopifyStatus: catalogProduct.status,
            revenue: 0,
            units: 0,
            orders: 0,
            cogs: 0,
            adSpend: 0,
            profit: 0,
            margin: 0,
            grossMargin: 0,
            roas: null,
            cpa: null,
          });
        }
        setRows([...merged.values()]);

        const groupedDaily = new Map<string, DailyProd>();
        for (const r of d.dailyRows ?? []) {
          const name = r.name ?? "Producto";
          const brandId = r.brandId ?? "";
          const id = `${brandId}||${normalizeProductKey(name)}`;
          const key = `${r.date}||${id}`;
          const current = groupedDaily.get(key) ?? {
            id,
            date: r.date,
            name,
            brandId,
            productType: r.productType ?? "físico",
            revenue: 0,
            units: 0,
            orders: 0,
            cogs: 0,
            adSpend: 0,
            profit: 0,
            margin: 0,
            roas: null,
          };
          current.revenue += r.revenueUsd ?? 0;
          current.units += r.units ?? 0;
          current.orders += r.orders ?? 0;
          current.cogs += r.cogsUsd ?? 0;
          current.adSpend += r.adSpendUsd ?? 0;
          current.profit += r.netProfit ?? 0;
          groupedDaily.set(key, current);
        }
        setDailyRows(
          [...groupedDaily.values()]
            .map((p) => ({
              ...p,
              margin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0,
              roas: p.adSpend > 0 ? p.revenue / p.adSpend : null,
            }))
            .sort((a, b) => b.date.localeCompare(a.date)),
        );
        setLoading(false);
      })
      .catch(() => {
        setRows([]);
        setDailyRows([]);
        setLoading(false);
      });
  }, [days, brand, isCustom, customFrom, customTo]);

  useEffect(() => { load(); }, [load]);

  // Productos del catálogo real, activos o borradores, deduplicados por tienda.
  const testeables = useMemo(
    () => rows.filter((p) => p.productType === "físico" || p.productType === "upsell")
             .sort((a, b) =>
               Number(a.shopifyStatus === "draft") - Number(b.shopifyStatus === "draft") ||
               a.name.localeCompare(b.name, "es") ||
               a.brandId.localeCompare(b.brandId)
             ),
    [rows],
  );

  const sel = testeables.find((p) => p.id === selId) ?? null;

  const periodDates = useMemo(() => {
    const nowLocal = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const fallbackTo = nowLocal.toISOString().slice(0, 10);
    const to = isCustom && customTo ? customTo : fallbackTo;
    const from = isCustom && customFrom
      ? customFrom
      : new Date(new Date(`${to}T12:00:00Z`).getTime() - (days - 1) * 86_400_000)
          .toISOString()
          .slice(0, 10);
    const result: string[] = [];
    for (
      let cursor = new Date(`${to}T12:00:00Z`);
      cursor >= new Date(`${from}T12:00:00Z`);
      cursor = new Date(cursor.getTime() - 86_400_000)
    ) {
      result.push(cursor.toISOString().slice(0, 10));
    }
    return result;
  }, [days, isCustom, customFrom, customTo]);

  const selectedDaily = useMemo(() => {
    if (!sel) return [];
    const byDate = new Map(
      dailyRows.filter((row) => row.id === sel.id).map((row) => [row.date, row]),
    );
    return periodDates.map((date) => byDate.get(date) ?? {
      id: sel.id,
      date,
      name: sel.name,
      brandId: sel.brandId,
      productType: sel.productType,
      revenue: 0,
      units: 0,
      orders: 0,
      cogs: 0,
      adSpend: 0,
      profit: 0,
      margin: 0,
      roas: null,
    });
  }, [dailyRows, periodDates, sel]);

  return (
    <div style={{ padding: "24px 32px", width: "100%", background: "var(--bg)", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Target size={22} style={{ color: "var(--accent, #7C5CFF)" }} />
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: C.text }}>Testeos</h1>
            <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>¿Qué producto sirve y cuál no? · {isCustom ? "período elegido" : `últimos ${days} días`}</p>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 5 }}>
          {BRANDS.map((b) => (
            <button key={b.value} onClick={() => { setBrand(b.value); setSelId(""); }} className="filter-pill"
              style={brand === b.value ? { background: b.color ?? "#2563EB", borderColor: b.color ?? "#2563EB", color: "#fff" } : {}}>
              {b.label}
            </button>
          ))}
        </div>
        <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, color: C.text, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Actualizar
        </button>
      </div>

      {/* Selector de producto */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 20px", marginBottom: 18 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
          Elige un producto de tu catálogo
        </label>
        <select
          value={selId}
          onChange={(e) => setSelId(e.target.value)}
          style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          <option value="" disabled>
            {testeables.length === 0 ? "— Sin productos disponibles —" : "Selecciona un producto…"}
          </option>
          {testeables.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.brandId === "brand_glowmmi" ? "Glowmmi" : "Balancea"}{p.shopifyStatus === "draft" ? " · Borrador" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Comparación diaria del producto seleccionado */}
      {sel && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <CalendarDays size={17} style={{ color: "#6366F1" }} />
              <div>
                <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>{sel.name}</p>
                <p style={{ fontSize: 11, color: C.muted, margin: "2px 0 0" }}>Resultados del período seleccionado</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 9, background: C.bg, border: `1px solid ${C.border}` }}>
              {([
                { key: "table" as const, label: "Vista tabla", icon: Table2 },
                { key: "summary" as const, label: "Vista resumida", icon: LayoutGrid },
              ]).map((option) => (
                <button
                  key={option.key}
                  onClick={() => setViewMode(option.key)}
                  aria-pressed={viewMode === option.key}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 11px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800, background: viewMode === option.key ? C.card : "transparent", color: viewMode === option.key ? C.text : C.muted, boxShadow: viewMode === option.key ? "0 1px 3px rgba(0,0,0,0.12)" : "none" }}
                >
                  <option.icon size={13} /> {option.label}
                </button>
              ))}
            </div>
          </div>
          {viewMode === "summary" ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
              {[
                { label: "Pedidos", value: fmtNum(sel.orders, 0), color: "#6366F1" },
                { label: "Revenue", value: fmtC(sel.revenue), color: "#2563EB" },
                { label: "COGS", value: fmtC(sel.cogs), color: "#8B5CF6" },
                { label: "Ad Spend", value: fmtC(sel.adSpend), color: "#F59E0B" },
                { label: "ROAS", value: sel.roas == null ? "—" : `${sel.roas.toFixed(2)}x`, color: (sel.roas ?? 0) >= 2.5 ? "var(--green)" : "var(--yellow)" },
                { label: "Profit %", value: `${sel.margin.toFixed(1)}%`, color: sel.profit >= 0 ? "var(--green)" : "var(--red)" },
                { label: "Profit $", value: fmtC(sel.profit), color: sel.profit >= 0 ? "var(--green)" : "var(--red)" },
              ].map((metric) => (
                <div key={metric.label} style={{ padding: "15px 16px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}` }}>
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{metric.label}</p>
                  <p style={{ margin: "7px 0 0", fontSize: 20, fontWeight: 900, color: metric.color }}>{metric.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: C.muted, margin: "0 0 14px" }}>
                Cada fila es un día. Los días sin pedidos también aparecen para identificar pausas o gasto sin conversión.
              </p>
              <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.bg }}>
                  {["Fecha", "Pedidos", "COGS", "Ad Spend", "ROAS", "Revenue", "Profit %", "Profit $"].map((label, index) => (
                    <th key={label} style={{ padding: "10px 13px", textAlign: index === 0 ? "left" : "right", fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedDaily.map((day) => {
                  const profitable = day.profit >= 0;
                  const hasActivity = day.orders > 0 || day.adSpend > 0;
                  return (
                    <tr key={day.date} style={{ opacity: hasActivity ? 1 : 0.55, background: day.profit < 0 && hasActivity ? "rgba(239,68,68,0.035)" : "transparent" }}>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {new Date(`${day.date}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" })}
                      </td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: day.orders > 0 ? C.text : C.muted, fontSize: 13, fontWeight: 800, textAlign: "right" }}>{fmtNum(day.orders, 0)}</td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 12, textAlign: "right", whiteSpace: "nowrap" }}>{fmtC(day.cogs)}</td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: day.adSpend > 0 ? "#F59E0B" : C.muted, fontSize: 12, fontWeight: day.adSpend > 0 ? 700 : 500, textAlign: "right", whiteSpace: "nowrap" }}>{fmtC(day.adSpend)}</td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: day.roas == null ? C.muted : day.roas >= 2.5 ? "var(--green)" : day.roas >= 1.5 ? "var(--yellow)" : "var(--red)", fontSize: 12, fontWeight: 800, textAlign: "right" }}>{day.roas == null ? "—" : `${day.roas.toFixed(2)}x`}</td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: C.text, fontSize: 12, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>{fmtC(day.revenue)}</td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: hasActivity ? (profitable ? "var(--green)" : "var(--red)") : C.muted, fontSize: 12, fontWeight: 800, textAlign: "right" }}>{day.revenue > 0 ? `${day.margin.toFixed(1)}%` : "—"}</td>
                      <td style={{ padding: "11px 13px", borderBottom: `1px solid ${C.border}`, color: hasActivity ? (profitable ? "var(--green)" : "var(--red)") : C.muted, fontSize: 12, fontWeight: 900, textAlign: "right", whiteSpace: "nowrap" }}>{fmtC(day.profit)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: C.bg }}>
                  <td style={{ padding: "11px 13px", color: C.text, fontSize: 11, fontWeight: 900, textTransform: "uppercase" }}>Total período</td>
                  <td style={{ padding: "11px 13px", color: C.text, fontSize: 13, fontWeight: 900, textAlign: "right" }}>{fmtNum(sel.orders, 0)}</td>
                  <td style={{ padding: "11px 13px", color: C.text, fontSize: 12, fontWeight: 800, textAlign: "right" }}>{fmtC(sel.cogs)}</td>
                  <td style={{ padding: "11px 13px", color: "#F59E0B", fontSize: 12, fontWeight: 800, textAlign: "right" }}>{fmtC(sel.adSpend)}</td>
                  <td style={{ padding: "11px 13px", color: C.text, fontSize: 12, fontWeight: 900, textAlign: "right" }}>{sel.roas == null ? "—" : `${sel.roas.toFixed(2)}x`}</td>
                  <td style={{ padding: "11px 13px", color: C.text, fontSize: 12, fontWeight: 800, textAlign: "right" }}>{fmtC(sel.revenue)}</td>
                  <td style={{ padding: "11px 13px", color: sel.profit >= 0 ? "var(--green)" : "var(--red)", fontSize: 12, fontWeight: 900, textAlign: "right" }}>{sel.margin.toFixed(1)}%</td>
                  <td style={{ padding: "11px 13px", color: sel.profit >= 0 ? "var(--green)" : "var(--red)", fontSize: 12, fontWeight: 900, textAlign: "right" }}>{fmtC(sel.profit)}</td>
                </tr>
              </tfoot>
            </table>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
