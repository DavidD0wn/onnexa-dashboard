import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ── GET — listar reglas ─────────────────────────────────────── */
export async function GET() {
  const config = await prisma.metaBotConfig.findFirst({ orderBy: { createdAt: "desc" } });
  if (!config) return NextResponse.json([]);

  const rules = await prisma.metaBotRule.findMany({
    where:   { configId: config.id },
    orderBy: { priority: "desc" },
  });
  return NextResponse.json(rules);
}

/* ── POST — crear regla ──────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const config = await prisma.metaBotConfig.findFirst({ orderBy: { createdAt: "desc" } });
  if (!config) return NextResponse.json({ error: "Sin config" }, { status: 400 });

  const data = await req.json();
  const rule = await prisma.metaBotRule.create({
    data: {
      configId: config.id,
      name:     data.name,
      keywords: JSON.stringify(data.keywords),
      response: data.response,
      isActive: data.isActive ?? true,
      priority: data.priority ?? 0,
    },
  });
  return NextResponse.json(rule);
}

/* ── PUT — actualizar regla ──────────────────────────────────── */
export async function PUT(req: NextRequest) {
  const data = await req.json();
  const rule = await prisma.metaBotRule.update({
    where: { id: data.id },
    data:  {
      name:     data.name,
      keywords: JSON.stringify(data.keywords),
      response: data.response,
      isActive: data.isActive,
      priority: data.priority,
    },
  });
  return NextResponse.json(rule);
}

/* ── DELETE — eliminar regla ─────────────────────────────────── */
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await prisma.metaBotRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
