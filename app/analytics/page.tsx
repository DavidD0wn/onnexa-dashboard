"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { localDateStr, daysAgoLocal } from "@/lib/utils";
import {
  RefreshCw, ChevronUp, ChevronDown, Edit2, Check, X as XIcon,
  TrendingUp, Package, DollarSign, ShoppingCart, AlertCircle,
  Globe, Store as StoreIcon, LayoutGrid, Calendar, ChevronLeft, ChevronRight,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────── */
type ProductRow = {
  name: string; variant: string;
  brandId: string; brandName: string; brandColor: string;
  storeKey: string; storeName: string;
  countryCode: string; countryName: string;
  revenueUsd: number; revenueLocal: number;
  units: number; orders: number; lastSeen: string;
  costPerUnit: number; cogsUsd: number; adSpendUsd: number; totalCost: number;
  aov: number; cpaBE: number | null;
  grossProfit: number; grossMargin: number;
  netProfit: number; netMargin: number;
  roas: number | null; cpa: number | null;
  cpaAds: number | null; roasAds: number | null;
  campaignPurchases: number; campaignConversionValue: number;
  status: string; dataQuality: string;
  sessions: number | null; addToCart: number | null; reachedCheckout: number | null;
  addToCartRate: number | null; conversionRate: number | null;
};

type Totals = {
  revenueUsd: number; units: number; orders: number; uniqueOrders?: number;
  cogsUsd: number; adSpendUsd: number; totalCost: number;
  grossProfit: number; grossMargin: number;
  netProfit: number; netMargin: number; roas: number | null;
};

// Aggregated row for General view (collapses countries)
type GeneralRow = Omit<ProductRow, "countryCode" | "countryName" | "storeKey" | "storeName" | "revenueLocal"> & {
  countries: string[]; stores: string[];
};

// Aggregated row for By Store view
type StoreRow = {
  storeKey: string; storeName: string; countryCode: string; countryName: string;
  brandName: string; brandColor: string;
  revenueUsd: number; orders: number; units: number;
  cogsUsd: number; adSpendUsd: number; totalCost: number;
  grossProfit: number; netProfit: number; netMargin: number;
  roas: number | null; cpa: number | null;
  productCount: number; topProduct: string;
};

type ViewMode = "bycountry" | "general" | "bystore";
type SortKey  = keyof ProductRow;

/* ─── Helpers ────────────────────────────────────── */
const usd  = (n: number, dec = 2) =>
  n < 0
    ? `(${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })})`
    : n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const pct  = (n: number) => `${n.toFixed(1)}%`;
const profColor = (n: number) => n >= 0 ? "#10B981" : "#EF4444";

const FLAG: Record<string, string> = { MX: "🇲🇽", US: "🇺🇸", CL: "🇨🇱" };
const COUNTRY_NAME: Record<string, string> = { MX: "México", US: "EE.UU.", CL: "Chile" };

/* ─── Status config ──────────────────────────────── */
const STATUS_CFG: Record<string, { color: string; bg: string }> = {
  "Escalable":          { color: "#10B981", bg: "rgba(16,185,129,0.15)" },
  "Rentable":           { color: "#6EE7B7", bg: "rgba(110,231,183,0.12)" },
  "Rentable justo":     { color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  "No rentable":        { color: "#EF4444", bg: "rgba(239,68,68,0.15)"  },
  "Sin pauta":          { color: "#6366F1", bg: "rgba(99,102,241,0.12)" },
  "Datos incompletos":  { color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.07)" },
};

const DQ_CFG: Record<string, { color: string }> = {
  "OK":                   { color: "#10B981" },
  "Falta COGS":           { color: "#F59E0B" },
  "Sin pauta registrada": { color: "#6366F1" },
};

/* ─── Product type classifier ────────────────────── */
type ProductType = "físico" | "digital" | "upsell" | "otro";
function classifyProduct(name: string, costPerUnit: number): ProductType {
  const n = name.toLowerCase();
  if (n.includes("upsell") || n.includes("order bump") || n.includes("potenciador") || n.includes("add-on")) return "upsell";
  if (n.includes("guía") || n.includes("guia") || n.includes("ebook") || n.includes("e-book") || n.includes("digital") || n.includes("pdf") || n.includes("protocolo") || n.includes("agenda") || n.includes("tracker") || n.includes("recetas") || n.includes("alimentos") || n.includes("lifting desde") || n.includes("glow desde") || n.includes("curva 360") || n.includes("plan de gym") || n.includes("plan ") || n.includes("rutina anti") || n.includes("poros bajo") || n.includes("poros abiertos") || n.includes("equilibrio íntimo") || n.includes("equilibrio intimo") || n.includes("infecciones") || n.includes("hormonas")) return "digital";
  if (costPerUnit > 0) return "físico";
  return "otro";
}
const TYPE_CFG: Record<ProductType, { label: string; color: string; bg: string; emoji: string }> = {
  físico:  { label: "Físico",   color: "#10B981", bg: "rgba(16,185,129,0.15)", emoji: "📦" },
  digital: { label: "Digital",  color: "#6366F1", bg: "rgba(99,102,241,0.15)", emoji: "📱" },
  upsell:  { label: "Upsell",   color: "#F59E0B", bg: "rgba(245,158,11,0.15)", emoji: "⚡" },
  otro:    { label: "Sin tipo", color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.06)", emoji: "•" },
};

/* ─── Column definitions per view ───────────────── */
type ColDef = { key: string; label: string; width: number; right?: boolean; sticky?: boolean; always?: boolean; tooltip?: string };

const ALL_COLS_COUNTRY: ColDef[] = [
  { key: "name",              label: "Producto",     width: 250, sticky: true, always: true },
  { key: "countryCode",       label: "País",         width: 110, always: true },
  { key: "storeName",         label: "Tienda",       width: 155 },
  { key: "revenueUsd",        label: "Revenue USD",  width: 125, right: true },
  { key: "totalCost",         label: "Gasto Total",  width: 120, right: true, tooltip: "COGS + Ad Spend — costo total por producto" },
  { key: "units",             label: "Unidades",     width: 95,  right: true },
  { key: "orders",            label: "Pedidos",      width: 90,  right: true },
  { key: "aov",               label: "AOV",          width: 90,  right: true },
  { key: "cogsUsd",           label: "COGS Total",   width: 115, right: true },
  { key: "adSpendUsd",        label: "Ad Spend",     width: 115, right: true },
  { key: "cpa",               label: "CPA Real",     width: 95,  right: true, tooltip: "Gasto total en ads ÷ pedidos reales en Shopify" },
  { key: "cpaAds",            label: "CPA Ads",      width: 95,  right: true, tooltip: "Gasto en ads ÷ compras atribuidas por Meta Ads" },
  { key: "cpaBE",             label: "CPA BE",       width: 95,  right: true, tooltip: "CPA máximo para no perder dinero (Break Even)" },
  { key: "roasAds",           label: "ROAS Ads",     width: 90,  right: true, tooltip: "Revenue atribuido por Meta ÷ Ad Spend (atribución Meta)" },
  { key: "roas",              label: "ROAS Blend.",  width: 90,  right: true, tooltip: "Revenue real en Shopify ÷ Ad Spend (Blended ROAS)" },
  { key: "grossProfit",       label: "Ut. Bruta",    width: 115, right: true },
  { key: "grossMargin",       label: "Mg. Bruto",    width: 100, right: true },
  { key: "netProfit",         label: "Ut. Neta",     width: 115, right: true },
  { key: "netMargin",         label: "Mg. Neto",     width: 100, right: true },
  { key: "status",            label: "Estado",       width: 140 },
  { key: "dataQuality",       label: "DQ",           width: 130 },
  { key: "sessions",          label: "Visitas",      width: 90,  right: true },
  { key: "addToCart",         label: "Al Carrito",   width: 95,  right: true },
  { key: "addToCartRate",     label: "Tasa AC",      width: 90,  right: true },
  { key: "conversionRate",    label: "Tasa Conv.",   width: 95,  right: true },
];

const COLS_GENERAL = [
  { key: "name",        label: "Producto",      width: 260, sticky: true },
  { key: "countries",   label: "Países",        width: 100 },
  { key: "revenueUsd",  label: "Revenue USD",   width: 125, right: true },
  { key: "units",       label: "Unidades",      width: 95,  right: true },
  { key: "orders",      label: "Pedidos",       width: 90,  right: true },
  { key: "cogsUsd",     label: "COGS Total",    width: 115, right: true },
  { key: "adSpendUsd",  label: "Ad Spend",      width: 115, right: true },
  { key: "grossProfit", label: "Ut. Bruta",     width: 115, right: true },
  { key: "grossMargin", label: "Mg. Bruto",     width: 100, right: true },
  { key: "netProfit",   label: "Ut. Neta",      width: 115, right: true },
  { key: "netMargin",   label: "Mg. Neto",      width: 100, right: true },
  { key: "cpa",         label: "CPA",           width: 90,  right: true },
  { key: "roas",        label: "ROAS",          width: 85,  right: true },
  { key: "status",      label: "Estado",        width: 140 },
] as const;

const COLS_STORE = [
  { key: "storeName",   label: "Tienda",        width: 190, sticky: true },
  { key: "countryCode", label: "País",          width: 110 },
  { key: "revenueUsd",  label: "Revenue USD",   width: 125, right: true },
  { key: "orders",      label: "Pedidos",       width: 90,  right: true },
  { key: "units",       label: "Unidades",      width: 90,  right: true },
  { key: "adSpendUsd",  label: "Ad Spend",      width: 115, right: true },
  { key: "cogsUsd",     label: "COGS",          width: 110, right: true },
  { key: "grossProfit", label: "Ut. Bruta",     width: 115, right: true },
  { key: "netProfit",   label: "Ut. Neta",      width: 115, right: true },
  { key: "netMargin",   label: "Mg. Neto",      width: 100, right: true },
  { key: "roas",        label: "ROAS",          width: 85,  right: true },
  { key: "cpa",         label: "CPA",           width: 90,  right: true },
  { key: "productCount",label: "Productos",     width: 90,  right: true },
  { key: "topProduct",  label: "Producto top",  width: 200 },
] as const;

/* ─── KPI Card ───────────────────────────────────── */
function KPI({ label, value, sub, icon: Icon, accent }:
  { label: string; value: string; sub?: string; icon: any; accent: string }) {
  return (
    <div style={{
      background: "var(--card-bg, #1e293b)",
      border: "1px solid var(--border, rgba(255,255,255,0.08))",
      borderRadius: 14, padding: "16px 20px", minWidth: 160, flex: 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${accent}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} color={accent} />
        </div>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ─── Edit COGS cell ──────────────────────────────── */
function CostCell({ name, costPerUnit, onSave }: { name: string; costPerUnit: number; onSave: (name: string, v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(costPerUnit));
  useEffect(() => { setVal(String(costPerUnit)); }, [costPerUnit]);
  if (!editing) return (
    <div onClick={() => setEditing(true)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", justifyContent: "flex-end" }} title="Click para editar COGS">
      <span style={{ color: costPerUnit > 0 ? "#f59e0b" : "rgba(255,255,255,0.35)" }}>
        {costPerUnit > 0 ? `$${costPerUnit.toFixed(2)}` : "—"}
      </span>
      <Edit2 size={10} color="rgba(255,255,255,0.3)" />
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
      <input autoFocus type="number" value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(name, parseFloat(val) || 0); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
        style={{ width: 72, padding: "2px 6px", borderRadius: 6, border: "1px solid #0E766E", background: "#0a2540", color: "#fff", fontSize: 12, textAlign: "right" }}
      />
      <button onClick={() => { onSave(name, parseFloat(val) || 0); setEditing(false); }} style={{ background: "#0E766E", border: "none", borderRadius: 5, cursor: "pointer", padding: "3px 5px", display: "flex" }}><Check size={11} color="#fff" /></button>
      <button onClick={() => setEditing(false)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 5, cursor: "pointer", padding: "3px 5px", display: "flex" }}><XIcon size={11} color="rgba(255,255,255,0.5)" /></button>
    </div>
  );
}

/* ─── Date Range Picker ──────────────────────────── */
const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const DAY_NAMES   = ["Lu","Ma","Mi","Ju","Vi","Sa","Do"];

function DateRangePicker({
  from, to, onApply, onClear,
}: { from: string; to: string; onApply: (f: string, t: string) => void; onClear: () => void }) {
  const [localFrom,  setLocalFrom]  = useState(from);
  const [localTo,    setLocalTo]    = useState(to);
  const [viewYear,   setViewYear]   = useState(() => (from ? new Date(from).getFullYear() : new Date().getFullYear()));
  const [viewMonth,  setViewMonth]  = useState(() => (from ? new Date(from).getMonth()    : new Date().getMonth()));
  const [selecting,  setSelecting]  = useState<"from" | "to">("from");

  // Build calendar grid for the viewed month
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow    = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Mon=0
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const pad    = (n: number) => String(n).padStart(2, "0");
  const toIso  = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const today  = localDateStr();

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const handleDay = (d: number) => {
    const iso = toIso(viewYear, viewMonth, d);
    if (selecting === "from") {
      setLocalFrom(iso);
      setLocalTo("");
      setSelecting("to");
    } else {
      if (iso < localFrom) {
        setLocalTo(localFrom);
        setLocalFrom(iso);
      } else {
        setLocalTo(iso);
      }
      setSelecting("from");
    }
  };

  const inRange = (d: number) => {
    const iso = toIso(viewYear, viewMonth, d);
    return localFrom && localTo && iso >= localFrom && iso <= localTo;
  };
  const isFrom  = (d: number) => toIso(viewYear, viewMonth, d) === localFrom;
  const isTo    = (d: number) => toIso(viewYear, viewMonth, d) === localTo;
  const isFutu  = (d: number) => toIso(viewYear, viewMonth, d) > today;

  const fmtDate = (iso: string) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-");
    return `${parseInt(d)} ${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
  };

  return (
    <div style={{
      background: "rgba(15,23,42,0.98)", border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 14, padding: 16, minWidth: 280, boxShadow: "0 16px 40px rgba(0,0,0,.6)",
      userSelect: "none",
    }}>
      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", padding: 4, borderRadius: 6, display: "flex" }}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", padding: 4, borderRadius: 6, display: "flex" }}>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {DAY_NAMES.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, padding: "3px 0" }}>{d}</div>)}
      </div>

      {/* Days grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, idx) => {
          if (!d) return <div key={`e-${idx}`} />;
          const from_ = isFrom(d);
          const to_   = isTo(d);
          const range = inRange(d) && !from_ && !to_;
          const future = isFutu(d);
          return (
            <button
              key={d}
              onClick={() => !future && handleDay(d)}
              style={{
                padding: "6px 2px", textAlign: "center", fontSize: 12,
                border: "none", cursor: future ? "default" : "pointer",
                background: from_ || to_ ? "#0E766E" : range ? "rgba(14,118,110,0.3)" : "transparent",
                color: future ? "rgba(255,255,255,0.2)" : from_ || to_ ? "#fff" : range ? "#a7f3d0" : "rgba(255,255,255,0.75)",
                fontWeight: from_ || to_ ? 700 : 400,
                borderRadius: from_ ? "6px 0 0 6px" : to_ ? "0 6px 6px 0" : range ? "0" : "6px",
              }}
            >
              {d}
            </button>
          );
        })}
      </div>

      {/* Selected range display */}
      <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", fontSize: 11 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>Desde</div>
            <div style={{ color: localFrom ? "#10B981" : "rgba(255,255,255,0.3)", fontWeight: 600 }}>{fmtDate(localFrom)}</div>
          </div>
          <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 16, alignSelf: "center" }}>→</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>Hasta</div>
            <div style={{ color: localTo ? "#10B981" : "rgba(255,255,255,0.3)", fontWeight: 600 }}>{fmtDate(localTo)}</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 6, textAlign: "center" }}>
          {selecting === "from" ? "Haz click en el día de inicio" : "Ahora elige el día final"}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={onClear} style={{ flex: 1, padding: "7px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 12 }}>Limpiar</button>
        <button
          onClick={() => localFrom && localTo && onApply(localFrom, localTo)}
          disabled={!localFrom || !localTo}
          style={{ flex: 2, padding: "7px", borderRadius: 8, border: "none", background: localFrom && localTo ? "#0E766E" : "rgba(255,255,255,0.08)", color: localFrom && localTo ? "#fff" : "rgba(255,255,255,0.3)", cursor: localFrom && localTo ? "pointer" : "default", fontSize: 12, fontWeight: 700 }}
        >
          Aplicar rango
        </button>
      </div>
    </div>
  );
}

/* ─── Customize Columns Modal ───────────────────── */
function CustomizeColsModal({
  allCols, colOrder, hiddenColKeys, onApply, onClose,
}: {
  allCols: ColDef[];
  colOrder: string[];
  hiddenColKeys: Set<string>;
  onApply: (order: string[], hidden: Set<string>) => void;
  onClose: () => void;
}) {
  const [localOrder,  setLocalOrder]  = useState<string[]>(() => {
    const seen    = new Set(colOrder);
    const newCols = allCols.map(c => c.key).filter(k => !seen.has(k));
    return [...colOrder.filter(k => allCols.some(c => c.key === k)), ...newCols];
  });
  const [localHidden, setLocalHidden] = useState<Set<string>>(new Set(hiddenColKeys));
  const [search,      setSearch]      = useState("");
  const [draggedKey,  setDraggedKey]  = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const toggle = (key: string) => {
    if (allCols.find(c => c.key === key)?.always) return;
    setLocalHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const removeCol = (key: string) => {
    if (allCols.find(c => c.key === key)?.always) return;
    setLocalHidden(prev => new Set([...prev, key]));
  };

  const handleDragStart = (e: React.DragEvent, key: string) => {
    e.dataTransfer.setData("text/plain", key);
    e.dataTransfer.effectAllowed = "move";
    setDraggedKey(key);
  };
  const handleDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverKey(key);
  };
  const handleDrop = (e: React.DragEvent, toKey: string) => {
    e.preventDefault();
    const fromKey = e.dataTransfer.getData("text/plain");
    if (!fromKey || fromKey === toKey) return;
    setLocalOrder(prev => {
      const from = prev.indexOf(fromKey);
      const to   = prev.indexOf(toKey);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, fromKey);
      return next;
    });
    setDraggedKey(null);
    setDragOverKey(null);
  };
  const handleDragEnd = () => { setDraggedKey(null); setDragOverKey(null); };

  const visibleCount  = localOrder.filter(k => !localHidden.has(k)).length;
  const filteredLeft  = allCols.filter(c =>
    !search || c.label.toLowerCase().includes(search.toLowerCase())
  );
  const allNonAlways  = allCols.filter(c => !c.always).map(c => c.key);
  const allChecked    = allNonAlways.every(k => !localHidden.has(k));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 16, width: 700, maxWidth: "96vw", height: 560, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 28px 70px rgba(0,0,0,0.8)" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fff" }}>Personalizar</h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 8, cursor: "pointer", padding: "5px 9px", color: "rgba(255,255,255,0.55)", fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>

        {/* Two-panel body */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

          {/* LEFT — all columns with checkboxes */}
          <div style={{ width: 255, borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
            {/* Search */}
            <div style={{ padding: "10px 12px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>🔍</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar una métrica"
                  style={{ background: "none", border: "none", outline: "none", color: "#fff", fontSize: 12, flex: 1, minWidth: 0 }} />
              </div>
            </div>
            {/* Column list */}
            <div style={{ overflowY: "auto", flex: 1, padding: "0 8px 8px" }}>
              {/* Select-all row */}
              {!search && (
                <button onClick={() => setLocalHidden(allChecked ? new Set(allNonAlways) : new Set<string>())}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", borderRadius: 6, background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ width: 15, height: 15, borderRadius: 4, border: "1.5px solid rgba(255,255,255,0.3)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {allChecked && <span style={{ color: "#0E766E", fontSize: 10, fontWeight: 700 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 600 }}>Seleccionar todo</span>
                </button>
              )}
              {filteredLeft.map(col => {
                const checked = !localHidden.has(col.key);
                return (
                  <button key={col.key} onClick={() => toggle(col.key)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", borderRadius: 6, background: checked ? "rgba(14,118,110,0.1)" : "transparent", border: "none", cursor: col.always ? "default" : "pointer", textAlign: "left" }}>
                    <div style={{ width: 15, height: 15, borderRadius: 4, background: checked ? "#0E766E" : "rgba(255,255,255,0.07)", border: `1.5px solid ${checked ? "#0E766E" : "rgba(255,255,255,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 12, color: checked ? "#fff" : "rgba(255,255,255,0.4)", fontWeight: checked ? 500 : 400 }}>{col.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT — selected columns in order, draggable */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px 6px", flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
                Métricas seleccionadas ({visibleCount}/{allCols.length})
              </p>
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "0 12px 8px" }}>
              {localOrder.filter(k => !localHidden.has(k)).map(key => {
                const col = allCols.find(c => c.key === key);
                if (!col) return null;
                const isDragging = draggedKey  === key;
                const isDragOver = dragOverKey === key;
                return (
                  <div key={key}
                    draggable={!col.always}
                    onDragStart={e => handleDragStart(e, key)}
                    onDragOver={e  => handleDragOver(e, key)}
                    onDrop={e      => handleDrop(e, key)}
                    onDragEnd={handleDragEnd}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, marginBottom: 3,
                      background: isDragOver ? "rgba(14,118,110,0.2)" : "rgba(255,255,255,0.05)",
                      border: `1.5px solid ${isDragOver ? "#0E766E" : "rgba(255,255,255,0.08)"}`,
                      opacity: isDragging ? 0.35 : 1,
                      cursor: col.always ? "default" : "grab",
                      transition: "border-color 0.1s, background 0.1s",
                    }}>
                    <span style={{ color: col.always ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.3)", fontSize: 15, userSelect: "none", flexShrink: 0, lineHeight: 1 }}>⠿</span>
                    <span style={{ flex: 1, fontSize: 13, color: "#fff", fontWeight: 500 }}>{col.label}</span>
                    {!col.always && (
                      <button onClick={() => removeCol(key)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.25)", padding: "2px 5px", borderRadius: 4, fontSize: 13, lineHeight: 1, flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <button onClick={() => { setLocalOrder(allCols.map(c => c.key)); setLocalHidden(new Set<string>()); }}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 12 }}>
            Restablecer
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: 13 }}>
              Cancelar
            </button>
            <button onClick={() => onApply(localOrder, localHidden)} style={{ padding: "8px 24px", borderRadius: 8, border: "none", background: "#0E766E", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────── */
export default function ProductAnalyticsPage() {
  const [rows,          setRows]          = useState<ProductRow[]>([]);
  const [totals,        setTotals]        = useState<Totals | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");
  const [days,          setDays]          = useState(7);
  const [customFrom,    setCustomFrom]    = useState("");
  const [customTo,      setCustomTo]      = useState("");
  const [showCalendar,  setShowCalendar]  = useState(false);
  const [store,         setStore]         = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [viewMode,      setViewMode]      = useState<ViewMode>("bycountry");
  const [sortKey,       setSortKey]       = useState<SortKey>("revenueUsd");
  const [sortAsc,       setSortAsc]       = useState(false);
  const [search,        setSearch]        = useState("");
  const [typeFilter,    setTypeFilter]    = useState<"total" | "físico" | "digital">("total");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [costs,         setCosts]         = useState<Record<string, number>>({});
  const [showCustomize, setShowCustomize] = useState(false);
  const [colOrder,      setColOrder]      = useState<string[]>(ALL_COLS_COUNTRY.map(c => c.key));
  const [hiddenColKeys, setHiddenColKeys] = useState<Set<string>>(new Set<string>());

  const tableWrapRef   = useRef<HTMLDivElement>(null);
  const topScrollRef   = useRef<HTMLDivElement>(null);
  const [tableMinW,    setTableMinW]   = useState(0);

  const syncScrollFromTop    = () => { if (tableWrapRef.current && topScrollRef.current) tableWrapRef.current.scrollLeft = topScrollRef.current.scrollLeft; };
  const syncScrollFromBottom = () => { if (tableWrapRef.current && topScrollRef.current) topScrollRef.current.scrollLeft  = tableWrapRef.current.scrollLeft;  };

  const calendarRef   = useRef<HTMLDivElement>(null);
  const calendarBtnRef = useRef<HTMLButtonElement>(null);
  const [calendarPos, setCalendarPos] = useState({ top: 0, left: 0 });
  const isCustomRange = !!(customFrom && customTo);

  // Open calendar: compute fixed position from the button
  const openCalendar = () => {
    if (calendarBtnRef.current) {
      const rect = calendarBtnRef.current.getBoundingClientRect();
      setCalendarPos({ top: rect.bottom + 8, left: Math.max(8, rect.right - 288) });
    }
    setShowCalendar(true);
  };

  // Close calendar on outside click
  useEffect(() => {
    if (!showCalendar) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inCalendar = calendarRef.current?.contains(target);
      const inBtn      = calendarBtnRef.current?.contains(target);
      if (!inCalendar && !inBtn) setShowCalendar(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCalendar]);

  // Load column config from localStorage on mount
  useEffect(() => {
    const savedOrder  = localStorage.getItem("analytics_col_order");
    const savedHidden = localStorage.getItem("analytics_col_hidden");
    const allKeys     = ALL_COLS_COUNTRY.map(c => c.key);
    if (savedOrder) {
      try {
        const parsed: string[] = JSON.parse(savedOrder);
        // Merge: keep saved order but append any new columns not yet saved
        const seen    = new Set(parsed);
        const valid   = parsed.filter(k => allKeys.includes(k));
        const newCols = allKeys.filter(k => !seen.has(k));
        setColOrder([...valid, ...newCols]);
      } catch {}
    }
    if (savedHidden) {
      try { setHiddenColKeys(new Set(JSON.parse(savedHidden))); } catch {}
    }
  }, []);

  const saveColConfig = (order: string[], hidden: Set<string>) => {
    localStorage.setItem("analytics_col_order",  JSON.stringify(order));
    localStorage.setItem("analytics_col_hidden", JSON.stringify([...hidden]));
  };

  const DAYS_OPTS = [
    { label: "Hoy", v: 1 }, { label: "7d", v: 7 }, { label: "14d", v: 14 },
    { label: "30d", v: 30 }, { label: "90d", v: 90 },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ store, country: countryFilter });
      if (isCustomRange) {
        params.set("from", customFrom);
        params.set("to",   customTo);
      } else {
        params.set("days", String(days));
      }
      const res  = await fetch(`/api/products/analytics?${params}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotals(data.totals ?? null);
      const c: Record<string, number> = {};
      (data.rows ?? []).forEach((r: ProductRow) => { if (r.costPerUnit > 0) c[r.name] = r.costPerUnit; });
      setCosts(c);
    } catch {
      setError("Error cargando datos");
    }
    setLoading(false);
  }, [days, store, countryFilter, customFrom, customTo, isCustomRange]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const handleSaveCost = async (name: string, v: number) => {
    setCosts(prev => ({ ...prev, [name]: v }));
    await fetch("/api/products/costs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, costPerUnit: v }),
    });
    load();
  };

  // ── Filtered base rows ──
  const filteredRows = useMemo(() => {
    let r = rows;
    if (typeFilter !== "total") r = r.filter(x => classifyProduct(x.name, x.costPerUnit) === typeFilter);
    if (search) r = r.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || x.brandName.toLowerCase().includes(search.toLowerCase()));
    if (statusFilter !== "all") r = r.filter(x => x.status === statusFilter);
    return r;
  }, [rows, typeFilter, search, statusFilter]);

  // ── General view: aggregate by product (collapse countries) ──
  const generalRows = useMemo((): (GeneralRow & { countries: string[]; stores: string[] })[] => {
    const groups: Record<string, GeneralRow & { countries: string[]; stores: string[]; _sumData: boolean }> = {};
    for (const r of filteredRows) {
      const gkey = `${r.name}||${r.variant}||${r.brandId}`;
      if (!groups[gkey]) {
        groups[gkey] = {
          name: r.name, variant: r.variant,
          brandId: r.brandId, brandName: r.brandName, brandColor: r.brandColor,
          revenueUsd: 0, units: 0, orders: 0, lastSeen: r.lastSeen,
          costPerUnit: 0, cogsUsd: 0, adSpendUsd: 0, totalCost: 0,
          aov: 0, cpaBE: null,
          grossProfit: 0, grossMargin: 0, netProfit: 0, netMargin: 0,
          roas: null, cpa: null, cpaAds: null, roasAds: null, campaignPurchases: 0, campaignConversionValue: 0,
          status: r.status, dataQuality: r.dataQuality,
          sessions: null, addToCart: null, reachedCheckout: null, addToCartRate: null, conversionRate: null,
          countries: [], stores: [], _sumData: true,
        };
      }
      const g = groups[gkey];
      g.revenueUsd            += r.revenueUsd;
      g.units                 += r.units;
      g.orders                += r.orders;
      g.cogsUsd               += r.cogsUsd;
      g.adSpendUsd            += r.adSpendUsd;
      g.totalCost             += r.totalCost;        // sum API-calculated totalCost
      g.grossProfit           += r.grossProfit;      // sum API-calculated grossProfit
      g.netProfit             += r.netProfit;        // sum API-calculated netProfit (incl fees+shipping)
      g.campaignPurchases     += r.campaignPurchases;
      g.campaignConversionValue += r.campaignConversionValue;
      if (r.lastSeen > g.lastSeen) g.lastSeen = r.lastSeen;
      if (!g.countries.includes(r.countryCode)) g.countries.push(r.countryCode);
      if (!g.stores.includes(r.storeName)) g.stores.push(r.storeName);
    }
    return Object.values(groups).map(g => {
      // Use accumulated API values directly — don't re-derive (they include fees+shipping)
      const { grossProfit, netProfit, totalCost } = g;
      const grossMargin = g.revenueUsd > 0 ? (grossProfit / g.revenueUsd) * 100 : 0;
      const netMargin   = g.revenueUsd > 0 ? (netProfit  / g.revenueUsd) * 100 : 0;
      const roas        = g.adSpendUsd > 0 ? g.revenueUsd / g.adSpendUsd : null;
      const cpa         = g.adSpendUsd > 0 && g.orders > 0 ? g.adSpendUsd / g.orders : null;
      const cpaAds      = g.adSpendUsd > 0 && g.campaignPurchases > 0 ? g.adSpendUsd / g.campaignPurchases : null;
      const roasAds     = g.adSpendUsd > 0 && g.campaignConversionValue > 0 ? g.campaignConversionValue / g.adSpendUsd : null;
      const costPerUnit = g.units > 0 ? g.cogsUsd / g.units : 0;
      const aov         = g.orders > 0 ? g.revenueUsd / g.orders : 0;
      const status = g.cogsUsd === 0 ? "Datos incompletos"
        : g.adSpendUsd === 0 ? "Sin pauta"
        : netMargin >= 25 && netProfit > 0 ? "Escalable"
        : netProfit > 0 ? "Rentable"
        : netMargin > -10 ? "Rentable justo"
        : "No rentable";
      return { ...g, grossProfit, grossMargin, netProfit, netMargin, roas, cpa, cpaAds, roasAds, totalCost, costPerUnit, aov };
    }).sort((a, b) => b.revenueUsd - a.revenueUsd);
  }, [filteredRows]);

  // ── By Store view: aggregate by storeName ──
  const storeRows = useMemo((): StoreRow[] => {
    const groups: Record<string, StoreRow & { _products: ProductRow[] }> = {};
    for (const r of filteredRows) {
      if (!groups[r.storeKey]) {
        groups[r.storeKey] = {
          storeKey: r.storeKey, storeName: r.storeName,
          countryCode: r.countryCode, countryName: r.countryName,
          brandName: r.brandName, brandColor: r.brandColor,
          revenueUsd: 0, orders: 0, units: 0,
          cogsUsd: 0, adSpendUsd: 0, totalCost: 0,
          grossProfit: 0, netProfit: 0, netMargin: 0,
          roas: null, cpa: null, productCount: 0, topProduct: "—",
          _products: [],
        };
      }
      const g = groups[r.storeKey];
      g.revenueUsd  += r.revenueUsd;
      g.orders      += r.orders;
      g.units       += r.units;
      g.cogsUsd     += r.cogsUsd;
      g.adSpendUsd  += r.adSpendUsd;
      g._products.push(r);
    }
    return Object.values(groups).map(g => {
      // Sum grossProfit and netProfit from individual rows (includes fees+shipping from API)
      const grossProfit = g._products.reduce((s, p) => s + p.grossProfit, 0);
      const netProfit   = g._products.reduce((s, p) => s + p.netProfit,   0);
      const totalCost   = g._products.reduce((s, p) => s + p.totalCost,   0);
      const netMargin   = g.revenueUsd > 0 ? (netProfit / g.revenueUsd) * 100 : 0;
      const roas        = g.adSpendUsd > 0 ? g.revenueUsd / g.adSpendUsd : null;
      const cpa         = g.adSpendUsd > 0 && g.orders > 0 ? g.adSpendUsd / g.orders : null;
      const sorted      = [...g._products].sort((a, b) => b.netProfit - a.netProfit);
      const topProduct  = sorted[0]?.name ?? "—";
      const productCount = new Set(g._products.map(p => p.name)).size;
      return { ...g, grossProfit, netProfit, netMargin, roas, cpa, totalCost, topProduct, productCount };
    }).sort((a, b) => b.revenueUsd - a.revenueUsd);
  }, [filteredRows]);

  // ── By Country sorted rows ──
  const countryRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string") return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filteredRows, sortKey, sortAsc]);

  const cogsConfigured = rows.some(r => r.costPerUnit > 0);

  // ── Totals row ───────────────────────────────────
  type DisplayTotals = {
    count: number; revenueUsd: number; units: number; orders: number;
    cogsUsd: number; adSpendUsd: number; grossProfit: number; netProfit: number;
    campaignPurchases: number; campaignConversionValue: number;
    sessions: number; addToCart: number;
    aov: number; grossMargin: number; netMargin: number;
    roas: number | null; cpa: number | null;
    cpaAds: number | null; roasAds: number | null; addToCartRate: number | null;
  };

  const computeTotals = (src: Array<{
    revenueUsd: number; units: number; orders: number; cogsUsd: number; adSpendUsd: number;
    grossProfit: number; netProfit: number;
    campaignPurchases?: number; campaignConversionValue?: number;
    sessions?: number | null; addToCart?: number | null;
  }>): DisplayTotals | null => {
    if (src.length === 0) return null;
    type Acc = { revenueUsd: number; units: number; orders: number; cogsUsd: number; adSpendUsd: number; grossProfit: number; netProfit: number; campaignPurchases: number; campaignConversionValue: number; sessions: number; addToCart: number; count: number };
    const t = src.reduce((a: Acc, r): Acc => ({
      revenueUsd:              a.revenueUsd  + r.revenueUsd,
      units:                   a.units       + r.units,
      orders:                  a.orders      + r.orders,
      cogsUsd:                 a.cogsUsd     + r.cogsUsd,
      adSpendUsd:              a.adSpendUsd  + r.adSpendUsd,
      grossProfit:             a.grossProfit + r.grossProfit,
      netProfit:               a.netProfit   + r.netProfit,
      campaignPurchases:       a.campaignPurchases       + (r.campaignPurchases       ?? 0),
      campaignConversionValue: a.campaignConversionValue + (r.campaignConversionValue ?? 0),
      sessions:                a.sessions    + (r.sessions  ?? 0),
      addToCart:               a.addToCart   + (r.addToCart ?? 0),
      count:                   a.count + 1,
    }), { revenueUsd: 0, units: 0, orders: 0, cogsUsd: 0, adSpendUsd: 0, grossProfit: 0, netProfit: 0, campaignPurchases: 0, campaignConversionValue: 0, sessions: 0, addToCart: 0, count: 0 } as Acc);
    return {
      ...t,
      aov:          t.orders > 0 ? t.revenueUsd / t.orders : 0,
      grossMargin:  t.revenueUsd > 0 ? (t.grossProfit / t.revenueUsd) * 100 : 0,
      netMargin:    t.revenueUsd > 0 ? (t.netProfit   / t.revenueUsd) * 100 : 0,
      roas:         t.adSpendUsd > 0 ? t.revenueUsd / t.adSpendUsd : null,
      cpa:          t.adSpendUsd > 0 && t.orders > 0 ? t.adSpendUsd / t.orders : null,
      cpaAds:       t.adSpendUsd > 0 && t.campaignPurchases > 0 ? t.adSpendUsd / t.campaignPurchases : null,
      roasAds:      t.adSpendUsd > 0 && t.campaignConversionValue > 0 ? t.campaignConversionValue / t.adSpendUsd : null,
      addToCartRate:t.sessions > 0 && t.addToCart > 0 ? (t.addToCart / t.sessions) * 100 : null,
    };
  };

  const bycountryTotals = useMemo(() => computeTotals(countryRows), [countryRows]);
  const generalTotals   = useMemo(() => computeTotals(generalRows),  [generalRows]);
  const storeTotals     = useMemo(() => computeTotals(storeRows),     [storeRows]);

  /* ── Cell renderers ─────────────────────────────── */
  const renderProductCell = (r: { name: string; variant: string; brandName: string; brandColor: string; costPerUnit: number }) => {
    const pType = classifyProduct(r.name, r.costPerUnit);
    const tc    = TYPE_CFG[pType];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: r.brandColor, flexShrink: 0 }} />
          <span style={{ color: "#fff", fontWeight: 500, fontSize: 13 }}>{r.name}</span>
        </div>
        <div style={{ display: "flex", gap: 5, paddingLeft: 15, alignItems: "center" }}>
          {r.variant && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)" }}>{r.variant}</span>}
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{r.brandName}</span>
          {pType !== "otro" && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: tc.bg, color: tc.color, fontWeight: 600 }}>{tc.emoji} {tc.label}</span>}
        </div>
      </div>
    );
  };

  const renderCountryCell = (countryCode: string, countryName?: string) => (
    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap" }}>
      {FLAG[countryCode] ?? "🌍"} {countryName ?? COUNTRY_NAME[countryCode] ?? countryCode}
    </span>
  );

  const renderStoreCell = (storeName: string, brandColor: string) => (
    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: brandColor }} />
      {storeName}
    </span>
  );

  const renderStatus = (status: string) => {
    const cfg = STATUS_CFG[status] ?? { color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.07)" };
    return <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: cfg.bg, color: cfg.color, fontWeight: 600, whiteSpace: "nowrap" }}>{status}</span>;
  };

  const renderDQ = (dq: string) => {
    const cfg = DQ_CFG[dq] ?? { color: "rgba(255,255,255,0.4)" };
    return <span style={{ fontSize: 11, color: cfg.color, whiteSpace: "nowrap" }}>{dq}</span>;
  };

  /* ── Render cell for By Country view ── */
  const renderColCell = (colKey: string, r: ProductRow) => {
    switch (colKey) {
      case "name":        return renderProductCell(r);
      case "countryCode": return renderCountryCell(r.countryCode, r.countryName);
      case "storeName":   return renderStoreCell(r.storeName, r.brandColor);
      case "cogsUsd": {
        if (r.cogsUsd === 0) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        return <span style={{ color: "#f87171", fontWeight: 500 }}>(${usd(r.cogsUsd)})</span>;
      }
      case "grossProfit": case "netProfit": {
        const v = r[colKey as keyof ProductRow] as number;
        return <span style={{ color: profColor(v), fontWeight: 600 }}>{usd(v)}</span>;
      }
      case "grossMargin": case "netMargin": {
        const v = r[colKey as keyof ProductRow] as number;
        return <span style={{ color: profColor(v) }}>{pct(v)}</span>;
      }
      case "roas": {
        if (r.adSpendUsd === 0) return <span style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>Sin pauta</span>;
        const v = r.roas;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>N/A</span>;
        return <span style={{ color: v >= 2 ? "#10B981" : v >= 1 ? "#f59e0b" : "#EF4444", fontWeight: 600 }}>{v.toFixed(2)}x</span>;
      }
      case "cpa": {
        if (r.adSpendUsd === 0) return <span style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>Sin pauta</span>;
        const v = r.cpa;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>N/A</span>;
        return <span style={{ color: "rgba(255,255,255,0.75)" }}>${v.toFixed(2)}</span>;
      }
      case "cpaAds": {
        if (r.adSpendUsd === 0) return <span style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>Sin pauta</span>;
        const v = r.cpaAds;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.35)" }}>N/A</span>;
        return <span style={{ color: "rgba(255,255,255,0.75)" }}>${v.toFixed(2)}</span>;
      }
      case "roasAds": {
        if (r.adSpendUsd === 0) return <span style={{ fontSize: 11, color: "#6366F1", fontWeight: 600 }}>Sin pauta</span>;
        const v = r.roasAds;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.35)" }}>N/A</span>;
        return <span style={{ color: v >= 2 ? "#10B981" : v >= 1 ? "#f59e0b" : "#EF4444", fontWeight: 600 }}>{v.toFixed(2)}x</span>;
      }
      case "cpaBE": {
        const v = r.cpaBE;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        const ok = r.cpa == null || r.cpa <= v;
        return <span style={{ color: ok ? "#10B981" : "#EF4444" }}>${v.toFixed(2)}</span>;
      }
      case "adSpendUsd":
        return <span style={{ color: r.adSpendUsd > 0 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{r.adSpendUsd > 0 ? `$${usd(r.adSpendUsd)}` : "—"}</span>;
      case "totalCost": {
        const v = r.totalCost;
        if (v === 0) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        const pctOfRev = r.revenueUsd > 0 ? (v / r.revenueUsd) * 100 : 0;
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
            <span style={{ color: "#f87171", fontWeight: 600 }}>${usd(v)}</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{pctOfRev.toFixed(0)}% rev.</span>
          </div>
        );
      }
      case "revenueUsd":  return <span style={{ color: "#fff", fontWeight: 600 }}>${usd(r.revenueUsd)}</span>;
      case "aov":         return <span style={{ color: "rgba(255,255,255,0.7)" }}>{r.aov > 0 ? `$${usd(r.aov)}` : "—"}</span>;
      case "units":       case "orders": return <span style={{ color: "rgba(255,255,255,0.8)" }}>{(r[colKey as keyof ProductRow] as number).toLocaleString()}</span>;
      case "status":      return renderStatus(r.status);
      case "dataQuality": return renderDQ(r.dataQuality);
      case "sessions": {
        if (r.sessions == null) return <span style={{ color: "rgba(255,255,255,0.2)" }}>—</span>;
        return <span style={{ color: "rgba(255,255,255,0.75)" }}>{r.sessions.toLocaleString()}</span>;
      }
      case "addToCart": {
        if (r.addToCart == null) return <span style={{ color: "rgba(255,255,255,0.2)" }}>—</span>;
        return <span style={{ color: "rgba(255,255,255,0.75)" }}>{r.addToCart.toLocaleString()}</span>;
      }
      case "addToCartRate": {
        if (r.addToCartRate == null) return <span style={{ color: "rgba(255,255,255,0.2)" }}>—</span>;
        const atcColor = r.addToCartRate >= 10 ? "#10B981" : r.addToCartRate >= 5 ? "#f59e0b" : "#EF4444";
        return <span style={{ color: atcColor, fontWeight: 600 }}>{r.addToCartRate.toFixed(1)}%</span>;
      }
      case "conversionRate": {
        if (r.conversionRate == null) return <span style={{ color: "rgba(255,255,255,0.2)" }}>—</span>;
        const cvrColor = r.conversionRate >= 3 ? "#10B981" : r.conversionRate >= 1.5 ? "#f59e0b" : "#EF4444";
        return <span style={{ color: cvrColor, fontWeight: 600 }}>{r.conversionRate.toFixed(2)}%</span>;
      }
      default: return <span style={{ color: "rgba(255,255,255,0.6)" }}>{String((r as any)[colKey] ?? "—")}</span>;
    }
  };

  /* ── Render cell for General view ── */
  const renderGeneralCell = (colKey: string, r: GeneralRow & { countries: string[]; stores: string[] }) => {
    switch (colKey) {
      case "name":      return renderProductCell({ ...r, costPerUnit: r.costPerUnit });
      case "countries": return (
        <div style={{ display: "flex", gap: 3 }}>
          {r.countries.map(cc => <span key={cc} style={{ fontSize: 14 }}>{FLAG[cc] ?? cc}</span>)}
        </div>
      );
      case "cogsUsd": {
        if (r.cogsUsd === 0) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        return <span style={{ color: "#f87171", fontWeight: 500 }}>(${usd(r.cogsUsd)})</span>;
      }
      case "grossProfit": case "netProfit": {
        const v = (r as any)[colKey] as number;
        return <span style={{ color: profColor(v), fontWeight: 600 }}>{usd(v)}</span>;
      }
      case "grossMargin": case "netMargin": {
        const v = (r as any)[colKey] as number;
        return <span style={{ color: profColor(v) }}>{pct(v)}</span>;
      }
      case "roas": {
        const v = r.roas;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        return <span style={{ color: v >= 2 ? "#10B981" : v >= 1 ? "#f59e0b" : "#EF4444", fontWeight: 600 }}>{v.toFixed(2)}x</span>;
      }
      case "cpa": {
        const v = r.cpa;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        return <span style={{ color: "rgba(255,255,255,0.75)" }}>${v.toFixed(2)}</span>;
      }
      case "adSpendUsd":
        return <span style={{ color: r.adSpendUsd > 0 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{r.adSpendUsd > 0 ? `$${usd(r.adSpendUsd)}` : "—"}</span>;
      case "revenueUsd": return <span style={{ color: "#fff", fontWeight: 600 }}>${usd(r.revenueUsd)}</span>;
      case "units": case "orders": return <span style={{ color: "rgba(255,255,255,0.8)" }}>{((r as any)[colKey] as number).toLocaleString()}</span>;
      case "status":     return renderStatus(r.status);
      default: return <span style={{ color: "rgba(255,255,255,0.6)" }}>{String((r as any)[colKey] ?? "—")}</span>;
    }
  };

  /* ── Render cell for By Store view ── */
  const renderStoreRowCell = (colKey: string, r: StoreRow) => {
    switch (colKey) {
      case "storeName":   return renderStoreCell(r.storeName, r.brandColor);
      case "countryCode": return renderCountryCell(r.countryCode, r.countryName);
      case "revenueUsd":  return <span style={{ color: "#fff", fontWeight: 600 }}>${usd(r.revenueUsd)}</span>;
      case "netProfit":   return <span style={{ color: profColor(r.netProfit), fontWeight: 600 }}>{usd(r.netProfit)}</span>;
      case "grossProfit": return <span style={{ color: profColor(r.grossProfit), fontWeight: 600 }}>{usd(r.grossProfit)}</span>;
      case "netMargin":   return <span style={{ color: profColor(r.netMargin) }}>{pct(r.netMargin)}</span>;
      case "roas": {
        const v = r.roas;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        return <span style={{ color: v >= 2 ? "#10B981" : v >= 1 ? "#f59e0b" : "#EF4444", fontWeight: 600 }}>{v.toFixed(2)}x</span>;
      }
      case "cpa": {
        const v = r.cpa;
        if (v == null) return <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>;
        return <span style={{ color: "rgba(255,255,255,0.75)" }}>${v.toFixed(2)}</span>;
      }
      case "adSpendUsd": return <span style={{ color: r.adSpendUsd > 0 ? "#f87171" : "rgba(255,255,255,0.3)" }}>{r.adSpendUsd > 0 ? `$${usd(r.adSpendUsd)}` : "—"}</span>;
      case "cogsUsd":     return <span style={{ color: "#f59e0b" }}>${usd(r.cogsUsd)}</span>;
      case "orders": case "units": case "productCount":
        return <span style={{ color: "rgba(255,255,255,0.8)" }}>{((r as any)[colKey] as number).toLocaleString()}</span>;
      case "topProduct":  return <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{r.topProduct}</span>;
      default: return <span style={{ color: "rgba(255,255,255,0.6)" }}>{String((r as any)[colKey] ?? "—")}</span>;
    }
  };

  /* ── Totals cell renderer ─────────────────────── */
  const renderTotalsCell = (key: string, t: DisplayTotals) => {
    const dim = { color: "rgba(255,255,255,0.45)", fontSize: 12 };
    const num = { color: "#fff", fontWeight: 700, fontSize: 13 };
    const red = { color: "#f87171", fontWeight: 700, fontSize: 13 };
    const grn = (v: number) => ({ color: v >= 0 ? "#10B981" : "#EF4444", fontWeight: 700, fontSize: 13 });
    const roaColor = (v: number) => v >= 2 ? "#10B981" : v >= 1 ? "#f59e0b" : "#EF4444";
    switch (key) {
      case "name":        return <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: 700 }}>TOTAL · {t.count} productos</span>;
      case "countryCode": case "storeName": case "countries": case "cpaBE": case "status": case "dataQuality": case "topProduct":
        return <span style={dim}>—</span>;
      case "revenueUsd":  return <span style={num}>${usd(t.revenueUsd)}</span>;
      case "units":       return <span style={num}>{t.units.toLocaleString()}</span>;
      case "orders":      return <span style={num}>{t.orders.toLocaleString()}</span>;
      case "productCount":return <span style={num}>{t.count}</span>;
      case "aov":         return <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 600, fontSize: 13 }}>{t.aov > 0 ? `$${usd(t.aov)}` : "—"}</span>;
      case "cogsUsd":     return t.cogsUsd > 0 ? <span style={red}>(${usd(t.cogsUsd)})</span> : <span style={dim}>—</span>;
      case "adSpendUsd":  return t.adSpendUsd > 0 ? <span style={red}>${usd(t.adSpendUsd)}</span> : <span style={dim}>—</span>;
      case "totalCost": {
        const v = t.cogsUsd + t.adSpendUsd;
        if (v === 0) return <span style={dim}>—</span>;
        const pct_ = t.revenueUsd > 0 ? (v / t.revenueUsd) * 100 : 0;
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
            <span style={red}>${usd(v)}</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{pct_.toFixed(0)}% rev.</span>
          </div>
        );
      }
      case "grossProfit": return <span style={grn(t.grossProfit)}>{usd(t.grossProfit)}</span>;
      case "grossMargin": return <span style={grn(t.grossMargin)}>{pct(t.grossMargin)}</span>;
      case "netProfit":   return <span style={grn(t.netProfit)}>{usd(t.netProfit)}</span>;
      case "netMargin":   return <span style={grn(t.netMargin)}>{pct(t.netMargin)}</span>;
      case "roas":        return t.roas == null ? <span style={dim}>—</span> : <span style={{ color: roaColor(t.roas), fontWeight: 700, fontSize: 13 }}>{t.roas.toFixed(2)}x</span>;
      case "cpa":         return t.cpa  == null ? <span style={dim}>—</span> : <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 600, fontSize: 13 }}>${t.cpa.toFixed(2)}</span>;
      case "cpaAds":      return t.cpaAds  == null ? <span style={dim}>—</span> : <span style={{ color: "rgba(255,255,255,0.8)", fontWeight: 600, fontSize: 13 }}>${t.cpaAds.toFixed(2)}</span>;
      case "roasAds":     return t.roasAds == null ? <span style={dim}>—</span> : <span style={{ color: roaColor(t.roasAds), fontWeight: 700, fontSize: 13 }}>{t.roasAds.toFixed(2)}x</span>;
      case "sessions":    return t.sessions > 0 ? <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, fontSize: 13 }}>{t.sessions.toLocaleString()}</span> : <span style={dim}>—</span>;
      case "addToCart":   return t.addToCart > 0 ? <span style={{ color: "rgba(255,255,255,0.75)", fontWeight: 600, fontSize: 13 }}>{t.addToCart.toLocaleString()}</span> : <span style={dim}>—</span>;
      case "addToCartRate": return t.addToCartRate == null ? <span style={dim}>—</span> : <span style={{ color: t.addToCartRate >= 10 ? "#10B981" : t.addToCartRate >= 5 ? "#f59e0b" : "#EF4444", fontWeight: 700, fontSize: 13 }}>{t.addToCartRate.toFixed(1)}%</span>;
      case "conversionRate": return <span style={dim}>—</span>;
      default: return <span style={dim}>—</span>;
    }
  };

  const activeCols: ColDef[] = viewMode === "general" ? (COLS_GENERAL as unknown as ColDef[])
    : viewMode === "bystore" ? (COLS_STORE as unknown as ColDef[])
    : colOrder
        .map(k => ALL_COLS_COUNTRY.find(c => c.key === k))
        .filter((c): c is ColDef => !!c && !hiddenColKeys.has(c.key));

  // Keep phantom top-scrollbar width in sync with table width
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTableMinW(activeCols.reduce((s, c) => s + c.width, 0));
  }, [activeCols]);

  const allStatuses = useMemo(() => Array.from(new Set(rows.map(r => r.status))).sort(), [rows]);

  const rowCountLabel =
    viewMode === "bystore"   ? `${storeRows.length} tiendas`
    : viewMode === "general" ? `${generalRows.length} productos consolidados`
    : `${countryRows.length} filas`;

  return (
    <div style={{ padding: "28px 32px", minHeight: "100vh", background: "var(--page-bg, #0f172a)", color: "#fff" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Product Analytics</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "4px 0 0" }}>
            Rentabilidad por producto, país y tienda · COGS y Ads separados por mercado
            {isCustomRange && <span style={{ color: "#10B981", marginLeft: 8 }}>· {customFrom} → {customTo}</span>}
            {!isCustomRange && <span style={{ marginLeft: 8 }}>· últimos {days === 1 ? "hoy" : `${days} días`}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {viewMode === "bycountry" && (
            <button onClick={() => setShowCustomize(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
              ⚙ Personalizar
              {hiddenColKeys.size > 0 && <span style={{ background: "#6366f1", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "1px 6px" }}>{ALL_COLS_COUNTRY.length - hiddenColKeys.size}</span>}
            </button>
          )}
          <button onClick={load} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10, border: "none", background: "#0E766E", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
            <RefreshCw size={14} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            {loading ? "Cargando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {/* ── View Mode switcher ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {([
          { v: "bycountry", l: "Por País",  icon: Globe },
          { v: "general",   l: "General",   icon: LayoutGrid },
          { v: "bystore",   l: "Por Tienda",icon: StoreIcon },
        ] as { v: ViewMode; l: string; icon: any }[]).map(({ v, l, icon: Icon }) => (
          <button key={v} onClick={() => setViewMode(v)} style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 18px", borderRadius: 10, border: "1px solid",
            borderColor: viewMode === v ? "#0E766E" : "rgba(255,255,255,0.1)",
            background: viewMode === v ? "rgba(14,118,110,0.2)" : "transparent",
            color: viewMode === v ? "#fff" : "rgba(255,255,255,0.5)",
            cursor: "pointer", fontSize: 13, fontWeight: 600,
          }}>
            <Icon size={14} />
            {l}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        {/* Brand / Store */}
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 10 }}>
          {[{ v: "all", l: "Todas" }, { v: "glowmmi", l: "Glowmmi" }, { v: "balancea", l: "Balancea" }].map(s => (
            <button key={s.v} onClick={() => setStore(s.v)} style={{ padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: store === s.v ? "#0E766E" : "transparent", color: store === s.v ? "#fff" : "rgba(255,255,255,0.5)" }}>{s.l}</button>
          ))}
        </div>

        {/* Country filter */}
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 10 }}>
          {[
            { v: "all", l: "🌍 Todos" },
            { v: "MX",  l: "🇲🇽 México" },
            { v: "US",  l: "🇺🇸 EE.UU." },
            { v: "CL",  l: "🇨🇱 Chile"  },
          ].map(s => (
            <button key={s.v} onClick={() => setCountryFilter(s.v)} style={{ padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: countryFilter === s.v ? "#0E766E" : "transparent", color: countryFilter === s.v ? "#fff" : "rgba(255,255,255,0.5)" }}>{s.l}</button>
          ))}
        </div>

        {/* Date range */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 10 }}>
          {DAYS_OPTS.map(d => (
            <button key={d.v}
              onClick={() => { setDays(d.v); setCustomFrom(""); setCustomTo(""); setShowCalendar(false); }}
              style={{ padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: !isCustomRange && days === d.v ? "#0E766E" : "transparent", color: !isCustomRange && days === d.v ? "#fff" : "rgba(255,255,255,0.5)" }}
            >
              {d.label}
            </button>
          ))}
          {/* Calendar button / chip */}
          {isCustomRange ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, background: "rgba(14,118,110,0.35)", border: "1px solid rgba(14,118,110,0.6)" }}>
              <Calendar size={12} color="#10B981" />
              <span style={{ fontSize: 11, color: "#10B981", fontWeight: 600, whiteSpace: "nowrap" }}>
                {customFrom.slice(5)} → {customTo.slice(5)}
              </span>
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); setShowCalendar(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 0, display: "flex", marginLeft: 2 }}>
                <XIcon size={11} />
              </button>
            </div>
          ) : (
            <button ref={calendarBtnRef} onClick={openCalendar} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", background: showCalendar ? "rgba(14,118,110,0.3)" : "transparent", color: showCalendar ? "#10B981" : "rgba(255,255,255,0.5)" }}>
              <Calendar size={13} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Fechas</span>
            </button>
          )}

          {/* Calendar dropdown — fixed so it escapes any overflow:hidden parent */}
          {showCalendar && !isCustomRange && (
            <div ref={calendarRef} style={{ position: "fixed", top: calendarPos.top, left: calendarPos.left, zIndex: 9999 }}>
              <DateRangePicker
                from={customFrom}
                to={customTo}
                onApply={(f, t) => { setCustomFrom(f); setCustomTo(t); setShowCalendar(false); }}
                onClear={() => { setCustomFrom(""); setCustomTo(""); setShowCalendar(false); }}
              />
            </div>
          )}
        </div>

        {/* Type filter */}
        <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 10 }}>
          {([
            { v: "total",   l: "Total"       },
            { v: "físico",  l: "📦 Físicos"  },
            { v: "digital", l: "📱 Digitales" },
          ] as { v: "total" | "físico" | "digital"; l: string }[]).map(s => (
            <button key={s.v} onClick={() => setTypeFilter(s.v)} style={{
              padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: typeFilter === s.v ? "#0E766E" : "transparent",
              color:      typeFilter === s.v ? "#fff"    : "rgba(255,255,255,0.5)",
            }}>{s.l}</button>
          ))}
        </div>

        {/* Status filter */}
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 12, cursor: "pointer", outline: "none" }}>
          <option value="all">Estado: Todos</option>
          {allStatuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Search */}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto…"
          style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 13, outline: "none", width: 200 }}
        />
      </div>

      {/* KPI Cards */}
      {totals && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
          <KPI label="Revenue total"  value={`$${usd(totals.revenueUsd)}`}  sub={`${totals.uniqueOrders ?? totals.orders} pedidos`} icon={TrendingUp} accent="#0E766E" />
          <KPI label="Ut. Bruta"      value={`$${usd(totals.grossProfit)}`} sub={pct(totals.grossMargin)} icon={DollarSign}  accent={totals.grossProfit >= 0 ? "#10B981" : "#EF4444"} />
          <KPI label="Ut. Neta"       value={`$${usd(totals.netProfit)}`}   sub={pct(totals.netMargin)}   icon={ShoppingCart} accent={totals.netProfit >= 0 ? "#10B981" : "#EF4444"} />
          <KPI label="ROAS"           value={totals.roas != null ? `${totals.roas.toFixed(2)}x` : "N/A"} sub="Ads Meta" icon={Package} accent="#6366f1" />
          <KPI label={viewMode === "bystore" ? "Tiendas" : "Productos"}
               value={String(viewMode === "bystore" ? storeRows.length : viewMode === "general" ? generalRows.length : countryRows.length)}
               sub={countryFilter !== "all" ? `${FLAG[countryFilter]} ${COUNTRY_NAME[countryFilter]}` : "Todos los países"}
               icon={viewMode === "bystore" ? StoreIcon : Package} accent="#f59e0b" />
        </div>
      )}

      {/* General view warning */}
      {viewMode === "general" && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 18px", borderRadius: 12, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.35)", marginBottom: 20 }}>
          <AlertCircle size={18} color="#818cf8" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ margin: 0, fontSize: 13, color: "#a5b4fc", fontWeight: 600 }}>Vista consolidada — datos agrupados por producto (todos los países)</p>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "rgba(165,180,252,0.7)" }}>
              Los KPIs son promedios o sumas across países. Un producto puede ser rentable en MX y perder en CL.
              Usa <strong style={{ color: "#a5b4fc" }}>Por País</strong> antes de tomar decisiones de escalado.
            </p>
          </div>
        </div>
      )}

      {/* COGS tip */}
      {!cogsConfigured && !loading && rows.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderRadius: 12, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)", marginBottom: 20 }}>
          <AlertCircle size={18} color="#f59e0b" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13, color: "#fbbf24", fontWeight: 600 }}>⚠️ COGS sin configurar — utilidad bruta y neta incompletas</p>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "rgba(251,191,36,0.75)" }}>
              Haz click en la columna <strong style={{ color: "#fbbf24" }}>COGS</strong> de cualquier producto, o ve a{" "}
              <a href="/costos" style={{ color: "#fbbf24", textDecoration: "underline" }}>COGS / Costos</a>.
            </p>
          </div>
        </div>
      )}

      {error && <div style={{ padding: 16, borderRadius: 10, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", marginBottom: 16 }}>{error}</div>}

      {/* ── Table ── */}
      <div style={{ background: "var(--card-bg, #1e293b)", border: "1px solid var(--border, rgba(255,255,255,0.08))", borderRadius: 14, overflow: "hidden" }}>
        {/* Top phantom scrollbar */}
        <div ref={topScrollRef} onScroll={syncScrollFromTop}
          style={{ overflowX: "auto", overflowY: "hidden", height: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          className="custom-scrollbar">
          <div style={{ width: tableMinW, height: 1 }} />
        </div>
        <div ref={tableWrapRef} onScroll={syncScrollFromBottom} style={{ overflowX: "auto" }} className="custom-scrollbar">
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: activeCols.reduce((s, c) => s + c.width, 0) }}>
            <thead>
              {/* Column headers */}
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {activeCols.map(col => (
                  <th key={col.key}
                    onClick={() => viewMode !== "bystore" && handleSort(col.key as SortKey)}
                    title={(col as ColDef).tooltip}
                    style={{
                      padding: "10px 14px", width: col.width, minWidth: col.width,
                      textAlign: (col as any).right ? "right" : "left",
                      fontSize: 11, fontWeight: 700,
                      color: sortKey === col.key ? "#0E766E" : "rgba(255,255,255,0.45)",
                      letterSpacing: "0.05em", textTransform: "uppercase",
                      cursor: viewMode !== "bystore" ? "pointer" : "default", userSelect: "none",
                      position: (col as any).sticky ? "sticky" : undefined,
                      left: (col as any).sticky ? 0 : undefined,
                      background: (col as any).sticky ? "#1e293b" : undefined,
                      zIndex: (col as any).sticky ? 2 : undefined,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {col.label}
                      {viewMode !== "bystore" && (sortKey === col.key
                        ? (sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                        : <ChevronDown size={12} style={{ opacity: 0.3 }} />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr><td colSpan={activeCols.length} style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>Cargando datos de Shopify…</td></tr>
              ) : viewMode === "bystore" ? (
                storeRows.length === 0
                  ? <tr><td colSpan={activeCols.length} style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>Sin datos para el período seleccionado</td></tr>
                  : <>
                    {storeRows.map((r, i) => (
                      <tr key={r.storeKey} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)", transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}>
                        {COLS_STORE.map(col => (
                          <td key={col.key} style={{ padding: "11px 14px", width: col.width, minWidth: col.width, textAlign: (col as any).right ? "right" : "left", fontSize: 13, position: (col as any).sticky ? "sticky" : undefined, left: (col as any).sticky ? 0 : undefined, background: (col as any).sticky ? (i % 2 === 0 ? "#1e293b" : "#1a2840") : undefined, zIndex: (col as any).sticky ? 1 : undefined }}>
                            {renderStoreRowCell(col.key, r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {storeTotals && (
                      <tr style={{ borderTop: "2px solid rgba(14,118,110,0.5)", background: "#0e2420" }}>
                        {(COLS_STORE as unknown as ColDef[]).map(col => (
                          <td key={col.key} style={{ padding: "10px 14px", width: col.width, minWidth: col.width, textAlign: (col as any).right ? "right" : "left", fontSize: 13, position: (col as any).sticky ? "sticky" : undefined, left: (col as any).sticky ? 0 : undefined, background: (col as any).sticky ? "#0e2420" : undefined, zIndex: (col as any).sticky ? 3 : undefined }}>
                            {renderTotalsCell(col.key, storeTotals)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </>
              ) : viewMode === "general" ? (
                generalRows.length === 0
                  ? <tr><td colSpan={activeCols.length} style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>Sin datos para el período seleccionado</td></tr>
                  : <>
                    {generalRows.map((r, i) => (
                      <tr key={`${r.name}||${r.variant}||${r.brandId}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)", transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}>
                        {COLS_GENERAL.map(col => (
                          <td key={col.key} style={{ padding: "11px 14px", width: col.width, minWidth: col.width, textAlign: (col as any).right ? "right" : "left", fontSize: 13, position: (col as any).sticky ? "sticky" : undefined, left: (col as any).sticky ? 0 : undefined, background: (col as any).sticky ? (i % 2 === 0 ? "#1e293b" : "#1a2840") : undefined, zIndex: (col as any).sticky ? 1 : undefined }}>
                            {renderGeneralCell(col.key, r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {generalTotals && (
                      <tr style={{ borderTop: "2px solid rgba(14,118,110,0.5)", background: "#0e2420" }}>
                        {(COLS_GENERAL as unknown as ColDef[]).map(col => (
                          <td key={col.key} style={{ padding: "10px 14px", width: col.width, minWidth: col.width, textAlign: (col as any).right ? "right" : "left", fontSize: 13, position: (col as any).sticky ? "sticky" : undefined, left: (col as any).sticky ? 0 : undefined, background: (col as any).sticky ? "#0e2420" : undefined, zIndex: (col as any).sticky ? 3 : undefined }}>
                            {renderTotalsCell(col.key, generalTotals)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </>
              ) : (
                countryRows.length === 0
                  ? <tr><td colSpan={activeCols.length} style={{ padding: 40, textAlign: "center", color: "rgba(255,255,255,0.4)" }}>Sin datos para el período seleccionado</td></tr>
                  : <>
                    {countryRows.map((r, i) => (
                      <tr key={`${r.name}||${r.variant}||${r.brandId}||${r.countryCode}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)", transition: "background 0.1s" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
                        onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)")}>
                        {activeCols.map((col: ColDef) => (
                          <td key={col.key} style={{ padding: "11px 14px", width: col.width, minWidth: col.width, textAlign: col.right ? "right" : "left", fontSize: 13, position: col.sticky ? "sticky" : undefined, left: col.sticky ? 0 : undefined, background: col.sticky ? (i % 2 === 0 ? "#1e293b" : "#1a2840") : undefined, zIndex: col.sticky ? 1 : undefined }}>
                            {renderColCell(col.key, r)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {bycountryTotals && (
                      <tr style={{ borderTop: "2px solid rgba(14,118,110,0.5)", background: "#0e2420" }}>
                        {activeCols.map((col: ColDef) => (
                          <td key={col.key} style={{ padding: "10px 14px", width: col.width, minWidth: col.width, textAlign: col.right ? "right" : "left", fontSize: 13, position: col.sticky ? "sticky" : undefined, left: col.sticky ? 0 : undefined, background: col.sticky ? "#0e2420" : undefined, zIndex: col.sticky ? 3 : undefined }}>
                            {renderTotalsCell(col.key, bycountryTotals)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
            {rowCountLabel} · Últimos {days} días
            {countryFilter !== "all" && <span style={{ color: "#fff" }}> · {FLAG[countryFilter]} {COUNTRY_NAME[countryFilter]}</span>}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
            COGS y Ads separados por país · CPA BE por orden
          </span>
        </div>
      </div>

      {showCustomize && (
        <CustomizeColsModal
          allCols={ALL_COLS_COUNTRY}
          colOrder={colOrder}
          hiddenColKeys={hiddenColKeys}
          onApply={(order, hidden) => {
            setColOrder(order);
            setHiddenColKeys(hidden);
            saveColConfig(order, hidden);
            setShowCustomize(false);
          }}
          onClose={() => setShowCustomize(false)}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.4; }
        select option { background: #1e293b; color: #fff; }
        .custom-scrollbar::-webkit-scrollbar { height: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.04); }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
      `}</style>
    </div>
  );
}
