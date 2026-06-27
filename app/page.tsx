"use client";
import { useEffect, useState, useCallback } from "react";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { fmtNum, fmtPct, localDateStr, daysAgoLocal } from "@/lib/utils";
import { useFilters } from "@/lib/filters";
import { useCurrency, CURRENCY_INFO, type CurrencyCode } from "@/lib/currency";
import {
  TrendingUp, TrendingDown, RefreshCw, ShoppingCart,
  Banknote, Zap, Target, BarChart3, ArrowUpRight, CheckSquare,
  Search, Download, SlidersHorizontal, Globe, AlertTriangle,
  DollarSign, Package, Truck, CreditCard, Plus, X, ShieldAlert,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

/* ─── Types ──────────────────────────────────────────────────── */
interface DashboardData {
  totals: {
    orders: number; units: number; gross: number; net: number;
    discounts: number; returns: number;
    adSpend: number; cogs: number; shipping: number; fees: number; taxes: number; other: number;
    profit: number; realProfit: number; chargebacks: number;
    margin: number; realMargin: number;
    cpa: number | null; roas: number | null; mer: number | null;
    aov: number; cpaBe: number | null; roasBe: number | null;
    profitPerOrder: number | null; realProfitPerOrder: number | null;
  };
  chartData: Array<{ date: string; glowmmi: number; balancea: number; profit: number; adSpend: number; orders: number; cogs: number; fees: number }>;
  byBrand: Array<{ name: string; brandId: string; revenue: number; net: number; profit: number; orders: number; units: number; adSpend: number; cogs: number; shipping: number; fees: number; chargebacks?: number }>;
  byCountry: Array<{ name: string; code: string; revenue: number; profit: number; orders: number; currency: string }>;
  tasks: Array<{ id: string; title: string; status: string; priority: string; category?: string; brand?: { name: string } }>;
}

/* ─── Estado Financiero logic ────────────────────────────────── */
type EstadoType = "escalable" | "rentable" | "rentable_justo" | "no_rentable" | "sin_ventas" | "sin_pauta" | "incompleto";

function getEstado(
  orders: number,
  adSpend: number,
  cogsPresent: boolean,
  profit: number,
  margin: number,
  cpa: number | null,
  cpaBe: number | null,
  targetMargin = 20
): EstadoType {
  if (orders === 0) return "sin_ventas";
  if (adSpend === 0 || cpa === null) return "sin_pauta";
  if (!cogsPresent) return "incompleto";
  if (profit < 0) return "no_rentable";
  if (margin >= targetMargin && cpaBe !== null && cpa < cpaBe * 0.75) return "escalable";
  if (profit > 0 && cpaBe !== null && cpa < cpaBe) return "rentable";
  return "rentable_justo";
}

const ESTADO_CONFIG: Record<EstadoType, { label: string; bg: string; color: string; dot: string }> = {
  escalable:      { label: "⬆ Escalable",        bg: "#D1FAE5", color: "#065F46", dot: "#10B981" },
  rentable:       { label: "✓ Rentable",          bg: "#DBEAFE", color: "#1E40AF", dot: "#3B82F6" },
  rentable_justo: { label: "≈ Rentable Justo",    bg: "#FEF3C7", color: "#92400E", dot: "#F59E0B" },
  no_rentable:    { label: "✗ No Rentable",       bg: "#FEE2E2", color: "#991B1B", dot: "#DC2626" },
  sin_ventas:     { label: "○ Sin Ventas",         bg: "#F3F4F6", color: "#6B7280", dot: "#9CA3AF" },
  sin_pauta:      { label: "◌ Sin Pauta",          bg: "#F3F4F6", color: "#6B7280", dot: "#9CA3AF" },
  incompleto:     { label: "— Datos Incompletos",  bg: "#F3F4F6", color: "#6B7280", dot: "#9CA3AF" },
};

/* ─── Filter constants ───────────────────────────────────────── */
const BRANDS = [
  { label: "Todas",    value: "all",           color: undefined },
  { label: "Glowmmi",  value: "brand_glowmmi",  color: "#EC4899" },
  { label: "Balancea", value: "brand_balancea", color: "#10B981" },
];

const COUNTRIES = [
  { label: "Todos",    value: "all"        },
  { label: "🇺🇸 USA",   value: "country_us" },
  { label: "🇲🇽 México", value: "country_mx" },
  { label: "🇨🇱 Chile",  value: "country_cl" },
];

/* ─── FilterPill ─────────────────────────────────────────────── */
function FilterPill({
  label, active, onClick, color,
}: {
  label: string; active: boolean; onClick: () => void; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="filter-pill"
      style={
        active
          ? { background: color ?? "#2563EB", borderColor: color ?? "#2563EB", color: "#fff" }
          : {}
      }
    >
      {label}
    </button>
  );
}

/* ─── KpiCard (hero / grande) ────────────────────────────────── */
function KpiCard({
  label, value, sub, color, icon: Icon, alert, badge, onExplain,
}: {
  label: string; value: string; sub?: string; color: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  alert?: boolean; badge?: { text: string; type: "good" | "ok" | "bad" | "neutral" };
  onExplain?: () => void;
}) {
  return (
    <div
      className="kpi-card"
      style={{ position: "relative", cursor: onExplain ? "pointer" : undefined }}
      onClick={onExplain}
      title={onExplain ? "Clic para ver cómo se calcula" : undefined}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
          {label}
          {onExplain && <span style={{ marginLeft: 5, fontSize: 10, color: "var(--text-3)", fontWeight: 400, opacity: 0.6 }}>ⓘ</span>}
        </p>
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: alert ? "#FEE2E2" : color + "18",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >
          <Icon size={14} style={{ color: alert ? "#DC2626" : color }} />
        </div>
      </div>
      <p style={{
        fontSize: 26, fontWeight: 800,
        color: alert ? "#DC2626" : "var(--text)",
        letterSpacing: "-0.02em", lineHeight: 1,
      }}>
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6, fontWeight: 500 }}>
          {sub}
        </p>
      )}
      {badge && (
        <div style={{ marginTop: 10 }}>
          <StatusBadge label={badge.text} type={badge.type} />
        </div>
      )}
    </div>
  );
}

/* ─── CompactMetric (fila Costos) ────────────────────────────── */
function CompactMetric({
  label, value, sub, color, icon: Icon, onExplain,
}: {
  label: string; value: string; sub?: string; color: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  onExplain?: () => void;
}) {
  return (
    <div
      className="card-flat"
      onClick={onExplain}
      style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 14, cursor: onExplain ? "pointer" : undefined }}
    >
      <div
        style={{
          width: 40, height: 40, borderRadius: 10,
          background: color + "15",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <Icon size={16} style={{ color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 4 }}>
          {label}
          {onExplain && <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 400, opacity: 0.5 }}>ⓘ</span>}
        </p>
        <p style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>
          {value}
        </p>
        {sub && <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</p>}
      </div>
    </div>
  );
}

/* ─── StatusBadge ────────────────────────────────────────────── */
function StatusBadge({ label, type }: { label: string; type: "good" | "ok" | "bad" | "neutral" }) {
  const styles = {
    good:    { background: "var(--green-bg)",  color: "var(--green-text)" },
    ok:      { background: "var(--yellow-bg)", color: "var(--yellow-text)" },
    bad:     { background: "var(--red-bg)",    color: "var(--red-text)" },
    neutral: { background: "var(--bg-2)",      color: "var(--text-3)" },
  };
  return (
    <span className="status-badge" style={styles[type]}>
      {label}
    </span>
  );
}

/* ─── EstadoBadge ────────────────────────────────────────────── */
function EstadoBadge({ estado }: { estado: EstadoType }) {
  const cfg = ESTADO_CONFIG[estado];
  return (
    <span
      className="status-badge"
      style={{ background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700 }}
    >
      {cfg.label}
    </span>
  );
}

/* ─── CpaIndicator (semáforo) ────────────────────────────────── */
function CpaIndicator({ cpa, cpaBe, fmtC }: { cpa: number | null; cpaBe: number | null; fmtC: (v: number) => string }) {
  if (cpa === null) return <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-3)" }}>Sin pauta</div>;
  const pct = cpaBe && cpaBe > 0 ? (cpa / cpaBe) * 100 : 0;
  const color = pct > 100 ? "#DC2626" : pct > 85 ? "#F59E0B" : "#10B981";
  const icon = pct > 100 ? "🔴" : pct > 85 ? "🟡" : "🟢";
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color }}>
        {icon} {fmtC(cpa)}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>
        BE: {cpaBe !== null ? fmtC(cpaBe) : "—"}
      </div>
    </div>
  );
}

/* ─── SectionLabel ───────────────────────────────────────────── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{
        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em",
        textTransform: "uppercase", color: "var(--text-3)",
      }}>
        {children}
      </span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

/* ─── Chargeback modal ───────────────────────────────────────── */
function ChargebackModal({
  onClose, onSaved,
}: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    date: localDateStr(),
    brandId: "brand_glowmmi",
    amount: "",
    orderId: "",
    reason: "fraud",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) return;
    setSaving(true);
    await fetch("/api/chargebacks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "var(--card)", borderRadius: 16, padding: 32,
        width: "100%", maxWidth: 420, boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--red-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShieldAlert size={18} style={{ color: "var(--red)" }} />
            </div>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Registrar Chargeback</p>
              <p style={{ fontSize: 12, color: "var(--text-3)" }}>Se restará de la ganancia real</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {[
          { label: "Fecha", type: "date", key: "date" },
          { label: "Monto (USD)", type: "number", key: "amount", placeholder: "0.00" },
          { label: "Nº de Orden (opcional)", type: "text", key: "orderId", placeholder: "#1234" },
          { label: "Notas (opcional)", type: "text", key: "notes", placeholder: "Descripción..." },
        ].map((f) => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              {f.label}
            </label>
            <input
              type={f.type}
              placeholder={f.placeholder}
              value={(form as any)[f.key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 8,
                border: "1.5px solid var(--border)", background: "var(--bg-2)",
                fontSize: 14, color: "var(--text)", outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        ))}

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Marca</label>
          <select
            value={form.brandId}
            onChange={(e) => setForm((p) => ({ ...p, brandId: e.target.value }))}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg-2)", fontSize: 14, color: "var(--text)" }}
          >
            <option value="brand_glowmmi">Glowmmi</option>
            <option value="brand_balancea">Balancea</option>
          </select>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Motivo</label>
          <select
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--bg-2)", fontSize: 14, color: "var(--text)" }}
          >
            <option value="fraud">Fraude</option>
            <option value="item_not_received">Pedido no recibido</option>
            <option value="not_as_described">Producto no coincide</option>
            <option value="duplicate">Cobro duplicado</option>
            <option value="other">Otro</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "10px", borderRadius: 8,
            background: "var(--bg-2)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Cancelar</button>
          <button onClick={save} disabled={saving} style={{
            flex: 2, padding: "10px", borderRadius: 8,
            background: saving ? "var(--border)" : "var(--red)",
            border: "none", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>
            {saving ? "Guardando..." : "Registrar Chargeback"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ExplainerModal ─────────────────────────────────────────── */
type ExplainRow = { label: string; value: string; sub?: string; isTotal?: boolean; isDivider?: boolean };

function ExplainerModal({
  metricKey, t, fmtC, derived, onClose,
}: {
  metricKey: string;
  t: DashboardData["totals"];
  fmtC: (v: number) => string;
  derived: {
    grossProfit: number; grossMargin: number; totalCosts: number; totalCostsTP: number;
    netMarginVsNet: number; poas: number | null; roasBe: number | null;
    breakEvenCpa: number | null; profitPerOrder: number;
    cogsPerOrder: number; adSpendPerOrder: number; shippingPerOrder: number; feesPerOrder: number;
    cpaMáx: number;
  };
  onClose: () => void;
}) {
  type Def = { title: string; subtitle: string; rows: ExplainRow[]; source: string; note?: string };

  const { grossProfit, grossMargin, totalCosts, totalCostsTP, netMarginVsNet, poas, roasBe, breakEvenCpa, profitPerOrder, cogsPerOrder, adSpendPerOrder, shippingPerOrder, feesPerOrder, cpaMáx } = derived;

  const defs: Record<string, Def> = {
    net_profit: {
      title: "Net Profit", subtitle: "Ganancia neta después de todos los costos",
      rows: [
        { label: "Revenue Neto",         value: fmtC(t.net),              sub: "Shopify (después de descuentos y devoluciones)" },
        { label: "− COGS (proveedor)",   value: `−${fmtC(t.cogs)}`,       sub: "/costos → product-costs.json" },
        { label: "− Ad Spend",           value: `−${fmtC(t.adSpend)}`,    sub: "Meta Ads API" },
        { label: "− Flete / Envío",      value: `−${fmtC(t.shipping)}`,   sub: "Shopify shipping lines" },
        { label: "− Fees / Pasarela",    value: `−${fmtC(t.fees)}`,       sub: "Estimado: 2.9% + $0.30 por transacción" },
        { label: "− Chargebacks",        value: `−${fmtC(t.chargebacks ?? 0)}`, sub: "Entrada manual" },
        { isDivider: true, label: "", value: "" },
        { label: "= Net Profit",         value: fmtC(t.profit),           isTotal: true },
      ],
      source: "Shopify + Meta Ads + /costos + Manual",
    },
    cogs_kpi: {
      title: "COGS Spend", subtitle: "Costo total pagado a proveedores en el período",
      rows: [
        { label: "¿De dónde viene?",     value: "", sub: "Se calcula por producto: unidades vendidas × costo por escalón" },
        { label: "Fuente de costos",     value: "", sub: "data/product-costs.json → tabla ProductCogsByCountry en BD" },
        { label: "Fuente de ventas",     value: "", sub: "Shopify Orders → OrderLine → cantidad vendida" },
        { isDivider: true, label: "", value: "" },
        { label: "COGS Total",           value: fmtC(t.cogs),             isTotal: true },
        { label: "COGS por pedido",      value: fmtC(cogsPerOrder),       sub: `${fmtC(t.cogs)} ÷ ${t.orders} pedidos` },
        { label: "% del Revenue",        value: t.net > 0 ? `${((t.cogs / t.net) * 100).toFixed(1)}%` : "—", sub: "COGS / Revenue Neto" },
        { label: "Gross Profit restante",value: fmtC(grossProfit),        sub: `Revenue ${fmtC(t.net)} − COGS ${fmtC(t.cogs)}` },
      ],
      source: "/costos (product-costs.json)",
      note: "Si el COGS es $0, ve a /costos a cargar los costos de tus productos.",
    },
    revenue: {
      title: "Revenue Neto", subtitle: "Ingresos reales después de descuentos y devoluciones",
      rows: [
        { label: "Ventas Brutas (Gross)", value: fmtC(t.gross),           sub: "Suma de todos los precios de línea en Shopify" },
        { label: "− Descuentos",          value: `−${fmtC(t.discounts ?? 0)}`, sub: "Códigos de descuento y automáticos" },
        { label: "− Devoluciones",        value: `−${fmtC(t.returns ?? 0)}`,   sub: "Refunds en Shopify" },
        { isDivider: true, label: "", value: "" },
        { label: "= Revenue Neto",        value: fmtC(t.net),             isTotal: true },
      ],
      source: "Shopify Orders API",
    },
    total_costs: {
      title: "Total Costs", subtitle: "Suma de todos los costos del período",
      rows: [
        { label: "COGS",         value: fmtC(t.cogs),                sub: "Costo de productos (proveedor)" },
        { label: "Ad Spend",     value: fmtC(t.adSpend),             sub: "Pauta Meta Ads" },
        { label: "Flete",        value: fmtC(t.shipping),            sub: "Costo de envío a clientes" },
        { label: "Fees",         value: fmtC(t.fees),                sub: "Comisiones de pasarela de pago" },
        { label: "Chargebacks",  value: fmtC(t.chargebacks ?? 0),   sub: "Contracargos registrados" },
        { isDivider: true, label: "", value: "" },
        { label: "= Total Costs",value: fmtC(totalCosts),            isTotal: true },
        { label: "% del Revenue",value: t.net > 0 ? `${((totalCosts / t.net) * 100).toFixed(1)}%` : "—" },
      ],
      source: "Shopify + Meta Ads + Estimado + Manual",
      note: "Total Costs = Revenue − Net Profit (método True Profit). Incluye todo lo que sale del negocio.",
    },
    net_margin: {
      title: "Net Profit Margin", subtitle: "% de cada peso de revenue que queda como ganancia",
      rows: [
        { label: "Net Profit",    value: fmtC(t.profit),              sub: "Ganancia después de todos los costos" },
        { label: "÷ Revenue Neto",value: fmtC(t.net),                 sub: "Ingresos reales del período" },
        { label: "× 100",         value: "",                          sub: "Para expresar en porcentaje" },
        { isDivider: true, label: "", value: "" },
        { label: "= Net Margin",  value: `${netMarginVsNet.toFixed(2)}%`, isTotal: true },
        { label: "Gross Margin",  value: `${grossMargin.toFixed(1)}%`,    sub: `(Revenue − COGS) / Revenue = Margen antes de ads` },
      ],
      source: "Calculado en dashboard",
    },
    ad_spend: {
      title: "Total Ad Spend", subtitle: "Inversión total en publicidad de Meta Ads",
      rows: [
        { label: "Fuente",        value: "",       sub: "Meta Ads API — se sincroniza automáticamente al abrir el dashboard" },
        { label: "Cobertura",     value: "",       sub: "Incluye todas las cuentas y campañas del período" },
        { isDivider: true, label: "", value: "" },
        { label: "Ad Spend Total",value: fmtC(t.adSpend),   isTotal: true },
        { label: "por Pedido",    value: fmtC(adSpendPerOrder), sub: `${fmtC(t.adSpend)} ÷ ${t.orders} pedidos` },
        { label: "% del Revenue", value: t.net > 0 ? `${((t.adSpend / t.net) * 100).toFixed(1)}%` : "—" },
        { label: "ROAS",          value: t.roas !== null ? `${t.roas.toFixed(2)}x` : "—", sub: `Revenue / Ad Spend = ${fmtC(t.net)} / ${fmtC(t.adSpend)}` },
      ],
      source: "Meta Ads API",
    },
    aov: {
      title: "Average Order Value (AOV)", subtitle: "Cuánto gasta cada cliente en promedio por pedido",
      rows: [
        { label: "Revenue Neto",  value: fmtC(t.net),      sub: "Ingresos totales del período" },
        { label: "÷ Pedidos",     value: String(t.orders),  sub: "Número de órdenes en el período" },
        { isDivider: true, label: "", value: "" },
        { label: "= AOV",         value: fmtC(t.aov),      isTotal: true },
      ],
      source: "Shopify Orders API",
      note: "Un AOV más alto = más margen por costo de adquisición. Meta para skincare DTC: ≥$50 USD.",
    },
    units: {
      title: "Units Sold", subtitle: "Total de unidades vendidas en el período",
      rows: [
        { label: "Fuente",         value: "",       sub: "Shopify Orders → cada línea de producto suma sus quantities" },
        { label: "Unidades Total", value: String(t.units), isTotal: true },
        { label: "Unidades/Pedido",value: t.orders > 0 ? (t.units / t.orders).toFixed(1) : "—", sub: `${t.units} uds ÷ ${t.orders} pedidos` },
      ],
      source: "Shopify Orders API",
    },
    gross_sales: {
      title: "Gross Sales", subtitle: "Ventas brutas antes de descuentos y devoluciones",
      rows: [
        { label: "Fuente",         value: "",         sub: "Suma de line_item.price × quantity en cada orden de Shopify" },
        { label: "Gross Sales",    value: fmtC(t.gross), isTotal: true },
        { label: "− Descuentos",   value: `−${fmtC(t.discounts ?? 0)}` },
        { label: "− Devoluciones", value: `−${fmtC(t.returns ?? 0)}` },
        { label: "= Revenue Neto", value: fmtC(t.net),   sub: `${t.gross > 0 ? ((t.net / t.gross) * 100).toFixed(0) : 0}% del bruto` },
      ],
      source: "Shopify Orders API",
    },
    roas: {
      title: "ROAS", subtitle: "Return on Ad Spend — cuántos $ de revenue genera cada $ invertido en ads",
      rows: [
        { label: "Revenue Neto",  value: fmtC(t.net),      sub: "Ingresos del período" },
        { label: "÷ Ad Spend",    value: fmtC(t.adSpend),  sub: "Inversión en Meta Ads" },
        { isDivider: true, label: "", value: "" },
        { label: "= ROAS",        value: t.roas !== null ? `${t.roas.toFixed(2)}x` : "—", isTotal: true },
        { label: "ROAS BE",       value: roasBe !== null ? `${roasBe.toFixed(2)}x` : "—", sub: "Mínimo para no perder — calculado con tu estructura de costos" },
      ],
      source: "Revenue: Shopify | Ad Spend: Meta Ads",
      note: "Meta para DTC: ROAS ≥ 3x. Por debajo del ROAS BE estás perdiendo por cada $1 invertido.",
    },
    cpa: {
      title: "CPA Real", subtitle: "Costo por adquisición — cuánto cuesta conseguir un cliente",
      rows: [
        { label: "Ad Spend Total",value: fmtC(t.adSpend),  sub: "Inversión en Meta Ads" },
        { label: "÷ Pedidos",     value: String(t.orders),  sub: "Número de órdenes atribuidas" },
        { isDivider: true, label: "", value: "" },
        { label: "= CPA Real",    value: t.cpa !== null ? fmtC(t.cpa) : "—", isTotal: true },
        { label: "CPA Break-Even",value: breakEvenCpa !== null ? fmtC(breakEvenCpa) : "—", sub: "CPA máximo antes de perder dinero por pedido" },
      ],
      source: "Ad Spend: Meta Ads | Pedidos: Shopify",
      note: "Si CPA > CPA BE, cada venta te cuesta más de lo que ganas. Meta: CPA < CPA BE × 0.75.",
    },
    cpa_be: {
      title: "CPA Break-Even", subtitle: "CPA máximo que puedes pagar sin perder dinero",
      rows: [
        { label: "Revenue por Pedido (AOV)", value: fmtC(t.aov) },
        { label: "− COGS por Pedido",        value: `−${fmtC(cogsPerOrder)}` },
        { label: "− Flete por Pedido",       value: `−${fmtC(shippingPerOrder)}` },
        { label: "− Fees por Pedido",        value: `−${fmtC(feesPerOrder)}` },
        { isDivider: true, label: "", value: "" },
        { label: "= CPA BE (Margen Bruto)",  value: breakEvenCpa !== null ? fmtC(breakEvenCpa) : "—", isTotal: true },
        { label: "CPA Máx c/15% reserva",   value: cpaMáx > 0 ? fmtC(cpaMáx) : "—", sub: "AOV − COGS − Flete − Fees − 15% del AOV" },
      ],
      source: "Calculado en dashboard con datos de Shopify y /costos",
    },
    mer: {
      title: "MER (Marketing Efficiency Ratio)", subtitle: "Eficiencia total del negocio, no solo de los ads",
      rows: [
        { label: "Revenue Neto",  value: fmtC(t.net),     sub: "Total de ingresos" },
        { label: "÷ Ad Spend",    value: fmtC(t.adSpend), sub: "Inversión en publicidad" },
        { isDivider: true, label: "", value: "" },
        { label: "= MER",         value: t.mer !== null ? `${t.mer.toFixed(2)}x` : "—", isTotal: true },
      ],
      source: "Revenue: Shopify | Ad Spend: Meta Ads",
      note: "A diferencia del ROAS (que usa el revenue atribuido por Meta), el MER usa el revenue real de Shopify. Es más honesto.",
    },
    poas: {
      title: "POAS (Profit on Ad Spend)", subtitle: "Cuántos $ de gross profit genera cada $ invertido en ads",
      rows: [
        { label: "Gross Profit",  value: fmtC(grossProfit), sub: `Revenue ${fmtC(t.net)} − COGS ${fmtC(t.cogs)}` },
        { label: "÷ Ad Spend",    value: fmtC(t.adSpend) },
        { isDivider: true, label: "", value: "" },
        { label: "= POAS",        value: poas !== null ? `${poas.toFixed(2)}x` : "—", isTotal: true },
      ],
      source: "Calculado en dashboard",
      note: "POAS > 1 = los ads generan más profit del que cuestan. Es más preciso que el ROAS para medir rentabilidad real.",
    },
    cogs_compact: {
      title: "COGS", subtitle: "Pago a proveedor — costo directo de los productos vendidos",
      rows: [
        { label: "Cálculo",       value: "", sub: "Unidades vendidas × costo unitario por escalón de precio" },
        { label: "Escalones",     value: "", sub: "x1, x2, x3... — el costo unitario baja al comprar más unidades" },
        { isDivider: true, label: "", value: "" },
        { label: "COGS Total",    value: fmtC(t.cogs),       isTotal: true },
        { label: "por Pedido",    value: fmtC(cogsPerOrder), sub: `${fmtC(t.cogs)} ÷ ${t.orders} pedidos` },
        { label: "% Revenue",     value: t.net > 0 ? `${((t.cogs / t.net) * 100).toFixed(1)}%` : "—" },
      ],
      source: "data/product-costs.json → ProductCogsByCountry → Shopify Orders",
    },
    flete: {
      title: "Flete / Envío", subtitle: "Costo de logística pagado para entregar los pedidos",
      rows: [
        { label: "Fuente",        value: "", sub: "Shopify Orders → shipping_lines.price de cada orden" },
        { label: "Tipo",          value: "", sub: "Incluye envío estándar, express, y cualquier línea de shipping de Shopify" },
        { isDivider: true, label: "", value: "" },
        { label: "Flete Total",   value: fmtC(t.shipping),          isTotal: true },
        { label: "por Pedido",    value: fmtC(shippingPerOrder),    sub: `${fmtC(t.shipping)} ÷ ${t.orders} pedidos` },
        { label: "% Revenue",     value: t.net > 0 ? `${((t.shipping / t.net) * 100).toFixed(1)}%` : "—" },
      ],
      source: "Shopify Orders API (shipping_lines)",
    },
    fees: {
      title: "Fees / Pasarela de Pago", subtitle: "Comisión que cobra el procesador de pagos",
      rows: [
        { label: "Fórmula",       value: "", sub: "2.9% del monto + $0.30 por transacción (tarifa estándar Shopify Payments / Stripe)" },
        { label: "Ejemplo",       value: "", sub: `Pedido de $100 → 2.9% × $100 + $0.30 = $3.20 de fee` },
        { isDivider: true, label: "", value: "" },
        { label: "Fees Total",    value: fmtC(t.fees),              isTotal: true },
        { label: "por Pedido",    value: fmtC(feesPerOrder),        sub: `${fmtC(t.fees)} ÷ ${t.orders} pedidos` },
        { label: "% Revenue",     value: t.net > 0 ? `${((t.fees / t.net) * 100).toFixed(1)}%` : "—" },
      ],
      source: "Estimado (no viene de Shopify directamente)",
      note: "Si usas una pasarela diferente a Shopify Payments, ajusta la tasa en el código (app/api/dashboard).",
    },
  };

  const def = defs[metricKey];
  if (!def) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--card)", borderRadius: 18, padding: 32, width: "100%", maxWidth: 500, boxShadow: "0 32px 80px rgba(0,0,0,0.35)", maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", lineHeight: 1.2 }}>{def.title}</p>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>{def.subtitle}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: 4, fontSize: 20, lineHeight: 1, marginLeft: 16, flexShrink: 0 }}>×</button>
        </div>

        {/* Rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {def.rows.map((row, i) =>
            row.isDivider ? (
              <div key={i} style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
            ) : (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  padding: "9px 12px", borderRadius: 8,
                  background: row.isTotal ? "var(--bg-2)" : "transparent",
                  border: row.isTotal ? "1px solid var(--border)" : "1px solid transparent",
                }}
              >
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: row.isTotal ? 800 : 500, color: row.isTotal ? "var(--text)" : "var(--text-2)" }}>
                    {row.label}
                  </p>
                  {row.sub && <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{row.sub}</p>}
                </div>
                {row.value && (
                  <p style={{ fontSize: 14, fontWeight: 800, color: row.isTotal ? "var(--text)" : row.value.startsWith("−") ? "var(--red)" : "var(--text)", fontFamily: "monospace", marginLeft: 16, whiteSpace: "nowrap" }}>
                    {row.value}
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {/* Source */}
        <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", marginBottom: 3 }}>Fuente de datos</p>
          <p style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{def.source}</p>
        </div>

        {/* Note */}
        {def.note && (
          <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8, background: "var(--yellow-bg)", border: "1px solid var(--yellow)" }}>
            <p style={{ fontSize: 12, color: "var(--yellow-text)", fontWeight: 500 }}>{def.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Dashboard ──────────────────────────────────────────────── */
export default function Dashboard() {
  const { days, brand, country, setBrand, setCountry, isCustom, customFrom, customTo } = useFilters();
  const { currency, setCurrency, fmtC, rateLabel, ratesLoaded, ratesFallback } = useCurrency();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCbModal, setShowCbModal] = useState(false);
  const [showProfit, setShowProfit] = useState(false);
  const [explainerKey, setExplainerKey] = useState<string | null>(null);
  const explain = (key: string) => () => setExplainerKey(key);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);   // silent background sync on mount
  const [lastSynced, setLastSynced] = useState<string>("");
  const [productStats, setProductStats] = useState<{
    topProducts: Array<{ code: string; name: string; brandId: string; revenue: number; profit: number; orders: number; adSpend: number; cogs: number; margin: number; avgRoas: number | null; avgCpa: number | null }>;
    daily: Array<{ date: string; products: Array<{ code: string; name: string; brandId: string; orders: number; revenue: number; adSpend: number; cogs: number; profit: number; roas: number | null; cpa: number | null; isProfit: boolean }> }>;
  } | null>(null);
  // Meta token expiry — System User token nunca expira, sin alerta
  const [metaTokenHours] = useState<number | null>(null); // null = sin alerta

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isCustom && customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", String(days));
    }
    if (brand !== "all") params.set("brand", brand);
    if (country !== "all") params.set("country", country);
    fetch(`/api/dashboard?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));

    // Product stats (same date range)
    const pParams = new URLSearchParams();
    if (isCustom && customFrom && customTo) {
      pParams.set("from", customFrom); pParams.set("to", customTo);
    } else {
      const from = daysAgoLocal(days - 1);
      const to   = localDateStr();
      pParams.set("from", from); pParams.set("to", to);
    }
    if (brand !== "all") pParams.set("brand", brand);
    fetch(`/api/products/stats?${pParams}`)
      .then((r) => r.json())
      .then((d) => setProductStats(d))
      .catch(() => {});
  }, [days, brand, country, isCustom, customFrom, customTo]);

  // ── Sync helpers ─────────────────────────────────────────────────────────────

  /** Sync ONLY Shopify orders (both stores). Used by the manual button.
   *
   * ⚠️  Runs stores SEQUENTIALLY (not in parallel) to avoid concurrent SQLite writes:
   *     Parallel syncs both call the rollup at the same time → write conflicts.
   *
   * ⚠️  Always syncs at least 30 days regardless of the current date-range filter.
   *     Using Math.max(days, 3) was a bug: syncing only 3 days would trigger the
   *     stale-row deletion for the 3-day window, wiping historical shopify_* rows.
   */
  const syncShopify = useCallback(async () => {
    setSyncing(true);
    try {
      // Respaldo de seguridad antes de sincronizar (punto de restauración)
      try { await fetch("/api/backup", { method: "POST" }); } catch { /* no crítico */ }
      // SOLO últimos 15 días — actualiza el mes en curso sin tocar meses cerrados.
      // Los meses pasados quedan fijos en la BD; nunca se re-sincronizan ni se degradan.
      const syncDays = 15;
      await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: "glowmmi", days: syncDays }),
      });
      await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: "balancea", days: syncDays }),
      });
      setLastSynced(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }));
      // Resetear el contador de 7 días: el AppLoader no re-sincronizará hasta dentro de una semana.
      if (typeof window !== "undefined") localStorage.setItem("onnexa_last_sync_at", String(Date.now()));
    } catch { /* non-critical */ }
    setSyncing(false);
    load();
  }, [days, load]);

  /**
   * Full sync: Shopify + Meta Ads + Rollup.
   * Runs automatically on mount so the dashboard always starts with fresh data.
   * Uses `setAutoSyncing` (not `setSyncing`) so the manual button stays enabled.
   */
  const autoSyncAll = useCallback(async () => {
    setAutoSyncing(true);
    try {
      // Step 1: Shopify (both stores) — sequential to avoid concurrent SQLite writes
      const syncDays = Math.max(days, 30); // always 30-day minimum
      await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: "glowmmi", days: syncDays }),
      });
      await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: "balancea", days: syncDays }),
      });

      // Step 2: Meta Ads sync
      const today    = localDateStr();
      const dateFrom = daysAgoLocal(syncDays - 1);
      await fetch("/api/meta-ads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo: today }),
      });

      // Step 3: Rollup adSpend → DailyMetric
      await fetch("/api/meta-ads/rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateFrom, to: today }),
      });

      setLastSynced(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }));
    } catch { /* non-critical */ }
    setAutoSyncing(false);
    load();
  }, [days, load]);

  // ── Load data from DB on filter change ──
  useEffect(() => { load(); }, [load]);

  // ── Re-fetch once AppLoader finishes its first-session sync ──
  useEffect(() => {
    const handler = () => load();
    window.addEventListener("onnexa-sync-done", handler);
    return () => window.removeEventListener("onnexa-sync-done", handler);
  }, [load]);

  // ── NO auto-sync on mount ──
  // AppLoader (layout.tsx) handles the only automatic sync — once per session.
  // Syncing again here would create race conditions and double-delete DB rows.
  // Use the manual "Actualizar" button to sync on demand.

  const t = data?.totals;

  /* ── Derived metrics ─────────────────────────────────── */
  const totalCosts = t ? t.cogs + t.shipping + t.fees + t.adSpend + (t.chargebacks ?? 0) : 0;
  // True Profit-style Total Costs = Revenue - Net Profit (includes everything)
  const totalCostsTP   = t ? t.net - t.profit : 0;
  // Net Profit Margin vs Net Revenue (True Profit style: profit / net_revenue)
  const netMarginVsNet = t && t.net > 0 ? (t.profit / t.net) * 100 : 0;
  const profitPerOrder   = t?.profitPerOrder ?? (t && t.orders > 0 ? t.profit / t.orders : 0);
  const cogsPerOrder     = t && t.orders > 0 ? t.cogs / t.orders : 0;
  const shippingPerOrder = t && t.orders > 0 ? t.shipping / t.orders : 0;
  const feesPerOrder     = t && t.orders > 0 ? t.fees / t.orders : 0;
  const dailyOrders      = t ? Math.round(t.orders / days) : 0;
  const breakEvenCpa     = t?.cpaBe ?? null;  // Use from API
  const cpaMáx           = t && t.aov > 0 && t.orders > 0
    ? t.aov - cogsPerOrder - shippingPerOrder - feesPerOrder - (t.aov * 0.15)
    : 0;
  const roasBe           = t?.roasBe ?? null;
  const grossProfit      = t ? t.net - t.cogs : 0;
  const grossMargin      = t && t.net > 0 ? (grossProfit / t.net) * 100 : 0;
  const poas             = t && t.adSpend > 0 ? grossProfit / t.adSpend : null;
  const adSpendPerOrder  = t && t.orders > 0 ? t.adSpend / t.orders : 0;
  const totalCostPerOrder = t && t.orders > 0 ? totalCosts / t.orders : 0;
  const hasAllData       = t ? (t.cogs > 0 && t.adSpend > 0 && t.shipping > 0) : false;
  const estadoGlobal     = t
    ? getEstado(t.orders, t.adSpend, t.cogs > 0, t.profit, t.margin, t.cpa, t.cpaBe)
    : "incompleto";

  /* ── Alertas ─────────────────────────────────────────── */
  const alertas: { icon: string; msg: string; type: "warn" | "error" | "info" }[] = [];

  // Meta token expiry — only evaluated client-side (metaTokenHours is null on SSR)
  if (metaTokenHours !== null) {
    if (metaTokenHours <= 0) {
      alertas.push({ icon: "🔑", msg: "Token de Meta Ads EXPIRADO — sync de ads detenido. Genera un nuevo token en Meta Business Manager y actualiza META_ADS_USER_TOKEN en .env", type: "error" });
    } else if (metaTokenHours <= 24) {
      alertas.push({ icon: "🔑", msg: `Token de Meta Ads expira en ${Math.ceil(metaTokenHours)}h — renuévalo en Meta Business Manager antes de que se detenga el sync`, type: "warn" });
    }
  }

  if (t) {
    if (t.cogs === 0)    alertas.push({ icon: "⚠️", msg: "COGS en 0 — la utilidad mostrada es una estimación incompleta", type: "warn" });
    if (t.adSpend === 0) alertas.push({ icon: "📢", msg: "Sin pauta registrada — revisa que el Ad Spend esté sincronizado", type: "info" });
    if (t.shipping === 0) alertas.push({ icon: "🚚", msg: "Sin flete registrado — los costos de envío no están reflejados", type: "warn" });
    if (t.adSpend > 0 && t.orders === 0)
      alertas.push({ icon: "💸", msg: "Hay gasto en pauta pero 0 pedidos — revisa el creativo, la campaña y la landing", type: "error" });
    if (t.cpa !== null && breakEvenCpa !== null && t.cpa > breakEvenCpa)
      alertas.push({ icon: "🔴", msg: `CPA Real (${fmtC(t.cpa)}) supera el CPA Break-Even (${fmtC(breakEvenCpa)}) — operando en pérdida por pedido`, type: "error" });
    else if (t.cpa !== null && breakEvenCpa !== null && t.cpa > breakEvenCpa * 0.85)
      alertas.push({ icon: "🟡", msg: `CPA en zona de riesgo — ${((t.cpa / breakEvenCpa) * 100).toFixed(0)}% del break-even`, type: "warn" });
    if (t.roas !== null && roasBe !== null && t.roas < roasBe)
      alertas.push({ icon: "📉", msg: `ROAS (${t.roas.toFixed(2)}x) por debajo del ROAS BE (${roasBe.toFixed(2)}x) — la oferta no alcanza su punto de equilibrio`, type: "warn" });
    if (country === "country_cl")
      alertas.push({ icon: "🇨🇱", msg: "Chile — Conversión CLP/USD en revisión. Valida la tasa de cambio antes de usar la utilidad como definitiva.", type: "warn" });
  }

  const derived = {
    grossProfit, grossMargin, totalCosts, totalCostsTP, netMarginVsNet,
    poas, roasBe, breakEvenCpa, profitPerOrder, cogsPerOrder,
    adSpendPerOrder, shippingPerOrder, feesPerOrder, cpaMáx,
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {showCbModal && (
        <ChargebackModal onClose={() => setShowCbModal(false)} onSaved={load} />
      )}
      {explainerKey && t && (
        <ExplainerModal metricKey={explainerKey} t={t} fmtC={fmtC} derived={derived} onClose={() => setExplainerKey(null)} />
      )}

      {/* ══════════════════════════════════════════════════════
          TOPBAR
      ══════════════════════════════════════════════════════ */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>

          {/* Title */}
          <div style={{ marginRight: 4 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
              Dashboard
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              Últimos {days} días
            </p>
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)", flexShrink: 0 }} />

          {/* Brand filter */}
          <div style={{ display: "flex", gap: 5 }}>
            {BRANDS.map((b) => (
              <FilterPill key={b.value} label={b.label} active={brand === b.value}
                onClick={() => setBrand(b.value)} color={b.color} />
            ))}
          </div>

          <div style={{ width: 1, height: 28, background: "var(--border)", flexShrink: 0 }} />

          {/* Country filter */}
          <div style={{ display: "flex", gap: 5 }}>
            {COUNTRIES.map((c) => (
              <FilterPill key={c.value} label={c.label} active={country === c.value}
                onClick={() => setCountry(c.value)} />
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }} />

          {/* Currency */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {(["USD", "MXN", "COP"] as CurrencyCode[]).map((c) => {
              const info = CURRENCY_INFO[c];
              const active = currency === c;
              return (
                <button key={c} suppressHydrationWarning onClick={() => setCurrency(c)} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 8,
                  fontSize: 12, fontWeight: 600,
                  background: active ? "#12304A" : "transparent",
                  color: active ? "#fff" : "var(--text-2)",
                  border: `1.5px solid ${active ? "#12304A" : "var(--border)"}`,
                  cursor: "pointer",
                }}>
                  <span>{info.flag}</span>{c}
                </button>
              );
            })}
          </div>

          {/* Rate badge */}
          {ratesLoaded && rateLabel && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 8,
              background: ratesFallback ? "var(--yellow-bg)" : "var(--green-bg)",
              color: ratesFallback ? "var(--yellow-text)" : "var(--green-text)",
              fontSize: 11, fontWeight: 600,
            }}>
              <Globe size={11} />{rateLabel}
            </div>
          )}

          {/* Facturas link */}
          <Link href="/facturas" style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600,
            textDecoration: "none",
          }}>
            📦 Facturas
          </Link>

          {/* Refresh */}
          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8,
            background: "var(--card)", border: "1.5px solid var(--border)",
            color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Actualizar
          </button>

          {/* Auto-sync indicator — visible while background sync runs on mount */}
          {autoSyncing && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8,
              background: "rgba(99,102,241,0.1)", border: "1.5px solid rgba(99,102,241,0.3)",
              color: "#6366f1", fontSize: 12, fontWeight: 600,
            }}>
              <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} />
              Sincronizando datos…
            </div>
          )}

          {/* Manual Shopify-only sync button */}
          <button
            onClick={syncShopify}
            disabled={syncing || autoSyncing}
            title="Actualiza solo las órdenes de Shopify (ventas, devoluciones, COGS). El Ad Spend de Meta se sincroniza automáticamente al abrir el dashboard."
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8,
              background: syncing ? "rgba(14,118,110,0.15)" : "#0E766E",
              border: "1.5px solid #0E766E",
              color: syncing ? "#0E766E" : "#fff",
              fontSize: 12, fontWeight: 600,
              cursor: (syncing || autoSyncing) ? "default" : "pointer",
              opacity: (syncing || autoSyncing) ? 0.7 : 1, transition: "all 0.2s",
            }}>
            <RefreshCw size={13} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Actualizando…" : "Actualizar Shopify"}
            {lastSynced && !syncing && !autoSyncing && (
              <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>· {lastSynced}</span>
            )}
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          PAGE BODY
      ══════════════════════════════════════════════════════ */}
      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Loading */}
        {loading && !data && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 240 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                border: "2.5px solid #E5E7EB", borderTopColor: "#0E766E",
                animation: "spin 0.8s linear infinite", margin: "0 auto 12px",
              }} />
              <p style={{ color: "var(--text-3)", fontSize: 13 }}>Cargando datos...</p>
            </div>
          </div>
        )}

        {t && (
          <>
            {/* ╔══════════════════════════════════════════════════╗
                ║  ALERTAS BANNER                                  ║
                ╚══════════════════════════════════════════════════╝ */}
            {alertas.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {alertas.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 18px", borderRadius: 10,
                    background: a.type === "error" ? "var(--red-bg)" : a.type === "warn" ? "var(--yellow-bg)" : "var(--blue-bg)",
                    borderTop: `1px solid ${a.type === "error" ? "var(--red)" : a.type === "warn" ? "var(--yellow)" : "var(--blue)"}`,
                    borderRight: `1px solid ${a.type === "error" ? "var(--red)" : a.type === "warn" ? "var(--yellow)" : "var(--blue)"}`,
                    borderBottom: `1px solid ${a.type === "error" ? "var(--red)" : a.type === "warn" ? "var(--yellow)" : "var(--blue)"}`,
                    borderLeft: `4px solid ${a.type === "error" ? "var(--red)" : a.type === "warn" ? "var(--yellow)" : "var(--blue)"}`,
                  }}>
                    <AlertTriangle size={15} style={{
                      color: a.type === "error" ? "var(--red)" : a.type === "warn" ? "var(--yellow)" : "var(--blue)",
                      flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: 13, fontWeight: 600,
                      color: a.type === "error" ? "var(--red-text)" : a.type === "warn" ? "var(--yellow-text)" : "var(--blue-text)",
                    }}>
                      {a.icon} {a.msg}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 1 — KPIs PRINCIPALES (True Profit order)   ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Resumen General</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14 }}>

                {/* 1. Net Profit */}
                <KpiCard
                  label="Net Profit"
                  value={fmtC(t.profit)}
                  sub={`${netMarginVsNet.toFixed(2)}% margen neto`}
                  color={t.profit >= 0 ? "#00A676" : "#DC2626"}
                  icon={t.profit >= 0 ? TrendingUp : TrendingDown}
                  alert={t.profit < 0}
                  badge={{ text: t.profit >= 0 ? "Rentable ✓" : "En pérdida ✗", type: t.profit >= 0 ? "good" : "bad" }}
                  onExplain={explain("net_profit")}
                />

                {/* 2. Orders */}
                <KpiCard
                  label="Orders"
                  value={fmtNum(t.orders, 0)}
                  sub={`${dailyOrders}/día`}
                  color="#6366F1"
                  icon={ShoppingCart}
                  badge={{ text: `${fmtNum(t.units, 0)} uds`, type: "neutral" }}
                  onExplain={explain("units")}
                />

                {/* 3. Revenue */}
                <KpiCard
                  label="Revenue"
                  value={fmtC(t.net)}
                  sub={`Revenue neto · ${t.net > 0 && t.gross > 0 ? ((t.net / t.gross) * 100).toFixed(0) : "0"}% del bruto`}
                  color="#2563EB"
                  icon={Banknote}
                  onExplain={explain("revenue")}
                />

                {/* 4. Total Costs */}
                <KpiCard
                  label="Total Costs"
                  value={fmtC(totalCostsTP)}
                  sub={`${t.net > 0 ? ((totalCostsTP / t.net) * 100).toFixed(1) : "0"}% del revenue`}
                  color="#DC2626"
                  icon={DollarSign}
                  onExplain={explain("total_costs")}
                />

                {/* 5. Net Profit Margin */}
                <KpiCard
                  label="Net Profit Margin"
                  value={`${netMarginVsNet.toFixed(2)}%`}
                  sub={`Bruta: ${grossMargin.toFixed(1)}%`}
                  color={netMarginVsNet >= 20 ? "#00A676" : netMarginVsNet >= 10 ? "#F59E0B" : "#DC2626"}
                  icon={Target}
                  badge={{ text: netMarginVsNet >= 20 ? "Sano ✓" : netMarginVsNet >= 10 ? "OK" : "Bajo ⚠", type: netMarginVsNet >= 20 ? "good" : netMarginVsNet >= 10 ? "ok" : "bad" }}
                  onExplain={explain("net_margin")}
                />

                {/* 6. Total Ad Spend */}
                <KpiCard
                  label="Total Ad Spend"
                  value={fmtC(t.adSpend)}
                  sub={`${t.net > 0 ? ((t.adSpend / t.net) * 100).toFixed(1) : "0"}% del revenue`}
                  color="#F59E0B"
                  icon={Zap}
                  onExplain={explain("ad_spend")}
                />

                {/* 7. Avg. Order Value */}
                <KpiCard
                  label="Avg. Order Value"
                  value={fmtC(t.aov)}
                  sub="Valor por pedido"
                  color="#8B5CF6"
                  icon={BarChart3}
                  badge={{ text: t.aov >= 50 ? "Saludable" : "Bajo", type: t.aov >= 50 ? "good" : "ok" }}
                  onExplain={explain("aov")}
                />

                {/* 8. Units Sold */}
                <KpiCard
                  label="Units Sold"
                  value={fmtNum(t.units, 0)}
                  sub={`${t.orders > 0 ? (t.units / t.orders).toFixed(1) : "0"} uds/pedido`}
                  color="#06B6D4"
                  icon={Package}
                  onExplain={explain("units")}
                />

                {/* 9. Gross Sales */}
                <KpiCard
                  label="Gross Sales"
                  value={fmtC(t.gross)}
                  sub="Ventas brutas antes de ajustes"
                  color="#10B981"
                  icon={ArrowUpRight}
                  onExplain={explain("gross_sales")}
                />

                {/* 10. COGS Spend (reemplaza Gross Profit) */}
                <KpiCard
                  label="COGS Spend"
                  value={fmtC(t.cogs)}
                  sub={`${t.net > 0 ? ((t.cogs / t.net) * 100).toFixed(1) : "0"}% del revenue · ${fmtC(cogsPerOrder)}/pedido`}
                  color="#6366F1"
                  icon={Package}
                  badge={{ text: grossMargin >= 40 ? `Margen bruto ${grossMargin.toFixed(0)}% ✓` : `Margen bruto ${grossMargin.toFixed(0)}%`, type: grossMargin >= 40 ? "good" : grossMargin >= 20 ? "ok" : "bad" }}
                  onExplain={explain("cogs_kpi")}
                />

              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 2 — PUBLICIDAD (Panel compacto)            ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Publicidad</SectionLabel>
              <div>

                {/* Performance panel */}
                <div className="card" style={{ padding: "22px 26px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 18 }}>Performance de Pauta</p>

                  {/* 5-col metric grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
                    {[
                      {
                        label: "ROAS", explainKey: "roas",
                        value: t.roas !== null ? `${t.roas.toFixed(2)}x` : "—",
                        sub: roasBe !== null ? `BE: ${roasBe.toFixed(2)}x` : "Sin pauta",
                        color: t.roas !== null ? (t.roas >= 3 ? "var(--green)" : t.roas >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)",
                      },
                      {
                        label: "CPA Real", explainKey: "cpa",
                        value: t.cpa !== null ? fmtC(t.cpa) : "—",
                        sub: breakEvenCpa !== null ? `BE: ${fmtC(breakEvenCpa)}` : "Sin pauta",
                        color: t.cpa !== null && breakEvenCpa !== null ? (t.cpa > breakEvenCpa ? "var(--red)" : t.cpa > breakEvenCpa * 0.85 ? "var(--yellow)" : "var(--green)") : "var(--text-3)",
                      },
                      {
                        label: "CPA BE", explainKey: "cpa_be",
                        value: breakEvenCpa !== null ? fmtC(breakEvenCpa) : "—",
                        sub: cpaMáx > 0 ? `Máx c/15%: ${fmtC(cpaMáx)}` : "CPA máximo",
                        color: "var(--text)",
                      },
                      {
                        label: "MER", explainKey: "mer",
                        value: t.mer !== null ? `${t.mer.toFixed(2)}x` : "—",
                        sub: "Eficiencia total",
                        color: t.mer !== null ? (t.mer >= 3 ? "var(--green)" : t.mer >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)",
                      },
                      {
                        label: "POAS", explainKey: "poas",
                        value: poas !== null ? `${poas.toFixed(2)}x` : "—",
                        sub: "Profit on Ad Spend",
                        color: poas !== null ? (poas >= 1.5 ? "var(--green)" : poas >= 1 ? "var(--yellow)" : "var(--red)") : "var(--text-3)",
                      },
                    ].map((m, i, arr) => (
                      <div
                        key={m.label}
                        onClick={() => setExplainerKey(m.explainKey)}
                        style={{
                          padding: "18px 16px",
                          borderRight: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                          background: "var(--card)",
                          cursor: "pointer",
                        }}
                        title="Clic para ver cómo se calcula"
                      >
                        <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", marginBottom: 10 }}>
                          {m.label} <span style={{ opacity: 0.5, fontSize: 9 }}>ⓘ</span>
                        </p>
                        <p style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1, color: m.color }}>
                          {m.value}
                        </p>
                        <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6, lineHeight: 1.3 }}>{m.sub}</p>
                      </div>
                    ))}
                  </div>

                  {/* CPA semáforo bar */}
                  {t.cpa !== null && breakEvenCpa !== null && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)" }}>
                          CPA Real vs Break-Even
                        </p>
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          padding: "2px 10px", borderRadius: 20,
                          background: t.cpa > breakEvenCpa ? "var(--red-bg)" : t.cpa > breakEvenCpa * 0.85 ? "var(--yellow-bg)" : "var(--green-bg)",
                          color: t.cpa > breakEvenCpa ? "var(--red-text)" : t.cpa > breakEvenCpa * 0.85 ? "var(--yellow-text)" : "var(--green-text)",
                        }}>
                          {t.cpa > breakEvenCpa ? `🔴 ${((t.cpa / breakEvenCpa) * 100).toFixed(0)}% del BE` :
                           t.cpa > breakEvenCpa * 0.85 ? `🟡 ${((t.cpa / breakEvenCpa) * 100).toFixed(0)}% del BE` :
                           `🟢 ${((t.cpa / breakEvenCpa) * 100).toFixed(0)}% del BE`}
                        </span>
                      </div>
                      <div style={{ height: 7, borderRadius: 6, background: "var(--bg-2)", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 6,
                          width: `${Math.min((t.cpa / breakEvenCpa) * 100, 100)}%`,
                          background: t.cpa > breakEvenCpa ? "#DC2626" : t.cpa > breakEvenCpa * 0.85 ? "#F59E0B" : "#10B981",
                          transition: "width 0.4s ease",
                        }} />
                      </div>
                    </div>
                  )}
                </div>

              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 3 — COSTOS                                 ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Estructura de Costos</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                <CompactMetric
                  label="COGS"
                  value={fmtC(t.cogs)}
                  sub={`${fmtC(cogsPerOrder)}/pedido · ${totalCosts > 0 ? ((t.cogs / totalCosts) * 100).toFixed(0) : 0}% del total`}
                  color="#6366F1"
                  icon={Package}
                  onExplain={explain("cogs_compact")}
                />
                <CompactMetric
                  label="Flete / Envío"
                  value={fmtC(t.shipping)}
                  sub={`${fmtC(shippingPerOrder)}/pedido · ${totalCosts > 0 ? ((t.shipping / totalCosts) * 100).toFixed(0) : 0}% del total`}
                  color="#F59E0B"
                  icon={Truck}
                  onExplain={explain("flete")}
                />
                <CompactMetric
                  label="Fees / Pasarela"
                  value={fmtC(t.fees)}
                  sub={`${fmtC(feesPerOrder)}/pedido · ${totalCosts > 0 ? ((t.fees / totalCosts) * 100).toFixed(0) : 0}% del total`}
                  color="#EC4899"
                  icon={CreditCard}
                  onExplain={explain("fees")}
                />
                <div className="card-flat" style={{
                  padding: "16px 20px",
                  background: "linear-gradient(135deg, #12304A 0%, #1a4060 100%)",
                  border: "none",
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>
                    Total Costos
                  </p>
                  <p style={{ fontSize: 20, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em", lineHeight: 1 }}>
                    {fmtC(totalCosts)}
                  </p>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 6 }}>
                    {t.gross > 0 ? ((totalCosts / t.gross) * 100).toFixed(1) : 0}% del revenue bruto
                  </p>
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Revenue</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{fmtC(t.gross)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Utilidad</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: t.profit >= 0 ? "#34D399" : "#F87171" }}>{fmtC(t.profit)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 3b — COST BREAKDOWN + ORDER SUMMARY        ║
                ╚══════════════════════════════════════════════════╝ */}
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14 }}>

              {/* Cost Breakdown — Donut Chart */}
              <div className="card" style={{ padding: "28px 32px" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Desglose de Costos</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                      {t.gross > 0 ? `${((totalCosts / t.gross) * 100).toFixed(1)}% del revenue bruto` : "Sin datos"}
                    </p>
                  </div>
                  {/* Data source badge */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {[
                      { dot: "#10B981", label: "Shopify" },
                      { dot: "#F59E0B", label: "Meta Ads" },
                      { dot: "#9CA3AF", label: "Estimado" },
                    ].map(b => (
                      <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: b.dot }} />
                        <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)" }}>{b.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {(() => {
                  const items = [
                    { label: "COGS",        value: t.cogs,             color: "#6366F1", source: t.cogs > 0 ? "Shopify" : "Estimado",    dot: t.cogs > 0 ? "#10B981" : "#9CA3AF" },
                    { label: "Ad Spend",    value: t.adSpend,          color: "#F59E0B", source: "Meta Ads",   dot: "#F59E0B" },
                    { label: "Flete",       value: t.shipping,         color: "#3B82F6", source: "Shopify",    dot: "#10B981" },
                    { label: "Fees",        value: t.fees,             color: "#EC4899", source: "Estimado",   dot: "#9CA3AF" },
                    { label: "Chargebacks", value: t.chargebacks ?? 0, color: "#DC2626", source: "Manual",     dot: "#DC2626" },
                  ].filter(i => i.value > 0);

                  if (items.length === 0) {
                    return (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, gap: 10, color: "var(--text-3)" }}>
                        <div style={{ fontSize: 32 }}>📊</div>
                        <p style={{ fontSize: 13, fontWeight: 600 }}>Sin datos de costos</p>
                        <p style={{ fontSize: 11 }}>Sincroniza Shopify y llena los costos en /costos</p>
                      </div>
                    );
                  }

                  const total = items.reduce((s, i) => s + i.value, 0) || 1;

                  const CostTooltip = ({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    const pct    = ((d.value / total)   * 100).toFixed(1);
                    const pctRev = t.gross > 0 ? ((d.value / t.gross) * 100).toFixed(1) : "0";
                    return (
                      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", boxShadow: "0 12px 32px rgba(0,0,0,0.2)", minWidth: 180 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <div style={{ width: 12, height: 12, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{d.label}</span>
                          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 20, background: "var(--bg-2)", color: "var(--text-3)" }}>{d.source}</span>
                        </div>
                        <p style={{ fontSize: 20, fontWeight: 900, color: d.color, letterSpacing: "-0.02em" }}>{fmtC(d.value)}</p>
                        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{pct}% del costo</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{pctRev}% del revenue</span>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.1fr", gap: 28, alignItems: "center" }}>

                      {/* ── Donut grande ── */}
                      <div style={{ position: "relative", height: 300 }}>
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={items}
                              cx="50%"
                              cy="50%"
                              innerRadius={90}
                              outerRadius={128}
                              paddingAngle={2}
                              dataKey="value"
                              startAngle={90}
                              endAngle={-270}
                              stroke="none"
                            >
                              {items.map((item, i) => (
                                <Cell key={i} fill={item.color} />
                              ))}
                            </Pie>
                            <Tooltip content={<CostTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>

                        {/* Center overlay */}
                        <div style={{
                          position: "absolute", top: "50%", left: "50%",
                          transform: "translate(-50%, -50%)",
                          textAlign: "center", pointerEvents: "none",
                          width: 160,
                        }}>
                          <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--text-3)", marginBottom: 4 }}>
                            Total Costos
                          </p>
                          <p style={{ fontSize: 28, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.03em", lineHeight: 1 }}>
                            {fmtC(totalCosts)}
                          </p>
                          <div style={{ width: 36, height: 2, borderRadius: 2, background: "var(--border)", margin: "8px auto" }} />
                          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)" }}>
                            {t.gross > 0 ? ((totalCosts / t.gross) * 100).toFixed(1) : 0}% del rev.
                          </p>
                          <p style={{ fontSize: 11, color: t.profit >= 0 ? "var(--green)" : "var(--red)", marginTop: 4, fontWeight: 700 }}>
                            Margen: {t.gross > 0 ? ((t.profit / t.gross) * 100).toFixed(1) : 0}%
                          </p>
                        </div>
                      </div>

                      {/* ── Legend ── */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {items.map((item) => {
                          const pct    = ((item.value / total) * 100).toFixed(1);
                          const pctRev = t.gross > 0 ? ((item.value / t.gross) * 100).toFixed(1) : "0";
                          return (
                            <div key={item.label} style={{
                              padding: "11px 14px", borderRadius: 10,
                              background: "var(--bg-2)",
                              border: `1px solid ${item.color}22`,
                            }}>
                              {/* Top row: name + amount */}
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <div style={{
                                  width: 13, height: 13, borderRadius: 4,
                                  background: item.color, flexShrink: 0,
                                }} />
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{item.label}</span>
                                <span style={{ fontSize: 14, fontWeight: 900, color: item.color, fontFamily: "monospace" }}>
                                  {fmtC(item.value)}
                                </span>
                              </div>
                              {/* Bottom row: % of total + % of revenue + source */}
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: item.color, background: item.color + "15", padding: "1px 7px", borderRadius: 20 }}>
                                  {pct}%
                                </span>
                                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{pctRev}% rev.</span>
                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
                                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: item.dot }} />
                                  <span style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600 }}>{item.source}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Total footer */}
                        <div style={{
                          padding: "10px 14px", borderRadius: 10,
                          background: "linear-gradient(135deg, var(--card) 0%, var(--bg-2) 100%)",
                          border: "1.5px solid var(--border)",
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                        }}>
                          <div>
                            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Total</p>
                            <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>{t.gross > 0 ? ((totalCosts / t.gross) * 100).toFixed(1) : 0}% del revenue</p>
                          </div>
                          <p style={{ fontSize: 20, fontWeight: 900, color: "var(--text)", fontFamily: "monospace", letterSpacing: "-0.02em" }}>
                            {fmtC(totalCosts)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Order Summary + Fuentes de datos */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                {/* Resumen por Pedido */}
                <div className="card" style={{ padding: "22px 26px", flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
                    Resumen por Pedido
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {[
                      { label: "Valor Promedio (AOV)",   value: fmtC(t.aov),            color: "#2563EB", good: t.aov >= 50 },
                      { label: "Ad Spend por Pedido",    value: fmtC(adSpendPerOrder),   color: "#F59E0B", good: null },
                      { label: "Costo Total por Pedido", value: fmtC(totalCostPerOrder), color: "#6366F1", good: null },
                      { label: "Ut. Bruta por Pedido",   value: fmtC(t.aov > 0 ? grossProfit / (t.orders || 1) : 0), color: "#10B981", good: (grossProfit / (t.orders || 1)) > 0 },
                      { label: "Ut. Neta por Pedido",    value: fmtC(profitPerOrder),    color: profitPerOrder >= 0 ? "#10B981" : "#DC2626", good: profitPerOrder >= 0 },
                      { label: "Unidades por Pedido",    value: t.orders > 0 ? (t.units / t.orders).toFixed(1) : "—", color: "#7C3AED", good: null },
                    ].map((row, i, arr) => (
                      <div key={row.label} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 0",
                        borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 12, color: "var(--text-2)" }}>{row.label}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace", color: row.good === null ? "var(--text)" : row.good ? "var(--green)" : "var(--red)" }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fuentes de datos */}
                <div className="card" style={{ padding: "16px 20px" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-3)", marginBottom: 12 }}>
                    Origen de los Datos
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {[
                      { label: "Revenue, Pedidos, Descuentos, Devoluciones, Flete, Taxes", source: "Shopify API",   dot: "#10B981", ok: true  },
                      { label: "Ad Spend (ROAS, CPA, MER)", source: "Meta Ads API",  dot: "#F59E0B", ok: true  },
                      { label: "COGS (proveedor)",           source: t.cogs > 0 ? "Sincronizado ✓" : "Sin costos — ve a /costos", dot: t.cogs > 0 ? "#10B981" : "#F59E0B", ok: t.cogs > 0 },
                      { label: "Fees / Pasarela",            source: "Estimado (2.9% + $0.30)", dot: "#9CA3AF", ok: false },
                      { label: "Chargebacks",                source: "Entrada manual", dot: "#9CA3AF", ok: null  },
                    ].map((r) => (
                      <div key={r.label} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: r.dot, flexShrink: 0, marginTop: 4 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 500, lineHeight: 1.3 }}>{r.label}</p>
                          <p style={{ fontSize: 10, color: r.ok === false ? "var(--yellow-text)" : "var(--text-3)", fontWeight: r.ok === false ? 700 : 400 }}>{r.source}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 3c — RESULTADO REAL                        ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <SectionLabel>Resultado Real</SectionLabel>
                <button
                  onClick={() => setShowCbModal(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 14px", borderRadius: 8,
                    background: "var(--red-bg)", border: "1px solid var(--red)",
                    color: "var(--red-text)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  <Plus size={13} /> Chargeback
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>

                {/* P&L Waterfall */}
                <div className="card" style={{ padding: "24px 28px" }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
                    Estado de Resultados — P&L
                  </p>

                  {(() => {
                    const disc = t.discounts ?? 0;
                    const rets = t.returns ?? 0;
                    const rows: { label: string; value: number; color: string; indent: number; dividerAfter?: boolean; highlight?: boolean; sub?: boolean }[] = [
                      { label: "Ventas Brutas",              value: t.gross,       color: "var(--text)",    indent: 0 },
                      ...(disc > 0 ? [{ label: "− Descuentos",              value: -disc,         color: "var(--yellow)", indent: 1 }] : []),
                      ...(rets > 0 ? [{ label: "− Devoluciones",            value: -rets,         color: "var(--yellow)", indent: 1 }] : []),
                      ...((disc > 0 || rets > 0) ? [{ label: "= Ventas Netas",              value: t.net,         color: "var(--text)",    indent: 0, sub: true, dividerAfter: false }] : []),
                      { label: "− Pago a Proveedor (COGS)",  value: -t.cogs,       color: "var(--red)",     indent: 1 },
                      { label: "− Facturas Publicidad",      value: -t.adSpend,    color: "var(--yellow)",  indent: 1 },
                      { label: "− Flete / Envío",            value: -t.shipping,   color: "var(--red)",     indent: 1 },
                      { label: "− Fees Pasarela",            value: -t.fees,       color: "var(--red)",     indent: 1 },
                      { label: "− Chargebacks",              value: -t.chargebacks, color: "var(--red)",    indent: 1, highlight: t.chargebacks > 0 },
                    ];
                    return rows.map((row, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 0",
                        paddingLeft: row.indent ? 16 : 0,
                        borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
                        background: row.highlight ? "var(--red-bg)" : row.sub ? "var(--bg-2)" : "transparent",
                        borderRadius: (row.highlight || row.sub) ? 8 : 0,
                        paddingRight: (row.highlight || row.sub) ? 10 : 0,
                        marginLeft: row.sub ? -8 : 0,
                        marginRight: row.sub ? -4 : 0,
                      }}>
                        <span style={{
                          fontSize: 13, color: row.sub ? "var(--text)" : "var(--text-2)",
                          fontWeight: (row.indent === 0 || row.sub) ? 700 : 500,
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          {row.indent > 0 && !row.sub && <span style={{ color: "var(--border-strong)", fontSize: 16 }}>·</span>}
                          {row.label}
                          {row.highlight && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--red)", background: "var(--red-bg)", padding: "1px 6px", borderRadius: 20 }}>
                              ¡CB!
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: row.value < 0 ? "var(--red)" : "var(--text)", fontFamily: "monospace" }}>
                          {row.value >= 0 ? fmtC(row.value) : `−${fmtC(Math.abs(row.value))}`}
                        </span>
                      </div>
                    ));
                  })()}

                  {/* Divider + Resultado */}
                  <div style={{ borderTop: "2.5px solid var(--text-2)", marginTop: 4, paddingTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>Ganancia Real</p>
                      <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                        {t.realMargin.toFixed(1)}% margen · {t.realProfitPerOrder ? `${fmtC(t.realProfitPerOrder)}/pedido` : "—"}
                      </p>
                    </div>
                    <p style={{
                      fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em",
                      color: t.realProfit >= 0 ? "var(--green)" : "var(--red)",
                    }}>
                      {fmtC(t.realProfit)}
                    </p>
                  </div>
                </div>

                {/* KPIs de ganancia real — columna derecha */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

                  {/* Ganancia Real */}
                  <div className="kpi-card" style={{
                    background: t.realProfit >= 0
                      ? "linear-gradient(135deg, #065F46 0%, #047857 100%)"
                      : "linear-gradient(135deg, #7F1D1D 0%, #991B1B 100%)",
                    border: "none", flex: 1,
                  }}>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "rgba(255,255,255,0.6)", marginBottom: 12 }}>
                      Ganancia Real
                    </p>
                    <p style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "-0.03em", lineHeight: 1 }}>
                      {fmtC(t.realProfit)}
                    </p>
                    <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 8 }}>
                      {t.realMargin.toFixed(1)}% margen real
                    </p>
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Sin chargebacks</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.9)" }}>{fmtC(t.profit)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>Chargebacks</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: t.chargebacks > 0 ? "#FCA5A5" : "rgba(255,255,255,0.9)" }}>
                          {t.chargebacks > 0 ? `−${fmtC(t.chargebacks)}` : fmtC(0)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Chargebacks */}
                  <div className="card-flat" style={{ padding: "16px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--red-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <ShieldAlert size={18} style={{ color: "var(--red)" }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 4 }}>
                          Chargebacks
                        </p>
                        <p style={{ fontSize: 20, fontWeight: 800, color: t.chargebacks > 0 ? "var(--red)" : "var(--text)", letterSpacing: "-0.02em", lineHeight: 1 }}>
                          {t.chargebacks > 0 ? `−${fmtC(t.chargebacks)}` : fmtC(0)}
                        </p>
                        <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                          {t.chargebacks === 0 ? "Sin chargebacks confirmados" : `${t.orders > 0 ? ((t.chargebacks / t.gross) * 100).toFixed(2) : 0}% del revenue`}
                        </p>
                      </div>
                      <button
                        onClick={() => setShowCbModal(true)}
                        style={{ background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--red-text)", fontSize: 11, fontWeight: 700 }}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 4 — GRÁFICA                                ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Evolución de Ventas</SectionLabel>
              <div className="card" style={{ padding: "24px 28px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Ventas por Día</p>
                    <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
                      Últimos {days} días · valores en USD
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    {[
                      { label: "Glowmmi",  color: "#EC4899" },
                      { label: "Balancea", color: "#10B981" },
                    ].map((l) => (
                      <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: l.color }} />
                        <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>{l.label}</span>
                      </div>
                    ))}
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: "#6366F1", opacity: 0.4 }} />
                      <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 500 }}>Pedidos</span>
                    </div>
                    <button
                      onClick={() => setShowProfit((p) => !p)}
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                        background: showProfit ? "#6366F120" : "var(--bg-2)",
                        border: `1px solid ${showProfit ? "#6366F1" : "var(--border)"}`,
                        color: showProfit ? "#6366F1" : "var(--text-3)",
                        cursor: "pointer",
                      }}
                    >
                      {showProfit ? "Ocultar utilidad" : "Mostrar utilidad"}
                    </button>
                  </div>
                </div>
                <RevenueChart data={data?.chartData ?? []} showProfit={showProfit} />
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 4b — VENTAS DIARIAS                        ║
                ╚══════════════════════════════════════════════════╝ */}
            {(() => {
              const rows = [...(data?.chartData ?? [])]
                .sort((a, b) => b.date.localeCompare(a.date)); // más reciente primero
              if (rows.length === 0) return null;

              return (
                <div>
                  <SectionLabel>Ventas Diarias</SectionLabel>
                  <div className="card" style={{ overflow: "hidden" }}>
                    <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Detalle por Día</p>
                        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                          {rows.length} días · valores en USD · más reciente primero
                        </p>
                      </div>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Fecha</th>
                            <th style={{ textAlign: "right" }}>Pedidos</th>
                            <th style={{ textAlign: "right" }}>Glowmmi</th>
                            <th style={{ textAlign: "right" }}>Balancea</th>
                            <th style={{ textAlign: "right" }}>Total Revenue</th>
                            <th style={{ textAlign: "right" }}>Ad Spend</th>
                            <th style={{ textAlign: "right" }}>COGS</th>
                            <th style={{ textAlign: "right" }}>Fees</th>
                            <th style={{ textAlign: "right" }}>Net Profit</th>
                            <th style={{ textAlign: "right" }}>Margen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const rev = r.glowmmi + r.balancea;
                            const margin = rev > 0 ? (r.profit / rev) * 100 : 0;
                            const isToday = r.date === localDateStr();
                            return (
                              <tr
                                key={r.date}
                                style={isToday ? { background: "var(--blue-bg)" } : undefined}
                              >
                                <td style={{ fontWeight: isToday ? 700 : 500, color: isToday ? "var(--blue-text)" : "var(--text-2)" }}>
                                  {isToday && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--blue)", marginRight: 6, textTransform: "uppercase" }}>Hoy</span>}
                                  {new Date(r.date + "T12:00:00Z").toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" })}
                                </td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>
                                  {r.orders}
                                </td>
                                <td style={{ textAlign: "right", color: r.glowmmi > 0 ? "#EC4899" : "var(--text-3)", fontWeight: r.glowmmi > 0 ? 600 : 400 }}>
                                  {r.glowmmi > 0 ? fmtC(r.glowmmi) : "—"}
                                </td>
                                <td style={{ textAlign: "right", color: r.balancea > 0 ? "#10B981" : "var(--text-3)", fontWeight: r.balancea > 0 ? 600 : 400 }}>
                                  {r.balancea > 0 ? fmtC(r.balancea) : "—"}
                                </td>
                                <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text)" }}>
                                  {fmtC(rev)}
                                </td>
                                <td style={{ textAlign: "right", color: r.adSpend > 0 ? "var(--yellow-text)" : "var(--text-3)", fontWeight: r.adSpend > 0 ? 600 : 400 }}>
                                  {r.adSpend > 0 ? fmtC(r.adSpend) : "—"}
                                </td>
                                <td style={{ textAlign: "right", color: "var(--text-2)" }}>
                                  {r.cogs > 0 ? fmtC(r.cogs) : "—"}
                                </td>
                                <td style={{ textAlign: "right", color: "var(--text-3)" }}>
                                  {r.fees > 0 ? fmtC(r.fees) : "—"}
                                </td>
                                <td style={{ textAlign: "right", fontWeight: 700, color: r.profit >= 0 ? "var(--green)" : "var(--red)" }}>
                                  {fmtC(r.profit)}
                                </td>
                                <td style={{ textAlign: "right" }}>
                                  <StatusBadge
                                    label={`${margin.toFixed(1)}%`}
                                    type={margin >= 20 ? "good" : margin >= 10 ? "ok" : r.profit < 0 ? "bad" : "neutral"}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 4c — TOP PRODUCTOS                         ║
                ╚══════════════════════════════════════════════════╝ */}
            {productStats && productStats.topProducts.length > 0 && (() => {
              const tops = productStats.topProducts;
              const maxRev = tops[0]?.revenue || 1;
              return (
                <div>
                  <SectionLabel>Top Productos</SectionLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>

                    {/* Tabla de top productos */}
                    <div className="card" style={{ overflow: "hidden" }}>
                      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
                        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Ranking por Revenue</p>
                        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>Período seleccionado · USD</p>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Producto</th>
                              <th style={{ textAlign: "right" }}>Pedidos</th>
                              <th style={{ textAlign: "right" }}>Revenue</th>
                              <th style={{ textAlign: "right" }}>Ad Spend</th>
                              <th style={{ textAlign: "right" }}>COGS</th>
                              <th style={{ textAlign: "right" }}>Profit</th>
                              <th style={{ textAlign: "right" }}>Margen</th>
                              <th style={{ textAlign: "right" }}>ROAS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tops.map((p, i) => {
                              const isGlow = p.brandId === "brand_glowmmi";
                              const barPct = (p.revenue / maxRev) * 100;
                              return (
                                <tr key={`${p.code}-${p.name}`}>
                                  <td style={{ fontWeight: 700, color: i === 0 ? "#F59E0B" : "var(--text-3)", fontSize: 13 }}>
                                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                                  </td>
                                  <td>
                                    <div>
                                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: isGlow ? "#EC4899" : "#10B981", flexShrink: 0 }} />
                                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{p.name}</span>
                                      </div>
                                      {/* Mini bar */}
                                      <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden", maxWidth: 200 }}>
                                        <div style={{ height: "100%", width: `${barPct}%`, background: isGlow ? "#EC4899" : "#10B981", borderRadius: 2 }} />
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ textAlign: "right", fontWeight: 600 }}>{p.orders}</td>
                                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{fmtC(p.revenue)}</td>
                                  <td style={{ textAlign: "right", color: p.adSpend > 0 ? "var(--yellow-text)" : "var(--text-3)" }}>
                                    {p.adSpend > 0 ? fmtC(p.adSpend) : "—"}
                                  </td>
                                  <td style={{ textAlign: "right", color: "var(--text-2)" }}>
                                    {p.cogs > 0 ? fmtC(p.cogs) : "—"}
                                  </td>
                                  <td style={{ textAlign: "right", fontWeight: 700, color: p.profit >= 0 ? "var(--green)" : "var(--red)" }}>
                                    {fmtC(p.profit)}
                                  </td>
                                  <td style={{ textAlign: "right" }}>
                                    <StatusBadge
                                      label={`${p.margin.toFixed(1)}%`}
                                      type={p.margin >= 20 ? "good" : p.margin >= 10 ? "ok" : p.profit < 0 ? "bad" : "neutral"}
                                    />
                                  </td>
                                  <td style={{ textAlign: "right", color: p.avgRoas !== null ? (p.avgRoas >= 3 ? "var(--green)" : p.avgRoas >= 2 ? "var(--yellow-text)" : "var(--red)") : "var(--text-3)", fontWeight: 600 }}>
                                    {p.avgRoas !== null ? `${(p.avgRoas as number).toFixed(2)}x` : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Panel: qué se vendió hoy/último día disponible */}
                    <div className="card" style={{ padding: "22px 24px" }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                        Últimos Días — Detalle
                      </p>
                      <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 16 }}>
                        Productos vendidos por día
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxHeight: 420, overflowY: "auto" }}>
                        {productStats.daily.slice(0, 7).map(day => {
                          const isToday = day.date === localDateStr();
                          const dayTotal = day.products.reduce((s: number, p: any) => s + p.revenue, 0);
                          return (
                            <div key={day.date}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: isToday ? "var(--blue)" : "var(--text-3)", textTransform: "uppercase" }}>
                                  {isToday && "● "}
                                  {new Date(day.date + "T12:00:00Z").toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" })}
                                </span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{fmtC(dayTotal)}</span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                                {day.products.map((p: any) => (
                                  <div key={`${p.code}-${p.name}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", borderRadius: 8, background: "var(--bg-2)" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: p.brandId === "brand_glowmmi" ? "#EC4899" : "#10B981", flexShrink: 0 }} />
                                      <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 500 }}>{p.name}</span>
                                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>×{p.orders}</span>
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontFamily: "monospace" }}>{fmtC(p.revenue)}</span>
                                      <span style={{
                                        fontSize: 10, padding: "2px 6px", borderRadius: 10, fontWeight: 700,
                                        background: p.isProfit ? "var(--green-bg)" : "var(--red-bg)",
                                        color: p.isProfit ? "var(--green-text)" : "var(--red-text)",
                                      }}>
                                        {p.isProfit ? "✓" : "✗"}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 5 — PRODUCT ANALYTICS                      ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Product Analytics</SectionLabel>
              <div className="card" style={{ overflow: "hidden" }}>
                {/* Table header bar */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "18px 24px", borderBottom: "1px solid var(--border)",
                  gap: 12, flexWrap: "wrap",
                }}>
                  <div>
                    <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                      Rentabilidad por Marca
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                      {data?.byBrand.length ?? 0} marcas activas · {currency}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Link href="/analytics" style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "7px 14px", borderRadius: 8,
                      background: "var(--blue-bg)", border: "1px solid var(--blue)",
                      color: "var(--blue-text)", fontSize: 12, fontWeight: 700,
                      textDecoration: "none",
                    }}>
                      <BarChart3 size={13} /> Product Analytics <ArrowUpRight size={12} />
                    </Link>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: "var(--bg-2)", border: "1px solid var(--border)",
                      borderRadius: 8, padding: "7px 12px",
                    }}>
                      <Search size={13} style={{ color: "var(--text-3)" }} />
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>Buscar marca...</span>
                    </div>
                    <button style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "7px 12px", borderRadius: 8,
                      background: "var(--bg-2)", border: "1px solid var(--border)",
                      color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>
                      <SlidersHorizontal size={13} />Filtros
                    </button>
                    <button style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "7px 12px", borderRadius: 8,
                      background: "var(--bg-2)", border: "1px solid var(--border)",
                      color: "var(--text-2)", fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>
                      <Download size={13} />Exportar
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Marca</th>
                        <th>Estado</th>
                        <th style={{ textAlign: "right" }}>Revenue</th>
                        <th style={{ textAlign: "right" }}>Pedidos</th>
                        <th style={{ textAlign: "right" }}>COGS</th>
                        <th style={{ textAlign: "right" }}>Flete</th>
                        <th style={{ textAlign: "right" }}>Ad Spend</th>
                        <th style={{ textAlign: "right" }}>Fees</th>
                        <th style={{ textAlign: "right" }}>Net Profit</th>
                        <th style={{ textAlign: "right" }}>Margen</th>
                        <th style={{ textAlign: "right" }}>CPA Real / BE</th>
                        <th style={{ textAlign: "right" }}>ROAS</th>
                        <th style={{ textAlign: "right" }}>MER</th>
                        <th style={{ textAlign: "right" }}>Util/Pedido</th>
                        <th style={{ textAlign: "right" }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Total row */}
                      <tr style={{ background: "#F8FAFC" }}>
                        <td style={{ fontWeight: 700, color: "var(--text)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#12304A" }} />
                            Total General
                          </div>
                        </td>
                        <td><EstadoBadge estado={estadoGlobal} /></td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{fmtC(t.gross)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{fmtNum(t.orders, 0)}</td>
                        <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtC(t.cogs)}</td>
                        <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtC(t.shipping)}</td>
                        <td style={{ textAlign: "right", color: "var(--yellow)", fontWeight: 600 }}>{fmtC(t.adSpend)}</td>
                        <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtC(t.fees)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: t.profit >= 0 ? "var(--green)" : "var(--red)" }}>
                          {fmtC(t.profit)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <StatusBadge
                            label={fmtPct(t.margin, 1)}
                            type={t.margin >= 20 ? "good" : t.margin >= 10 ? "ok" : "bad"}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <CpaIndicator cpa={t.cpa} cpaBe={breakEvenCpa} fmtC={fmtC} />
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: t.roas !== null ? (t.roas >= 3 ? "var(--green)" : t.roas >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)" }}>
                          {t.roas !== null ? `${t.roas.toFixed(2)}x` : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: "var(--text-2)" }}>
                          {t.mer !== null ? `${t.mer.toFixed(2)}x` : "—"}
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600, color: profitPerOrder >= 0 ? "var(--green)" : "var(--red)" }}>
                          {fmtC(profitPerOrder)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <EstadoBadge estado={estadoGlobal} />
                        </td>
                      </tr>

                      {/* Per-brand rows */}
                      {data?.byBrand.map((b) => {
                        const bOrders    = b.orders || 1;
                        const bCpa       = b.adSpend > 0 && b.orders > 0 ? b.adSpend / b.orders : null;
                        const bCpaBe     = b.orders > 0 ? (b.revenue - b.cogs - b.shipping - b.fees) / b.orders : null;
                        const bRoas      = b.adSpend > 0 ? b.revenue / b.adSpend : null;
                        const bMer       = b.adSpend > 0 ? b.revenue / b.adSpend : null;
                        const bMargin    = b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0;
                        const bProfitPerOrder = b.orders > 0 ? b.profit / b.orders : null;
                        const bEstado    = getEstado(b.orders, b.adSpend, b.cogs > 0, b.profit, bMargin, bCpa, bCpaBe);
                        const color      = b.name.toLowerCase().includes("glow") ? "#EC4899" : "#10B981";

                        return (
                          <tr key={b.name}>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                <span style={{ fontWeight: 600, color: "var(--text)" }}>{b.name}</span>
                              </div>
                            </td>
                            <td><EstadoBadge estado={bEstado} /></td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtC(b.revenue)}</td>
                            <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtNum(b.orders, 0)}</td>
                            <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtC(b.cogs)}</td>
                            <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtC(b.shipping)}</td>
                            <td style={{ textAlign: "right", color: "var(--yellow)", fontWeight: 600 }}>{fmtC(b.adSpend)}</td>
                            <td style={{ textAlign: "right", color: "var(--text-2)" }}>{fmtC(b.fees)}</td>
                            <td style={{ textAlign: "right", fontWeight: 700, color: b.profit >= 0 ? "var(--green)" : "var(--red)" }}>
                              {fmtC(b.profit)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <StatusBadge
                                label={fmtPct(bMargin, 1)}
                                type={bMargin >= 20 ? "good" : bMargin >= 10 ? "ok" : "bad"}
                              />
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <CpaIndicator cpa={bCpa} cpaBe={bCpaBe} fmtC={fmtC} />
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600, color: bRoas !== null ? (bRoas >= 3 ? "var(--green)" : bRoas >= 2 ? "var(--yellow)" : "var(--red)") : "var(--text-3)" }}>
                              {bRoas !== null ? `${bRoas.toFixed(2)}x` : "—"}
                            </td>
                            <td style={{ textAlign: "right", color: "var(--text-2)" }}>
                              {bMer !== null ? `${bMer.toFixed(2)}x` : "—"}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600, color: (bProfitPerOrder ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
                              {bProfitPerOrder !== null ? fmtC(bProfitPerOrder) : "—"}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <EstadoBadge estado={bEstado} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ╔══════════════════════════════════════════════════╗
                ║  FILA 6 — ALERTAS + TAREAS                       ║
                ╚══════════════════════════════════════════════════╝ */}
            <div>
              <SectionLabel>Operación</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 20 }}>

                {/* Resumen de alertas */}
                <div className="card" style={{ padding: "24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
                    <AlertTriangle size={16} style={{ color: "var(--yellow)" }} />
                    <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                      Alertas de Sistema
                    </p>
                    {alertas.length > 0 && (
                      <span className="status-badge" style={{ background: "var(--red-bg)", color: "var(--red-text)", marginLeft: 4 }}>
                        {alertas.length}
                      </span>
                    )}
                  </div>
                  {alertas.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "28px 0" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--green-text)" }}>Todo en orden</p>
                      <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                        Sin alertas activas para este período
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {alertas.map((a, i) => (
                        <div key={i} style={{
                          padding: "12px 14px", borderRadius: 10,
                          background: a.type === "error" ? "var(--red-bg)" : a.type === "warn" ? "var(--yellow-bg)" : "var(--blue-bg)",
                          borderTop: "1px solid transparent",
                          borderRight: "1px solid transparent",
                          borderBottom: "1px solid transparent",
                          borderLeft: `3px solid ${a.type === "error" ? "var(--red)" : a.type === "warn" ? "var(--yellow)" : "var(--blue)"}`,
                        }}>
                          <p style={{
                            fontSize: 12, fontWeight: 600,
                            color: a.type === "error" ? "var(--red-text)" : a.type === "warn" ? "var(--yellow-text)" : "var(--blue-text)",
                          }}>
                            {a.icon} {a.msg}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Indicadores de datos */}
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                      Cobertura de datos
                    </p>
                    {[
                      { label: "COGS", ok: t.cogs > 0 },
                      { label: "Ad Spend", ok: t.adSpend > 0 },
                      { label: "Flete", ok: t.shipping > 0 },
                      { label: "Fees", ok: t.fees > 0 },
                    ].map((item) => (
                      <div key={item.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text-2)" }}>{item.label}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: item.ok ? "var(--green-text)" : "var(--red-text)",
                        }}>
                          {item.ok ? "✓ Registrado" : "✗ Sin datos"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tareas */}
                <div className="card" style={{ padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <CheckSquare size={16} style={{ color: "var(--blue)" }} />
                      <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Tareas Pendientes</p>
                      {data?.tasks && data.tasks.length > 0 && (
                        <span className="status-badge" style={{ background: "var(--blue-bg)", color: "var(--blue-text)" }}>
                          {data.tasks.length}
                        </span>
                      )}
                    </div>
                    <Link href="/tareas" style={{
                      display: "flex", alignItems: "center", gap: 4,
                      fontSize: 12, fontWeight: 600, color: "var(--blue)",
                      background: "var(--blue-bg)", padding: "5px 12px", borderRadius: 8,
                      textDecoration: "none",
                    }}>
                      Ver todas <ArrowUpRight size={12} />
                    </Link>
                  </div>
                  {(!data?.tasks || data.tasks.length === 0) ? (
                    <div style={{ textAlign: "center", padding: "40px 0" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>🎉</div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>Sin tareas pendientes</p>
                      <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Todo al día</p>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {data.tasks.slice(0, 8).map((task) => (
                        <div key={task.id} style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "10px 12px", borderRadius: 10,
                          background: "var(--bg-2)", border: "1px solid var(--border)",
                        }}>
                          <div style={{
                            width: 7, height: 7, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                            background:
                              task.priority === "high" ? "var(--red)" :
                              task.priority === "medium" ? "var(--yellow)" : "var(--text-4)",
                          }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{
                              fontSize: 12, fontWeight: 600, color: "var(--text)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {task.title}
                            </p>
                            <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap" }}>
                              {task.brand && (
                                <span style={{
                                  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20,
                                  background: task.brand.name === "Glowmmi" ? "#FCE7F3" : "#D1FAE5",
                                  color: task.brand.name === "Glowmmi" ? "#BE185D" : "#065F46",
                                }}>
                                  {task.brand.name}
                                </span>
                              )}
                              {task.category && (
                                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{task.category}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
