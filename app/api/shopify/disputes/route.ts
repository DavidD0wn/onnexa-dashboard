/**
 * POST /api/shopify/disputes
 *
 * Sincroniza los chargebacks (disputes) de Shopify Payments automáticamente
 * y los guarda en la tabla Chargeback de la DB.
 *
 * Solo disponible para tiendas con Shopify Payments (Glowmmi/USD).
 *
 * Body: { store?: "glowmmi"|"balancea" }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const STORES = {
  glowmmi: {
    shop: "glm-1694.myshopify.com",
    clientId: "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType: "json" as const,
    brandId: "brand_glowmmi",
    supportsPayments: true,
  },
  balancea: {
    shop: "mp0vab-bw.myshopify.com",
    clientId: "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType: "urlencoded" as const,
    brandId: "brand_balancea",
    supportsPayments: true,  // Balancea has Shopify Payments active
  },
};

// Always store chargeback amounts in USD for consistency.
// Shopify Payments disputes API returns amount in the order's presentment currency.
// Fetch the live rate so the conversion matches what the dashboard display uses.
const FALLBACK_MXN_RATE = 17.5;
async function fetchLiveMxnRate(): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return FALLBACK_MXN_RATE;
    const data = await res.json();
    const mxn = data?.rates?.MXN;
    return typeof mxn === "number" && mxn > 10 ? Math.round(mxn * 100) / 100 : FALLBACK_MXN_RATE;
  } catch { return FALLBACK_MXN_RATE; }
}

function toUsd(amount: number, currency: string, mxnRate: number): number {
  if (!currency || currency === "USD") return amount;
  if (currency === "MXN") return Math.round((amount / mxnRate) * 100) / 100;
  return amount; // unknown currency — store as-is
}

async function getToken(shop: string, clientId: string, clientSecret: string, authType: "json" | "urlencoded"): Promise<string> {
  const url = `https://${shop}/admin/oauth/access_token`;
  const isJson = authType === "json";
  const body = isJson
    ? JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
    : new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString();
  const contentType = isJson ? "application/json" : "application/x-www-form-urlencoded";
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body });
  if (!res.ok) throw new Error(`Auth error ${shop} (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error(`No access_token`);
  return data.access_token;
}

async function fetchDisputes(shop: string, token: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null =
    `https://${shop}/admin/api/2024-01/shopify_payments/disputes.json?limit=250`;

  while (url) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Disputes error (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data: any = await res.json();
    all.push(...(data.disputes ?? []));
    const next: RegExpMatchArray | null = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

// Map Shopify dispute status → our internal status
function mapStatus(shopifyStatus: string): string {
  const map: Record<string, string> = {
    won:            "won",
    lost:           "confirmed",
    needs_response: "disputed",
    under_review:   "disputed",
    charge_refunded: "confirmed",
    accepted:       "confirmed",
  };
  return map[shopifyStatus] ?? "disputed";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { store = "glowmmi" } = body as { store?: string };

  const cfg = STORES[store as keyof typeof STORES];
  if (!cfg) return NextResponse.json({ error: "Tienda no válida" }, { status: 400 });
  if (!cfg.supportsPayments) {
    return NextResponse.json({
      store: cfg.shop,
      skipped: true,
      message: "Shopify Payments no disponible para esta tienda.",
    });
  }

  // Fetch live rate once for the whole sync — amounts are always stored in USD
  const mxnRate = await fetchLiveMxnRate();

  try {
    const token = await getToken(cfg.shop, cfg.clientId, cfg.clientSecret, cfg.authType);
    const disputes = await fetchDisputes(cfg.shop, token);

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const dispute of disputes) {
      const shopifyDisputeId = `dispute_${dispute.id}`;
      const disputeDate  = new Date(dispute.initiated_at ?? dispute.evidence_due_by ?? new Date());
      // Convert to USD — Shopify returns amount in the order's presentment currency
      const rawAmount    = parseFloat(dispute.amount ?? "0");
      const currency     = (dispute.currency ?? "USD").toUpperCase();
      const amountUsd    = toUsd(rawAmount, currency, mxnRate);
      const reason       = dispute.reason ?? "unknown";
      const status       = mapStatus(dispute.status ?? "needs_response");
      const orderId      = dispute.order_id ? String(dispute.order_id) : null;

      try {
        const existing = await prisma.chargeback.findFirst({
          where: { orderId: shopifyDisputeId },
        });

        if (existing) {
          // Update status and refresh amount (in case rate changed significantly)
          if (existing.status !== status || Math.abs(existing.amount - amountUsd) > 0.5) {
            await prisma.chargeback.update({
              where: { id: existing.id },
              data:  { status, amount: amountUsd },
            });
            updated++;
          }
        } else {
          await prisma.chargeback.create({
            data: {
              date:    disputeDate,
              brandId: cfg.brandId,
              amount:  amountUsd,
              orderId:  shopifyDisputeId,
              reason,
              status,
              notes: `Shopify Payments dispute — Order ${orderId ?? "unknown"} — ${dispute.status} — ${rawAmount} ${currency}`,
            },
          });
          created++;
        }
      } catch (e: any) {
        errors.push(`dispute ${dispute.id}: ${e.message}`);
      }
    }

    return NextResponse.json({
      store: cfg.shop,
      disputesFound: disputes.length,
      created,
      updated,
      mxnRateUsed: mxnRate,
      errors: errors.slice(0, 5),
      summary: {
        needs_response: disputes.filter((d) => d.status === "needs_response").length,
        under_review:   disputes.filter((d) => d.status === "under_review").length,
        won:            disputes.filter((d) => d.status === "won").length,
        lost:           disputes.filter((d) => d.status === "lost").length,
      },
      disputes: disputes.slice(0, 5).map((d) => ({
        id:       d.id,
        orderId:  d.order_id,
        amount:   d.amount,
        currency: d.currency,
        reason:   d.reason,
        status:   d.status,
        dueBy:    d.evidence_due_by,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET() {
  const chargebacks = await prisma.chargeback.findMany({
    where:   { brandId: "brand_glowmmi" },
    orderBy: { date: "desc" },
    take:    20,
  });

  const totals = await prisma.chargeback.groupBy({
    by:    ["status"],
    _sum:  { amount: true },
    _count: { id: true },
  });

  return NextResponse.json({
    chargebacks: chargebacks.map((c) => ({
      date:    c.date,
      amount:  c.amount,
      reason:  c.reason,
      status:  c.status,
      orderId: c.orderId,
      notes:   c.notes,
    })),
    summary: totals.map((t) => ({
      status: t.status,
      count:  t._count.id,
      total:  t._sum.amount?.toFixed(2),
    })),
  });
}
