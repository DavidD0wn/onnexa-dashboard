import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit  = parseInt(searchParams.get("limit")  ?? "50");
  const offset = parseInt(searchParams.get("offset") ?? "0");
  const status = searchParams.get("status"); // "pending" | "replied" | "error" | "skipped" | null (all)

  const where = status ? { status } : {};

  const [total, items] = await Promise.all([
    prisma.metaConversation.count({ where }),
    prisma.metaConversation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    limit,
      skip:    offset,
    }),
  ]);

  // Stats
  const stats = await prisma.metaConversation.groupBy({
    by:         ["status"],
    _count:     { id: true },
  });

  const counts = {
    total:   total,
    replied: 0,
    pending: 0,
    error:   0,
    skipped: 0,
  };
  for (const s of stats) {
    if (s.status in counts) (counts as any)[s.status] = s._count.id;
  }

  return NextResponse.json({ items, total, counts });
}
