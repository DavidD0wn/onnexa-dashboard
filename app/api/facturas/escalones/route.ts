/**
 * GET  /api/facturas/escalones        — lista todos los escalones
 * POST /api/facturas/escalones        — upsert uno o varios escalones
 * DELETE /api/facturas/escalones?id=  — elimina un escalón
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const escalones = await prisma.supplierEscalon.findMany({
    orderBy: [{ productCode: "asc" }, { units: "asc" }],
  });
  return NextResponse.json(escalones);
}

export async function POST(req: Request) {
  const body = await req.json();
  const rows: Array<{
    productCode: string; productName: string; units: number;
    costMx?: number | null; costUs?: number | null; costCl?: number | null;
  }> = Array.isArray(body) ? body : [body];

  const results = [];
  for (const r of rows) {
    const row = await prisma.supplierEscalon.upsert({
      where: { productCode_units: { productCode: r.productCode, units: r.units } },
      update: {
        productName: r.productName,
        costMx: r.costMx ?? null,
        costUs: r.costUs ?? null,
        costCl: r.costCl ?? null,
      },
      create: {
        productCode: r.productCode,
        productName: r.productName,
        units: r.units,
        costMx: r.costMx ?? null,
        costUs: r.costUs ?? null,
        costCl: r.costCl ?? null,
      },
    });
    results.push(row);
  }
  return NextResponse.json({ saved: results.length, rows: results });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.supplierEscalon.delete({ where: { id } });
  return NextResponse.json({ deleted: id });
}
