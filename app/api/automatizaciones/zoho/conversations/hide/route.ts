import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  const { id, hidden } = await req.json();
  const conv = await prisma.zohoConversation.update({
    where: { id },
    data:  { hidden: hidden ?? true },
  });
  return NextResponse.json({ ok: true, hidden: conv.hidden });
}
