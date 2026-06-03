import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? "";
  const limit  = parseInt(searchParams.get("limit") ?? "50");
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const where: any = { hidden: false };
  if (status) where.status = status;

  const [items, total, stats] = await Promise.all([
    prisma.zohoConversation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    limit,
      skip:    offset,
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
    items,
    stats: {
      replied:          statusMap["replied"]          ?? 0,
      needs_attention:  statusMap["needs_attention"]  ?? 0,
      escalated:        statusMap["escalated"]        ?? 0,
      skipped:          statusMap["skipped"]          ?? 0,
      error:            statusMap["error"]            ?? 0,
    },
  });
}
