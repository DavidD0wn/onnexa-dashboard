"use client";
import { useState, useMemo, useEffect } from "react";
import { Calculator, Save, Trash2, Copy, TrendingUp, AlertTriangle, CheckCircle, XCircle, Plus, RotateCcw } from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────── */
type Currency = "USD" | "MXN" | "CLP";
type Status   = "winner" | "rentable" | "just" | "risky" | "bad";
type MultOpt  = 3 | 3.5 | 4 | 5;

interface Inputs {
  scenarioName:       string;
  currency:           Currency;
  exchangeRate:       number;   // internal, hidden in UI
  cogs:               number;   // per unit
  shipping:           number;   // per order
  gatewayPct:         number;
  gatewayFixed:       number;
  bonus:              number;
  refundPct:          number;   // NEW — replaced otherCosts
  multiplier:         number;
  manualPriceEnabled: boolean;  // NEW
  manualPrice:        number;   // NEW
  discountPct:        number;
  targetCpa:          number;
}

interface OfferRow {
  id:         string;
  label:      string;
  units:      number;
  priceGross: number;
  locked:     boolean;
  isCustom:   boolean;
}

interface SavedScenario extends Inputs {
  id:      string;
  savedAt: string;
  offers:  OfferRow[];
}

/* ─── Currency config ─────────────────────────────────────────── */
const CURRENCY_DEFAULTS: Record<Currency, { label: string; symbol: string; defaultRate: number }> = {
  USD: { label: "Dólar",   symbol: "US$",  defaultRate: 1    },
  MXN: { label: "Peso MX", symbol: "MX$",  defaultRate: 18.7 },
  CLP: { label: "Peso CL", symbol: "CLP$", defaultRate: 900  },
};

/* ─── Helpers ─────────────────────────────────────────────────── */
const usd = (n: number) =>
  "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pctFmt = (n: number) => n.toFixed(1) + "%";

function localPrice(usdVal: number, currency: Currency, rate: number) {
  if (currency === "USD") return usd(usdVal);
  const sym = CURRENCY_DEFAULTS[currency].symbol;
  return sym + " " + Math.round(usdVal * rate).toLocaleString("es-MX");
}

function calcStatus(netMargin: number, beCpa: number, targetCpa: number): Status {
  if (beCpa <= 0 || targetCpa > beCpa)           return "bad";
  if (targetCpa / beCpa > 0.9)                    return "risky";
  if (netMargin >= 30)                             return "winner";
  if (netMargin >= 15)                             return "rentable";
  if (netMargin > 0)                              return "just";
  return "bad";
}

const STATUS_CFG: Record<Status, { label: string; bg: string; border: string; text: string; icon: any }> = {
  winner:   { label: "Ganadora 🏆",    bg: "var(--green-bg)",  border: "var(--green)",  text: "var(--green-text)",  icon: CheckCircle   },
  rentable: { label: "Rentable ✓",     bg: "#dcfce755",        border: "#22c55e",       text: "#16a34a",            icon: TrendingUp    },
  just:     { label: "Rentable justo", bg: "var(--yellow-bg)", border: "var(--yellow)", text: "var(--yellow-text)", icon: AlertTriangle },
  risky:    { label: "Riesgosa ⚠",    bg: "#fff7ed",          border: "#f97316",       text: "#c2410c",            icon: AlertTriangle },
  bad:      { label: "No rentable ✗",  bg: "var(--red-bg)",    border: "var(--red)",    text: "var(--red-text)",    icon: XCircle       },
};

/* ─── Calc engine ─────────────────────────────────────────────── */
function calcRow(row: OfferRow, inp: Inputs) {
  const priceDiscounted = row.priceGross * (1 - inp.discountPct / 100);
  const cogsTotal       = inp.cogs * row.units;
  const gatewayFee      = priceDiscounted * (inp.gatewayPct / 100) + inp.gatewayFixed;
  const refundEstimated = priceDiscounted * (inp.refundPct / 100);
  const priceNet        = priceDiscounted;  // net = discounted price (gateway & refund come out of it)
  const totalPreAds     = cogsTotal + inp.shipping + gatewayFee + refundEstimated + inp.bonus;
  const beCpa           = priceNet - totalPreAds;  // BE CPA = CPA máximo
  const beRoas          = priceNet > 0 && beCpa > 0        ? priceNet / beCpa      : null;
  const targetRoas      = priceNet > 0 && inp.targetCpa > 0 ? priceNet / inp.targetCpa : null;
  const netProfit       = beCpa - inp.targetCpa;
  const netMargin       = priceNet > 0 ? (netProfit / priceNet) * 100 : 0;

  // Revenue composition %
  const pCogs   = priceNet > 0 ? (cogsTotal          / priceNet) * 100 : 0;
  const pAds    = priceNet > 0 ? (inp.targetCpa       / priceNet) * 100 : 0;
  const pFees   = priceNet > 0 ? (gatewayFee          / priceNet) * 100 : 0;
  const pShip   = priceNet > 0 ? (inp.shipping        / priceNet) * 100 : 0;
  const pBonus  = priceNet > 0 ? (inp.bonus           / priceNet) * 100 : 0;
  const pRefund = priceNet > 0 ? (refundEstimated     / priceNet) * 100 : 0;
  const pProfit = Math.max(0, 100 - pCogs - pAds - pFees - pShip - pBonus - pRefund);

  const s = calcStatus(netMargin, beCpa, inp.targetCpa);
  return {
    priceDiscounted, priceNet, cogsTotal, gatewayFee, refundEstimated,
    totalPreAds, beCpa, beRoas, targetRoas, netProfit, netMargin,
    pCogs, pAds, pFees, pShip, pBonus, pRefund, pProfit, status: s,
  };
}

function suggestedGross(units: number, inp: Inputs): number {
  if (inp.manualPriceEnabled && units === 1) return inp.manualPrice;
  const base = (inp.cogs * units) + inp.shipping + inp.bonus;
  return +(base * inp.multiplier).toFixed(2);
}

/* ─── Small components ────────────────────────────────────────── */
function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
        {note && <span style={{ fontSize: 10, color: "var(--text-3)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, prefix, step = "0.01", min = "0" }: {
  value: number; onChange: (v: number) => void; prefix?: string; step?: string; min?: string;
}) {
  return (
    <div style={{ position: "relative" }}>
      {prefix && (
        <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-3)", pointerEvents: "none" }}>{prefix}</span>
      )}
      <input
        type="number" step={step} min={min} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: "100%", paddingLeft: prefix ? (prefix.length > 1 ? 30 : 24) : 12, paddingRight: 10,
          paddingTop: 8, paddingBottom: 8, borderRadius: 8,
          background: "var(--bg-2)", border: "1.5px solid var(--border)",
          color: "var(--text)", fontSize: 13, fontWeight: 600, outline: "none",
        }}
        onFocus={e => (e.target.style.borderColor = "#0E766E")}
        onBlur={e  => (e.target.style.borderColor = "var(--border)")}
      />
    </div>
  );
}

/* ─── Donut chart ─────────────────────────────────────────────── */
function DonutChart({ segments, profitPct }: {
  segments: { label: string; pct: number; color: string }[];
  profitPct: number;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const filtered = segments.filter(s => s.pct > 0.3);
  const total    = filtered.reduce((sum, s) => sum + s.pct, 0);

  const CX = 110, CY = 110, R = 78, STROKE = 30, GAP_DEG = 2.8;
  const C = 2 * Math.PI * R;

  let cumDeg = 0;
  const slices = filtered.map(s => {
    const fracDeg = (s.pct / total) * 360;
    const arcDeg  = Math.max(fracDeg - GAP_DEG, 0.3);
    const arcLen  = (arcDeg / 360) * C;
    const startDeg = cumDeg;
    cumDeg += fracDeg;
    return { ...s, startDeg, arcLen };
  });

  const activeSlice = hovered !== null ? slices[hovered] : null;
  const displayPct   = activeSlice ? activeSlice.pct.toFixed(1) + "%" : profitPct.toFixed(1) + "%";
  const displayLabel = activeSlice ? activeSlice.label : "UTILIDAD";
  const displayColor = activeSlice ? activeSlice.color : "#4ade80";

  return (
    <svg width="220" height="220" viewBox="0 0 220 220" style={{ display: "block", overflow: "visible" }}>
      {/* Background track */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border)" strokeWidth={STROKE} />

      {/* Segments */}
      {slices.map((s, i) => {
        const isHov = hovered === i;
        return (
          <g
            key={i}
            style={{
              transformOrigin: `${CX}px ${CY}px`,
              transform: `rotate(${-90 + s.startDeg}deg)${isHov ? " scale(1.08)" : ""}`,
              transition: "transform 0.2s cubic-bezier(0.34,1.56,0.64,1)",
              cursor: "pointer",
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <circle
              cx={CX} cy={CY} r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={isHov ? STROKE + 5 : STROKE}
              strokeDasharray={`${s.arcLen} ${C * 3}`}
              strokeLinecap="butt"
              style={{
                filter: isHov ? `drop-shadow(0 0 10px ${s.color}bb)` : "none",
                transition: "stroke-width 0.15s ease, filter 0.15s ease",
              }}
            />
          </g>
        );
      })}

      {/* Inner fill to define hole */}
      <circle cx={CX} cy={CY} r={R - STROKE / 2 - 4} fill="var(--bg-2)" />

      {/* Center: big value */}
      <text
        x={CX} y={CY - 7}
        textAnchor="middle" dominantBaseline="middle"
        fill={displayColor}
        fontSize="28" fontWeight="800"
        fontFamily="system-ui,-apple-system,sans-serif"
        style={{ transition: "fill 0.2s" }}
      >
        {displayPct}
      </text>
      {/* Center: label */}
      <text
        x={CX} y={CY + 16}
        textAnchor="middle" dominantBaseline="middle"
        fill="var(--text-3)"
        fontSize="9" fontWeight="700"
        letterSpacing="1.2"
        fontFamily="system-ui,-apple-system,sans-serif"
        style={{ textTransform: "uppercase" }}
      >
        {displayLabel}
      </text>
    </svg>
  );
}

/* ─── Revenue composition section ────────────────────────────── */
function RevenueSection({ c, inp, rowLabel }: {
  c: ReturnType<typeof calcRow>;
  inp: Inputs;
  rowLabel: string;
}) {
  const segments = [
    { label: "COGS",    pct: c.pCogs,   color: "#fb923c" },
    { label: "Ads",     pct: c.pAds,    color: "#818cf8" },
    { label: "Fees",    pct: c.pFees,   color: "#f472b6" },
    { label: "Flete",   pct: c.pShip,   color: "#38bdf8" },
    { label: "Refund",  pct: c.pRefund, color: "#f87171" },
    { label: "Utilidad",pct: c.pProfit, color: "#4ade80" },
  ];

  const msgs: { text: string; type: "green" | "yellow" | "red" | "blue" }[] = [];
  if (c.status === "winner" || c.status === "rentable")
    msgs.push({ text: `✅ La oferta tiene espacio para pautar con CPA objetivo actual (${usd(inp.targetCpa)}).`, type: "green" });
  if (c.pCogs > 40)
    msgs.push({ text: `💰 COGS ocupa ${pctFmt(c.pCogs)} del revenue — muy alto. Revisa proveedor o sube el precio.`, type: "red" });
  if (c.pAds > 35)
    msgs.push({ text: `📣 Ads ocupa ${pctFmt(c.pAds)} del revenue — revisa creativo, landing u oferta para bajar CPA.`, type: "yellow" });
  if (inp.discountPct > 15 && c.pProfit < 20)
    msgs.push({ text: `🏷 El descuento del ${inp.discountPct}% reduce el profit. Valida si mejora la conversión antes de usarlo.`, type: "yellow" });
  if (c.beRoas && c.beRoas > 4)
    msgs.push({ text: `📊 BE ROAS de ${c.beRoas.toFixed(2)}x es exigente — puede ser riesgoso para pauta fría.`, type: "yellow" });

  const bgMap    = { green: "var(--green-bg)", yellow: "var(--yellow-bg)", red: "var(--red-bg)", blue: "var(--blue-bg)" };
  const borderMap = { green: "var(--green)",   yellow: "var(--yellow)",    red: "var(--red)",    blue: "var(--blue)"    };
  const textMap  = { green: "var(--green-text)", yellow: "var(--yellow-text)", red: "var(--red-text)", blue: "var(--blue-text)" };

  return (
    <div className="card" style={{ padding: "22px 28px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>
        Composición del revenue —{" "}
        <span style={{ color: "var(--text-2)" }}>{rowLabel}</span>
        <span style={{ color: "var(--text-3)", fontWeight: 500 }}> · precio neto {usd(c.priceNet)}</span>
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 32, alignItems: "start" }}>

        {/* Left: donut + grid legend */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <DonutChart segments={segments} profitPct={c.pProfit} />

          {/* Legend grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", width: "100%" }}>
            {segments.filter(s => s.pct > 0.3).map(s => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: 4, background: s.color, flexShrink: 0,
                  boxShadow: `0 0 6px ${s.color}66`,
                }} />
                <div>
                  <p style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.label}</p>
                  <p style={{ fontSize: 14, color: "var(--text)", fontWeight: 800, lineHeight: 1.2 }}>{s.pct.toFixed(1)}%</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: recommendations */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--blue-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <TrendingUp size={13} style={{ color: "var(--blue)" }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Recomendaciones automáticas</p>
          </div>

          {msgs.length === 0 ? (
            <div style={{ padding: "14px 16px", borderRadius: 10, background: "var(--green-bg)", border: "1px solid var(--green)" }}>
              <p style={{ fontSize: 12, color: "var(--green-text)" }}>✅ Oferta equilibrada — sin alertas activas.</p>
            </div>
          ) : msgs.map((m, i) => (
            <div key={i} style={{ padding: "12px 16px", borderRadius: 10, background: bgMap[m.type], border: `1px solid ${borderMap[m.type]}` }}>
              <p style={{ fontSize: 12, color: textMap[m.type], lineHeight: 1.5 }}>{m.text}</p>
            </div>
          ))}

          {/* Quick numbers strip */}
          <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {[
              { label: "COGS",   value: usd(c.cogsTotal),  color: "#fb923c" },
              { label: "Fees",   value: usd(c.gatewayFee), color: "#f472b6" },
              { label: "Flete",  value: usd(inp.shipping),  color: "#38bdf8" },
              { label: "Refund", value: usd(c.refundEstimated), color: "#f87171" },
              { label: "Pre-ads",value: usd(c.totalPreAds), color: "var(--text-3)" },
              { label: "Utilidad",value: usd(c.netProfit), color: "#4ade80" },
            ].map(k => (
              <div key={k.label} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: 4 }}>{k.label}</p>
                <p style={{ fontSize: 13, fontWeight: 800, color: k.color }}>{k.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Offer comparison table ──────────────────────────────────── */
function OfferTable({ rows, calcs, inp, onPriceChange, onAddCustom, onRemoveRow, onResetRow }: {
  rows: OfferRow[];
  calcs: ReturnType<typeof calcRow>[];
  inp: Inputs;
  onPriceChange: (id: string, v: number) => void;
  onAddCustom: () => void;
  onRemoveRow: (id: string) => void;
  onResetRow: (id: string) => void;
}) {
  const discLabel = `${inp.discountPct}% OFF`;
  const th = (label: string, left = false) => (
    <th key={label} style={{
      padding: "8px 10px", textAlign: left ? "left" : "right", fontWeight: 700, fontSize: 10,
      textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)",
      borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
    }}>{label}</th>
  );

  return (
    <div className="card" style={{ padding: "20px 24px", overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Comparador de ofertas</p>
        <button onClick={onAddCustom} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8,
          background: "var(--blue-bg)", border: "1px solid var(--blue)", color: "var(--blue)",
          fontSize: 11, fontWeight: 700, cursor: "pointer",
        }}>
          <Plus size={12} /> Oferta custom
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {th("Oferta", true)}
            {th("Unids")}
            {th("P. Bruto")}
            {th(discLabel)}
            {th("P. Neto")}
            {th("Utilidad")}
            {th("% Util")}
            {th("CPA OBJ")}
            {th("ROAS OBJ")}
            {th("CPA BE")}
            {th("ROAS BE")}
            {th("Estado")}
            <th style={{ width: 50, borderBottom: "1px solid var(--border)" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const c   = calcs[i];
            const cfg = STATUS_CFG[c.status];
            const Icon = cfg.icon;
            const isBest = i === calcs.reduce((b, cc, ii) => cc.netMargin > calcs[b].netMargin ? ii : b, 0);
            return (
              <tr key={row.id} style={{
                borderBottom: "1px solid var(--border)",
                background: isBest ? "var(--green-bg)" : "transparent",
              }}>
                {/* Label */}
                <td style={{ padding: "10px 10px", fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>
                  {row.label}
                  {isBest && <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "var(--green)", color: "#fff", fontWeight: 700 }}>mejor</span>}
                </td>
                {/* Units */}
                <td style={{ padding: "10px 10px", textAlign: "right", color: "var(--text-2)" }}>
                  {row.isCustom ? (
                    <input type="number" min="1" value={row.units} style={{ width: 48, textAlign: "right", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 6px", color: "var(--text)", fontSize: 12 }}
                      onChange={e => onPriceChange(row.id + "_units", parseFloat(e.target.value) || 1)} />
                  ) : row.units}
                </td>
                {/* Precio bruto — editable */}
                <td style={{ padding: "10px 10px", textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                    <input
                      type="number" step="0.01" min="0" value={row.priceGross}
                      onChange={e => onPriceChange(row.id, parseFloat(e.target.value) || 0)}
                      style={{
                        width: 75, textAlign: "right", background: "var(--bg-2)",
                        border: `1.5px solid ${row.locked ? "#0E766E55" : "var(--border)"}`,
                        borderRadius: 6, padding: "4px 6px", color: "var(--text)", fontSize: 12, fontWeight: 600,
                      }}
                    />
                    {row.locked && (
                      <button title="Restaurar precio sugerido" onClick={() => onResetRow(row.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-3)" }}>
                        <RotateCcw size={10} />
                      </button>
                    )}
                  </div>
                </td>
                {/* Precio con X% OFF */}
                <td style={{ padding: "10px 10px", textAlign: "right", color: "var(--text-3)", fontSize: 11 }}>
                  {usd(c.priceDiscounted)}
                </td>
                {/* Precio neto */}
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 600, color: "var(--text)" }}>
                  {usd(c.priceNet)}
                </td>
                {/* Utilidad $ */}
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 700, color: c.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>
                  {usd(c.netProfit)}
                </td>
                {/* % Utilidad */}
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 700, color: c.netMargin >= 20 ? "var(--green)" : c.netMargin >= 10 ? "var(--yellow)" : "var(--red)" }}>
                  {c.netMargin.toFixed(1)}%
                </td>
                {/* CPA OBJ */}
                <td style={{ padding: "10px 10px", textAlign: "right", color: "var(--text-2)" }}>
                  {usd(inp.targetCpa)}
                </td>
                {/* ROAS OBJ */}
                <td style={{ padding: "10px 10px", textAlign: "right", color: "var(--blue)" }}>
                  {c.targetRoas ? c.targetRoas.toFixed(2) + "x" : "—"}
                </td>
                {/* CPA BE */}
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 700, color: c.beCpa > inp.targetCpa ? "var(--green)" : "var(--red)" }}>
                  {usd(c.beCpa)}
                </td>
                {/* ROAS BE */}
                <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 600, color: "var(--text-2)" }}>
                  {c.beRoas ? c.beRoas.toFixed(2) + "x" : "—"}
                </td>
                {/* Estado */}
                <td style={{ padding: "10px 10px", textAlign: "right" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: cfg.border, color: "#fff", whiteSpace: "nowrap",
                  }}>
                    <Icon size={10} />
                    {cfg.label}
                  </span>
                </td>
                {/* Remove */}
                <td style={{ padding: "10px 6px", textAlign: "center" }}>
                  {row.isCustom && (
                    <button onClick={() => onRemoveRow(row.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Constants ───────────────────────────────────────────────── */
const MULT_OPTS: { label: string; val: number }[] = [
  { label: "3×", val: 3 }, { label: "3.5×", val: 3.5 },
  { label: "4×", val: 4 }, { label: "5×", val: 5 },
];

const DEFAULT_INPUTS: Inputs = {
  scenarioName: "", currency: "MXN", exchangeRate: 18.7,
  cogs: 6.20, shipping: 6.50, gatewayPct: 3.5, gatewayFixed: 0.30,
  bonus: 0, refundPct: 0,
  multiplier: 3.5, manualPriceEnabled: false, manualPrice: 0,
  discountPct: 10, targetCpa: 12,
};

function makeDefaultRows(inp: Inputs): OfferRow[] {
  return [1, 2, 3].map(units => ({
    id: `x${units}`, label: units === 1 ? "x1 — 1 unidad" : `x${units} — ${units} unidades`,
    units, priceGross: suggestedGross(units, inp), locked: false as boolean, isCustom: false as boolean,
  }));
}

const LS_KEY = "onnexa_calc_scenarios";

/* ─── Main page ────────────────────────────────────────────────── */
export default function CalculadoraPage() {
  const [inp, setInp]             = useState<Inputs>(DEFAULT_INPUTS);
  const [rows, setRows]           = useState<OfferRow[]>(() => makeDefaultRows(DEFAULT_INPUTS));
  const [customMult, setCustomMult] = useState(false);
  const [saved, setSaved]         = useState<SavedScenario[]>([]);
  const [saveMsg, setSaveMsg]     = useState("");
  const [selectedRow, setSelectedRow] = useState(0);  // for pie chart

  useEffect(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) setSaved(JSON.parse(raw)); } catch {}
  }, []);

  const calcs = useMemo(() => rows.map(r => calcRow(r, inp)), [rows, inp]);

  /* ── Helpers ── */
  const setField = <K extends keyof Inputs>(key: K) => (val: Inputs[K]) =>
    setInp(p => ({ ...p, [key]: val }));

  const setCurrency = (cur: Currency) =>
    setInp(p => ({ ...p, currency: cur, exchangeRate: CURRENCY_DEFAULTS[cur].defaultRate }));

  const setMultiplier = (val: number) => {
    setInp(p => ({ ...p, multiplier: val }));
    setRows(prev => prev.map(r => r.locked ? r : { ...r, priceGross: suggestedGross(r.units, { ...inp, multiplier: val }) }));
  };

  /* ── Row helpers ── */
  const handlePriceChange = (id: string, v: number) => {
    if (id.endsWith("_units")) {
      const rowId = id.replace("_units", "");
      setRows(prev => prev.map(r => r.id !== rowId ? r : { ...r, units: v, priceGross: suggestedGross(v, inp) }));
    } else {
      setRows(prev => prev.map(r => r.id !== id ? r : { ...r, priceGross: v, locked: true }));
    }
  };
  const handleResetRow  = (id: string) =>
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, priceGross: suggestedGross(r.units, inp), locked: false }));
  const handleAddCustom = () => {
    const id = `custom-${Date.now()}`;
    setRows(prev => [...prev, { id, label: "Custom", units: 1, priceGross: suggestedGross(1, inp), locked: false, isCustom: true }]);
  };
  const handleRemoveRow = (id: string) => setRows(prev => prev.filter(r => r.id !== id));

  /* ── Recalc unlocked rows when cost inputs change ── */
  useEffect(() => {
    setRows(prev => prev.map(r => r.locked ? r : { ...r, priceGross: suggestedGross(r.units, inp) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inp.cogs, inp.shipping, inp.bonus, inp.multiplier, inp.manualPriceEnabled, inp.manualPrice]);

  /* ── Save / load ── */
  const handleSave = () => {
    if (!inp.scenarioName.trim()) { setSaveMsg("Ponle nombre al escenario primero."); setTimeout(() => setSaveMsg(""), 2500); return; }
    const scenario: SavedScenario = { ...inp, id: Date.now().toString(), savedAt: new Date().toISOString(), offers: rows };
    const next = [scenario, ...saved].slice(0, 20);
    setSaved(next); localStorage.setItem(LS_KEY, JSON.stringify(next));
    setSaveMsg("✓ Guardado"); setTimeout(() => setSaveMsg(""), 2000);
  };
  const handleLoad = (s: SavedScenario) => {
    const { id: _id, savedAt: _sa, offers, ...inputs } = s;
    setInp(inputs); setRows(offers);
  };
  const handleDelete = (id: string) => {
    const next = saved.filter(s => s.id !== id);
    setSaved(next); localStorage.setItem(LS_KEY, JSON.stringify(next));
  };
  const handleDuplicate = (s: SavedScenario) => {
    const dup: SavedScenario = { ...s, id: Date.now().toString(), savedAt: new Date().toISOString(), scenarioName: s.scenarioName + " (copia)" };
    const next = [dup, ...saved].slice(0, 20);
    setSaved(next); localStorage.setItem(LS_KEY, JSON.stringify(next));
  };

  /* ── Derived ── */
  const c0    = calcs[0];
  const cSel  = calcs[Math.min(selectedRow, calcs.length - 1)];
  const cfg0  = STATUS_CFG[c0.status];
  const Icon0 = cfg0.icon;

  /* ── KPI cards (ordered per brief) ── */
  const kpis = [
    {
      label: "Precio de Venta",
      value: usd(rows[0]?.priceGross ?? 0),
      sub: `Neto: ${usd(c0.priceNet)} · ${inp.discountPct}% OFF: ${usd(c0.priceDiscounted)}`,
      color: "var(--text)",
    },
    {
      label: "BE CPA / CPA Máx",
      value: usd(c0.beCpa),
      sub: c0.beCpa > inp.targetCpa ? `✓ Margen: ${usd(c0.netProfit)}` : "✗ Sin espacio para pautar",
      color: c0.beCpa > inp.targetCpa ? "var(--green)" : "var(--red)",
    },
    {
      label: "BE ROAS",
      value: c0.beRoas ? c0.beRoas.toFixed(2) + "x" : "—",
      sub: "ROAS mínimo para no perder",
      color: "var(--text)",
    },
    {
      label: "CPA Objetivo",
      value: usd(inp.targetCpa),
      sub: c0.beCpa > inp.targetCpa ? `${pctFmt((inp.targetCpa / c0.beCpa) * 100)} del BE CPA` : "Supera el BE CPA",
      color: c0.beCpa > inp.targetCpa ? "var(--blue)" : "var(--red)",
    },
    {
      label: "ROAS Objetivo",
      value: c0.targetRoas ? c0.targetRoas.toFixed(2) + "x" : "—",
      sub: `= precio neto / CPA obj`,
      color: "var(--blue)",
    },
    {
      label: "Utilidad (x1)",
      value: usd(c0.netProfit),
      sub: `Costo pre-ads: ${usd(c0.totalPreAds)}`,
      color: c0.netProfit >= 0 ? "var(--green)" : "var(--red)",
    },
    {
      label: "% Utilidad (x1)",
      value: pctFmt(c0.netMargin),
      sub: cfg0.label,
      color: cfg0.border,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>

      {/* Header */}
      <div className="page-header" style={{ padding: "12px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--blue-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Calculator size={16} style={{ color: "var(--blue)" }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>Calculadora de Oferta</p>
              <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>Diseña y compara ofertas antes de pautar</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="text" placeholder="Nombre del escenario (ej: Deep Collagen MX x2 - 10%OFF)"
              value={inp.scenarioName} onChange={e => setField("scenarioName")(e.target.value)}
              style={{ width: 310, padding: "8px 12px", borderRadius: 8, background: "var(--bg-2)", border: "1.5px solid var(--border)", color: "var(--text)", fontSize: 12, outline: "none" }}
            />
            <button onClick={handleSave} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8,
              background: "#0E766E", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}>
              <Save size={13} /> Guardar
            </button>
            {saveMsg && <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 700 }}>{saveMsg}</span>}
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ── Row 1: Config + Costs + Prices ── */}
        <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 1fr", gap: 16, alignItems: "start" }}>

          {/* A. Config */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>Configuración</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              <Field label="Moneda">
                <div style={{ display: "flex", gap: 4 }}>
                  {(["USD","MXN","CLP"] as Currency[]).map(cur => (
                    <button key={cur} onClick={() => setCurrency(cur)} style={{
                      flex: 1, padding: "6px 2px", borderRadius: 7,
                      border: `1.5px solid ${inp.currency === cur ? "#0E766E" : "var(--border)"}`,
                      background: inp.currency === cur ? "#0E766E15" : "var(--bg-2)",
                      color: inp.currency === cur ? "#0E766E" : "var(--text-3)",
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                    }}>{cur}</button>
                  ))}
                </div>
              </Field>

              <Field label="Descuento %" note={`Label: "${inp.discountPct}% OFF"`}>
                <NumInput value={inp.discountPct} onChange={setField("discountPct")} prefix="%" step="1" />
              </Field>

              <Field label="% Refund" note="Promedio de devoluciones">
                <NumInput value={inp.refundPct} onChange={setField("refundPct")} prefix="%" step="0.5" />
              </Field>

              {/* Tipo de precio */}
              <Field label="Tipo de precio">
                <div style={{ display: "flex", gap: 4 }}>
                  {[{ label: "×Mult", val: false }, { label: "Manual", val: true }].map(opt => (
                    <button key={String(opt.val)} onClick={() => setField("manualPriceEnabled")(opt.val)} style={{
                      flex: 1, padding: "6px 4px", borderRadius: 7,
                      border: `1.5px solid ${inp.manualPriceEnabled === opt.val ? "#6366f1" : "var(--border)"}`,
                      background: inp.manualPriceEnabled === opt.val ? "#6366f115" : "var(--bg-2)",
                      color: inp.manualPriceEnabled === opt.val ? "#6366f1" : "var(--text-3)",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                    }}>{opt.label}</button>
                  ))}
                </div>
              </Field>

              {inp.manualPriceEnabled && (
                <Field label="Precio manual (x1)" note="Precio bruto">
                  <NumInput value={inp.manualPrice} onChange={setField("manualPrice")} prefix="$" />
                </Field>
              )}
            </div>
          </div>

          {/* B. Costos */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>Costos de la oferta</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="COGS / unidad" note="Costo producto">
                <NumInput value={inp.cogs} onChange={setField("cogs")} prefix="$" />
              </Field>
              <Field label="Flete / orden" note="Fulfillment">
                <NumInput value={inp.shipping} onChange={setField("shipping")} prefix="$" />
              </Field>
              <Field label="Fee pasarela %" note="Ej: 3.5%">
                <NumInput value={inp.gatewayPct} onChange={setField("gatewayPct")} prefix="%" step="0.1" />
              </Field>
              <Field label="Fee fijo" note="Ej: $0.30">
                <NumInput value={inp.gatewayFixed} onChange={setField("gatewayFixed")} prefix="$" />
              </Field>
              <Field label="Bono / regalo" note="Por orden">
                <NumInput value={inp.bonus} onChange={setField("bonus")} prefix="$" />
              </Field>
              {/* costo pre-ads de referencia */}
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <p style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>Total pre-ads (x1)</p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{usd(c0.totalPreAds)}</p>
              </div>
            </div>
          </div>

          {/* C. Precio y Pauta */}
          <div className="card" style={{ padding: "18px 20px" }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 14 }}>Precio & Pauta</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Multiplicador */}
              {!inp.manualPriceEnabled && (
                <Field label="Multiplicador" note="Costo base × mult = precio sugerido">
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {MULT_OPTS.map(m => (
                      <button key={m.val} onClick={() => { setCustomMult(false); setMultiplier(m.val); }} style={{
                        padding: "5px 10px", borderRadius: 7,
                        border: `1.5px solid ${!customMult && inp.multiplier === m.val ? "#0E766E" : "var(--border)"}`,
                        background: !customMult && inp.multiplier === m.val ? "#0E766E15" : "var(--bg-2)",
                        color: !customMult && inp.multiplier === m.val ? "#0E766E" : "var(--text-3)",
                        fontSize: 11, fontWeight: 700, cursor: "pointer",
                      }}>{m.label}</button>
                    ))}
                    <button onClick={() => setCustomMult(true)} style={{
                      padding: "5px 10px", borderRadius: 7,
                      border: `1.5px solid ${customMult ? "#6366f1" : "var(--border)"}`,
                      background: customMult ? "#6366f115" : "var(--bg-2)", color: customMult ? "#6366f1" : "var(--text-3)",
                      fontSize: 11, fontWeight: 700, cursor: "pointer",
                    }}>Custom</button>
                  </div>
                  {customMult && <NumInput value={inp.multiplier} onChange={v => setMultiplier(v)} prefix="×" step="0.1" />}
                </Field>
              )}

              <Field label="CPA Objetivo" note="Costo por compra esperado">
                <NumInput value={inp.targetCpa} onChange={setField("targetCpa")} prefix="$" />
              </Field>

              {/* Quick reference */}
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)", marginBottom: 8 }}>Referencia x1</p>
                {[
                  { label: "Precio bruto",         value: usd(rows[0]?.priceGross ?? 0) },
                  { label: `Con ${inp.discountPct}% OFF`, value: usd(c0.priceDiscounted) },
                  { label: "Precio neto",            value: usd(c0.priceNet) },
                  { label: `En ${CURRENCY_DEFAULTS[inp.currency].symbol}`, value: localPrice(c0.priceNet, inp.currency, inp.exchangeRate), color: "var(--text-2)" },
                  { label: "BE CPA / CPA máx",       value: usd(c0.beCpa), color: c0.beCpa > inp.targetCpa ? "var(--green)" : "var(--red)" },
                  { label: "BE ROAS",                value: c0.beRoas ? c0.beRoas.toFixed(2) + "x" : "—" },
                  { label: "ROAS Objetivo",          value: c0.targetRoas ? c0.targetRoas.toFixed(2) + "x" : "—", color: "var(--blue)" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>{r.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: (r as any).color ?? "var(--text-2)" }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Row 2: 7 KPI cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 10 }}>
          {kpis.map((k) => (
            <div key={k.label} className="card" style={{ padding: "14px 16px" }}>
              <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: 5 }}>{k.label}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: k.color, letterSpacing: "-0.01em", lineHeight: 1.1 }}>{k.value}</p>
              <p style={{ fontSize: 9, color: "var(--text-3)", marginTop: 4, lineHeight: 1.3 }}>{k.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Row 3: Offer table ── */}
        <OfferTable
          rows={rows} calcs={calcs} inp={inp}
          onPriceChange={handlePriceChange}
          onAddCustom={handleAddCustom}
          onRemoveRow={handleRemoveRow}
          onResetRow={handleResetRow}
        />

        {/* ── Row 4: Revenue composition (donut + recs) ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Row picker */}
          <div style={{ display: "flex", gap: 6 }}>
            {rows.map((r, i) => (
              <button key={r.id} onClick={() => setSelectedRow(i)} style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: "pointer",
                border: `1.5px solid ${selectedRow === i ? "#0E766E" : "var(--border)"}`,
                background: selectedRow === i ? "#0E766E15" : "var(--bg-2)",
                color: selectedRow === i ? "#0E766E" : "var(--text-3)",
              }}>{r.label}</button>
            ))}
          </div>
          <RevenueSection c={cSel} inp={inp} rowLabel={rows[Math.min(selectedRow, rows.length - 1)]?.label ?? "x1"} />
        </div>

        {/* ── Row 5: Saved scenarios ── */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>
            Escenarios guardados ({saved.length})
          </p>
          {saved.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-3)" }}>Sin escenarios. Ponle nombre a la configuración actual y presiona Guardar.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["Nombre","Moneda","Desc%","CPA Obj","Mejor oferta","CPA BE","Utilidad","% Util","Estado","Fecha",""].map(c => (
                      <th key={c} style={{ padding: "6px 10px", textAlign: c === "Nombre" ? "left" : "right", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", borderBottom: "1px solid var(--border)" }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {saved.map(s => {
                    const sCalcs  = s.offers.map(r => calcRow(r, s));
                    const bestIdx = sCalcs.reduce((b, c, i) => c.netMargin > sCalcs[b].netMargin ? i : b, 0);
                    const best    = sCalcs[bestIdx];
                    const scfg    = STATUS_CFG[best.status];
                    return (
                      <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "9px 10px", fontWeight: 700, color: "var(--text)" }}>{s.scenarioName}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: "var(--text-2)" }}>{s.currency ?? "USD"}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: "var(--text-2)" }}>{s.discountPct}%</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: "var(--text-2)" }}>{usd(s.targetCpa)}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: "var(--text-2)" }}>{s.offers[bestIdx]?.label ?? "—"}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: best.beCpa > s.targetCpa ? "var(--green)" : "var(--red)" }}>{usd(best.beCpa)}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: best.netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{usd(best.netProfit)}</td>
                        <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700, color: best.netMargin >= 20 ? "var(--green)" : "var(--yellow)" }}>{best.netMargin.toFixed(1)}%</td>
                        <td style={{ padding: "9px 10px", textAlign: "right" }}>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: scfg.border, color: "#fff" }}>{scfg.label}</span>
                        </td>
                        <td style={{ padding: "9px 10px", textAlign: "right", color: "var(--text-3)", fontSize: 10 }}>{s.savedAt.slice(0,10)}</td>
                        <td style={{ padding: "9px 10px" }}>
                          <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                            <button onClick={() => handleLoad(s)} style={{ background: "var(--blue-bg)", border: "1px solid var(--blue)", borderRadius: 6, padding: "3px 8px", color: "var(--blue)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Cargar</button>
                            <button onClick={() => handleDuplicate(s)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", color: "var(--text-3)", cursor: "pointer" }}>
                              <Copy size={11} />
                            </button>
                            <button onClick={() => handleDelete(s.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
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
    </div>
  );
}
