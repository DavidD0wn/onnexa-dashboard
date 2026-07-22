// app/api/automatizaciones/zoho/reportes/route.ts
// ── Reportes: de qué nos escriben más los clientes ──
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Etiquetas legibles para cada tipo de caso que clasifica la IA
const CASO_LABEL: Record<string, string> = {
  CJ_SIMPLIFICAR_DIRECCION: "Dirección muy larga (paquetería)",
  CJ_ADDRESS2_LARGO:        "Colonia muy larga (paquetería)",
  CJ_DIRECCION_INCOMPLETA:  "Dirección incompleta (paquetería)",
  CJ_CP_NO_COINCIDE:        "CP no coincide (paquetería)",
  CLIENTE_DONDE_PEDIDO:     "¿Dónde está mi pedido?",
  CLIENTE_REEMBOLSO:        "Pide reembolso",
  CLIENTE_YA_RECIBIO:       "Ya recibió el pedido",
  CLIENTE_PEDIR_DIRECCION:  "Hay que pedirle la dirección",
  ESCALAR_HUMANO:           "Necesita revisión humana",
};

export async function GET(req: NextRequest) {
  const dias = parseInt(req.nextUrl.searchParams.get("dias") ?? "30");
  const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);

  const convs = await prisma.zohoConversation.findMany({
    where:  { createdAt: { gte: desde } },
    select: {
      caseType: true, status: true, source: true, createdAt: true,
      aiConfidence: true, fromEmail: true, inboundText: true,
      config: { select: { emailAddress: true } },
    },
  });

  const marca = (c: any) => (/glowmmi/i.test(c.config?.emailAddress ?? "") ? "Glowmmi" : "Balancea");

  // ── Por tipo de caso (lo que más preguntan) ──
  const porCaso: Record<string, { total: number; Glowmmi: number; Balancea: number }> = {};
  for (const c of convs) {
    if (!c.caseType) continue;
    const k = c.caseType;
    porCaso[k] ??= { total: 0, Glowmmi: 0, Balancea: 0 };
    porCaso[k].total++;
    porCaso[k][marca(c) as "Glowmmi" | "Balancea"]++;
  }
  const casos = Object.entries(porCaso)
    .map(([caso, v]) => ({ caso, label: CASO_LABEL[caso] ?? caso, ...v }))
    .sort((a, b) => b.total - a.total);

  // ── Por tienda ──
  const porMarca = { Glowmmi: 0, Balancea: 0 };
  for (const c of convs) porMarca[marca(c) as "Glowmmi" | "Balancea"]++;

  // ── Por estado ──
  const porEstado: Record<string, number> = {};
  for (const c of convs) porEstado[c.status] = (porEstado[c.status] ?? 0) + 1;

  // ── Volumen por día ──
  const porDia: Record<string, number> = {};
  for (const c of convs) {
    const d = c.createdAt.toISOString().slice(0, 10);
    porDia[d] = (porDia[d] ?? 0) + 1;
  }
  const dias_serie = Object.entries(porDia).sort().map(([fecha, n]) => ({ fecha, n }));

  // ── Ruido filtrado (rebotes/publicidad que NO gastaron IA) ──
  const ruido = convs.filter((c) => c.source === "filter").length;

  // ── Clientes que más escriben ──
  const porCliente: Record<string, number> = {};
  for (const c of convs) {
    if (c.source === "filter") continue;
    porCliente[c.fromEmail] = (porCliente[c.fromEmail] ?? 0) + 1;
  }
  const repetidores = Object.entries(porCliente)
    .filter(([, n]) => n > 1)
    .map(([email, n]) => ({ email, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  // ── Confianza media de la IA ──
  const conConf = convs.filter((c) => typeof c.aiConfidence === "number");
  const confianzaMedia = conConf.length
    ? conConf.reduce((s, c) => s + (c.aiConfidence ?? 0), 0) / conConf.length
    : 0;

  return NextResponse.json({
    dias,
    total: convs.length,
    ruido,
    reales: convs.length - ruido,
    casos,
    porMarca,
    porEstado,
    serie: dias_serie,
    repetidores,
    confianzaMedia,
  });
}
