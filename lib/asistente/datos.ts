// lib/asistente/datos.ts
// Datos de la app (solo lectura) para el MCP y el asistente de voz: se llama al mismo handler
// GET que usa el dashboard, así los números son idénticos. Montos en USD.
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET as marcas } from "@/app/api/brands/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as pyl } from "@/app/api/p-and-l/route";
import { GET as ads } from "@/app/api/meta-ads/insights/route";
import { GET as productos } from "@/app/api/products/analytics/route";
import { GET as ltv } from "@/app/api/ltv/route";
import { GET as contracargos } from "@/app/api/chargebacks/route";

const FECHAS = { from: "Desde, AAAA-MM-DD", to: "Hasta, AAAA-MM-DD" };
export const DATOS: Record<string, { get: (req: NextRequest) => Promise<Response>; descripcion: string; params: Record<string, string> }> = {
  app_marcas: { get: () => marcas(), descripcion: "Marcas (Glowmmi, Balancea, Pleena…) y países con sus ids. Úsalo para saber qué id pasar en brand/brandId/country.", params: {} },
  app_dashboard: {
    get: dashboard,
    descripcion: "KPIs del dashboard: ventas, pedidos, gasto en ads, ROAS, márgenes, por día. Montos en USD.",
    params: { brand: "Id de marca (opcional, ver app_marcas)", country: "Id de país (opcional)", ...FECHAS, days: "Últimos N días si no hay from/to" },
  },
  app_pyl: {
    get: pyl,
    descripcion: "Estado de resultados (P&L): ingresos, COGS, envío, comisiones, ads, costos fijos y utilidad. USD.",
    params: { brand: "Id de marca (opcional)", ...FECHAS, granularity: "day | week | month" },
  },
  app_ads: {
    get: ads,
    descripcion: "Meta Ads por campaña: gasto, compras, ROAS, CPA y estado.",
    params: { brandId: "Id de marca (opcional)", dateFrom: "Desde, AAAA-MM-DD", dateTo: "Hasta, AAAA-MM-DD" },
  },
  app_productos: {
    get: productos,
    descripcion: "Analítica por producto: unidades, ingreso, COGS, margen y gasto atribuido. Puede ser una respuesta grande.",
    params: { brandId: "Id de marca (opcional)", country: "Id de país (opcional)", ...FECHAS, days: "Últimos N días si no hay from/to" },
  },
  app_ltv: { get: ltv, descripcion: "Valor de vida del cliente (LTV), recompra y cohortes.", params: { brand: "Id de marca (opcional)", ...FECHAS } },
  app_contracargos: { get: contracargos, descripcion: "Contracargos (disputas) registrados.", params: { brandId: "Id de marca (opcional)", ...FECHAS, days: "Últimos N días" } },
};

/** Llama a una herramienta de datos. `max` recorta la respuesta (el MCP aguanta más que Groq). */
export async function consultarDatos(nombre: string, args: Record<string, unknown> = {}, max = 100_000): Promise<{ ok: boolean; texto: string }> {
  const d = DATOS[nombre];
  if (!d) return { ok: false, texto: `No existe la herramienta de datos ${nombre}` };
  const url = new URL("http://mcp/");
  for (const [k, v] of Object.entries(args ?? {})) if (v != null && v !== "" && k in d.params) url.searchParams.set(k, String(v));
  const r = await d.get(new NextRequest(url));
  const texto = await r.text();
  // shortcut: corta respuestas enormes; si hace falta más, pedir rangos de fecha más cortos.
  return { ok: r.ok, texto: texto.length > max ? texto.slice(0, max) + "\n…[recortado: pide un rango más corto]" : texto };
}

/** Catálogo para el prompt del asistente de voz: herramientas, parámetros e ids de marca reales. */
export async function catalogoDatos(): Promise<string> {
  const marcasDb = await prisma.brand.findMany({ select: { id: true, name: true } }).catch(() => []);
  const lineas = Object.entries(DATOS)
    .filter(([n]) => n !== "app_marcas")
    .map(([n, d]) => `- ${n}: ${d.descripcion} Parámetros: ${Object.keys(d.params).join(", ")}`);
  return lineas.join("\n") + `\nIds de marca: ${marcasDb.map((m) => `${m.name} = ${m.id}`).join(", ")}`;
}
