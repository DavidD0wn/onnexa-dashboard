// app/api/automatizaciones/zoho/drafts/route.ts
// ── Bandeja de borradores generados por la IA (pendientes de aprobar) ──
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


// GET: lista los borradores (draft) y escalados (escalated) no ocultos
export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status"); // opcional
  const where: any = { hidden: false, source: "ai" };
  if (status) where.status = status;
  else where.status = { in: ["draft", "escalated", "needs_attention"] };

  const drafts = await prisma.zohoConversation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    // Incluir el buzón que recibió el correo para saber si es Glowmmi o Balancea
    include: { config: { select: { emailAddress: true } } },
  });

  return NextResponse.json({
    drafts: drafts.map((d) => {
      const mailbox = d.config?.emailAddress ?? "";
      return {
        ...d,
        needsData: d.needsData ? JSON.parse(d.needsData) : [],
        mailbox,
        brand: /glowmmi/i.test(mailbox) ? "Glowmmi" : "Balancea",
      };
    }),
  });
}
