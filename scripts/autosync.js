/**
 * ONNEXA — Auto-sync de Shopify
 *
 * Sincroniza órdenes de Glowmmi y Balanceaa directamente con la base de datos.
 * Corre de forma independiente, sin necesitar el servidor de Next.js activo.
 *
 * Uso:
 *   node scripts/autosync.js           → sincroniza últimos 3 días
 *   node scripts/autosync.js 7         → sincroniza últimos 7 días
 *   node scripts/autosync.js 30        → sincroniza últimos 30 días
 */

const https = require("https");
const path = require("path");

const DAYS = parseInt(process.argv[2] || "3", 10);
const BASE_URL = "http://localhost:3000";

// ─── Tiendas ──────────────────────────────────────────────────────────────────
const STORES = [
  { key: "glowmmi",  name: "Glowmmi",   emoji: "🌸" },
  { key: "balancea", name: "Balanceaa",  emoji: "🌿" },
];

// ─── HTTP helper (nativo, sin dependencias) ───────────────────────────────────
function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = require("http").request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ error: "JSON parse error", raw: raw.slice(0, 200) }); }
      });
    });

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" });
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   ONNEXA Auto-sync — ${now.padEnd(20)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  console.log(`  Sincronizando últimos ${DAYS} días...\n`);

  let totalOrders = 0;
  let totalDays = 0;
  const errors = [];

  for (const store of STORES) {
    process.stdout.write(`  ${store.emoji} ${store.name.padEnd(12)} → `);
    try {
      const result = await httpPost(`${BASE_URL}/api/shopify/sync`, {
        store: store.key,
        days: DAYS,
      });

      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
        errors.push(`${store.name}: ${result.error}`);
      } else {
        console.log(`✅ ${result.ordersTotal} órdenes · ${result.daysSynced} días guardados`);
        totalOrders += result.ordersTotal ?? 0;
        totalDays += result.daysSynced ?? 0;
      }
    } catch (e) {
      console.log(`❌ ${e.message}`);
      errors.push(`${store.name}: ${e.message}`);
    }
  }

  console.log(`\n  ─────────────────────────────────────────`);
  console.log(`  Total: ${totalOrders} órdenes · ${totalDays} días sincronizados`);
  if (errors.length > 0) {
    console.log(`  ⚠️  Errores: ${errors.join(" | ")}`);
  } else {
    console.log(`  ✅ Sincronización completada sin errores`);
  }
  console.log(`  Dashboard: http://localhost:3000\n`);

  // Exit code para Task Scheduler (0 = éxito, 1 = hubo errores)
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n❌ Error crítico: ${e.message}`);
  process.exit(1);
});
