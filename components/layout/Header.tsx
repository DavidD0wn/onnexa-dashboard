"use client";
import { Bell } from "lucide-react";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const today = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-6"
      style={{
        height: "var(--header-h)",
        background: "var(--card)",
        borderBottom: "1px solid var(--border)",
        boxShadow: "0 1px 8px var(--shadow)",
      }}
    >
      <div>
        <h1 className="text-sm font-bold" style={{ color: "var(--text)" }}>{title}</h1>
        {subtitle && <p className="text-xs" style={{ color: "var(--text-3)" }}>{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs capitalize hidden sm:block" style={{ color: "var(--text-3)" }}>{today}</span>
        <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />
        <button className="relative w-8 h-8 flex items-center justify-center rounded-lg transition-all" style={{ color: "var(--text-3)" }}>
          <Bell size={15} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: "var(--red)" }} />
        </button>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
          style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}
        >
          F
        </div>
      </div>
    </header>
  );
}
