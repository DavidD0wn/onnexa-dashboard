"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/lib/theme";
import { useFilters } from "@/lib/filters";
import { useCurrency, CURRENCY_INFO, CurrencyCode } from "@/lib/currency";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, TrendingUp, BarChart2, Calendar, DollarSign,
  Megaphone, Package, BarChart3, Globe, Calculator, FlaskConical,
  Tag, Layers, CheckSquare, Upload, Truck, Bell, FileText,
  Settings, ChevronDown, Moon, Sun, X, Telescope, Bot, Mail, Target, ShoppingBag, Table2, Users, AppWindow, Boxes, BookOpen,
} from "lucide-react";

/* ── Mark ──────────────────────────────────────────────────── */
function OnnexaMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <path d="M11 2L19 6.5V15.5L11 20L3 15.5V6.5L11 2Z"
        stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" fill="none" />
      <path d="M11 7L15 9.5V14.5L11 17L7 14.5V9.5L11 7Z"
        fill="#0E766E" opacity="0.95" />
    </svg>
  );
}

/* ── Períodos ───────────────────────────────────────────────── */
const PERIODS = [
  { label: "Hoy",         days: 1  },
  { label: "Esta semana", days: 7  },
  { label: "Este mes",    days: 30 },
  { label: "60 días",     days: 60 },
  { label: "90 días",     days: 90 },
];

/* ── Grupos ──────────────────────────────────────────────────── */
const GROUPS = [
  {
    id: "resumen",
    label: "Resumen",
    defaultOpen: true,
    items: [
      { label: "Dashboard",         href: "/",              icon: LayoutDashboard },
      { label: "Ventas Diarias",    href: "/ventas",        icon: TrendingUp      },
      { label: "Ventas x Producto", href: "/pedidos",       icon: ShoppingBag     },
      { label: "KPIs",               href: "/semana",        icon: BarChart2       },
      { label: "KPIs por País",     href: "/pais",          icon: Globe           },
      { label: "Rentabilidad",      href: "/rentabilidad",  icon: DollarSign      },
      { label: "Proyecciones",      href: "/proyecciones",  icon: Telescope       },
    ],
  },
  {
    id: "crecimiento",
    label: "Crecimiento",
    defaultOpen: false,
    items: [
      { label: "Ads",               href: "/ads",        icon: Megaphone   },
      { label: "Productos",         href: "/productos",  icon: Package     },
      { label: "Product Analytics", href: "/analytics",  icon: BarChart3   },
      { label: "COGS / Costos",     href: "/costos",     icon: DollarSign  },
    ],
  },
  {
    id: "herramientas",
    label: "Herramientas",
    defaultOpen: false,
    items: [
      { label: "Calculadora & Sim", href: "/calculadora", icon: Calculator },
      { label: "Análisis de Precio", href: "/pricing",    icon: Tag        },
    ],
  },
  {
    id: "operacion",
    label: "Operación",
    defaultOpen: false,
    items: [
      { label: "Tareas",              href: "/tareas",    icon: CheckSquare },
      { label: "Pedidos Pendientes",  href: "/inventario", icon: Truck      },
      { label: "Facturas Proveedor",  href: "/facturas",  icon: Upload      },
      { label: "Novedades",           href: "/novedades", icon: Bell        },
    ],
  },
  {
    id: "automatizaciones",
    label: "Automatizaciones",
    defaultOpen: false,
    items: [
      { label: "Bot Meta",  href: "/automatizaciones/meta", icon: Bot,  disabled: true },
      { label: "Bot Zoho",  href: "/automatizaciones/zoho", icon: Mail, disabled: true },
      { label: "Envío de Ebooks", href: "/automatizaciones/ebooks", icon: BookOpen },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    defaultOpen: false,
    items: [
      { label: "Reporte P&L",   href: "/reporte",       icon: Table2   },
      { label: "Costos Apps",   href: "/apps",          icon: AppWindow },
      { label: "Reportes PDF",  href: "/reportes",      icon: FileText },
      { label: "Configuración", href: "/configuracion", icon: Settings },
    ],
  },
];

/* ── Colores sidebar ────────────────────────────────────────── */
const S = {
  bg:         "#12304A",
  bgHover:    "rgba(255,255,255,0.07)",
  bgActive:   "#0E766E",
  text:       "rgba(255,255,255,0.72)",
  textActive: "#FFFFFF",
  label:      "rgba(255,255,255,0.35)",
  divider:    "rgba(255,255,255,0.08)",
};

/* ── NavGroup ───────────────────────────────────────────────── */
function NavGroup({
  group,
  pathname,
  alertCount,
  zohoAlertCount,
}: {
  group: (typeof GROUPS)[0];
  pathname: string;
  alertCount: number;
  zohoAlertCount: number;
}) {
  const hasActive = group.items.some((i) =>
    i.href === "/" ? pathname === "/" : pathname.startsWith(i.href)
  );
  const [open, setOpen] = useState(group.defaultOpen || hasActive);

  return (
    <div>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          marginTop: 6,
          borderRadius: 8,
          color: S.label,
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = S.bgHover;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          {group.label}
        </span>
        <ChevronDown
          size={12}
          style={{
            color: S.label,
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.2s ease",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Items */}
      {open && (
        <div style={{ marginTop: 2, marginBottom: 4 }}>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const soon = (item as any).soon;

            const disabled = (item as any).disabled;

            return (
              <Link
                key={item.href}
                href={disabled ? "#" : item.href}
                onClick={disabled ? (e) => e.preventDefault() : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  margin: "1px 4px",
                  borderRadius: 8,
                  background: active ? S.bgActive : "transparent",
                  color: active ? S.textActive : (soon || disabled) ? "rgba(255,255,255,0.35)" : S.text,
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  textDecoration: "none",
                  transition: "background 0.12s ease",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!active && !disabled)
                    (e.currentTarget as HTMLElement).style.background = S.bgHover;
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <Icon size={16} strokeWidth={active ? 2.5 : 1.8} style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {disabled && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                    textTransform: "uppercase", padding: "2px 6px", borderRadius: 20,
                    background: "rgba(239,68,68,0.18)", color: "rgba(239,68,68,0.7)", flexShrink: 0,
                  }}>
                    Offline
                  </span>
                )}
                {soon && !disabled && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                    textTransform: "uppercase", padding: "2px 6px", borderRadius: 20,
                    background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.45)", flexShrink: 0,
                  }}>
                    Próx
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar ────────────────────────────────────────────────── */
export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const { currency, setCurrency } = useCurrency();
  const { days, setDays, isCustom, customFrom, customTo, setCustomRange, clearCustomRange } = useFilters();
  const [alertCount,      setAlertCount]      = useState(0);
  const [zohoAlertCount,  setZohoAlertCount]  = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [meta, zoho] = await Promise.all([
          fetch("/api/automatizaciones/meta/alerts").then((r) => r.json()),
          fetch("/api/automatizaciones/zoho/alerts").then((r) => r.json()),
        ]);
        setAlertCount(meta.total ?? 0);
        setZohoAlertCount(zoho.total ?? 0);
      } catch {}
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  // Local state for date inputs
  const [localFrom, setLocalFrom] = useState(customFrom ?? "");
  const [localTo,   setLocalTo]   = useState(customTo   ?? "");

  const handleApplyRange = () => {
    if (localFrom && localTo && localFrom <= localTo) {
      setCustomRange(localFrom, localTo);
    }
  };

  const handleClear = () => {
    clearCustomRange();
    setLocalFrom("");
    setLocalTo("");
    setDays(30);
  };

  return (
    <aside
      className="sidebar-scroll fixed left-0 top-0 h-screen flex flex-col z-40"
      style={{
        width: "var(--sidebar-w)",
        background: S.bg,
        borderRight: `1px solid ${S.divider}`,
      }}
    >
      {/* ── Logo ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 18px",
          borderBottom: `1px solid ${S.divider}`,
          flexShrink: 0,
        }}
      >
        <OnnexaMark />
        <div>
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
            Onnexa
          </p>
          <p style={{ color: S.label, fontSize: 10, lineHeight: 1.3 }}>
            Command Center
          </p>
        </div>
      </div>

      {/* ── Scroll area ──────────────────────────────── */}
      <div
        className="sidebar-scroll"
        style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}
      >
        {/* Período — presets */}
        <div style={{ padding: "0 10px", marginBottom: 2 }}>
          <p
            style={{
              color: S.label,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              padding: "6px 8px 4px",
            }}
          >
            Período
          </p>
          {PERIODS.map((p) => {
            const active = !isCustom && (
              p.label === "Hoy"         ? days === 1  :
              p.label === "Esta semana" ? days === 7  :
              p.label === "Este mes"    ? days === 30 :
              p.label === "60 días"     ? days === 60 :
              p.label === "90 días"     ? days === 90 : false
            );
            return (
              <button
                key={p.label}
                onClick={() => { setDays(p.days); setLocalFrom(""); setLocalTo(""); }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  margin: "1px 0",
                  borderRadius: 8,
                  background: active ? S.bgActive : "transparent",
                  color: active ? S.textActive : S.text,
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.12s ease",
                }}
                onMouseEnter={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLElement).style.background = S.bgHover;
                }}
                onMouseLeave={(e) => {
                  if (!active)
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: active ? "#fff" : "rgba(255,255,255,0.20)",
                  }}
                />
                {p.label}
              </button>
            );
          })}
        </div>

        {/* ── Custom date range picker ─────────────────── */}
        <div style={{ padding: "6px 12px 10px" }}>
          <p style={{
            color: S.label,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            marginBottom: 8,
            paddingLeft: 0,
          }}>
            Fecha específica
          </p>

          {/* Active custom range banner */}
          {isCustom && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "5px 8px",
              marginBottom: 8,
              borderRadius: 8,
              background: "#0E766E22",
              border: "1px solid #0E766E55",
            }}>
              <span style={{ fontSize: 10, color: "#4DD9C6", fontWeight: 600 }}>
                {customFrom} → {customTo}
              </span>
              <button
                onClick={handleClear}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#4DD9C6" }}
              >
                <X size={11} />
              </button>
            </div>
          )}

          {/* Date inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div>
              <label style={{ fontSize: 10, color: S.label, display: "block", marginBottom: 3 }}>
                Desde
              </label>
              <input
                type="date"
                value={localFrom}
                max={localTo || undefined}
                onChange={(e) => setLocalFrom(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 7,
                  border: "1.5px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  fontSize: 12,
                  outline: "none",
                  colorScheme: "dark",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 10, color: S.label, display: "block", marginBottom: 3 }}>
                Hasta
              </label>
              <input
                type="date"
                value={localTo}
                min={localFrom || undefined}
                max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setLocalTo(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 7,
                  border: "1.5px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  fontSize: 12,
                  outline: "none",
                  colorScheme: "dark",
                }}
              />
            </div>
            <button
              onClick={handleApplyRange}
              disabled={!localFrom || !localTo || localFrom > localTo}
              style={{
                width: "100%",
                padding: "7px",
                borderRadius: 8,
                border: "none",
                background: localFrom && localTo && localFrom <= localTo
                  ? "#0E766E"
                  : "rgba(255,255,255,0.08)",
                color: localFrom && localTo && localFrom <= localTo
                  ? "#fff"
                  : "rgba(255,255,255,0.30)",
                fontSize: 12,
                fontWeight: 600,
                cursor: localFrom && localTo ? "pointer" : "not-allowed",
                transition: "background 0.15s ease",
              }}
            >
              Ver ese período
            </button>
          </div>
        </div>

        {/* Divider */}
        <div
          style={{
            margin: "2px 16px 8px",
            height: 1,
            background: S.divider,
          }}
        />

        {/* Nav groups */}
        <div style={{ padding: "0 8px" }}>
          {GROUPS.map((g) => (
            <NavGroup key={g.id} group={g} pathname={pathname} alertCount={alertCount} zohoAlertCount={zohoAlertCount} />
          ))}
        </div>
      </div>

      {/* ── Bottom ───────────────────────────────────── */}
      <div
        style={{
          padding: "14px 16px",
          borderTop: `1px solid ${S.divider}`,
          flexShrink: 0,
        }}
      >
        {/* Brand dots */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#EC4899" }} />
            <span style={{ color: "#EC4899", fontSize: 11, fontWeight: 600 }}>Glowmmi</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981" }} />
            <span style={{ color: "#10B981", fontSize: 11, fontWeight: 600 }}>Balancea</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#10B981",
                boxShadow: "0 0 0 2px rgba(16,185,129,0.25)",
              }}
            />
            <span style={{ color: "#10B981", fontSize: 11, fontWeight: 600 }}>Online</span>
          </div>
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggle}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "8px",
            borderRadius: 10,
            background: S.bgHover,
            border: `1px solid ${S.divider}`,
            color: S.text,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
          {theme === "dark" ? "Modo Claro" : "Modo Oscuro"}
        </button>

        {/* Currency selector */}
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          {(["USD", "MXN", "COP"] as CurrencyCode[]).map((c) => (
            <button
              key={c}
              suppressHydrationWarning
              onClick={() => setCurrency(c)}
              style={{
                flex: 1,
                padding: "6px 2px",
                borderRadius: 8,
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
                border: `1px solid ${currency === c ? "transparent" : S.divider}`,
                background: currency === c ? "#6366f1" : S.bgHover,
                color: currency === c ? "#fff" : S.text,
                transition: "all 0.15s",
                lineHeight: 1.3,
              }}
            >
              <span style={{ display: "block" }}>{CURRENCY_INFO[c].flag}</span>
              {c}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
