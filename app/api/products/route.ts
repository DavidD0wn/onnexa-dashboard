import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const brandId = searchParams.get("brand");
  const countryId = searchParams.get("country");

  const products = await prisma.product.findMany({
    where: {
      ...(brandId && { brandId }),
      ...(countryId && { countryId }),
    },
    include: {
      brand: true,
      country: true,
      store: true,
      costTiers: { orderBy: { minQuantity: "asc" } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ products });
}

export async function PATCH(req: Request) {
  const { id, ...data } = await req.json();
  const updated = await prisma.product.update({ where: { id }, data });
  return NextResponse.json(updated);
}
