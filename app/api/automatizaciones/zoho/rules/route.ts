import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* Obtener el configId del único config Zoho */
async function getConfigId(): Promise<string | null> {
  const c = await prisma.zohoBotConfig.findFirst();
  return c?.id ?? null;
}

export async function GET() {
  const configId = await getConfigId();
  if (!configId) return NextResponse.json([], { status: 200 });

  const rules = await prisma.zohoBotRule.findMany({
    where:   { configId },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(rules);
}

export async function POST(req: NextRequest) {
  const configId = await getConfigId();
  if (!configId) return NextResponse.json({ error: "Sin config Zoho" }, { status: 404 });

  const { name, keywords, response, priority, isActive } = await req.json();

  const rule = await prisma.zohoBotRule.create({
    data: {
      configId,
      name,
      keywords: Array.isArray(keywords) ? JSON.stringify(keywords) : keywords,
      response,
      priority: priority ?? 1,
      isActive: isActive ?? true,
    },
  });

  return NextResponse.json(rule, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, name, keywords, response, priority, isActive } = await req.json();

  const rule = await prisma.zohoBotRule.update({
    where: { id },
    data: {
      name,
      keywords: Array.isArray(keywords) ? JSON.stringify(keywords) : keywords,
      response,
      priority,
      isActive,
    },
  });

  return NextResponse.json(rule);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  await prisma.zohoBotRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
