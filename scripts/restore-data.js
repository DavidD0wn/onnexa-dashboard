// Restaura AdSpend + DailyMetric desde un respaldo JSON.
// Uso:  node scripts/restore-data.js            (usa el respaldo más reciente)
//       node scripts/restore-data.js <archivo>  (usa un respaldo específico)
// Reemplaza por completo el contenido actual de ambas tablas con el del respaldo.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const p = new PrismaClient();
const DATE_FIELDS = ["date", "createdAt", "updatedAt", "tokenExpiry", "sentAt", "lastSyncAt"];

function reviveDates(row) {
  const out = { ...row };
  for (const k of DATE_FIELDS) if (out[k]) out[k] = new Date(out[k]);
  return out;
}

(async () => {
  const dir = path.join(__dirname, "..", "data", "backups");
  let file = process.argv[2];
  if (!file) {
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith("backup-")).sort();
    if (!backups.length) { console.error("❌ No hay respaldos en", dir); process.exit(1); }
    file = path.join(dir, backups[backups.length - 1]);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log("Restaurando desde:", file);
  console.log("  Respaldo del:", data.createdAt);
  console.log("  AdSpend:", data.adSpend.length, "| DailyMetric:", data.dailyMetric.length);

  // Reemplazo completo y atómico
  await p.$transaction([
    p.adSpend.deleteMany({}),
    p.dailyMetric.deleteMany({}),
    p.adSpend.createMany({ data: data.adSpend.map(reviveDates) }),
    p.dailyMetric.createMany({ data: data.dailyMetric.map(reviveDates) }),
  ]);

  console.log("✅ Restauración completa.");
  await p.$disconnect();
})();
