import "dotenv/config";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.split("=");
    return [key, value.length ? value.join("=") : true];
  }),
);

const base = String(args.get("--base") || "http://localhost:3000").replace(/\/+$/, "");
const to = String(args.get("--to") || new Date().toISOString().slice(0, 10));
const fromDefault = new Date(`${to}T00:00:00Z`);
fromDefault.setUTCDate(fromDefault.getUTCDate() - 6);
const from = String(args.get("--from") || fromDefault.toISOString().slice(0, 10));
const tolerance = 0.01;

async function json(path) {
  const response = await fetch(base + path, {
    headers: process.env.SYNC_SECRET
      ? { "x-sync-secret": process.env.SYNC_SECRET }
      : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: respuesta no JSON (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`${path}: ${payload.error || payload.message || response.status}`);
  }
  return payload;
}

const query = `from=${from}&to=${to}`;
const dashboard = await json(`/api/dashboard?${query}`);
const products = await json(`/api/products/analytics?${query}`);
const pnl = await json(`/api/p-and-l?${query}`);
const dailyProducts = await json(`/api/shopify/daily-products?${query}&store=all`);
const reconciliation = await json(`/api/integrations/reconciliation?${query}`);
const meta = await json(
  `/api/meta-ads/insights?dateFrom=${from}&dateTo=${to}`,
);

const dailyOrders = dailyProducts.days.reduce(
  (sum, day) => sum + day.totalOrders,
  0,
);
const dailyRevenue = dailyProducts.days.reduce(
  (sum, day) => sum + day.totalRevenueUsd,
  0,
);

const checks = [];
function equal(label, expected, actual) {
  const difference = Number(actual) - Number(expected);
  checks.push({
    label,
    expected: Number(expected),
    actual: Number(actual),
    difference,
    ok: Math.abs(difference) < tolerance,
  });
}

equal("Pedidos · Product Analytics", dashboard.totals.orders, products.totals.uniqueOrders);
equal("Pedidos · P&L", dashboard.totals.orders, pnl.total.data.orders);
equal("Pedidos · Ventas por producto", dashboard.totals.orders, dailyOrders);
equal("Unidades · Product Analytics", dashboard.totals.units, products.totals.units);
equal("Unidades · P&L", dashboard.totals.units, pnl.total.data.units);
equal("Ingreso neto · Product Analytics", dashboard.totals.net, products.totals.revenueUsd);
equal("Ingreso neto · P&L", dashboard.totals.net, pnl.total.data.netRevenue);
equal("Ingreso neto · Ventas por producto", dashboard.totals.net, dailyRevenue);
equal("COGS · Product Analytics", dashboard.totals.cogs, products.totals.cogsUsd);
equal("COGS · P&L", dashboard.totals.cogs, pnl.total.data.cogs);
equal("Ad spend · Product Analytics", dashboard.totals.adSpend, products.totals.adSpendUsd);
equal("Ad spend · P&L", dashboard.totals.adSpend, pnl.total.data.adSpend);
equal("Ad spend · Meta Ads", dashboard.totals.adSpend, meta.totals.spend);
equal("Ganancia · Product Analytics", dashboard.totals.profit, products.totals.netProfit);
equal("Ganancia · P&L", dashboard.totals.profit, pnl.total.data.netProfit);
equal(
  "Ganancia · conciliación",
  dashboard.totals.profit,
  reconciliation.summary.expectedNetProfit,
);

for (const dashboardBrand of dashboard.byBrand) {
  const rows = products.rows.filter(
    (row) => row.brandId === dashboardBrand.brandId,
  );
  equal(
    `${dashboardBrand.name} · ingreso`,
    dashboardBrand.net,
    rows.reduce((sum, row) => sum + row.revenueUsd, 0),
  );
  equal(
    `${dashboardBrand.name} · COGS`,
    dashboardBrand.cogs,
    rows.reduce((sum, row) => sum + row.cogsUsd, 0),
  );
  equal(
    `${dashboardBrand.name} · ad spend`,
    dashboardBrand.adSpend,
    rows.reduce((sum, row) => sum + row.adSpendUsd, 0),
  );
  equal(
    `${dashboardBrand.name} · ganancia`,
    dashboardBrand.profit,
    rows.reduce((sum, row) => sum + row.netProfit, 0),
  );
}

for (const dashboardCountry of dashboard.byCountry) {
  const rows = products.rows.filter(
    (row) => row.countryCode === dashboardCountry.code,
  );
  equal(
    `${dashboardCountry.code} · ingreso`,
    dashboardCountry.net,
    rows.reduce((sum, row) => sum + row.revenueUsd, 0),
  );
  equal(
    `${dashboardCountry.code} · COGS`,
    dashboardCountry.cogs,
    rows.reduce((sum, row) => sum + row.cogsUsd, 0),
  );
  equal(
    `${dashboardCountry.code} · ad spend`,
    dashboardCountry.adSpend,
    rows.reduce((sum, row) => sum + row.adSpendUsd, 0),
  );
  equal(
    `${dashboardCountry.code} · ganancia`,
    dashboardCountry.profit,
    rows.reduce((sum, row) => sum + row.netProfit, 0),
  );
}

const failed = checks.filter((check) => !check.ok);
console.log(`Auditoría financiera: ${from} a ${to}`);
console.log(`Comparaciones: ${checks.length}; discrepancias: ${failed.length}`);
for (const check of failed) {
  console.log(
    `FAIL ${check.label}: esperado=${check.expected.toFixed(2)} ` +
      `actual=${check.actual.toFixed(2)} diferencia=${check.difference.toFixed(2)}`,
  );
}
console.log(
  `Totales: pedidos=${dashboard.totals.orders}, unidades=${dashboard.totals.units}, ` +
    `neto=$${dashboard.totals.net.toFixed(2)}, COGS=$${dashboard.totals.cogs.toFixed(2)}, ` +
    `Meta=$${dashboard.totals.adSpend.toFixed(2)}, ganancia=$${dashboard.totals.profit.toFixed(2)}`,
);

if (!reconciliation.ok || !products.adSpendReconciliation.ok || failed.length) {
  process.exitCode = 2;
} else {
  console.log("Resultado: TODO COINCIDE dentro de $0.01.");
}
