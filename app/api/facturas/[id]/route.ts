/**
 * GET    /api/facturas/[id]   — detalle completo de una factura
 * DELETE /api/facturas/[id]   — eliminar factura y sus órdenes
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { orderNumber: "asc" },
        include: { items: true },
      },
    },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.supplierInvoice.delete({ where: { id } });
  return NextResponse.json({ deleted: id });
}
