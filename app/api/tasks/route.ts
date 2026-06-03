import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const tasks = await prisma.task.findMany({
    include: { brand: true, country: true, product: true },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const data = await req.json();
  const task = await prisma.task.create({ data, include: { brand: true } });
  return NextResponse.json(task);
}

export async function PATCH(req: Request) {
  const { id, ...data } = await req.json();
  const task = await prisma.task.update({ where: { id }, data, include: { brand: true } });
  return NextResponse.json(task);
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
