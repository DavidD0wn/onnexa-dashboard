import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchMetaPages, MetaGraphError } from "@/lib/integrations/meta";

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
  return fetchMetaPages(accountId + "/campaigns", {
    fields: "id,name,status,effective_status",
    limit: 200,
  });
}

// ─── Upsert campaign status in DB using raw SQL (no prisma client regen needed) ─
async function upsertCampaignStatus(
  campaignId: string, campaignName: string,
  accountId: string, brandId: string,
  status: string, effectiveStatus: string,
) {
  await prisma.metaCampaignStatus.upsert({
    where: { campaignId },
    create: { campaignId, campaignName, accountId, brandId, status, effectiveStatus },
    update: { campaignName, accountId, brandId, status, effectiveStatus },
  });
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

// Devuelve { rows, ok }. ok=false significa que la cuenta NO completó su
// sincronización (error/cursor/rate-limit) — el caller NO debe borrar los datos
// existentes de esa cuenta, para no perderlos. ok=true = paginación completa.
async function fetchInsights(accountId: string, dateFrom: string, dateTo: string): Promise<{ rows: any[]; ok: boolean }> {
  try {
    const rows = await fetchMetaPages<any>(accountId + "/insights", {
      fields: FIELDS,
      level: "ad",
      time_increment: 1,
      limit: 500,
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
    });
    return { rows, ok: true };
  } catch (error) {
    if (error instanceof MetaGraphError && error.code === 190) throw error;
    console.warn(
      `[Meta Ads] No se completó ${accountId}; se conservan sus datos:`,
      error instanceof Error ? error.message : String(error),
    );
    return { rows: [], ok: false };
  }
}

/* ── COP → USD conversion rate (Banana #1 account reports in Colombian Pesos) ──
   Actualizado jun 2026: 4100 estaba desactualizado y subvaluaba el gasto COP ~14%.
   Tasa real de mercado ~3550 (er-api) — coincide con el gasto real verificado por
   Fernanda en Meta. Si COP se mueve mucho, ajustar aquí. */
const configuredCopRate = Number(process.env.COP_TO_USD_RATE);
const COP_TO_USD =
  Number.isFinite(configuredCopRate) && configuredCopRate > 0
    ? configuredCopRate
    : 3550;

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

    /* ── Step 1: Fetch rows POR CUENTA antes de tocar la DB ──────────────────
       Cada cuenta se sincroniza independientemente. Si una cuenta falla
       (ok=false), NO se borran sus datos existentes — así nunca se pierde el
       histórico de una cuenta que tuvo un error transitorio (la causa de que
       "se vaya todo" el ad spend). */
    const perAccount: { account: typeof accounts[number]; rows: any[]; ok: boolean }[] = [];
    for (const account of accounts) {
      const { rows, ok } = await fetchInsights(account.accountId, dateFrom, dateTo);
      perAccount.push({ account, rows, ok });
      if (!ok) {
        console.warn(`[Meta Ads] Cuenta ${account.accountId} (${account.brandId}) falló o trajo datos parciales — se CONSERVAN sus datos existentes (no se borran)`);
      }
    }

    let totalSaved = 0;
    const skippedAccounts: string[] = [];

    /* ── Precargar IDs de producto válidos UNA sola vez ──────────────────────
       Antes se hacía un prisma.product.findUnique POR CADA fila (miles de
       round-trips a Neon). Con la tabla en memoria validamos sin tocar la BD.
       Si la tabla Product no existe en cloud, queda vacío → productId = null. */
    let validProductIds = new Set<string>();
    try {
      const prods = await prisma.product.findMany({ select: { id: true } });
      validProductIds = new Set(prods.map((p) => p.id));
    } catch { /* tabla Product ausente/sin migrar — se omite la atribución */ }

    /* ── Step 2: Borrar + reinsertar SOLO las cuentas que sincronizaron OK ── */
    for (const { account, rows, ok } of perAccount) {
      // Cuenta que falló: conservar sus datos. No borrar, no reinsertar.
      if (!ok) { skippedAccounts.push(account.accountId); continue; }

      // Construir todas las filas en memoria y luego insertarlas en LOTE.
      // Antes se hacía un prisma.adSpend.create por fila (miles de round-trips
      // a Neon → ~18 min). createMany hace ~1 viaje por lote de 500.
      const toInsert = rows.map((row) => {
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

        // Atribución de producto: extrae el código del nombre de campaña
        // (p.ej. "10/04/26 - HB01 - Cbo - Usa") y valida contra el set precargado.
        // Si el producto no existe, queda null y el gasto se guarda igual SIN
        // vincular — así createMany nunca choca contra la FK del productId.
        const candidate  = extractProductId(row.campaign_name ?? null, account.brandId);
        const productId  = candidate && validProductIds.has(candidate) ? candidate : null;

        return {
          brandId:         account.brandId,
          countryId,
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
          productId,
        };
      });

      // Reemplazo atómico: si un lote falla, también se revierte la eliminación
      // y el histórico anterior de la cuenta queda intacto.
      const BATCH = 500;
      try {
        const savedForAccount = await prisma.$transaction(
          async (tx) => {
            await tx.adSpend.deleteMany({
              where: {
                accountId: account.accountId,
                platform: "facebook",
                date: {
                  gte: new Date(dateFrom + "T00:00:00Z"),
                  lte: new Date(dateTo + "T23:59:59Z"),
                },
              },
            });

            let saved = 0;
            for (let i = 0; i < toInsert.length; i += BATCH) {
              const result = await tx.adSpend.createMany({
                data: toInsert.slice(i, i + BATCH),
              });
              saved += result.count;
            }
            return saved;
          },
          { timeout: 120_000 },
        );
        totalSaved += savedForAccount;
      } catch (error) {
        skippedAccounts.push(account.accountId);
        console.warn(
          `[Meta Ads] Se revirtió la actualización de ${account.accountId}; los datos anteriores siguen intactos:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    await prisma.metaAdsSyncLog.create({
      data: {
        status: skippedAccounts.length ? "partial" : "success",
        recordsSaved: totalSaved,
        dateFrom, dateTo,
        ...(skippedAccounts.length ? { errorMsg: `Cuentas conservadas (no sincronizadas): ${skippedAccounts.join(", ")}` } : {}),
      },
    });

    /* ── Rollup: pasar AdSpend → DailyMetric.adSpend automáticamente ──
       Usar el origin de la propia request (no un puerto fijo): si otra app
       ocupó el 3000 y el dashboard arrancó en 3001, el rollup debe llamarse a
       SÍ MISMO — no a la otra app. Evita el "choque" entre proyectos. */
    try {
      const baseUrl    = new URL(req.url).origin;
      const rollupRes  = await fetch(`${baseUrl}/api/meta-ads/rollup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: dateFrom, to: dateTo }),
      });
      const rollupData = await rollupRes.json().catch(() => ({}));
      console.log("[Meta Ads] Rollup:", rollupData.message ?? rollupData);
    } catch (re) {
      console.warn("[Meta Ads] Rollup falló (no crítico):", (re as any).message);
    }

    return NextResponse.json({ ok: true, recordsSaved: totalSaved, dateFrom, dateTo, skippedAccounts });
  } catch (err: any) {
    console.error("[Meta Ads Sync]", err.message);
    try {
      await prisma.metaAdsSyncLog.create({
        data: { status: "error", errorMsg: err.message },
      });
    } catch (logError) {
      console.error(
        "[Meta Ads Sync Log]",
        logError instanceof Error ? logError.message : String(logError),
      );
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const [last, accounts] = await Promise.all([
      prisma.metaAdsSyncLog.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.metaAdsAccount.findMany(),
    ]);
    return NextResponse.json({ lastSync: last, accounts });
  } catch (error) {
    console.error(
      "[Meta Ads Sync Status]",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: "No se pudo consultar el estado de sincronización." },
      { status: 503 },
    );
  }
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
