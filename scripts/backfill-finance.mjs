import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: true, quiet: true });

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=")];
  }),
);
const baseUrl = (args.get("--url") || "http://localhost:3000").replace(/\/$/, "");
const from = args.get("--from") || "2026-03-01";
const to = args.get("--to") || new Date().toISOString().slice(0, 10);
const chunkDays = Math.max(1, Number(args.get("--chunk-days") || 31));
const stores = (args.get("--stores") || "glowmmi,balancea,pleena")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function dateRanges(start, end, daysPerChunk) {
  const ranges = [];
  let cursor = new Date(`${start}T12:00:00Z`);
  const final = new Date(`${end}T12:00:00Z`);
  while (cursor <= final) {
    const chunkEnd = new Date(cursor.getTime() + (daysPerChunk - 1) * 86_400_000);
    const rangeEnd = chunkEnd < final ? chunkEnd : final;
    ranges.push([
      cursor.toISOString().slice(0, 10),
      rangeEnd.toISOString().slice(0, 10),
    ]);
    cursor = new Date(rangeEnd.getTime() + 86_400_000);
  }
  return ranges;
}

async function request(path, body, extraHeaders = {}) {
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: `respuesta no JSON (HTTP ${response.status})` };
    }
    if (response.ok && !payload?.error) return payload;
    lastError = payload?.error || `HTTP ${response.status}`;
    const retryable =
      response.status >= 500 ||
      /transaction|timeout|timed out|pool/i.test(lastError);
    if (!retryable || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw new Error(`${path}: ${lastError}`);
}

const totals = Object.fromEntries(stores.map((store) => [store, 0]));
for (const [rangeFrom, rangeTo] of dateRanges(from, to, chunkDays)) {
  process.stdout.write(`Rango ${rangeFrom} a ${rangeTo}\n`);
  for (const store of stores) {
    const result = await request("/api/shopify/sync", {
      store,
      from: rangeFrom,
      to: rangeTo,
      skipRollup: true,
    });
    if (result.errors?.length) {
      throw new Error(`Shopify ${store}: ${result.errors.join("; ")}`);
    }
    totals[store] += Number(result.ordersTotal || 0);
    process.stdout.write(`  Shopify ${store}: ${result.ordersTotal || 0} pedidos\n`);
  }

  const meta = await request("/api/meta-ads/sync", {
    dateFrom: rangeFrom,
    dateTo: rangeTo,
    skipRollup: true,
  });
  if (meta.ok === false || meta.skippedAccounts?.length) {
    throw new Error(
      `Meta ${rangeFrom}: ${meta.error || `cuentas omitidas ${meta.skippedAccounts.join(", ")}`}`,
    );
  }
  process.stdout.write(`  Meta: ${meta.recordsSaved || 0} filas\n`);

  const rollup = await request("/api/meta-ads/rollup", {
    from: rangeFrom,
    to: rangeTo,
  });
  process.stdout.write(`  Consolidado: ${rollup.updated ?? rollup.daysUpdated ?? "OK"}\n`);
}

const secret = process.env.SYNC_SECRET?.trim();
const authHeaders = secret ? { "x-sync-secret": secret } : {};
const reconciliation = await request(
  `/api/integrations/reconciliation?from=${from}&to=${to}`,
  undefined,
  authHeaders,
);
if (!reconciliation.ok) {
  throw new Error(
    `Conciliación pendiente: ${reconciliation.summary?.mismatchedGroups ?? "sin detalle"} grupos`,
  );
}

const drive = await request(
  "/api/finance-drive",
  { action: "export", from, to, advanceCheckpoint: true },
  authHeaders,
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  from,
  to,
  shopifyOrders: totals,
  reconciliation: reconciliation.summary,
  drive: {
    lastSuccessfulDate: drive.manifest?.lastSuccessfulDate,
    weeksSaved: Object.keys(drive.manifest?.weeks || {}).length,
  },
}, null, 2)}\n`);
