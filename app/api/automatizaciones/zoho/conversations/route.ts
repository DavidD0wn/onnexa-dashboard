import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "";
  const limit  = parseInt(searchParams.get("limit") ?? "50");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const where: any = { hidden: false };
  // "pendiente" agrupa todo lo que espera acción tuya (borradores + escalados)
  if (status === "pendiente")      where.status = { in: ["draft", "escalated", "needs_attention"] };
  else if (status)                 where.status = status;

  const [items, total, stats] = await Promise.all([
    prisma.zohoConversation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    limit,
      skip:    offset,
      // Incluir el buzón para saber si el correo llegó a Glowmmi o Balancea
      include: { config: { select: { emailAddress: true } } },
    }),
    prisma.zohoConversation.count({ where }),
    prisma.zohoConversation.groupBy({
      by:     ["status"],
      _count: { status: true },
      where:  { hidden: false },
    }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of stats) statusMap[s.status] = s._count.status;

  return NextResponse.json({
    total,
    items: items.map((c) => {
      const mailbox = (c as any).config?.emailAddress ?? "";
      return {
        ...c,
        mailbox,
        brand: /glowmmi/i.test(mailbox) ? "Glowmmi" : "Balancea",
        needsData: c.needsData ? JSON.parse(c.needsData) : [],
      };
    }),
    stats: {
      pendiente:        (statusMap["draft"] ?? 0) + (statusMap["escalated"] ?? 0) + (statusMap["needs_attention"] ?? 0),
      draft:            statusMap["draft"]            ?? 0,
      replied:          statusMap["replied"]          ?? 0,
      needs_attention:  statusMap["needs_attention"]  ?? 0,
      escalated:        statusMap["escalated"]        ?? 0,
      skipped:          statusMap["skipped"]          ?? 0,
      error:            statusMap["error"]            ?? 0,
    },
  });
}
