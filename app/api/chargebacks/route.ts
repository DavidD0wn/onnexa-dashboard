import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const brandId  = searchParams.get("brandId")  ?? undefined;
  const fromParam = searchParams.get("from") ?? undefined;
  const toParam   = searchParams.get("to")   ?? undefined;
  const days      = parseInt(searchParams.get("days") ?? "30");

  let from: Date, to: Date;
  if (fromParam && toParam) {
    from = new Date(fromParam + "T00:00:00.000Z");
    to   = new Date(toParam   + "T23:59:59.999Z");
  } else {
    const today = new Date();
    const f     = new Date(today);
    f.setDate(today.getDate() - (days - 1));
    from = new Date(Date.UTC(f.getFullYear(), f.getMonth(), f.getDate()));
    to   = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999));
  }

  const where: any = { date: { gte: from, lte: to } };
  if (brandId) where.brandId = brandId;

  const rows = await (prisma as any).chargeback.findMany({ where, orderBy: { date: "desc" } });

  const total = rows.reduce((s: number, r: any) => s + (r.status !== "won" ? r.amount : 0), 0);

  return NextResponse.json({ rows, total });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { date, brandId, amount, orderId, reason, status, notes } = body;

  if (!date || !brandId || !amount) {
    return NextResponse.json({ error: "Faltan campos requeridos: date, brandId, amount" }, { status: 400 });
  }

  const cb = await (prisma as any).chargeback.create({
    data: {
      date:    new Date(date),
      brandId,
      amount:  parseFloat(amount),
      orderId: orderId ?? null,
      reason:  reason  ?? null,
      status:  status  ?? "confirmed",
      notes:   notes   ?? null,
    },
  });

  return NextResponse.json(cb);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

  await (prisma as any).chargeback.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
