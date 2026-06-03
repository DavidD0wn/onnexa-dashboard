import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const countries = await prisma.country.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ countries });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const { id, exchangeRateToUsd, gatewayFeePercent, gatewayFixedFee, defaultShippingCost, targetCpa, targetMargin } = body;

  const updated = await prisma.country.update({
    where: { id },
    data: {
      exchangeRateToUsd: parseFloat(exchangeRateToUsd) || 1,
      gatewayFeePercent: parseFloat(gatewayFeePercent) || 3.5,
      gatewayFixedFee: parseFloat(gatewayFixedFee) || 0,
      defaultShippingCost: parseFloat(defaultShippingCost) || 0,
      targetCpa: targetCpa ? parseFloat(targetCpa) : null,
      targetMargin: targetMargin ? parseFloat(targetMargin) : null,
    },
  });

  return NextResponse.json({ country: updated });
}
