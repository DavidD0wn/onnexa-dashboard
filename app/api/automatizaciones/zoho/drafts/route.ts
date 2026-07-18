// app/api/automatizaciones/zoho/drafts/route.ts
// ── Bandeja de borradores generados por la IA (pendientes de aprobar) ──
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
  });

  return NextResponse.json({
    drafts: drafts.map((d) => ({
      ...d,
      needsData: d.needsData ? JSON.parse(d.needsData) : [],
    })),
  });
}
