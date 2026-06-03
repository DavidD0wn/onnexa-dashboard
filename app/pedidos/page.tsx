"use client";
import { useEffect, useState, useCallback } from "react";
import { ShoppingBag, ChevronDown, ChevronUp, RefreshCw, Package, TrendingUp } from "lucide-react";
import { useCurrency } from "@/lib/currency";

/* ─── Types ─────────────────────────────────────────────────── */
interface ProductLine {
  name:       string;
  variant:    string;
  qty:        number;
  revenueUsd: number;
  orderCount: number;
  brandName:  string;
  brandColor: string;
}

interface DayData {
  date:            string;
  totalOrders:     number;
  totalRevenueUsd: number;
  products:        ProductLine[];
}

/* ─── Helpers ────────────────────────────────────────────────── */
const DAY_NAMES = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
const MON_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MON_NAMES[d.getUTCMonth()]}`;
}

function localDateStr(d: Date = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isToday(iso: string) {
  return iso === localDateStr();
}
function isYesterday(iso: string) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return iso === localDateStr(y);
}
function dateLabel(iso: string) {
  if (isToday(iso))     return "HOY";
  if (isYesterday(iso)) return "AYER";
  return null;
}

/* ─── DayCard ────────────────────────────────────────────────── */
function DayCard({ day, fmtC, defaultOpen }: { day: DayData; fmtC: (v: number) => string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const badge = dateLabel(day.date);

  // Group products by brand for the mini bar
  const byBrand = day.products.reduce<Record<string, { color: string; rev: number }>>((acc, p) => {
    if (!acc[p.brandName]) acc[p.brandName] = { color: p.brandColor, rev: 0 };
    acc[p.brandName].rev += p.revenueUsd;
    return acc;
  }, {});

  return (
    <div style={{
      borderRadius: 16, overflow: "hidden",
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      boxShadow: open ? "0 4px 24px rgba(0,0,0,0.06)" : "none",
      transition: "box-shadow 0.2s",
    }}>
      {/* ── Header ── */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "14px 20px", cursor: "pointer",
          background: "none", border: "none", textAlign: "left",
        }}
      >
        {/* Date */}
        <div style={{ minWidth: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{fmtDate(day.date)}</span>
            {badge && (
              <span style={{
                fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 99,
                background: badge === "HOY" ? "#0E766E" : "var(--bg-2)",
                color: badge === "HOY" ? "#fff" : "var(--text-3)",
                letterSpacing: "0.06em",
              }}>{badge}</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{day.date}</span>
        </div>

        {/* Stats pills */}
        <div style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap" }}>
          <span style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 700, padding: "4px 10px",
            borderRadius: 99, background: "var(--bg-2)", color: "var(--text)",
          }}>
            <ShoppingBag size={11} style={{ color: "#6366f1" }} />
            {day.totalOrders} pedidos
          </span>
          <span style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 700, padding: "4px 10px",
            borderRadius: 99, background: "var(--bg-2)", color: "var(--text)",
          }}>
            <TrendingUp size={11} style={{ color: "#10b981" }} />
            {fmtC(day.totalRevenueUsd)}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 600, padding: "4px 10px",
            borderRadius: 99, background: "var(--bg-2)", color: "var(--text-3)",
          }}>
            {day.products.length} producto{day.products.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Brand mini bars */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", marginRight: 8 }}>
          {Object.entries(byBrand).map(([name, { color, rev }]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>{name}</span>
            </div>
          ))}
        </div>

        {open ? <ChevronUp size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />
               : <ChevronDown size={16} style={{ color: "var(--text-3)", flexShrink: 0 }} />}
      </button>

      {/* ── Product table ── */}
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "0 0 8px" }}>
          {/* Table header */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 80px 90px 100px",
            padding: "8px 20px 6px",
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", color: "var(--text-3)",
          }}>
            <span>Producto</span>
            <span style={{ textAlign: "center" }}>Unidades</span>
            <span style={{ textAlign: "right" }}>Ingreso</span>
            <span style={{ textAlign: "right" }}>% del día</span>
          </div>

          {day.products.map((p, i) => {
            const pct = day.totalRevenueUsd > 0 ? (p.revenueUsd / day.totalRevenueUsd) * 100 : 0;
            return (
              <div
                key={i}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 80px 90px 100px",
                  padding: "9px 20px",
                  background: i % 2 === 0 ? "transparent" : "var(--bg-2)",
                  alignItems: "center",
                  borderLeft: `3px solid ${p.brandColor}`,
                  marginLeft: 4,
                }}
              >
                {/* Name + brand */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{p.name}</span>
                    {p.variant && (
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 6,
                        background: p.brandColor + "20", color: p.brandColor, fontWeight: 700,
                      }}>{p.variant}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>{p.brandName}</span>
                </div>

                {/* Units */}
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    display: "inline-block", fontSize: 13, fontWeight: 800,
                    width: 32, height: 32, lineHeight: "32px", borderRadius: "50%",
                    background: p.brandColor + "18", color: p.brandColor,
                  }}>{p.qty}</span>
                </div>

                {/* Revenue */}
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                    {fmtC(p.revenueUsd)}
                  </span>
                </div>

                {/* % bar */}
                <div style={{ paddingLeft: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: p.brandColor, borderRadius: 99, transition: "width 0.4s ease" }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", minWidth: 28, textAlign: "right" }}>
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {day.products.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              Sin datos de productos para este día
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function PedidosPage() {
  const { fmtC } = useCurrency();
  const [days,    setDays]    = useState(7);
  const [store,   setStore]   = useState("all");
  const [data,    setData]    = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/shopify/daily-products?days=${days}&store=${store}`)
      .then((r) => r.json())
      .then((d) => { setData(d.days ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [days, store]);

  useEffect(() => { load(); }, [load]);

  // Totals
  const totOrders  = data.reduce((s, d) => s + d.totalOrders, 0);
  const totRevenue = data.reduce((s, d) => s + d.totalRevenueUsd, 0);
  const allProducts = data.flatMap((d) => d.products);
  const topByQty = Object.values(
    allProducts.reduce<Record<string, { name: string; qty: number; brandColor: string }>>((acc, p) => {
      const k = p.name;
      if (!acc[k]) acc[k] = { name: p.name, qty: 0, brandColor: p.brandColor };
      acc[k].qty += p.qty;
      return acc;
    }, {})
  ).sort((a, b) => b.qty - a.qty).slice(0, 5);

  const STORE_OPTIONS = [
    { value: "all",      label: "Todas las tiendas", color: "#6366f1" },
    { value: "glowmmi",  label: "Glowmmi",           color: "#EC4899" },
    { value: "balancea", label: "Balancea",           color: "#10B981" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* ── Header ───────────────────────────────────────── */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid var(--border)",
            }}>
              <Package size={16} style={{ color: "var(--text-2)" }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Ventas por Producto</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Qué se vendió cada día, por producto y variante</p>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Store selector */}
            <div style={{ display: "flex", gap: 4, padding: "4px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
              {STORE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStore(s.value)}
                  style={{
                    padding: "5px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                    cursor: "pointer", border: "none", transition: "all 0.15s",
                    background: store === s.value ? s.color : "transparent",
                    color: store === s.value ? "#fff" : "var(--text-2)",
                  }}
                >{s.label}</button>
              ))}
            </div>

            {/* Days selector */}
            <div style={{ display: "flex", gap: 4, padding: "4px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
              {[1, 3, 7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  style={{
                    padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                    cursor: "pointer", border: "none", transition: "all 0.15s",
                    background: days === d ? "#0E766E" : "transparent",
                    color: days === d ? "#fff" : "var(--text-2)",
                  }}
                >{d === 1 ? "Hoy" : `${d}d`}</button>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={load}
              style={{
                width: 34, height: 34, borderRadius: 8, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: "var(--bg-2)", border: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={14} style={{ color: "var(--text-3)", animation: loading ? "spin 1s linear infinite" : "none" }} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── KPI row ──────────────────────────────────── */}
        {!loading && data.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {/* Total pedidos */}
            <div className="card" style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 6 }}>Pedidos</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{totOrders}</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>en {days} día{days !== 1 ? "s" : ""}</p>
            </div>
            {/* Total revenue */}
            <div className="card" style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 6 }}>Ingresos</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{fmtC(totRevenue)}</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{fmtC(totOrders > 0 ? totRevenue / totOrders : 0)} / pedido</p>
            </div>
            {/* Top product */}
            <div className="card" style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 6 }}>Más vendido</p>
              <p style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.3 }}>{topByQty[0]?.name ?? "—"}</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{topByQty[0]?.qty ?? 0} unidades</p>
            </div>
            {/* Top 5 bar */}
            <div className="card" style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 10 }}>Top 5 productos</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {topByQty.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.brandColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{p.qty}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Day cards ─────────────────────────────────── */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[...Array(days > 3 ? 3 : days)].map((_, i) => (
              <div key={i} className="card" style={{ height: 60, borderRadius: 16, opacity: 0.5, animation: "pulse 1.5s ease-in-out infinite" }} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="card" style={{ padding: "48px", textAlign: "center" }}>
            <Package size={32} style={{ color: "var(--text-3)", margin: "0 auto 12px" }} />
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Sin pedidos en este período</p>
            <p style={{ fontSize: 13, color: "var(--text-3)" }}>Prueba un rango de fechas más amplio</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.map((day, i) => (
              <DayCard key={day.date} day={day} fmtC={fmtC} defaultOpen={i < 2} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
