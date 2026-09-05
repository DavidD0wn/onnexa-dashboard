import "dotenv/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: true, quiet: true });

const apiVersion = process.env.SHOPIFY_API_VERSION?.trim() || "2026-07";
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=")];
  }),
);
const from = args.get("--from") || "2026-03-01";
const to = args.get("--to") || new Date().toISOString().slice(0, 10);

const stores = [
  {
    key: "glowmmi",
    shop: process.env.SHOPIFY_GLOWMMI_SHOP || "glm-1694.myshopify.com",
    clientId: process.env.SHOPIFY_GLOWMMI_CLIENT_ID || "",
    clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET || "",
    staticToken: process.env.SHOPIFY_GLOWMMI_TOKEN || "",
    authType: process.env.SHOPIFY_GLOWMMI_AUTH_TYPE || "json",
  },
  {
    key: "balancea",
    shop: process.env.SHOPIFY_BALANCEA_SHOP || "mp0vab-bw.myshopify.com",
    clientId: process.env.SHOPIFY_BALANCEA_CLIENT_ID || "",
    clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET || "",
    staticToken: process.env.SHOPIFY_BALANCEA_TOKEN || "",
    authType: process.env.SHOPIFY_BALANCEA_AUTH_TYPE || "urlencoded",
  },
  {
    key: "pleena",
    shop: process.env.SHOPIFY_PLEENA_SHOP || "s31nvm-ng.myshopify.com",
    clientId: process.env.SHOPIFY_PLEENA_CLIENT_ID || "",
    clientSecret: process.env.SHOPIFY_PLEENA_CLIENT_SECRET || "",
    staticToken: process.env.SHOPIFY_PLEENA_TOKEN || "",
    authType: process.env.SHOPIFY_PLEENA_AUTH_TYPE || "urlencoded",
  },
];

function nextLink(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1];
  }
  return null;
}

async function getToken(store) {
  if (!store.clientId || !store.clientSecret) {
    if (store.staticToken) return store.staticToken;
    throw new Error("sin credenciales configuradas");
  }
  const payload = {
    grant_type: "client_credentials",
    client_id: store.clientId,
    client_secret: store.clientSecret,
  };
  const urlencoded = store.authType === "urlencoded";
  const response = await fetch(`https://${store.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": urlencoded
        ? "application/x-www-form-urlencoded"
        : "application/json",
      Accept: "application/json",
    },
    body: urlencoded
      ? new URLSearchParams(payload).toString()
      : JSON.stringify(payload),
  });
  if (!response.ok) {
    if (store.staticToken) return store.staticToken;
    throw new Error(`autenticación HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!data.access_token) throw new Error("Shopify no devolvió token");
  return data.access_token;
}

async function fetchOrders(store, token) {
  const start = `${from}T00:00:00-05:00`;
  const end = `${to}T23:59:59-05:00`;
  let url =
    `https://${store.shop}/admin/api/${apiVersion}/orders.json` +
    `?status=any&created_at_min=${encodeURIComponent(start)}` +
    `&created_at_max=${encodeURIComponent(end)}&limit=250` +
    `&fields=id,created_at,financial_status,cancelled_at,test,total_price,current_total_price`;
  const orders = [];
  while (url) {
    const response = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`órdenes HTTP ${response.status}`);
    const data = await response.json();
    orders.push(...(data.orders || []));
    url = nextLink(response.headers.get("link"));
  }
  return [...new Map(orders.map((order) => [String(order.id), order])).values()];
}

function summarize(orders) {
  const byStatus = {};
  const byDay = {};
  for (const order of orders) {
    const key = order.financial_status || "sin_estado";
    byStatus[key] = (byStatus[key] || 0) + 1;
    if (!order.test && !order.cancelled_at && key !== "voided") {
      const day = String(order.created_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }
  }
  const active = orders.filter((order) => !order.cancelled_at && !order.test);
  return {
    totalAdmin: orders.length,
    activeNonTest: active.length,
    cancelled: orders.filter((order) => Boolean(order.cancelled_at)).length,
    test: orders.filter((order) => Boolean(order.test)).length,
    byFinancialStatus: byStatus,
    byDay,
    totalPrice: Number(
      orders.reduce((sum, order) => sum + Number(order.total_price || 0), 0).toFixed(2),
    ),
    activeCurrentTotalPrice: Number(
      active.reduce((sum, order) => sum + Number(order.current_total_price || 0), 0).toFixed(2),
    ),
  };
}

const report = { from, to, stores: {} };
for (const store of stores) {
  try {
    const token = await getToken(store);
    report.stores[store.key] = summarize(await fetchOrders(store, token));
  } catch (error) {
    report.stores[store.key] = {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
