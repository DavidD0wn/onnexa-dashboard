// Respaldo de datos críticos (AdSpend + DailyMetric) a un archivo JSON.
// Uso:  node scripts/backup-data.js
// Crea: data/backups/backup-YYYY-MM-DD-HH-MM-SS.json
// Estos datos (ad spend + ventas) son históricos y no deben perderse — este
// snapshot permite restaurarlos al instante con restore-data.js si un sync falla.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const p = new PrismaClient();

(async () => {
  const adSpend     = await p.adSpend.findMany();
  const dailyMetric = await p.dailyMetric.findMany();

  const dir = path.join(__dirname, "..", "data", "backups");
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file  = path.join(dir, `backup-${stamp}.json`);

  fs.writeFileSync(
    file,
    JSON.stringify({ createdAt: new Date().toISOString(), adSpend, dailyMetric }, null, 2)
  );

  // Mantener solo los últimos 10 respaldos (limpieza automática)
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith("backup-")).sort();
  while (backups.length > 10) {
    const old = backups.shift();
    fs.unlinkSync(path.join(dir, old));
  }

  console.log("✅ Respaldo guardado:", file);
  console.log("   AdSpend:", adSpend.length, "filas | DailyMetric:", dailyMetric.length, "filas");
  await p.$disconnect();
})();
