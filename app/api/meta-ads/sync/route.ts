import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const TOKEN  = process.env.META_ADS_USER_TOKEN ?? "";

// ─── Country inference from campaign name ─────────────────────────────────────
// Campaigns follow the pattern: "DD/MM/YY - PRODUCT_CODE - CBO [country?]"
// Country suffix examples: "CBO mx", "CBO usa", "CBO" (no suffix = default)
function inferCountryId(
  campaign: string | null,
  adset:    string | null,
  ad:       string | null,
  accountCurrency: string,
): string {
  const text = [campaign, adset, ad].filter(Boolean).join(" ");

  // Priority: explicit "CBO <country>" suffix (most specific signal)
  if (/CBO\s+(usa|us)\b/i.test(text))             return "country_us";
  if (/CBO\s+(chile|cl|ch)\b/i.test(text))         return "country_cl";
  if (/CBO\s+(mx|mexico|méxico|mex)\b/i.test(text)) return "country_mx";

  // General country keywords anywhere in the text
  if (/\b(usa|eeuu|united\s*states|estados\s*unidos)\b/i.test(text)) return "country_us";
  if (/\bchile\b/i.test(text))                    return "country_cl";
  if (/\b(mexico|méxico)\b/i.test(text))          return "country_mx";

  // Fall back to account currency
  return accountCurrency === "USD" ? "country_us" : "country_mx";
}

// ─── Product code extraction + ID lookup ─────────────────────────────────────
// Campaign pattern: "DATE - PRODUCT_CODE - CBO ..."
// Product code is always the second segment: letters + digits (e.g. TP01, INS01, GF01)
// Brand-specific product code map: some codes (like HB01) exist in multiple brands
// with different product IDs.  Key = "BRAND_ID:CODE" or "CODE" as fallback.
const PRODUCT_CODE_MAP: Record<string, string> = {
  // Glowmmi
  "brand_glowmmi:TP01":  "prod_glw_7966465949744",  // Jiyu Toner Pads K-Beauty
  "brand_glowmmi:GF01":  "prod_glw_7959152361520",  // GlowFill™
  "brand_glowmmi:INS01": "prod_glw_7909382848560",  // InstantLift™
  "brand_glowmmi:DP01":  "prod_glw_7931502067760",  // Deep Collagen
  "brand_glowmmi:RE01":  "prod_glw_7885424525360",  // Retinal Shot
  "brand_glowmmi:RV01":  "prod_glw_7901472784432",  // ReviveLift™
  "brand_glowmmi:HB01":  "prod_glw_7810722168880",   // Mascarilla coreana para puntos negros
  // Balancea
  "brand_balancea:HB01":  "bal_holy_basil",         // Holy Basil suplemento
  "brand_balancea:HR01":  "bal_herbiotic",           // HerBiotic™
  "brand_balancea:ST01":  "bal_clearstem",           // Clearstem™
  "brand_balancea:CT01":  "bal_cutting",             // Cutting Mix
  "brand_balancea:FX01":  "bal_curva",               // CURVA™
  "brand_balancea:INO01": "bal_fertil",              // FERTIL™
  "brand_balancea:DB01":  "bal_airi",                // AiRi
};

function extractProductId(campaign: string | null, brandId?: string): string | null {
  if (!campaign) return null;
  // Match the product code segment: letters (2-5) + digits (2-3)
  const m = campaign.match(/\b([A-Za-z]{2,5}\d{2,3})\b/);
  if (!m) return null;
  const code = m[1].toUpperCase();
  // Only match if we have a brand-specific key — never fall back across brands
  // (e.g. HB01 exists in both Glowmmi and Balancea with different products)
  if (brandId) {
    const brandKey = `${brandId}:${code}`;
    return PRODUCT_CODE_MAP[brandKey] ?? null;
  }
  return null;
}

const FIELDS = [
  "campaign_name", "adset_name", "ad_name",
  "spend", "impressions", "clicks", "ctr", "cpc", "cpm",
  "actions", "action_values", "cost_per_action_type",
].join(",");

// ─── Fetch real campaign statuses from Meta API ────────────────────────────────
async function fetchCampaignStatuses(accountId: string): Promise<Array<{
  id: string; name: string; status: string; effective_status: string;
}>> {
  const results: any[] = [];
  let url: string | null =
    `https://graph.facebook.com/v19.0/${accountId}/campaigns` +
    `?fields=id,name,status,effective_status&limit=200` +
    `&access_token=${TOKEN}`;
  while (url) {
    const res: Response = await fetch(url);
    const data = await res.json();
    if (data.error) {
      const code = data.error?.code ?? 0;
      const msg  = data.error?.message ?? "";
      if (code === 190 || msg.includes("access token") || msg.includes("token")) {
        console.warn("[Meta Ads] Token inválido al obtener estados de campañas:", msg.slice(0, 100));
      } else {
        console.warn("[Meta Ads] Campaign status error:", msg.slice(0, 100));
      }
      break;
    }
    results.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return results;
}

// ─── Upsert campaign status in DB using raw SQL (no prisma client regen needed) ─
async function upsertCampaignStatus(
  campaignId: string, campaignName: string,
  accountId: string, brandId: string,
  status: string, effectiveStatus: string,
) {
  await prisma.$executeRawUnsafe(`
    INSERT INTO MetaCampaignStatus (id, campaignId, campaignName, accountId, brandId, status, effectiveStatus, createdAt, updatedAt)
    VALUES (lower(hex(randomblob(9))), ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(campaignId) DO UPDATE SET
      status = excluded.status,
      effectiveStatus = excluded.effectiveStatus,
      campaignName = excluded.campaignName,
      accountId = excluded.accountId,
      brandId = excluded.brandId,
      updatedAt = datetime('now')
  `, campaignId, campaignName, accountId, brandId, status, effectiveStatus);
}

function getPurchases(actions: any[]): number {
  if (!actions) return 0;
  return actions
    .filter((a) => ["purchase","omni_purchase"].includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || "0"), 0);
}
function getConvValue(actionValues: any[]): number {
  if (!actionValues) return 0;
  return actionValues
    .filter((a) => ["purchase","omni_purchase"].includes(a.action_type))
    .reduce((s, a) => s + parseFloat(a.value || "0"), 0);
}
function getCPA(costPerAction: any[]): number | null {
  if (!costPerAction) return null;
  const pa = costPerAction.find((a) => ["purchase","omni_purchase"].includes(a.action_type));
  return pa ? parseFloat(pa.value || "0") : null;
}

async function fetchInsights(accountId: string, dateFrom: string, dateTo: string) {
  const rows: any[] = [];
  let url: string | null =
    `https://graph.facebook.com/v19.0/${accountId}/insights` +
    `?fields=${FIELDS}&level=ad&time_increment=1&limit=500` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))}` +
    `&access_token=${TOKEN}`;

  while (url) {
    const res: Response = await fetch(url);
    const data: any     = await res.json();
    if (data.error) {
      const code = data.error?.code ?? 0;
      const msg  = data.error?.message ?? "Meta API error";
      // (#2642) = invalid/expired cursor — happens on large paginated requests.
      // Don't throw: return whatever rows we already collected so the sync
      // saves partial data instead of failing completely.
      if (code === 2642 || msg.includes("cursors") || msg.includes("cursor")) {
        console.warn(`[Meta Ads] Cursor expired mid-pagination for ${accountId} — saving ${rows.length} rows collected so far`);
        break;
      }
      // Token expired or invalid → surface this so the user can renew it
      if (code === 190 || msg.includes("access token") || msg.includes("token")) {
        throw new Error(`Token expirado o inválido: ${msg}`);
      }
      // Other errors: log and break (don't lose existing rows)
      console.warn(`[Meta Ads] API error for ${accountId} (${code}): ${msg.slice(0, 150)}`);
      break;
    }
    rows.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return rows;
}

/* ── COP → USD conversion rate (Banana #1 account reports in Colombian Pesos) ── */
const COP_TO_USD = 4100;

export async function POST(req: NextRequest) {
  try {
    const body     = await req.json().catch(() => ({}));
    // Use local server date (not UTC) as default — server runs at UTC-5, matching Mexico/Colombia business hours
    const localStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const today    = new Date();
    const dateTo   = body.dateTo   ?? localStr(today);
    const from30d  = new Date(); from30d.setDate(from30d.getDate() - 30);
    const dateFrom = body.dateFrom ?? localStr(from30d);

    const accounts = await prisma.metaAdsAccount.findMany({ where: { isActive: true } });
    if (!accounts.length) return NextResponse.json({ error: "Sin cuentas" }, { status: 404 });

    /* ── Step 0: Fetch + store REAL campaign statuses from Meta API ────────── */
    for (const account of accounts) {
      try {
        const campStatuses = await fetchCampaignStatuses(account.accountId);
        for (const c of campStatuses) {
          await upsertCampaignStatus(c.id, c.name, account.accountId, account.brandId, c.status, c.effective_status);
        }
        console.log(`[Meta Ads] Campaign statuses synced for ${account.accountId}: ${campStatuses.length} campaigns`);
      } catch (e: any) {
        console.warn(`[Meta Ads] Could not fetch campaign statuses for ${account.accountId}:`, e.message);
      }
    }

    /* ── Step 1: Fetch rows from ALL accounts before touching the DB ──────────
       Critical: if we delete+insert inside the per-account loop, the second
       account's deleteMany wipes the first account's freshly-inserted rows.
       Solution: collect everything first, then do ONE delete per brand, then
       insert all rows. */
    type PendingRow = { account: typeof accounts[number]; row: any };
    const pendingByBrand: Record<string, PendingRow[]> = {};

    for (const account of accounts) {
      const rows = await fetchInsights(account.accountId, dateFrom, dateTo);
      if (!pendingByBrand[account.brandId]) pendingByBrand[account.brandId] = [];
      for (const row of rows) {
        pendingByBrand[account.brandId].push({ account, row });
      }
    }

    let totalSaved = 0;

    /* ── Step 2: One delete per brand, then insert all accounts' rows ───── */
    for (const [brandId, pending] of Object.entries(pendingByBrand)) {
      // Single deleteMany covers ALL accounts for this brand in the date range
      await prisma.adSpend.deleteMany({
        where: {
          brandId,
          platform:     "facebook",
          campaignName: { not: null },
          date: {
            gte: new Date(dateFrom),
            lte: new Date(dateTo + "T23:59:59Z"),
          },
        },
      });

      // Insert fresh rows — country and product inferred from campaign name
      for (const { account, row } of pending) {
        /* Currency conversion: Banana #1 (act_486942987769865) reports in COP.
           Divide monetary values by COP_TO_USD so everything is stored in USD. */
        const fx    = account.currency === "COP" ? 1 / COP_TO_USD : 1;

        const spend      = parseFloat(row.spend      || "0") * fx;
        const purchases  = getPurchases(row.actions ?? []);
        const convValue  = getConvValue(row.action_values ?? []) * fx;
        const cpaCOP     = getCPA(row.cost_per_action_type ?? []);
        const cpa        = cpaCOP !== null ? cpaCOP * fx : null;

        // Infer country from campaign/adset/ad names (e.g. "CBO mx", "CBO usa")
        const countryId  = inferCountryId(
          row.campaign_name ?? null,
          row.adset_name    ?? null,
          row.ad_name       ?? null,
          account.currency,
        );

        // Try to link to a specific product via campaign code (e.g. "TP01", "INS01")
        const productId  = extractProductId(row.campaign_name ?? null, account.brandId);

        await prisma.adSpend.create({
          data: {
            brandId:         account.brandId,
            countryId,
            productId:       productId ?? undefined,
            accountId:       account.accountId,
            date:            new Date(row.date_start),
            platform:        "facebook",
            campaignName:    row.campaign_name ?? null,
            adsetName:       row.adset_name    ?? null,
            adName:          row.ad_name       ?? null,
            spend,
            impressions:     parseInt(row.impressions || "0"),
            clicks:          parseInt(row.clicks      || "0"),
            purchases:       Math.round(purchases),
            conversionValue: convValue,
            ctr:             parseFloat(row.ctr || "0"),
            cpc:             parseFloat(row.cpc || "0") * fx,
            cpm:             parseFloat(row.cpm || "0") * fx,
            cpa,
            roas:            spend > 0 && convValue > 0 ? convValue / spend : null,
          },
        });
        totalSaved++;
      }
    }

    await prisma.metaAdsSyncLog.create({
      data: { status: "success", recordsSaved: totalSaved, dateFrom, dateTo },
    });

    /* ── Rollup: pasar AdSpend → DailyMetric.adSpend automáticamente ── */
    try {
      const rollupRes  = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/meta-ads/rollup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateFrom, to: dateTo }),
      });
      const rollupData = await rollupRes.json().catch(() => ({}));
      console.log("[Meta Ads] Rollup:", rollupData.message ?? rollupData);
    } catch (re) {
      console.warn("[Meta Ads] Rollup falló (no crítico):", (re as any).message);
    }

    return NextResponse.json({ ok: true, recordsSaved: totalSaved, dateFrom, dateTo });
  } catch (err: any) {
    console.error("[Meta Ads Sync]", err.message);
    await prisma.metaAdsSyncLog.create({
      data: { status: "error", errorMsg: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  const last     = await prisma.metaAdsSyncLog.findFirst({ orderBy: { createdAt: "desc" } });
  const accounts = await prisma.metaAdsAccount.findMany();
  return NextResponse.json({ lastSync: last, accounts });
}

// ─── PATCH — re-tag existing rows with correct country + productId ──────────
// Use this to fix historical data without re-syncing from Meta.
// Call: PATCH /api/meta-ads/sync
export async function PATCH() {
  try {
    const all = await prisma.adSpend.findMany({
      where: { platform: "facebook" },
      select: { id: true, campaignName: true, adsetName: true, adName: true, brandId: true },
    });

    // Need account currencies to determine default country per brand
    const accounts = await prisma.metaAdsAccount.findMany({ select: { brandId: true, currency: true } });
    const currencyByBrand: Record<string, string> = {};
    for (const a of accounts) currencyByBrand[a.brandId] = a.currency;

    let updated = 0;
    const preview: { campaign: string; oldCountry?: string; newCountry: string; productId: string | null }[] = [];

    for (const row of all) {
      const currency  = currencyByBrand[row.brandId] ?? "MXN";
      const countryId = inferCountryId(row.campaignName, row.adsetName, row.adName, currency);
      const productId = extractProductId(row.campaignName, row.brandId);

      await prisma.adSpend.update({
        where: { id: row.id },
        data:  { countryId, productId },   // null clears a stale productId; undefined would skip the update
      });
      updated++;
      if (preview.length < 30) {
        preview.push({ campaign: row.campaignName ?? "(sin nombre)", newCountry: countryId, productId });
      }
    }

    return NextResponse.json({ ok: true, updated, preview });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
