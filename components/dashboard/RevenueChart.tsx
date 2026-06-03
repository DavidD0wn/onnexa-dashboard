"use client";
import {
  ResponsiveContainer, ComposedChart, Bar, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export interface ChartData {
  date: string;
  glowmmi: number;
  balancea: number;
  profit: number;
  adSpend: number;
  orders: number;
}

const GLOWMMI_COLOR  = "#EC4899";
const BALANCEA_COLOR = "#10B981";
const PROFIT_COLOR   = "#6366F1";

function fmtMoney(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const ordersEntry = payload.find((p: any) => p.dataKey === "orders");
  const moneyEntries = payload.filter((p: any) => p.dataKey !== "orders");

  return (
    <div style={{
      background: "#FFFFFF",
      border: "1px solid #E5E7EB",
      borderRadius: 12,
      padding: "12px 16px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      minWidth: 180,
    }}>
      <p style={{ color: "#6B7280", fontSize: 11, fontWeight: 700, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>

      {/* Orders highlighted at top */}
      {ordersEntry && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 10px", borderRadius: 8,
          background: "rgba(99,102,241,0.08)", marginBottom: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: PROFIT_COLOR }} />
            <span style={{ color: "#6B7280", fontSize: 12, fontWeight: 600 }}>Pedidos</span>
          </div>
          <span style={{ color: "#111827", fontSize: 14, fontWeight: 800 }}>
            {ordersEntry.value}
          </span>
        </div>
      )}

      {/* Revenue by brand */}
      {moneyEntries.map((p: any) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color ?? p.fill, flexShrink: 0 }} />
          <span style={{ color: "#6B7280", fontSize: 12, textTransform: "capitalize", flex: 1 }}>
            {p.name === "glowmmi"  ? "Glowmmi"  :
             p.name === "balancea" ? "Balancea"  :
             p.name === "profit"   ? "Utilidad"  : p.name}:
          </span>
          <span style={{ color: "#111827", fontSize: 12, fontWeight: 700 }}>
            {new Intl.NumberFormat("en-US", {
              style: "currency", currency: "USD",
              minimumFractionDigits: 0, maximumFractionDigits: 0,
            }).format(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  data: ChartData[];
  showProfit?: boolean;
}

export function RevenueChart({ data, showProfit = false }: Props) {
  const maxOrders = Math.max(...data.map((d) => d.orders ?? 0), 1);

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={GLOWMMI_COLOR}  stopOpacity={0.18} />
              <stop offset="100%" stopColor={GLOWMMI_COLOR}  stopOpacity={0} />
            </linearGradient>
            <linearGradient id="bGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={BALANCEA_COLOR} stopOpacity={0.15} />
              <stop offset="100%" stopColor={BALANCEA_COLOR} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="pGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={PROFIT_COLOR}  stopOpacity={0.15} />
              <stop offset="100%" stopColor={PROFIT_COLOR}  stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="0" stroke="#F3F4F6" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => {
              const d = new Date(v);
              return `${d.getDate()} ${format(d, "MMM", { locale: es })}`;
            }}
            interval={Math.max(Math.floor(data.length / 8), 1)}
          />

          {/* Left Y axis — money */}
          <YAxis
            yAxisId="money"
            orientation="left"
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtMoney}
            width={48}
          />

          {/* Right Y axis — orders */}
          <YAxis
            yAxisId="orders"
            orientation="right"
            tick={{ fontSize: 11, fill: "#9CA3AF" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}`}
            width={32}
            domain={[0, maxOrders * 2.5]}  // Push bars low so they don't overlap lines
          />

          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }} />

          {/* Orders bars — background-style, subtle */}
          <Bar
            yAxisId="orders"
            dataKey="orders"
            name="Pedidos"
            fill={PROFIT_COLOR}
            fillOpacity={0.15}
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />

          {/* Revenue areas */}
          <Area
            yAxisId="money"
            type="monotone"
            dataKey="glowmmi"
            name="glowmmi"
            stroke={GLOWMMI_COLOR}
            strokeWidth={2}
            fill="url(#gGrad)"
            dot={false}
            activeDot={{ r: 4, fill: GLOWMMI_COLOR, strokeWidth: 0 }}
          />
          <Area
            yAxisId="money"
            type="monotone"
            dataKey="balancea"
            name="balancea"
            stroke={BALANCEA_COLOR}
            strokeWidth={2}
            fill="url(#bGrad)"
            dot={false}
            activeDot={{ r: 4, fill: BALANCEA_COLOR, strokeWidth: 0 }}
          />

          {showProfit && (
            <Area
              yAxisId="money"
              type="monotone"
              dataKey="profit"
              name="profit"
              stroke={PROFIT_COLOR}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="url(#pGrad)"
              dot={false}
              activeDot={{ r: 3, fill: PROFIT_COLOR, strokeWidth: 0 }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
