"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search, RefreshCw, Save, CheckCircle, AlertTriangle,
  TrendingDown, Package, DollarSign, Percent,
  ChevronDown, ChevronUp, Zap, X, Edit2, Upload,
  BarChart2, Layers, Tag, Clock, ShoppingBag, Plus,
  Table2, ExternalLink,
} from "lucide-react";

/* ─── Types ─────────────────────────────────────────────────────────────── */
type CountryKey  = "MX" | "US" | "CL";
type SubTab      = "catalogo" | "base" | "escalones" | "sincosto" | "historial";

type CostDetail  = { product?: number; shipping?: number; refund?: number; fee?: number; price?: number };
type CostsByCountry = { mx: Record<string,number>; us: Record<string,number>; cl: Record<string,number> };
type DetailByCountry = { mx: Record<string,CostDetail>; us: Record<string,CostDetail>; cl: Record<string,CostDetail> };
type AnalyticsEntry = { units: number; revenue: number; cogsUsd: number };

// New model
type CogRow = {
  id: string;
  countryCode: string;
  storeId: string;
  storeName: string;
  brand: string;
  productBaseName: string;
  offerName: string;
  unitsTotal: number;
  unitsPaid: number;
  unitsFree: number;
  productCostTotalUsd: number;
  productCostUnitUsd: number;
  shippingCostUsd: number;
  shippingIncludedInCogs: boolean;
  gatewayFeePercent: number;
  fulfillmentCostUsd: number;
  otherCostsUsd: number;
  totalCostBeforeAdsUsd: number;
  isActive: boolean;
  dataQuality: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type BaseRow = {
  name: string; brand: "glowmmi" | "balancea" | "unknown";
  total: number; product?: number; shipping?: number; refund?: number; fee?: number;
  priceAov?: number; priceSet?: number;
  units30d: number; revenue30d: number; cogsCalc: number; cogsPct?: number;
};
type Escalon = { id: string; productCode: string; productName: string; units: number; costMx?: number|null; costUs?: number|null; costCl?: number|null };
type ImportLog = { id: string; type: string; filename: string; status: string; importedRows: number; totalRows: number; createdAt: string };
type SyncResult = { ok?: boolean; updated?: number; skipped?: number; daysProcessed?: number; missingCosts?: string[]; costsLoaded?: number; from?: string; to?: string; error?: string; message?: string };

/* ─── Config ─────────────────────────────────────────────────────────────── */
const COUNTRY_CFG: Record<CountryKey, { flag: string; label: string; color: string }> = {
  MX: { flag: "🇲🇽", label: "México", color: "#10B981" },
  US: { flag: "🇺🇸", label: "USA",    color: "#6366F1" },
  CL: { flag: "🇨🇱", label: "Chile",  color: "#F59E0B" },
};

const BRAND_COLORS: Record<string,string> = { glowmmi: "#EC4899", balancea: "#10B981" };
const BRAND_LABELS: Record<string,string> = { glowmmi: "Glowmmi",  balancea: "Balancea" };

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const usd  = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct  = (n: number)        => n.toFixed(1) + "%";

function guessBrand(name: string): "glowmmi" | "balancea" | "unknown" {
  const n = name.toLowerCase();
  if (n.includes("airi") || n.includes("curva") || n.includes("smyle") || n.includes("cutting") ||
      n.includes("inositol") || n.includes("flexi") || n.includes("mouthwash") ||
      n.includes("holy basil") || n.includes("debloted") || n.includes("herbio"))
    return "balancea";
  if (n.includes("collar") || n.includes("joya") || n.includes("mama") || n.includes("pulsera"))
    return "unknown";
  return "glowmmi";
}

function isOfer(name: string): boolean {
  const n = name.toLowerCase();
  return /x[234567]$/.test(n) || /\+\s*\d+\s*(free|gratis)/i.test(n) || /\d\s*\+\s*\d/.test(n) || n.includes("bundle") || n.includes("pack") || /35%/.test(n);
}

/* ─── Stat card ──────────────────────────────────────────────────────────── */
function Stat({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: `${color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={13} color={color} />
        </div>
        <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ─── Inline editable cell ───────────────────────────────────────────────── */
function EditableCell({
  value, type = "number", format, onSave, placeholder = "—", suffix = "",
}: {
  value: number | string | null; type?: "number" | "text";
  format?: "currency" | "integer" | "plain";
  onSave: (v: string) => void; placeholder?: string; suffix?: string;
}) {
  // Auto-detect format: text fields are always plain, numeric default is currency
  const fmt = format ?? (type === "text" ? "plain" : "currency");

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value != null ? String(value) : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);
  useEffect(() => { setVal(value != null ? String(value) : ""); }, [value]);

  const displayVal = () => {
    if (fmt === "currency") return `$${usd(Number(value))}`;
    if (fmt === "integer")  return String(Math.round(Number(value)));
    return String(value ?? "");
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        step={fmt === "integer" ? "1" : "0.01"}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { onSave(val); setEditing(false); }}
        onKeyDown={e => {
          if (e.key === "Enter")  { onSave(val); setEditing(false); }
          if (e.key === "Escape") { setVal(value != null ? String(value) : ""); setEditing(false); }
        }}
        style={{ width: "100%", padding: "3px 6px", borderRadius: 4, border: "1px solid var(--text-3)", background: "var(--bg-2)", color: "var(--text)", fontSize: 12, outline: "none", textAlign: fmt === "plain" ? "left" : "right" }}
      />
    );
  }

  const isEmpty = value == null || value === "" || (typeof value === "number" && value === 0 && fmt === "currency");
  return (
    <div
      onClick={() => setEditing(true)}
      style={{ cursor: "pointer", textAlign: fmt === "plain" ? "left" : "right", padding: "4px 6px", borderRadius: 4, fontSize: 12 }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,.06)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      title="Click para editar"
    >
      {isEmpty
        ? <span style={{ color: "var(--text-3)" }}>{placeholder}<Edit2 size={9} style={{ marginLeft: 3 }} /></span>
        : <span style={{ color: fmt === "currency" ? "#F59E0B" : fmt === "integer" ? "var(--text-2)" : "var(--text)" }}>
            {displayVal()}{suffix}
          </span>
      }
    </div>
  );
}

/* ─── Catálogo COGS Table (new Excel-style) ──────────────────────────────── */
type ShopifyProduct = {
  brand: string; productId: string; title: string; handle: string;
  status: string; image: string | null; productUrl: string; adminUrl: string;
};

function CatalogoCOGS({ country, brand, search }: { country: CountryKey; brand: string; search: string }) {
  const [rows,    setRows]    = useState<CogRow[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState<Record<string,boolean>>({});
  const [adding,  setAdding]  = useState(false);
  const [newRow,  setNewRow]  = useState({ productBaseName: "", offerName: "", unitsTotal: 1, productCostTotalUsd: 0 });
  const [aovMap,  setAovMap]  = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [cogsRes, analyticsRes, catalogRes] = await Promise.all([
      fetch(`/api/products/cogs-by-country?country=${country}`),
      fetch(`/api/products/analytics?days=30&store=all`),
      fetch(`/api/products/shopify-catalog`),
    ]);
    const cogsData     = await cogsRes.json();
    const analyticsData = await analyticsRes.json();
    const catalogData   = await catalogRes.json().catch(() => ({ products: [] }));

    const aov: Record<string, number> = {};
    for (const row of (analyticsData.rows ?? [])) {
      const key = row.name?.toLowerCase().replace(/[™®–—\-\s]+/g, " ").trim().split(/[|]/)[0].trim();
      if (key && row.revenueUsd > 0 && row.units > 0)
        aov[key] = (aov[key] ?? 0) + row.revenueUsd / row.units;
    }
    setAovMap(aov);
    setRows(Array.isArray(cogsData) ? cogsData : []);
    setProducts(catalogData.products ?? []);
    setLoading(false);
  }, [country]);

  useEffect(() => { load(); }, [load]);

  // Normalizar nombre para matching: quita ™®, acentos, descripción (después de — - |),
  // sufijo "xN" o "N+M", emojis básicos. Lowercase, sin espacios extra.
  const normalizeBaseName = (name: string): string => name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, "")
    .split(/\s+[—–\-|]\s+/)[0]
    .replace(/\s+x\d+\s*$/i, "")
    .replace(/\s+\d+\s*\+\s*\d+.*$/i, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim().toLowerCase();

  // Map de "nombre normalizado" → COGs (de la BD). Usado para buscar costos por producto Shopify.
  const cogsByKey = useMemo(() => {
    const map = new Map<string, CogRow[]>();
    for (const r of rows) {
      const k = normalizeBaseName(r.productBaseName);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    // Dedup ofertas idénticas dentro de cada grupo (mismo units + mismo costo unitario)
    for (const [k, list] of map.entries()) {
      const seen = new Map<string, CogRow>();
      for (const r of list) {
        const sig = `${r.unitsTotal}|${r.productCostUnitUsd.toFixed(2)}`;
        if (!seen.has(sig)) seen.set(sig, r);
      }
      map.set(k, Array.from(seen.values()).sort((a, b) => a.unitsTotal - b.unitsTotal));
    }
    return map;
  }, [rows]);

  // Productos a mostrar: SOLO los que existen en Shopify. Filtra por marca y búsqueda.
  const visibleProducts = useMemo(() => {
    let r = products;
    if (brand !== "all") r = r.filter(p => p.brand === brand);
    if (search) { const q = search.toLowerCase(); r = r.filter(p => p.title.toLowerCase().includes(q)); }
    // Excluir productos que NO son main products (ebooks, guías, accesorios, planes, etc.)
    r = r.filter(p => !/ebook|eook|guía|guia|brocha|protocolo|recetario|protección|proteccion|calendario|hábitos|habitos|menú|menu|plan de gym|método|metodo|ritual|set |kit |collar|agenda|21d|reto |challenge|gratis|upsell|vitamina c|youtful|reafirmante|rendimiento extendido|rendimiento m[aá]ximo|lifting desde|pureza extendida/i.test(p.title));
    return r;
  }, [products, brand, search]);

  // Estructura final: { product: ShopifyProduct, cogs: CogRow[] }
  const productsWithCogs = useMemo(() => {
    return visibleProducts.map(p => {
      const key = normalizeBaseName(p.title);
      const cogs = cogsByKey.get(key) ?? [];
      return { product: p, cogs };
    });
  }, [visibleProducts, cogsByKey]);

  const patchRow = async (id: string, field: string, rawVal: string) => {
    const numVal = parseFloat(rawVal);
    if (isNaN(numVal) && field !== "notes") return;
    setSaving(p => ({ ...p, [id]: true }));
    const body: Record<string, unknown> = { id, [field]: isNaN(numVal) ? rawVal : numVal };
    const updated = await fetch("/api/products/cogs-by-country", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...updated } : r));
    setSaving(p => ({ ...p, [id]: false }));
  };

  const deleteRow = async (id: string) => {
    await fetch(`/api/products/cogs-by-country?id=${id}`, { method: "DELETE" });
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const addRow = async () => {
    if (!newRow.productBaseName || !newRow.offerName) return;
    const body = { ...newRow, countryCode: country, brand: guessBrand(newRow.productBaseName) };
    const created = await fetch("/api/products/cogs-by-country", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
    setRows(prev => [...prev, created]);
    setNewRow({ productBaseName: "", offerName: "", unitsTotal: 1, productCostTotalUsd: 0 });
    setAdding(false);
  };

  const colColor = COUNTRY_CFG[country].color;

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>Cargando catálogo…</div>;

  // Stats del catálogo
  const productsWithCount = productsWithCogs.filter(p => p.cogs.length > 0).length;
  const productsMissing   = productsWithCogs.length - productsWithCount;
  const allOffers         = productsWithCogs.flatMap(p => p.cogs);
  const avgCost           = allOffers.length > 0 ? allOffers.reduce((s, r) => s + r.productCostUnitUsd, 0) / allOffers.length : 0;

  return (
    <div>
      {/* Resumen del país */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, padding: "16px 20px 12px" }}>
        <div style={{ background: "var(--bg-2)", borderLeft: `3px solid ${colColor}`, borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".05em" }}>Productos Shopify</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginTop: 2 }}>{productsWithCogs.length}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{allOffers.length} ofertas con costo</div>
        </div>
        <div style={{ background: "var(--bg-2)", borderLeft: "3px solid #10B981", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".05em" }}>Con costo cargado</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#10B981", marginTop: 2 }}>{productsWithCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{productsWithCogs.length > 0 ? Math.round(productsWithCount / productsWithCogs.length * 100) : 0}% del total</div>
        </div>
        {productsMissing > 0 && (
          <div style={{ background: "var(--bg-2)", borderLeft: "3px solid #EF4444", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".05em" }}>Sin costo</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#EF4444", marginTop: 2 }}>{productsMissing}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>productos por cargar</div>
          </div>
        )}
        <div style={{ background: "var(--bg-2)", borderLeft: "3px solid #8B5CF6", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 700, letterSpacing: ".05em" }}>Costo prom / unidad</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#8B5CF6", marginTop: 2 }}>${usd(avgCost)}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{COUNTRY_CFG[country].label}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 20px 12px" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
          Catálogo · {COUNTRY_CFG[country].flag} {COUNTRY_CFG[country].label}
        </span>
        <button
          onClick={() => setAdding(p => !p)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "none", background: colColor, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12 }}
        >
          <Plus size={13} /> Nueva oferta
        </button>
      </div>

      {/* Add row form */}
      {adding && (
        <div style={{ margin: "0 20px 12px", background: "var(--bg-2)", border: `1px solid ${colColor}44`, borderRadius: 10, padding: "14px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10, fontWeight: 600, textTransform: "uppercase" }}>Nueva oferta — {country}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {[
              { label: "Producto base", key: "productBaseName", type: "text", w: 180 },
              { label: "Nombre oferta", key: "offerName",       type: "text", w: 200 },
              { label: "Uni totales",   key: "unitsTotal",      type: "number", w: 90 },
              { label: "Costo total $", key: "productCostTotalUsd", type: "number", w: 110 },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3 }}>{f.label}</div>
                <input
                  type={f.type}
                  step="0.01"
                  value={(newRow as any)[f.key]}
                  onChange={e => setNewRow(p => ({ ...p, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))}
                  style={{ width: f.w, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12, outline: "none" }}
                />
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
              <button onClick={() => setAdding(false)} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-3)", cursor: "pointer", fontSize: 12 }}>Cancelar</button>
              <button onClick={addRow} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: colColor, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Cards grid — un card por producto Shopify */}
      <div style={{ padding: "0 20px 20px" }}>
        {productsWithCogs.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "var(--text-3)", background: "var(--bg-2)", borderRadius: 12, border: "1px dashed var(--border)" }}>
            {products.length === 0
              ? "No se pudo cargar el catálogo de Shopify. Revisa las credenciales."
              : <>Sin productos para {brand === "all" ? "esta marca" : BRAND_LABELS[brand]}.</>}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
            {productsWithCogs.map(({ product, cogs }) => {
              const brandColor = BRAND_COLORS[product.brand] ?? "#6366F1";
              const brandLabel = BRAND_LABELS[product.brand] ?? product.brand;
              const productName = product.title;
              const sorted = cogs;
              const okCount = sorted.filter(r => r.dataQuality === "ok" && r.productCostTotalUsd > 0).length;
              const aovUnit = aovMap[normalizeBaseName(productName)];
              const hasCogs = sorted.length > 0;

              return (
                <div key={product.productId} style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", transition: "border-color .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = brandColor + "60")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
                >
                  {/* Card header con imagen */}
                  <div style={{ padding: "12px 14px", borderBottom: hasCogs ? "1px solid var(--border)" : "none", background: `linear-gradient(180deg, ${brandColor}10 0%, transparent 100%)`, display: "flex", gap: 12 }}>
                    {/* Imagen del producto */}
                    {product.image ? (
                      <a href={product.productUrl} target="_blank" rel="noopener noreferrer"
                        style={{ width: 60, height: 60, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--bg-2)", display: "block", border: `1px solid ${brandColor}30`, textDecoration: "none" }}
                        title={`Ver "${productName}" en Shopify`}
                      >
                        <img src={product.image} alt={productName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </a>
                    ) : (
                      <div style={{ width: 60, height: 60, borderRadius: 8, background: brandColor + "22", color: brandColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, flexShrink: 0 }}>
                        {productName.charAt(0).toUpperCase()}
                      </div>
                    )}

                    {/* Texto */}
                    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div>
                        <a href={product.productUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}
                          title={`Abrir landing — ${productName}`}
                        >
                          {productName}
                          <ExternalLink size={11} style={{ marginLeft: 4, opacity: 0.5, verticalAlign: "middle" }} />
                        </a>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>
                          <span style={{ color: brandColor }}>{brandLabel}</span>
                          {hasCogs && <> · {sorted.length} oferta{sorted.length !== 1 ? "s" : ""}</>}
                          {product.status === "draft" && <span style={{ color: "#F59E0B", marginLeft: 6 }}>· borrador</span>}
                        </div>
                      </div>
                      {hasCogs && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: okCount === sorted.length ? "#10B98118" : "#F59E0B18", color: okCount === sorted.length ? "#10B981" : "#F59E0B", fontWeight: 700 }}>
                            {okCount}/{sorted.length} ✓
                          </span>
                          {aovUnit && (
                            <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                              AOV: <strong style={{ color: "var(--text-2)" }}>${usd(aovUnit)}</strong>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mensaje "sin costo" si no hay cogs */}
                  {!hasCogs && (
                    <div style={{ padding: "12px 16px", background: "rgba(239,68,68,.05)", color: "var(--text-3)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "#EF4444", fontWeight: 600 }}>⚠ Sin costo cargado</span>
                      <button onClick={() => { setNewRow({ productBaseName: productName, offerName: productName, unitsTotal: 1, productCostTotalUsd: 0 }); setAdding(true); }}
                        style={{ background: brandColor, color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        + Agregar
                      </button>
                    </div>
                  )}

                  {/* Ofertas list — solo si hay cogs */}
                  {hasCogs && (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {sorted.map((row, i) => {
                        const isSav    = saving[row.id];
                        const adjPrice = aovUnit ? aovUnit * row.unitsTotal : null;
                        const roasBe   = adjPrice && row.totalCostBeforeAdsUsd > 0 ? adjPrice / row.totalCostBeforeAdsUsd : null;
                        const missing  = row.productCostTotalUsd <= 0;

                        return (
                          <div key={row.id}
                            style={{
                              padding: "10px 16px",
                              borderTop: i > 0 ? "1px solid rgba(255,255,255,.04)" : "none",
                              background: missing ? "rgba(239,68,68,.04)" : "transparent",
                              opacity: isSav ? 0.5 : 1,
                              transition: "background .15s",
                            }}
                          >
                            {/* Línea 1: nombre de oferta + units badge + delete */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.offerName}>
                                {row.offerName}
                              </span>
                              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-2)", color: "var(--text-3)", fontWeight: 700, flexShrink: 0 }}>
                                {row.unitsTotal}u
                              </span>
                              <button
                                onClick={() => { if (confirm(`¿Eliminar "${row.offerName}"?`)) deleteRow(row.id); }}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", opacity: 0.3, padding: 2, flexShrink: 0 }}
                                title="Eliminar oferta"
                                onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                                onMouseLeave={e => (e.currentTarget.style.opacity = "0.3")}
                              >
                                <X size={12} />
                              </button>
                            </div>

                            {/* Línea 2: costos editables + ROAS BE */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
                              {/* Costo total — editable */}
                              <div>
                                <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, marginBottom: 2 }}>
                                  Costo total
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: missing ? "#EF4444" : "var(--text)" }}>
                                  $<EditableCell
                                    value={row.productCostTotalUsd}
                                    onSave={v => patchRow(row.id, "productCostTotalUsd", v)}
                                    placeholder="0.00"
                                  />
                                </div>
                              </div>

                              {/* Costo unitario — auto */}
                              <div>
                                <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, marginBottom: 2 }}>
                                  Por unidad
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)" }}>
                                  {row.productCostUnitUsd > 0 ? `$${usd(row.productCostUnitUsd)}` : "—"}
                                </div>
                              </div>

                              {/* ROAS BE — solo si hay datos */}
                              {roasBe != null ? (
                                <div style={{ textAlign: "right" }} title="ROAS de break-even (con AOV de últimos 30d)">
                                  <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 600, marginBottom: 2 }}>
                                    ROAS BE
                                  </div>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: roasBe < 2 ? "#EF4444" : roasBe < 3 ? "#F59E0B" : "#10B981" }}>
                                    {roasBe.toFixed(2)}x
                                  </div>
                                </div>
                              ) : (
                                <div style={{ width: 50 }} />
                              )}
                            </div>

                            {isSav && (
                              <div style={{ fontSize: 10, color: "#F59E0B", marginTop: 4, fontWeight: 600 }}>guardando…</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: "12px 20px 20px", fontSize: 11, color: "var(--text-3)", textAlign: "center" }}>
        💡 Click en el <strong style={{ color: "var(--text-2)" }}>Costo total</strong> para editarlo. El <strong style={{ color: "var(--text-2)" }}>costo por unidad</strong> se calcula automático (÷ unidades).
        El <strong style={{ color: "var(--text-2)" }}>ROAS BE</strong> usa el AOV real de Analytics de los últimos 30 días.
      </div>
    </div>
  );
}

/* ─── Costos Base (legacy, simplified) ───────────────────────────────────── */
function CostosBaseTable({ rows, country, saving, onSave }: {
  rows: BaseRow[]; country: string; saving: Record<string,boolean>;
  onSave: (name: string, total: number, detail: CostDetail, country: string) => void;
}) {
  const [sortKey, setSortKey] = useState<keyof BaseRow>("revenue30d");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = a[sortKey] ?? 0; const bv = b[sortKey] ?? 0;
    if (typeof av === "string") return sortAsc ? (av as string).localeCompare(bv as string) : (bv as string).localeCompare(av as string);
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  }), [rows, sortKey, sortAsc]);

  const cfg = COUNTRY_CFG[country as CountryKey] ?? COUNTRY_CFG.MX;

  const Th = ({ k, label, right, w }: { k: keyof BaseRow; label: string; right?: boolean; w?: number }) => (
    <th onClick={() => { if (sortKey === k) setSortAsc(p => !p); else { setSortKey(k); setSortAsc(false); } }}
      style={{ padding: "9px 10px", fontSize: 10, fontWeight: 600, cursor: "pointer", color: sortKey === k ? "var(--text)" : "var(--text-3)", textAlign: right ? "right" : "left", userSelect: "none", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", width: w }}>
      {label} {sortKey === k ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <Th k="name" label="Producto" w={200} />
            <th style={{ padding: "9px 10px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>Marca</th>
            <th style={{ padding: "9px 10px", fontSize: 10, fontWeight: 600, color: cfg.color, textAlign: "right", background: "var(--bg-2)", borderBottom: `2px solid ${cfg.color}44`, width: 110 }}>Costo USD</th>
            <Th k="units30d"   label="Uds 30d"    right w={70} />
            <Th k="revenue30d" label="Revenue 30d" right w={100} />
            <Th k="cogsPct"    label="COGS%"       right w={72} />
            <th style={{ padding: "9px 10px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", textAlign: "right", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", width: 80 }}>CPA BE</th>
            <th style={{ padding: "9px 10px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", textAlign: "right", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", width: 80 }}>ROAS BE</th>
            <th style={{ padding: "9px 10px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", textAlign: "center", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", width: 90 }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={9} style={{ padding: 36, textAlign: "center", color: "var(--text-3)" }}>Sin resultados</td></tr>}
          {sorted.map((e, i) => {
            const priceAov = e.units30d > 0 && e.revenue30d > 0 ? e.revenue30d / e.units30d : null;
            const price    = e.priceSet ?? priceAov;
            const margin   = price && price > 0 && e.total > 0 ? ((price - e.total) / price) * 100 : null;
            const cpaBe    = price && e.total > 0 ? price - e.total : null;
            const roasBe   = price && e.total > 0 ? price / e.total  : null;
            const hasCost  = e.total > 0;
            const hasRev   = e.revenue30d > 0;
            const bg       = i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)";
            return (
              <tr key={e.name} style={{ borderBottom: "1px solid var(--border)", background: !hasCost && hasRev ? "rgba(239,68,68,.04)" : bg }}
                onMouseEnter={ev => (ev.currentTarget.style.background = "rgba(255,255,255,.03)")}
                onMouseLeave={ev => (ev.currentTarget.style.background = !hasCost && hasRev ? "rgba(239,68,68,.04)" : bg)}
              >
                <td style={{ padding: "7px 10px", maxWidth: 200 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={e.name}>{e.name}</span>
                </td>
                <td style={{ padding: "7px 10px" }}>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 600, background: (BRAND_COLORS[e.brand] ?? "#6366F1") + "22", color: BRAND_COLORS[e.brand] ?? "#6366F1" }}>
                    {BRAND_LABELS[e.brand] ?? e.brand}
                  </span>
                </td>
                <td style={{ padding: "5px 10px" }}>
                  <div onClick={() => {
                    const v = prompt(`Costo USD para "${e.name}" (${country}):`, String(e.total || ""));
                    if (v) onSave(e.name, parseFloat(v) || 0, {}, country.toLowerCase() as any);
                  }} style={{ textAlign: "right", cursor: "pointer", padding: "4px 6px", borderRadius: 4, fontSize: 12, color: e.total > 0 ? "#F59E0B" : "var(--text-3)" }}
                    onMouseEnter={ev => (ev.currentTarget.style.background = "rgba(255,255,255,.06)")}
                    onMouseLeave={ev => (ev.currentTarget.style.background = "transparent")}
                  >
                    {e.total > 0 ? `$${usd(e.total)}` : "— editar"} <Edit2 size={9} />
                  </div>
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--text-2)" }}>{e.units30d || "—"}</td>
                <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--text-2)" }}>{hasRev ? `$${usd(e.revenue30d)}` : "—"}</td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {e.cogsPct != null ? <span style={{ color: e.cogsPct > 60 ? "#EF4444" : e.cogsPct > 40 ? "#F59E0B" : "#10B981", fontWeight: 600 }}>{pct(e.cogsPct)}</span> : <span style={{ color: "var(--text-3)" }}>—</span>}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {cpaBe != null ? <span style={{ color: "var(--text-2)" }}>${usd(cpaBe)}</span> : <span style={{ color: "var(--text-3)" }}>—</span>}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "right" }}>
                  {roasBe != null ? <span style={{ color: roasBe <= 2 ? "#EF4444" : roasBe <= 3 ? "#F59E0B" : "#10B981", fontWeight: 600 }}>{roasBe.toFixed(2)}x</span> : <span style={{ color: "var(--text-3)" }}>—</span>}
                </td>
                <td style={{ padding: "7px 10px", textAlign: "center" }}>
                  {!hasRev ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "rgba(255,255,255,.06)", color: "var(--text-3)" }}>Sin ventas</span>
                    : hasCost ? <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#10B98118", color: "#10B981" }}>✓ Ok</span>
                    : <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: "#EF444418", color: "#EF4444", fontWeight: 600 }}>⚠ Falta</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Escalones Table ────────────────────────────────────────────────────── */
function EscalonesView({ country }: { country: CountryKey }) {
  const [escalones, setEscalones] = useState<Escalon[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");

  useEffect(() => {
    setLoading(true);
    fetch("/api/facturas/escalones").then(r => r.json()).then(d => { setEscalones(Array.isArray(d) ? d : []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const costKey = country === "MX" ? "costMx" : country === "US" ? "costUs" : "costCl";
  const grouped = useMemo(() => {
    const map = new Map<string, { productCode: string; productName: string; tiers: Map<number, Escalon> }>();
    for (const e of escalones) {
      if (!map.has(e.productCode)) map.set(e.productCode, { productCode: e.productCode, productName: e.productName, tiers: new Map() });
      map.get(e.productCode)!.tiers.set(e.units, e);
    }
    return Array.from(map.values()).filter(g => !search || g.productName.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [escalones, search]);

  const allUnits = useMemo(() => { const s = new Set<number>(); for (const e of escalones) s.add(e.units); return Array.from(s).sort((a, b) => a - b); }, [escalones]);
  const cfg = COUNTRY_CFG[country];

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>Cargando escalones…</div>;
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 300 }}>
          <Search size={13} color="var(--text-3)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto…"
            style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text)", fontSize: 12, outline: "none" }} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{grouped.length} productos · {allUnits.length} escalones</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: "9px 12px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", textAlign: "left", width: 80 }}>Código</th>
              <th style={{ padding: "9px 12px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", textAlign: "left" }}>Producto</th>
              {allUnits.map(u => <th key={u} style={{ padding: "9px 12px", fontSize: 10, fontWeight: 600, color: cfg.color, background: "var(--bg-2)", borderBottom: `2px solid ${cfg.color}44`, textAlign: "right", width: 90 }}>{u} ud{u > 1 ? "s" : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 && <tr><td colSpan={2 + allUnits.length} style={{ padding: 36, textAlign: "center", color: "var(--text-3)" }}>Sin escalones</td></tr>}
            {grouped.map((g, i) => (
              <tr key={g.productCode} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)" }}
                onMouseEnter={ev => (ev.currentTarget.style.background = "rgba(255,255,255,.03)")}
                onMouseLeave={ev => (ev.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)")}>
                <td style={{ padding: "8px 12px", color: "var(--text-3)", fontFamily: "monospace", fontSize: 11 }}>{g.productCode}</td>
                <td style={{ padding: "8px 12px", color: "var(--text)", fontWeight: 500 }}>{g.productName}</td>
                {allUnits.map(u => { const tier = g.tiers.get(u); const cost = tier ? (tier as any)[costKey] as number|null : null; return <td key={u} style={{ padding: "8px 12px", textAlign: "right" }}>{cost != null ? <span style={{ color: "#F59E0B", fontWeight: 600 }}>${usd(cost)}</span> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>; })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Historial ──────────────────────────────────────────────────────────── */
function HistorialView() {
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/import").then(r => r.json()).then(d => { const all: ImportLog[] = Array.isArray(d) ? d : (d.imports ?? []); setLogs(all.filter(l => l.filename?.endsWith(".xlsx") || l.type === "costs_excel")); setLoading(false); }).catch(() => setLoading(false)); }, []);
  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>Cargando…</div>;
  return !logs.length ? <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>Sin importaciones.</div> : (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead><tr>{["Archivo","Estado","Importados","Total","Fecha"].map(h => <th key={h} style={{ padding: "9px 12px", fontSize: 10, fontWeight: 600, color: "var(--text-3)", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", textAlign: h === "Archivo" ? "left" : "right" }}>{h}</th>)}</tr></thead>
      <tbody>{logs.map((l, i) => <tr key={l.id} style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,.01)" }}>
        <td style={{ padding: "8px 12px", color: "var(--text)" }}>{l.filename}</td>
        <td style={{ padding: "8px 12px", textAlign: "right" }}><span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: l.status === "completed" ? "#10B98118" : "#EF444418", color: l.status === "completed" ? "#10B981" : "#EF4444" }}>{l.status}</span></td>
        <td style={{ padding: "8px 12px", textAlign: "right", color: "#10B981", fontWeight: 600 }}>{l.importedRows}</td>
        <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-2)" }}>{l.totalRows}</td>
        <td style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-3)" }}>{new Date(l.createdAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}</td>
      </tr>)}</tbody>
    </table>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */
export default function CostosPage() {
  const [costs,       setCosts]       = useState<CostsByCountry>({ mx: {}, us: {}, cl: {} });
  const [detail,      setDetail]      = useState<DetailByCountry>({ mx: {}, us: {}, cl: {} });
  const [analytics,   setAnalytics]   = useState<Record<string, any>>({});
  const [countryTab,  setCountryTab]  = useState<CountryKey>("MX");
  const [subTab,      setSubTab]      = useState<SubTab>("catalogo");
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState<Record<string,boolean>>({});
  const [syncing,     setSyncing]     = useState(false);
  const [syncingFees, setSyncingFees] = useState(false);
  const [importing,   setImporting]   = useState(false);
  const [syncResult,  setSyncResult]  = useState<SyncResult | null>(null);
  const [search,      setSearch]      = useState("");
  const [brand,       setBrand]       = useState<"all" | "glowmmi" | "balancea">("all");
  const [days,        setDays]        = useState(30);
  const [catalogStats, setCatalogStats] = useState({ total: 0, withCost: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [costsRes, analyticsRes, catalogRes] = await Promise.all([
        fetch("/api/products/costs"),
        fetch(`/api/products/analytics?days=${days}&store=all`),
        fetch(`/api/products/cogs-by-country?country=${countryTab}`),
      ]);
      const costsData     = await costsRes.json();
      const analyticsData = await analyticsRes.json();
      const catalogData   = await catalogRes.json();

      setCosts({ mx: costsData?.mx ?? {}, us: costsData?.us ?? {}, cl: costsData?.cl ?? {} });
      setDetail(costsData?.detail ?? { mx: {}, us: {}, cl: {} });

      const aMap: Record<string, any> = {};
      for (const row of (analyticsData.rows ?? [])) {
        const v = row.variant && row.variant !== "" ? row.variant : "";
        const fullName = v ? `${row.name} ${v}` : row.name;
        if (!aMap[fullName]) aMap[fullName] = { units: 0, revenue: 0, cogsUsd: 0 };
        aMap[fullName].units   += row.units      ?? 0;
        aMap[fullName].revenue += row.revenueUsd ?? 0;
        aMap[fullName].cogsUsd += row.cogsUsd    ?? 0;
      }
      setAnalytics(aMap);

      const catalogArr = Array.isArray(catalogData) ? catalogData : [];
      setCatalogStats({ total: catalogArr.length, withCost: catalogArr.filter((r: any) => r.productCostTotalUsd > 0).length });
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [days, countryTab]);

  useEffect(() => { load(); }, [load]);

  const saveCost = useCallback(async (name: string, total: number, det: CostDetail, country: string) => {
    setSaving(p => ({ ...p, [name]: true }));
    const c = country.toLowerCase() as keyof CostsByCountry;
    setCosts(p => ({ ...p, [c]: { ...p[c], [name]: total } }));
    await fetch("/api/products/costs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, costPerUnit: total, country: c, ...det }) });
    setSaving(p => ({ ...p, [name]: false }));
  }, []);

  const syncToDashboard = useCallback(async () => {
    setSyncing(true); setSyncResult(null);
    try { const res = await fetch("/api/products/cogs-rollup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) }); setSyncResult(await res.json()); } catch { setSyncResult({ error: "Error al recalcular" }); }
    setSyncing(false);
  }, [days]);

  const syncFees = useCallback(async () => {
    setSyncingFees(true); setSyncResult(null);
    try {
      const [d1, d2] = await Promise.all([
        fetch("/api/shopify/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: "glowmmi",  days }) }).then(r => r.json()),
        fetch("/api/shopify/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ store: "balancea", days }) }).then(r => r.json()),
      ]);
      setSyncResult({ ok: true, updated: (d1.daysUpdated ?? 0) + (d2.daysUpdated ?? 0), daysProcessed: -1, costsLoaded: (d1.payoutsFound ?? 0) + (d2.payoutsFound ?? 0), from: d1.dateFrom ?? "", to: d1.dateTo ?? "", missingCosts: [] });
    } catch { setSyncResult({ error: "Error al obtener fees" }); }
    setSyncingFees(false);
  }, [days]);

  const handleImport = useCallback(async (file: File) => {
    setImporting(true); setSyncResult(null);
    const fd = new FormData(); fd.append("file", file);
    try {
      const res  = await fetch("/api/products/costs/import", { method: "POST", body: fd });
      const data = await res.json();
      if (data.error) { setSyncResult({ error: data.error }); }
      else { setSyncResult({ ok: true, updated: data.costsImported ?? 0, daysProcessed: -2, costsLoaded: data.escalonesSaved ?? 0, from: `${data.costsImported ?? 0} costos`, to: `${data.escalonesSaved ?? 0} escalones`, missingCosts: data.warnings ?? [], message: `Excel importado · ${data.sheetsProcessed} sheets` }); load(); }
    } catch { setSyncResult({ error: "Error al importar Excel" }); }
    setImporting(false);
  }, [load]);

  /* ── Build legacy rows ─── */
  const allRows: BaseRow[] = useMemo(() => {
    const activeCosts  = costs[countryTab.toLowerCase() as keyof CostsByCountry]  ?? {};
    const activeDetail = detail[countryTab.toLowerCase() as keyof DetailByCountry] ?? {};
    const allNames = new Set([...Object.keys(analytics), ...Object.keys(activeCosts)]);
    return Array.from(allNames).map(name => {
      const a   = analytics[name];
      const det = activeDetail[name] ?? {};
      const tot = activeCosts[name] ?? 0;
      const units30d = a?.units ?? 0; const rev30d = a?.revenue ?? 0; const cogsCalc = a?.cogsUsd ?? 0;
      return { name, brand: guessBrand(name), total: tot, product: det.product, shipping: det.shipping, refund: det.refund, fee: det.fee, priceSet: det.price, priceAov: units30d > 0 && rev30d > 0 ? rev30d / units30d : undefined, units30d, revenue30d: rev30d, cogsCalc, cogsPct: rev30d > 0 && cogsCalc > 0 ? (cogsCalc / rev30d) * 100 : undefined };
    });
  }, [costs, detail, countryTab, analytics]);

  const filterRows = useCallback((rows: BaseRow[]) => {
    let r = rows;
    if (brand !== "all") r = r.filter(e => e.brand === brand);
    if (search) { const q = search.toLowerCase(); r = r.filter(e => e.name.toLowerCase().includes(q)); }
    return r.sort((a, b) => b.revenue30d - a.revenue30d);
  }, [brand, search]);

  const baseRows = useMemo(() => filterRows(allRows.filter(e => !isOfer(e.name))), [allRows, filterRows]);
  const sinCostRows = useMemo(() => filterRows(allRows.filter(e => e.total === 0 && e.revenue30d > 0)), [allRows, filterRows]);

  const stats = useMemo(() => {
    const withRev = allRows.filter(e => e.revenue30d > 0); const withCost = withRev.filter(e => e.total > 0); const missing = withRev.filter(e => e.total === 0);
    const totalCogs = allRows.reduce((s, e) => s + e.cogsCalc, 0); const totalRev = allRows.reduce((s, e) => s + e.revenue30d, 0);
    return { total: allRows.length, covered: withCost.length, missing: missing.length, pctCovered: withRev.length > 0 ? (withCost.length / withRev.length) * 100 : 100, totalCogs, totalRev, cogsPct: totalRev > 0 ? (totalCogs / totalRev) * 100 : 0, missedRev: missing.reduce((s, e) => s + e.revenue30d, 0) };
  }, [allRows]);

  const cfg = COUNTRY_CFG[countryTab];

  const SUB_TABS: Array<{ key: SubTab; icon: any; label: string; badge?: string }> = [
    { key: "catalogo",  icon: Table2,        label: "Catálogo por oferta", badge: catalogStats.total ? String(catalogStats.total) : undefined },
    { key: "base",      icon: BarChart2,     label: "Costos Base (legacy)" },
    { key: "escalones", icon: Layers,        label: "Escalones" },
    { key: "sincosto",  icon: AlertTriangle, label: "Sin Costo", badge: stats.missing > 0 ? String(stats.missing) : undefined },
    { key: "historial", icon: Clock,         label: "Historial" },
  ];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1600, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>COGS — Costos de Producto</h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: "4px 0 0" }}>Por país · por oferta/bundle · escalones · sincronización con Analytics</p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {([30, 60, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)} style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1px solid ${days === d ? "#F59E0B" : "var(--border)"}`, background: days === d ? "#F59E0B18" : "var(--card)", color: days === d ? "#F59E0B" : "var(--text-2)", cursor: "pointer" }}>{d}d</button>
          ))}
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-2)", cursor: "pointer", fontSize: 12 }}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} /> Recargar
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ""; }} />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: "1px solid #6366F1", background: "#6366F118", color: "#6366F1", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
            <Upload size={13} /> {importing ? "Importando…" : "Importar Excel"}
          </button>
          <button onClick={syncFees} disabled={syncingFees} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-2)", cursor: "pointer", fontSize: 12 }}>
            <DollarSign size={13} /> {syncingFees ? "Obteniendo…" : "Fees Reales"}
          </button>
          <button onClick={syncToDashboard} disabled={syncing} style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 16px", borderRadius: 8, border: "none", background: syncing ? "rgba(245,158,11,.4)" : "#F59E0B", color: "#000", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            <Zap size={13} /> {syncing ? "Recalculando…" : "Recalcular Dashboard"}
          </button>
        </div>
      </div>

      {/* Country tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 0 }}>
        {(["MX", "US", "CL"] as CountryKey[]).map(c => {
          const cc = COUNTRY_CFG[c]; const active = countryTab === c;
          return (
            <button key={c} onClick={() => setCountryTab(c)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: "8px 8px 0 0", border: `1px solid ${active ? "var(--border)" : "transparent"}`, borderBottom: active ? "1px solid var(--card)" : "1px solid transparent", background: active ? "var(--card)" : "transparent", color: active ? cc.color : "var(--text-3)", cursor: "pointer", fontSize: 13, fontWeight: active ? 700 : 500, marginBottom: active ? -1 : 0 }}>
              <span style={{ fontSize: 18 }}>{cc.flag}</span> {cc.label}
              {active && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 20, background: `${cc.color}22`, color: cc.color, fontWeight: 700 }}>{catalogStats.total}</span>}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center", paddingRight: 8 }}>Editar solo afecta el país activo</div>
      </div>

      {/* Sync banner */}
      {syncResult && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 16px", background: syncResult.error ? "#EF444418" : "#10B98118", border: `1px solid ${syncResult.error ? "#EF4444" : "#10B981"}`, borderTop: "none" }}>
          {syncResult.error ? <AlertTriangle size={16} color="#EF4444" style={{ flexShrink: 0 }} /> : <CheckCircle size={16} color="#10B981" style={{ flexShrink: 0 }} />}
          <div style={{ flex: 1, fontSize: 12 }}>
            {syncResult.error ? <span style={{ color: "#EF4444", fontWeight: 600 }}>{syncResult.error}</span>
              : syncResult.daysProcessed === -2 ? <span style={{ color: "#10B981", fontWeight: 600 }}>✅ {syncResult.message} — {syncResult.from}, {syncResult.to}</span>
              : syncResult.daysProcessed === -1 ? <span style={{ color: "#10B981", fontWeight: 600 }}>✅ Fees Shopify Payments — {syncResult.costsLoaded} payouts, {syncResult.updated} días actualizados</span>
              : <span style={{ color: "#10B981", fontWeight: 600 }}>✅ COGS recalculado — {syncResult.updated} filas ({syncResult.from} → {syncResult.to})</span>}
            {(syncResult.missingCosts ?? []).length > 0 && <div style={{ marginTop: 4, color: "#F59E0B" }}>{syncResult.missingCosts!.slice(0, 4).join(" · ")}{syncResult.missingCosts!.length > 4 ? ` +${syncResult.missingCosts!.length - 4} más` : ""}</div>}
          </div>
          <button onClick={() => setSyncResult(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}><X size={13} /></button>
        </div>
      )}

      {/* Main card */}
      <div style={{ background: "var(--card)", border: `1px solid ${cfg.color}44`, borderRadius: "0 0 12px 12px", overflow: "hidden" }}>
        <div style={{ height: 3, background: `linear-gradient(90deg, ${cfg.color}, ${cfg.color}44)` }} />

        {/* Stats */}
        <div style={{ display: "flex", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <Stat icon={Table2}        label={`Catálogo ${cfg.flag}`}        value={String(catalogStats.total)}              sub={`${catalogStats.withCost} con costo definido`} color={cfg.color} />
          <Stat icon={Package}       label={`Productos analytics`}         value={String(stats.total)}                     sub={`${stats.covered} con costo base`}             color="#6366F1" />
          <Stat icon={AlertTriangle} label="Sin costo (con ventas)"        value={String(stats.missing)}                  sub={`$${usd(stats.missedRev)} sin COGS`}          color="#EF4444" />
          <Stat icon={DollarSign}    label={`COGS calculado (${days}d)`}   value={`$${usd(stats.totalCogs)}`}             sub={`${pct(stats.cogsPct)} del revenue`}          color="#F59E0B" />
          <Stat icon={Percent}       label="Margen bruto"                  value={`${(100 - stats.cogsPct).toFixed(1)}%`} sub="Revenue − COGS"                               color="#EC4899" />
        </div>

        {/* Sub-tabs */}
        <div style={{ display: "flex", gap: 2, padding: "12px 20px 0", borderBottom: "1px solid var(--border)", background: "var(--bg-2)", flexWrap: "wrap" }}>
          {SUB_TABS.map(t => {
            const active = subTab === t.key;
            return (
              <button key={t.key} onClick={() => setSubTab(t.key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: "8px 8px 0 0", cursor: "pointer", background: active ? "var(--card)" : "transparent", border: `1px solid ${active ? "var(--border)" : "transparent"}`, borderBottom: active ? "1px solid var(--card)" : "1px solid transparent", color: active ? cfg.color : "var(--text-3)", fontSize: 12, fontWeight: active ? 700 : 500, marginBottom: active ? -1 : 0 }}>
                <t.icon size={13} /> {t.label}
                {t.badge && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 10, background: t.key === "sincosto" ? "#EF444422" : `${cfg.color}22`, color: t.key === "sincosto" ? "#EF4444" : cfg.color, fontWeight: 700 }}>{t.badge}</span>}
              </button>
            );
          })}
          {(subTab !== "catalogo" && subTab !== "escalones" && subTab !== "historial") && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", paddingBottom: 8 }}>
              <div style={{ position: "relative" }}>
                <Search size={12} color="var(--text-3)" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…" style={{ padding: "5px 8px 5px 26px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-2)", color: "var(--text)", fontSize: 11, outline: "none", width: 160 }} />
              </div>
              {(["all", "glowmmi", "balancea"] as const).map(b => (
                <button key={b} onClick={() => setBrand(b)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: `1px solid ${brand === b ? BRAND_COLORS[b] ?? "#6366F1" : "var(--border)"}`, background: brand === b ? (BRAND_COLORS[b] ?? "#6366F1") + "22" : "transparent", color: brand === b ? (BRAND_COLORS[b] ?? "#6366F1") : "var(--text-3)", cursor: "pointer" }}>
                  {b === "all" ? "Todas" : BRAND_LABELS[b]}
                </button>
              ))}
            </div>
          )}
          {subTab === "catalogo" && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", paddingBottom: 8 }}>
              <div style={{ position: "relative" }}>
                <Search size={12} color="var(--text-3)" style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)" }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto…" style={{ padding: "5px 8px 5px 26px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-2)", color: "var(--text)", fontSize: 11, outline: "none", width: 180 }} />
              </div>
              {(["all", "glowmmi", "balancea"] as const).map(b => (
                <button key={b} onClick={() => setBrand(b)} style={{ padding: "5px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600, border: `1px solid ${brand === b ? BRAND_COLORS[b] ?? "#6366F1" : "var(--border)"}`, background: brand === b ? (BRAND_COLORS[b] ?? "#6366F1") + "22" : "transparent", color: brand === b ? (BRAND_COLORS[b] ?? "#6366F1") : "var(--text-3)", cursor: "pointer" }}>
                  {b === "all" ? "Todas" : BRAND_LABELS[b]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div>
          {loading && subTab !== "catalogo" ? (
            <div style={{ padding: 64, textAlign: "center", color: "var(--text-3)" }}>Cargando…</div>
          ) : (
            <>
              {subTab === "catalogo" && <CatalogoCOGS country={countryTab} brand={brand} search={search} />}
              {subTab === "base"     && <CostosBaseTable rows={baseRows}     country={countryTab} saving={saving} onSave={saveCost} />}
              {subTab === "sincosto" && (
                <>
                  <div style={{ padding: "10px 20px 6px", display: "flex", gap: 12 }}>
                    <AlertTriangle size={14} color="#EF4444" />
                    <span style={{ fontSize: 12, color: "#EF4444", fontWeight: 600 }}>{sinCostRows.length} productos con ventas sin costo asignado</span>
                  </div>
                  <CostosBaseTable rows={sinCostRows} country={countryTab} saving={saving} onSave={saveCost} />
                </>
              )}
              {subTab === "escalones" && <div style={{ padding: 20 }}><EscalonesView country={countryTab} /></div>}
              {subTab === "historial" && <div style={{ padding: 20 }}><HistorialView /></div>}
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-3)", lineHeight: 1.7 }}>
        <strong style={{ color: "var(--text-2)" }}>Catálogo por oferta</strong> = nueva tabla con COGS por país + bundle · click en cualquier celda para editar.
        <strong style={{ color: "var(--text-2)" }}> Costos Base</strong> = vista legacy por producto único.
        <strong style={{ color: "var(--text-2)" }}> CPA BE / ROAS BE</strong> = calculados con AOV real de los últimos {days} días.
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
