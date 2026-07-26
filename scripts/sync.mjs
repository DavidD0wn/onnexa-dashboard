import "dotenv/config";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.length ? rest.join("=") : true];
  }),
);

const apply = args.has("--apply");
const only = String(args.get("--only") || "all").toLowerCase();
const baseUrl = String(
  args.get("--base") || process.env.ONNEXA_BASE_URL || "http://localhost:3000",
).replace(/\/+$/, "");
const days = Math.max(1, Number(args.get("--days") || 3));

const isoDay = (date) => date.toISOString().slice(0, 10);
const dateTo = String(args.get("--to") || isoDay(new Date()));
const defaultFrom = new Date(dateTo + "T00:00:00Z");
defaultFrom.setUTCDate(defaultFrom.getUTCDate() - days + 1);
const dateFrom = String(args.get("--from") || isoDay(defaultFrom));

if (!["all", "shopify", "meta"].includes(only)) {
  throw new Error("--only debe ser all, shopify o meta");
}
if (!Number.isFinite(days) || days < 1) {
  throw new Error("--days debe ser un número positivo");
}

const headers = { "Content-Type": "application/json" };
if (process.env.SYNC_SECRET) {
  headers["x-sync-secret"] = process.env.SYNC_SECRET;
}

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const payload = await response.json().catch(() => ({
    error: `Respuesta no JSON (HTTP ${response.status})`,
  }));
  if (!response.ok) {
    throw new Error(`${path}: ${payload.error || payload.message || response.status}`);
  }
  return payload;
}

function line(label, value) {
  process.stdout.write(`${label}: ${value}\n`);
}

async function inspect() {
  try {
    const health = await request("/api/integrations/health");
    line("Conexiones", health.ok ? "OK" : "requieren atención");
  } catch (error) {
    line("Conexiones", error.message);
  }

  const reconciliation = await request(
    `/api/integrations/reconciliation?from=${dateFrom}&to=${dateTo}`,
  );
  const summary = reconciliation.summary;
  line("Rango", `${dateFrom} a ${dateTo}`);
  line("Diferencia Meta/Dashboard", Number(summary.adSpendDifference).toFixed(2));
  line("Diferencia utilidad", Number(summary.profitDifference).toFixed(2));
  line("Grupos con diferencias", summary.mismatchedGroups);
  return reconciliation;
}

line("Onnexa", apply ? "sincronización segura" : "verificación sin cambios");
await inspect();

if (!apply) {
  line("Resultado", "No se modificaron datos. Usa --apply para sincronizar.");
} else {
  if (only === "all" || only === "shopify") {
    for (const store of ["glowmmi", "balancea"]) {
      const result = await request("/api/shopify/sync", {
        method: "POST",
        body: JSON.stringify({ store, days, from: dateFrom, to: dateTo }),
      });
      line(`Shopify ${store}`, `${result.synced || 0} días sincronizados`);
    }
  }

  if (only === "all" || only === "meta") {
    const result = await request("/api/meta-ads/sync", {
      method: "POST",
      body: JSON.stringify({ dateFrom, dateTo }),
    });
    line("Meta Ads", `${result.recordsSaved || 0} registros sincronizados`);
    if (result.skippedAccounts?.length) {
      line("Cuentas conservadas por error", result.skippedAccounts.join(", "));
    }
  }

  const finalCheck = await inspect();
  if (!finalCheck.ok) {
    process.exitCode = 2;
    line("Resultado", "Terminó, pero la conciliación aún reporta diferencias.");
  } else {
    line("Resultado", "Sincronización y conciliación correctas.");
  }
}
