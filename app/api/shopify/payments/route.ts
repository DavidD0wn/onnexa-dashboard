/**
 * POST /api/shopify/payments
 *
 * Sincroniza fees REALES de Shopify Payments usando Balance Transactions.
 *
 * ✅ Cada transacción tiene su processed_at (fecha de la orden, NO fecha del payout)
 *    → fees asignados al día correcto, nunca en batches semanales
 *
 * Endpoint: GET /admin/api/2024-01/shopify_payments/balance/transactions.json
 *   type=charge  → fee de cada venta
 *   type=refund  → fee de cada devolución (reduce fees del día)
 *
 * Body: { store?: "glowmmi"|"balancea", days?: number }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const FALLBACK_MXN_RATE = 17.30;

// ─── Exchange rate helpers (MXN → USD) ───────────────────────────────────────
function fillGaps(rates: Record<string, number>, from: string, to: string): Record<string, number> {
  const filled: Record<string, number> = {};
  let last = FALLBACK_MXN_RATE;
  let cursor = new Date(from + "T12:00:00Z");
  const end   = new Date(to   + "T12:00:00Z");
  while (cursor <= end) {
    const d = cursor.toISOString().slice(0, 10);
    if (rates[d] !== undefined) last = rates[d];
    filled[d] = last;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return filled;
}
async function fetchHistoricalRates(from: string, to: string): Promise<Record<string, number>> {
  try {
    const url = `https://api.frankfurter.app/${from}..${to}?from=USD&to=MXN`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      const rates: Record<string, number> = {};
      for (const [date, day] of Object.entries(data?.rates ?? {} as Record<string, any>)) {
        const mxn = (day as any)?.MXN;
        if (typeof mxn === "number" && mxn > 10) rates[date] = Math.round(mxn * 100) / 100;
      }
      if (Object.keys(rates).length > 0) return fillGaps(rates, from, to);
    }
  } catch { /* fall through */ }
  return {}; // callers use FALLBACK_MXN_RATE
}

// ─── Store configs ────────────────────────────────────────────────────────────
const STORES = {
  glowmmi: {
    shop:           "glm-1694.myshopify.com",
    clientId:       "de9e81a11394aabe11272947a4da0da5",
    clientSecret:   "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",
    authType:       "json" as const,
    brandId:        "brand_glowmmi",
    // Shopify Payments balance transactions report fees in the store's PAYOUT currency (USD)
    // even when orders are placed in MXN — no conversion needed
    feesCurrency:   "USD" as const,
    splitByCountry: true,
  },
  balancea: {
    shop:           "mp0vab-bw.myshopify.com",
    clientId:       "b06d2c272b5428556744aa476b8467f1",
    clientSecret:   "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",
    authType:       "urlencoded" as const,
    brandId:        "brand_balancea",
    feesCurrency:   "USD" as const,   // Balancea Shopify Payments settles in USD
    splitByCountry: false,
  },
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function getToken(
  shop: string, clientId: string, clientSecret: string,
  authType: "json" | "urlencoded",
): Promise<string> {
  const url = `https://${shop}/admin/oauth/access_token`;
  const body = authType === "urlencoded"
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString()
    : JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });
  const ct = authType === "urlencoded" ? "application/x-www-form-urlencoded" : "application/json";
  const res  = await fetch(url, { method: "POST", headers: { "Content-Type": ct }, body });
  if (!res.ok) throw new Error(`Auth error ${shop} (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`No access_token: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

// ─── Fetch balance transactions (charges + refunds) ───────────────────────────
// ⚠️  Shopify cursor-based pagination (page_info) DROPS all query filters after
//     the first page. We must NOT use payout_transaction_type or processed_at
//     in the URL — instead we filter client-side after each page.
//
// Strategy:
//   1. Fetch all pages without filters (single loop, fastest path).
//   2. Client-side: keep only type=charge or type=refund.
//   3. Client-side: keep only processed_at within [dateFrom, dateTo].
//   4. Stop early once transactions fall before dateFrom (API returns newest-first).
async function fetchBalanceTxs(
  shop: string, token: string,
  dateFrom: string, dateTo: string,
): Promise<Array<{ date: string; fee: number; amount: number; type: string }>> {
  const all: Array<{ date: string; fee: number; amount: number; type: string }> = [];

  let url: string | null =
    `https://${shop}/admin/api/2024-01/shopify_payments/balance/transactions.json?limit=250`;

  while (url) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`[payments] Balance tx error (${res.status}): ${txt.slice(0, 200)}`);
      break;
    }
    const data: any = await res.json();
    const txs: any[] = data.transactions ?? data.balance_transactions ?? [];

    let pastRange = false;
    for (const tx of txs) {
      const date = (tx.processed_at as string).slice(0, 10);
      if (date < dateFrom) { pastRange = true; break; }   // oldest tx on this page is before range → stop
      if (date > dateTo)   continue;                       // future date (edge case) → skip
      if (tx.type !== "charge" && tx.type !== "refund") continue; // ignore payout/dispute/debit
      all.push({
        date,
        fee:    parseFloat(tx.fee    ?? "0"),
        amount: parseFloat(tx.amount ?? "0"),
        type:   tx.type,
      });
    }

    if (pastRange) break; // no need to fetch older pages
    const next = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

// ─── Helper: local date string ────────────────────────────────────────────────
function localStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { store = "glowmmi", days = 30 } = body as { store?: string; days?: number };

  const cfg = STORES[store as keyof typeof STORES];
  if (!cfg) return NextResponse.json({ error: "Tienda no válida" }, { status: 400 });

  try {
    const token    = await getToken(cfg.shop, cfg.clientId, cfg.clientSecret, cfg.authType);
    const today    = localStr(new Date());
    const fromD    = new Date(); fromD.setDate(fromD.getDate() - days);
    const dateFrom = localStr(fromD);

    // ── Fetch all charge + refund transactions ──
    const txs = await fetchBalanceTxs(cfg.shop, token, dateFrom, today);

    // ── Group fees by date (sum charges, subtract refunds) ──
    // fee on a "refund" tx is the refund processing fee (usually negative or zero)
    const feesByDate: Record<string, number> = {};
    for (const tx of txs) {
      feesByDate[tx.date] = (feesByDate[tx.date] ?? 0) + tx.fee;
    }

    // ── Load daily exchange rates for MXN→USD conversion if needed ──
    let ratesByDate: Record<string, number> = {};
    if (cfg.feesCurrency === "MXN") {
      ratesByDate = await fetchHistoricalRates(dateFrom, today);
    }
    const getRate = (d: string) => ratesByDate[d] ?? FALLBACK_MXN_RATE;

    // ── Update DailyMetric rows ──────────────────────────────────────────────
    let updated = 0;
    let skipped = 0;
    const preview: Array<{ date: string; totalFeeUsd: number; rowsUpdated: number }> = [];

    for (const [dateKey, rawFee] of Object.entries(feesByDate)) {
      if (rawFee <= 0) continue; // skip days with 0 or negative fees (net refunds)

      const rate      = cfg.feesCurrency === "MXN" ? getRate(dateKey) : 1;
      const totalFeeUsd = rawFee / rate;

      const dayStart = new Date(dateKey + "T00:00:00Z");
      const dayEnd   = new Date(dateKey + "T23:59:59.999Z");

      // Find all DailyMetric rows for this brand+date (may be multiple countries)
      const rows = await prisma.dailyMetric.findMany({
        where: { brandId: cfg.brandId, date: { gte: dayStart, lte: dayEnd } },
      });

      if (rows.length === 0) { skipped++; continue; }

      if (rows.length === 1) {
        // Single row — assign all fees directly
        await prisma.dailyMetric.update({
          where: { id: rows[0].id },
          data:  { fees: totalFeeUsd },
        });
        updated++;
      } else {
        // Multiple rows (e.g. Glowmmi US + MX) — distribute proportionally by gross revenue
        const totalGross = rows.reduce((s, r) => s + (r.grossRevenue ?? 0), 0);
        for (const row of rows) {
          const share = totalGross > 0 ? (row.grossRevenue ?? 0) / totalGross : 1 / rows.length;
          await prisma.dailyMetric.update({
            where: { id: row.id },
            data:  { fees: totalFeeUsd * share },
          });
        }
        updated += rows.length;
      }

      if (preview.length < 10) {
        preview.push({ date: dateKey, totalFeeUsd: Math.round(totalFeeUsd * 100) / 100, rowsUpdated: rows.length });
      }
    }

    return NextResponse.json({
      ok:              true,
      store:           cfg.shop,
      txsFound:        txs.length,
      datesWithFees:   Object.keys(feesByDate).length,
      rowsUpdated:     updated,
      datesSkipped:    skipped,
      dateFrom,
      dateTo:          today,
      preview,
    });
  } catch (err: any) {
    console.error("[payments]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── GET — last 7 days with real fees ────────────────────────────────────────
export async function GET() {
  const metrics = await prisma.dailyMetric.findMany({
    where:   { brandId: "brand_glowmmi", fees: { gt: 0 } },
    orderBy: { date: "desc" },
    take:    10,
    select:  { date: true, countryId: true, grossRevenue: true, fees: true },
  });
  return NextResponse.json({
    message: "Últimas métricas con fees de Shopify Balance Transactions",
    rows: metrics.map(m => ({
      date:       m.date.toISOString().slice(0, 10),
      country:    m.countryId,
      gross:      m.grossRevenue.toFixed(2),
      fees:       m.fees.toFixed(2),
      feesPct:    m.grossRevenue > 0 ? ((m.fees / m.grossRevenue) * 100).toFixed(2) + "%" : "—",
    })),
  });
}
