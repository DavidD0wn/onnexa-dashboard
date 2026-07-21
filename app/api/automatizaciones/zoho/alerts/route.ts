import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET() {
  const [escalated, needs_attention] = await Promise.all([
    prisma.zohoConversation.count({ where: { status: "escalated",       hidden: false } }),
    prisma.zohoConversation.count({ where: { status: "needs_attention", hidden: false } }),
  ]);

  const items = await prisma.zohoConversation.findMany({
    where:   { status: { in: ["escalated", "needs_attention"] }, hidden: false },
    orderBy: { createdAt: "desc" },
    take:    20,
  });

  return NextResponse.json({
    total: escalated + needs_attention,
    escalated,
    needs_attention,
    items,
  });
}
