import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: true, quiet: true });
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=")];
  }),
);
const from = args.get("--from") || "2026-03-01";
const to = args.get("--to") || new Date().toISOString().slice(0, 10);
const base = (args.get("--url") || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.SYNC_SECRET?.trim();
const response = await fetch(
  `${base}/api/integrations/reconciliation?from=${from}&to=${to}`,
  {
    headers: secret ? { "x-sync-secret": secret } : {},
    signal: AbortSignal.timeout(180_000),
  },
);
const data = await response.json();
if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
process.stdout.write(`${JSON.stringify({
  ok: data.ok,
  range: data.range,
  summary: data.summary,
  mismatches: (data.mismatches || []).map((row) => ({
    date: row.date,
    brandId: row.brandId,
    countryId: row.countryId,
    sourceAdSpend: row.sourceAdSpend,
    dailyMetricAdSpend: row.dailyMetricAdSpend,
    adSpendDifference: row.adSpendDifference,
    storedNetProfit: row.storedNetProfit,
    expectedNetProfit: row.expectedNetProfit,
    profitDifference: row.profitDifference,
    rowCount: row.rowCount,
    rows: (row.rows || []).map((item) => ({
      id: item.id,
      storeId: item.storeId,
      ordersCount: item.ordersCount,
      unitsSold: item.unitsSold,
      grossRevenue: item.grossRevenue,
      netRevenue: item.netRevenue,
      cogs: item.cogs,
      adSpend: item.adSpend,
      adSpendFacebook: item.adSpendFacebook,
      netProfit: item.netProfit,
      notes: item.notes,
    })),
  })),
}, null, 2)}\n`);
