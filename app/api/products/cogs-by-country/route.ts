import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ─── Types ────────────────────────────────────────────────────────────────────
type CogRow = {
  id?: string;
  countryCode: string;
  storeId?: string;
  storeName?: string;
  brand?: string;
  productBaseName: string;
  offerName: string;
  unitsTotal: number;
  unitsPaid?: number;
  unitsFree?: number;
  productCostTotalUsd: number;
  shippingCostUsd?: number;
  shippingIncludedInCogs?: boolean;
  gatewayFeePercent?: number;
  fulfillmentCostUsd?: number;
  otherCostsUsd?: number;
  isActive?: boolean;
  dataQuality?: string;
  notes?: string;
};

// ─── Auto-computed fields ─────────────────────────────────────────────────────
function compute(row: CogRow, gatewayFeeDefault = 3.5) {
  const units      = Math.max(1, row.unitsTotal ?? 1);
  const costTotal  = row.productCostTotalUsd ?? 0;
  const unitCost   = costTotal / units;
  const shipping   = row.shippingIncludedInCogs ? 0 : (row.shippingCostUsd ?? 0);
  const gtwPct     = row.gatewayFeePercent ?? gatewayFeeDefault;
  const gtwFee     = (gtwPct / 100) * costTotal; // approximate — no selling price yet
  const fulfillment = row.fulfillmentCostUsd ?? 0;
  const other      = row.otherCostsUsd ?? 0;
  const totalBeforeAds = costTotal + shipping + fulfillment + other; // fee excluded unless needed

  return {
    productCostUnitUsd:   Math.round(unitCost   * 10000) / 10000,
    gatewayFeeUsd:        Math.round(gtwFee     * 100)   / 100,
    totalCostBeforeAdsUsd: Math.round(totalBeforeAds * 100) / 100,
    dataQuality: costTotal <= 0 ? "missing_cost" : units <= 0 ? "review" : "ok",
  };
}

// ─── GET — list rows by country / brand / active ──────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const country  = searchParams.get("country")?.toUpperCase();
  const brand    = searchParams.get("brand");
  const active   = searchParams.get("active") !== "false"; // default: only active

  const where: Record<string, unknown> = {};
  if (country && country !== "ALL") where.countryCode = country;
  if (brand   && brand   !== "all") where.brand = brand;
  if (active) where.isActive = true;

  const rows = await prisma.productCogsByCountry.findMany({
    where,
    orderBy: [{ productBaseName: "asc" }, { countryCode: "asc" }, { unitsTotal: "asc" }],
  });

  return NextResponse.json(rows);
}

// ─── POST — create one or bulk (array) ───────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const inputs: CogRow[] = Array.isArray(body) ? body : [body];

  const created = [];
  for (const input of inputs) {
    const c = compute(input);
    const row = await prisma.productCogsByCountry.create({
      data: {
        countryCode:            (input.countryCode ?? "MX").toUpperCase(),
        storeId:                input.storeId     ?? "all",
        storeName:              input.storeName   ?? "",
        brand:                  input.brand       ?? "",
        productBaseName:        input.productBaseName.trim(),
        offerName:              input.offerName.trim(),
        unitsTotal:             Math.max(1, input.unitsTotal ?? 1),
        unitsPaid:              input.unitsPaid   ?? input.unitsTotal ?? 1,
        unitsFree:              input.unitsFree   ?? 0,
        productCostTotalUsd:    input.productCostTotalUsd ?? 0,
        productCostUnitUsd:     c.productCostUnitUsd,
        shippingCostUsd:        input.shippingCostUsd        ?? 0,
        shippingIncludedInCogs: input.shippingIncludedInCogs ?? true,
        gatewayFeeUsd:          c.gatewayFeeUsd,
        gatewayFeePercent:      input.gatewayFeePercent      ?? 3.5,
        fulfillmentCostUsd:     input.fulfillmentCostUsd     ?? 0,
        otherCostsUsd:          input.otherCostsUsd          ?? 0,
        totalCostBeforeAdsUsd:  c.totalCostBeforeAdsUsd,
        isActive:               input.isActive ?? true,
        dataQuality:            c.dataQuality,
        notes:                  input.notes ?? null,
      },
    });
    created.push(row);
  }

  return NextResponse.json(created.length === 1 ? created[0] : created, { status: 201 });
}

// ─── PATCH — update one row by id ────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await prisma.productCogsByCountry.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Merge fields and recompute derived
  const merged: CogRow = {
    countryCode:            fields.countryCode            ?? existing.countryCode,
    productBaseName:        fields.productBaseName        ?? existing.productBaseName,
    offerName:              fields.offerName              ?? existing.offerName,
    unitsTotal:             fields.unitsTotal             ?? existing.unitsTotal,
    productCostTotalUsd:    fields.productCostTotalUsd    ?? existing.productCostTotalUsd,
    shippingCostUsd:        fields.shippingCostUsd        ?? existing.shippingCostUsd,
    shippingIncludedInCogs: fields.shippingIncludedInCogs ?? existing.shippingIncludedInCogs,
    gatewayFeePercent:      fields.gatewayFeePercent      ?? existing.gatewayFeePercent,
    fulfillmentCostUsd:     fields.fulfillmentCostUsd     ?? existing.fulfillmentCostUsd,
    otherCostsUsd:          fields.otherCostsUsd          ?? existing.otherCostsUsd,
  };
  const c = compute(merged);

  const updated = await prisma.productCogsByCountry.update({
    where: { id },
    data: {
      ...fields,
      productCostUnitUsd:    c.productCostUnitUsd,
      gatewayFeeUsd:         c.gatewayFeeUsd,
      totalCostBeforeAdsUsd: c.totalCostBeforeAdsUsd,
      dataQuality:           c.dataQuality,
      updatedAt:             new Date(),
    },
  });

  return NextResponse.json(updated);
}

// ─── DELETE — deactivate (soft delete) ───────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updated = await prisma.productCogsByCountry.update({
    where: { id },
    data: { isActive: false, updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, id: updated.id });
}
