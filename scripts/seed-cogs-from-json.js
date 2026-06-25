/**
 * Siembra ProductCogsByCountry desde data/product-costs.json
 * (que es el source of truth actualizado del proveedor).
 *
 * Uso:  node scripts/seed-cogs-from-json.js
 *
 * - Lee el JSON con costos por país y los inserta en la tabla.
 * - Reemplaza todo el contenido previo (deleteMany + createMany).
 * - Mapea cada offerName a productBaseName + unitsTotal + brand.
 * - El sync de Shopify ya lee de esta tabla — los cambios se reflejan en toda la app.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const p = new PrismaClient();

function guessBrand(productName) {
  const n = productName.toLowerCase();
  if (/holy basil|herbiotic|clearstem|cutting|deep collagen|debloted|flexi|inositol|mouthwash|smyle|astaxanthin|airi|curva|fertil|collar/i.test(n)) return "balancea";
  return "glowmmi";
}

function storeIdFor(brand, country) {
  return `store_${brand}_${country.toLowerCase()}`;
}

function extractUnits(offerName) {
  const xN = offerName.match(/\bx(\d+)\b/i);
  if (xN) return parseInt(xN[1]);
  const bundle = offerName.match(/(\d+)\s*\+\s*(\d+)/);
  if (bundle) return parseInt(bundle[1]) + parseInt(bundle[2]);
  return 1;
}

function extractBaseName(offerName) {
  return offerName
    .replace(/\s+x\d+\b.*$/i, "")
    .replace(/\s+\d+\s*\+\s*\d+.*$/i, "")
    .replace(/\s+\d+\s*\+\s*\d+%?off.*$/i, "")
    .trim();
}

(async () => {
  const jsonPath = path.join(__dirname, "..", "data", "product-costs.json");
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  console.log("Leyendo:", jsonPath, "(versión", data._version + ")");

  const rows = [];
  for (const country of ["mx", "us", "cl"]) {
    const block = data[country];
    if (!block) continue;
    for (const [offerName, costPerUnit] of Object.entries(block)) {
      if (offerName.startsWith("_")) continue;
      if (typeof costPerUnit !== "number" || costPerUnit <= 0) continue;
      const units = extractUnits(offerName);
      const isUnitPrice = /\bx\d+\b/i.test(offerName);
      const totalCost = isUnitPrice ? costPerUnit * units : costPerUnit;
      const productBaseName = extractBaseName(offerName);
      const brand = guessBrand(productBaseName);
      rows.push({
        countryCode: country.toUpperCase(),
        storeId: storeIdFor(brand, country),
        brand,
        productBaseName,
        offerName,
        unitsTotal: units,
        unitsPaid: units,
        unitsFree: 0,
        productCostTotalUsd: Math.round(totalCost * 100) / 100,
        productCostUnitUsd: Math.round((totalCost / units) * 10000) / 10000,
        shippingCostUsd: 0,
        shippingIncludedInCogs: true,
        gatewayFeePercent: 3.5,
        gatewayFeeUsd: 0,
        fulfillmentCostUsd: 0,
        otherCostsUsd: 0,
        totalCostBeforeAdsUsd: Math.round(totalCost * 100) / 100,
        isActive: true,
        dataQuality: "ok",
      });
    }
  }

  console.log("Filas a sembrar:", rows.length);

  console.log("Borrando tabla ProductCogsByCountry...");
  await p.productCogsByCountry.deleteMany({});

  console.log("Insertando...");
  for (let i = 0; i < rows.length; i += 100) {
    await p.productCogsByCountry.createMany({ data: rows.slice(i, i + 100), skipDuplicates: true });
  }

  const total = await p.productCogsByCountry.count();
  const byCountry = await p.productCogsByCountry.groupBy({ by: ["countryCode"], _count: true });
  console.log("\n✅ Sembrado completo. Total:", total);
  byCountry.forEach((r) => console.log("  " + r.countryCode + ": " + r._count + " filas"));
  await p.$disconnect();
})();
