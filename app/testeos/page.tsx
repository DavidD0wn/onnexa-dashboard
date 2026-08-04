"use client";
import { useEffect, useState, useMemo, useCallback } from "react";
import { CalendarDays, RefreshCw, Target, TrendingUp, TrendingDown, DollarSign, ShoppingCart, Zap, Package } from "lucide-react";
import { useCurrency } from "@/lib/currency";
import { useFilters } from "@/lib/filters";
import { fmtNum } from "@/lib/utils";

/* ─── Tipos ─────────────────────────────────────────────── */
interface Prod {
  id: string; name: string; brandId: string; productType: string;
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

/* ─── Veredicto: ¿sirve el producto? ─────────────────────── */
type Verdict = { key: string; label: string; emoji: string; color: string; bg: string; reco: string };

function veredicto(p: Prod): Verdict {
  const conPauta = p.adSpend > 0;
  // Sin pauta o sin ventas → no se puede juzgar el testeo
  if (p.orders === 0) return { key: "sin", label: "Sin ventas", emoji: "○", color: "var(--text-3)", bg: "var(--bg-2)", reco: "Todavía no hay pedidos en este período." };
  if (!conPauta)      return { key: "organico", label: "Sin pauta", emoji: "◌", color: "var(--blue)", bg: "var(--blue-bg)", reco: "Vendió sin pauta registrada. Para testear su rentabilidad real, necesita gasto de ads asignado." };

  if (p.profit < 0)   return { key: "matar", label: "No rentable", emoji: "✗", color: "var(--red)", bg: "var(--red-bg)",
    reco: `Está perdiendo dinero: por cada venta gastas más en ads/costo de lo que deja. Revisa el creativo/oferta o baja el presupuesto. Pérdida actual: ${Math.round(p.profit)} USD.` };

  if (p.margin >= 25 && (p.roas ?? 0) >= 2.5)
    return { key: "escalar", label: "Ganador — Escalar", emoji: "🏆", color: "var(--green)", bg: "var(--green-bg)",
      reco: `Margen sano (${p.margin.toFixed(0)}%) y ROAS ${p.roas?.toFixed(2)}x. Este SÍ funciona — vale la pena subirle presupuesto.` };

  if (p.margin >= 10)
    return { key: "rentable", label: "Rentable", emoji: "✓", color: "var(--green)", bg: "var(--green-bg)",
      reco: `Deja ganancia (margen ${p.margin.toFixed(0)}%), pero el margen aún no es para escalar agresivo. Optimiza CPA o sube el ticket antes de meterle más.` };

  return { key: "ajustar", label: "Al límite", emoji: "≈", color: "var(--yellow)", bg: "var(--yellow-bg)",
    reco: `Apenas empata (margen ${p.margin.toFixed(0)}%). Un mal día y pierde. Ajusta oferta, COGS o CPA antes de escalar.` };
}

const C = {
  card: "var(--card)", bg: "var(--bg-2)", border: "var(--border)",
  text: "var(--text)", muted: "var(--text-3)",
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

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("includeDaily", "1");
    if (isCustom && customFrom && customTo) { params.set("from", customFrom); params.set("to", customTo); }
    else params.set("days", String(days));
    if (brand !== "all") params.set("brandId", brand);
    fetch(`/api/products/analytics?${params}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "No se pudieron cargar los testeos");
        return data;
      })
      .then((d) => {
        const raw = d.rows ?? d.products ?? [];
        const grouped = new Map<string, Prod>();
        for (const r of raw) {
          const name = r.name ?? "Producto";
          const brandId = r.brandId ?? "";
          const id = `${brandId}||${name}`;
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
        const mapped = [...grouped.values()].map((p) => ({
          ...p,
          margin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0,
          grossMargin: p.revenue > 0 ? ((p.revenue - p.cogs) / p.revenue) * 100 : 0,
          roas: p.adSpend > 0 ? p.revenue / p.adSpend : null,
          cpa: p.adSpend > 0 && p.orders > 0 ? p.adSpend / p.orders : null,
        }));
        setRows(mapped);

        const groupedDaily = new Map<string, DailyProd>();
        for (const r of d.dailyRows ?? []) {
          const name = r.name ?? "Producto";
          const brandId = r.brandId ?? "";
          const id = `${brandId}||${name}`;
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

  // Solo productos "testeables": físicos y upsells (los digitales son regalos)
  const testeables = useMemo(
    () => rows.filter((p) => p.productType === "físico" || p.productType === "upsell")
             .sort((a, b) => b.profit - a.profit),
    [rows],
  );

  const sel = testeables.find((p) => p.id === selId) ?? testeables[0] ?? null;

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
            <button key={b.value} onClick={() => setBrand(b.value)} className="filter-pill"
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
          value={sel?.id ?? ""}
          onChange={(e) => setSelId(e.target.value)}
          style={{ width: "100%", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          {testeables.length === 0 && <option>— sin productos con ventas en este período —</option>}
          {testeables.map((p) => {
            const v = veredicto(p);
            return <option key={p.id} value={p.id}>{v.emoji} {p.name.slice(0, 60)} — {v.label}</option>;
          })}
        </select>
      </div>

      {/* Veredicto del producto seleccionado */}
      {sel && (() => {
        const v = veredicto(sel);
        return (
          <div style={{ marginBottom: 20 }}>
            <div style={{ background: v.bg, border: `1.5px solid ${v.color}`, borderRadius: 14, padding: "20px 24px", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 30 }}>{v.emoji}</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: v.color, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Veredicto</p>
                  <p style={{ fontSize: 22, fontWeight: 900, color: v.color, margin: 0, lineHeight: 1.1 }}>{v.label}</p>
                </div>
                <div style={{ flex: 1 }} />
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>Ganancia neta</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: sel.profit >= 0 ? "var(--green)" : "var(--red)", margin: 0 }}>{fmtC(sel.profit)}</p>
                </div>
              </div>
              <p style={{ fontSize: 14, color: C.text, margin: "6px 0 0", lineHeight: 1.5 }}>{v.reco}</p>
            </div>

            {/* Métricas del producto */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {[
                { icon: DollarSign, label: "Revenue", value: fmtC(sel.revenue), color: "#2563EB" },
                { icon: ShoppingCart, label: "Pedidos", value: fmtNum(sel.orders, 0), sub: `${fmtNum(sel.units, 0)} unidades entregadas`, color: "#6366F1" },
                { icon: Package, label: "COGS", value: fmtC(sel.cogs), color: "#8B5CF6" },
                { icon: Zap, label: "Ad Spend", value: fmtC(sel.adSpend), color: "#F59E0B" },
                { icon: Target, label: "Margen neto", value: `${sel.margin.toFixed(0)}%`, sub: `bruto ${sel.grossMargin.toFixed(0)}%`, color: sel.margin >= 25 ? "#10B981" : sel.margin >= 10 ? "#F59E0B" : "#EF4444" },
                { icon: sel.profit >= 0 ? TrendingUp : TrendingDown, label: "ROAS", value: sel.roas != null ? `${sel.roas.toFixed(2)}x` : "—", sub: sel.cpa != null ? `CPA ${fmtC(sel.cpa)}` : "", color: (sel.roas ?? 0) >= 2.5 ? "#10B981" : (sel.roas ?? 0) >= 1.5 ? "#F59E0B" : "#EF4444" },
              ].map((m) => (
                <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                    <m.icon size={14} style={{ color: m.color }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</span>
                  </div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0, lineHeight: 1 }}>{m.value}</p>
                  {m.sub && <p style={{ fontSize: 11, color: C.muted, margin: "4px 0 0" }}>{m.sub}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Comparación diaria del producto seleccionado */}
      {sel && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <CalendarDays size={17} style={{ color: "#6366F1" }} />
            <p style={{ fontSize: 15, fontWeight: 800, color: C.text, margin: 0 }}>Comparación diaria del testeo</p>
          </div>
          <p style={{ fontSize: 12, color: C.muted, margin: "0 0 14px" }}>
            Cada fila es un día de <strong style={{ color: C.text }}>{sel.name}</strong>. Los días sin pedidos también aparecen para identificar pausas o gasto sin conversión.
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
        </div>
      )}

      {/* Ranking: todos los testeos de un vistazo */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 22px" }}>
        <p style={{ fontSize: 15, fontWeight: 700, color: C.text, margin: "0 0 4px" }}>Todos los testeos</p>
        <p style={{ fontSize: 12, color: C.muted, margin: "0 0 16px" }}>Ordenados por ganancia. Verde = escalar · Amarillo = ajustar · Rojo = matar.</p>
        {testeables.length === 0 ? (
          <p style={{ fontSize: 13, color: C.muted }}>Sin productos con ventas en este período.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {testeables.map((p) => {
              const v = veredicto(p);
              const isSel = sel?.id === p.id;
              return (
                <button key={p.id} onClick={() => setSelId(p.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, textAlign: "left", cursor: "pointer",
                    background: isSel ? v.bg : "transparent", border: `1px solid ${isSel ? v.color : C.border}` }}>
                  <span style={{ fontSize: 16, width: 22, textAlign: "center", flexShrink: 0 }}>{v.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</p>
                    <p style={{ fontSize: 11, color: C.muted, margin: "2px 0 0" }}>
                      {p.orders} pedidos · margen {p.margin.toFixed(0)}% · ROAS {p.roas != null ? p.roas.toFixed(2) + "x" : "—"}
                    </p>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: v.bg, color: v.color, flexShrink: 0 }}>{v.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "monospace", color: p.profit >= 0 ? "var(--green)" : "var(--red)", flexShrink: 0, minWidth: 78, textAlign: "right" }}>{fmtC(p.profit)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
