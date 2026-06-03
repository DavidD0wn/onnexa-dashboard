"use client";

type BadgeVariant = "green" | "red" | "yellow" | "blue" | "purple" | "gray";

const styles: Record<BadgeVariant, { bg: string; text: string }> = {
  green: { bg: "var(--green-bg)", text: "var(--green-text)" },
  red: { bg: "var(--red-bg)", text: "var(--red-text)" },
  yellow: { bg: "var(--yellow-bg)", text: "var(--yellow-text)" },
  blue: { bg: "var(--blue-bg)", text: "var(--blue-text)" },
  purple: { bg: "var(--purple-bg)", text: "var(--purple-text)" },
  gray: { bg: "var(--bg-2)", text: "var(--text-2)" },
};

export function Badge({ variant = "gray", children, className }: { variant?: BadgeVariant; children: React.ReactNode; className?: string }) {
  const s = styles[variant];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${className ?? ""}`}
      style={{ background: s.bg, color: s.text }}
    >
      {children}
    </span>
  );
}
