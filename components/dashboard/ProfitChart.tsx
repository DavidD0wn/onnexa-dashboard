"use client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell
} from "recharts";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface ProfitData {
  date: string;
  profit: number;
  adSpend: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl p-3 text-xs"
      style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 8px 20px var(--shadow-md)" }}
    >
      <p className="font-semibold mb-2" style={{ color: "var(--text-2)" }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: "var(--text-3)" }}>{p.name === "profit" ? "Utilidad" : "Pauta"}:</span>
          <span className="font-semibold" style={{ color: "var(--text)" }}>
            {new Intl.NumberFormat("es-MX", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
};

export function ProfitChart({ data }: { data: ProfitData[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => {
            const d = new Date(v);
            return `${d.getDate()} ${format(d, "MMM", { locale: es })}`;
          }}
          interval={4}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#94A3B8" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="profit" radius={[3, 3, 0, 0]} maxBarSize={14}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.profit >= 0 ? "#10B981" : "#F87171"} />
          ))}
        </Bar>
        <Bar dataKey="adSpend" radius={[3, 3, 0, 0]} fill="#F59E0B" maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  );
}
