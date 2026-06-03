import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const brandId   = searchParams.get("brandId")   ?? undefined;
  const dateFrom  = searchParams.get("dateFrom")  ?? undefined;
  const dateTo    = searchParams.get("dateTo")     ?? undefined;

  const where: any = { platform: "facebook" };
  if (brandId)  where.brandId  = brandId;
  if (dateFrom) where.date = { ...where.date, gte: new Date(dateFrom) };
  if (dateTo)   where.date = { ...where.date, lte: new Date(dateTo + "T23:59:59Z") };

  // Load account name map for display
  const accounts = await prisma.metaAdsAccount.findMany({
    select: { accountId: true, accountName: true, currency: true },
  });
  const accountMap: Record<string, { name: string; currency: string }> = {};
  for (const a of accounts) {
    accountMap[a.accountId] = { name: a.accountName ?? a.accountId, currency: a.currency };
  }

  const rows = await prisma.adSpend.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Load REAL campaign statuses from Meta API (synced during last sync)
  // Using raw SQL since MetaCampaignStatus was added without a full prisma generate
  const campaignStatusRows = await prisma.$queryRawUnsafe<
    Array<{ campaignName: string; effectiveStatus: string }>
  >(`SELECT campaignName, effectiveStatus FROM MetaCampaignStatus`).catch(() => [] as any[]);
  const campaignStatusMap: Record<string, string> = {};
  for (const r of campaignStatusRows) {
    campaignStatusMap[r.campaignName] = r.effectiveStatus;
  }
  const hasCampaignStatuses = Object.keys(campaignStatusMap).length > 0;

  // Fallback: "active" threshold if no real statuses yet (had spend in last 3 days)
  const today    = new Date();
  const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);

  // Aggregate totals
  const totals = rows.reduce(
    (acc, r) => ({
      spend:           acc.spend + r.spend,
      impressions:     acc.impressions + r.impressions,
      clicks:          acc.clicks + r.clicks,
      purchases:       acc.purchases + r.purchases,
      conversionValue: acc.conversionValue + r.conversionValue,
    }),
    { spend: 0, impressions: 0, clicks: 0, purchases: 0, conversionValue: 0 }
  );

  const roas = totals.spend > 0 ? totals.conversionValue / totals.spend : 0;
  const cpa  = totals.purchases > 0 ? totals.spend / totals.purchases : 0;
  const ctr  = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpc  = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  const cpm  = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;

  // Group by campaign for breakdown
  const byCampaign: Record<string, any> = {};
  for (const r of rows) {
    const key = r.campaignName ?? "Sin nombre";
    if (!byCampaign[key]) {
      byCampaign[key] = {
        campaignName:    key,
        brandId:         r.brandId,
        accountId:       r.accountId ?? "",
        accountName:     r.accountId ? (accountMap[r.accountId]?.name ?? r.accountId) : "—",
        spend: 0, impressions: 0, clicks: 0, purchases: 0, conversionValue: 0,
        lastDate: r.date,   // track most recent date with spend
      };
    }
    byCampaign[key].spend           += r.spend;
    byCampaign[key].impressions     += r.impressions;
    byCampaign[key].clicks          += r.clicks;
    byCampaign[key].purchases       += r.purchases;
    byCampaign[key].conversionValue += r.conversionValue;
    // Keep the latest date
    if (r.date > byCampaign[key].lastDate) byCampaign[key].lastDate = r.date;
  }

  const campaigns = Object.values(byCampaign).map((c: any) => {
    // Use REAL Meta status if available, otherwise fall back to date heuristic
    const metaStatus = campaignStatusMap[c.campaignName];
    const isActive = hasCampaignStatuses
      ? (metaStatus === "ACTIVE")
      : c.lastDate >= threeDaysAgo;
    return {
      ...c,
      roas:        c.spend > 0 ? c.conversionValue / c.spend : 0,
      cpa:         c.purchases > 0 ? c.spend / c.purchases : 0,
      ctr:         c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0,
      isActive,
      metaStatus:  metaStatus ?? null,   // expose for debugging
      lastDateStr: (c.lastDate as Date).toISOString().slice(0, 10),
    };
  }).sort((a, b) => b.spend - a.spend);

  // Daily spend for chart
  const byDay: Record<string, any> = {};
  for (const r of rows) {
    const day = r.date.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { date: day, spend: 0, purchases: 0, conversionValue: 0 };
    byDay[day].spend           += r.spend;
    byDay[day].purchases       += r.purchases;
    byDay[day].conversionValue += r.conversionValue;
  }
  const daily = Object.values(byDay).sort((a: any, b: any) => a.date.localeCompare(b.date));

  return NextResponse.json({
    totals: { ...totals, roas, cpa, ctr, cpc, cpm },
    campaigns,
    daily,
    rowCount: rows.length,
  });
}
