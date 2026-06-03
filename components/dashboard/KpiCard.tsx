"use client";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  accentColor?: string;
  alert?: boolean;
  sub?: string;
  className?: string;
}

export function KpiCard({ title, value, change, changeLabel, icon: Icon, accentColor = "#6366F1", alert, sub }: KpiCardProps) {
  const isPositive = change !== undefined && change >= 0;
  const isNeutral = change === undefined || change === 0;

  return (
    <div
      className="rounded-2xl p-5 transition-all hover:scale-[1.01]"
      style={{
        background: "var(--card)",
        border: alert ? "1px solid var(--red)" : "1px solid var(--border)",
        boxShadow: "0 1px 3px var(--shadow)",
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-3)" }}>{title}</p>
        {Icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `${accentColor}18` }}>
            <Icon size={16} style={{ color: accentColor }} />
          </div>
        )}
      </div>
      <div className="text-2xl font-bold tracking-tight mb-1" style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div className="text-xs font-medium" style={{ color: "var(--text-3)" }}>{sub}</div>}
      {change !== undefined && (
        <div className="flex items-center gap-1 mt-3 text-xs font-semibold" style={{ color: isPositive ? "var(--green)" : isNeutral ? "var(--text-3)" : "var(--red)" }}>
          {isNeutral ? <Minus size={11} /> : isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {Math.abs(change).toFixed(1)}% {changeLabel ?? "vs ayer"}
        </div>
      )}
    </div>
  );
}
