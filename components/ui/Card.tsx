"use client";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl transition-all ${className}`}
      style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 1px 3px var(--shadow)" }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-5 py-4 ${className}`} style={{ borderBottom: "1px solid var(--border)" }}>
      {children}
    </div>
  );
}

export function CardContent({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function CardTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={`text-sm font-bold ${className}`} style={{ color: "var(--text)" }}>
      {children}
    </h3>
  );
}
