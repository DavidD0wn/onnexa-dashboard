/**
 * Seed ProductCogsByCountry from PDF data.
 * Run: npx ts-node --skip-project scripts/seed-cogs.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Datos base del PDF (páginas 4-6) ────────────────────────────────────────
// Format: [productBaseName, offerName, unitsTotal, productCostTotalUsd, brand, countryCode]
// When countryCode is "AUTO" it means not specified — we default to MX
const SEED_DATA: Array<[string, string, number, number, string, string]> = [
  // HOLY BASIL — first 5 rows = MX prices, next 3 = US prices (from PDF structure)
  ["Holy Basil",    "Holy Basil x1",        1, 9.30,  "balancea", "MX"],
  ["Holy Basil",    "Holy Basil 2+1 Free",  3, 23.20, "balancea", "MX"],
  ["Holy Basil",    "Holy Basil 3+2 Free",  5, 37.00, "balancea", "MX"],
  ["Holy Basil",    "Holy Basil x2",        2, 16.30, "balancea", "MX"],
  ["Holy Basil",    "Holy Basil x3",        3, 23.20, "balancea", "MX"],
  ["Holy Basil",    "Holy Basil x1",        1, 10.20, "balancea", "US"],
  ["Holy Basil",    "Holy Basil x2",        2, 20.00, "balancea", "US"],
  ["Holy Basil",    "Holy Basil x3",        3, 25.50, "balancea", "US"],

  // RETINAL SHOT — glowmmi
  ["Retinal Shot",  "Retinal Shot x1",          1, 10.34, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 2+35%off",    2, 18.00, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot x3",          3, 25.74, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 3+1 Free",    4, 32.00, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 1+1 gratis",  2, 18.00, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot x1",          1, 10.34, "glowmmi", "US"],
  ["Retinal Shot",  "Retinal Shot 2+1 free",    3, 25.74, "glowmmi", "US"],
  ["Retinal Shot",  "Retinal Shot 3+2 Free",    3, 25.74, "glowmmi", "US"],
  ["Retinal Shot",  "Retinal Shot x1",          1,  7.80, "glowmmi", "CL"],
  ["Retinal Shot",  "Retinal Shot 1+1 gratis",  2, 13.00, "glowmmi", "CL"],
  ["Retinal Shot",  "Retinal Shot 2+2 gratis",  4, 24.00, "glowmmi", "CL"],
  ["Retinal Shot",  "Retinal Shot x1",          1,  7.80, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 1+1 gratis",  2, 13.00, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 2+1 gratis",  4, 26.00, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 2+1 free",    3, 18.20, "glowmmi", "MX"],
  ["Retinal Shot",  "Retinal Shot 3+2 Free",    4, 26.00, "glowmmi", "MX"],

  // JIYU TONER PADS — glowmmi
  ["Jiyu Toner Pads", "Jiyu Toner Pads x1", 1, 14.19, "glowmmi", "MX"],
  ["Jiyu Toner Pads", "Jiyu Toner Pads x2", 2, 25.74, "glowmmi", "MX"],
  ["Jiyu Toner Pads", "Jiyu Toner Pads x3", 3, 37.29, "glowmmi", "MX"],

  // REVIVE EYE — glowmmi
  ["Revive Eye", "Revive Eye x1", 1,  8.03, "glowmmi", "MX"],
  ["Revive Eye", "Revive Eye x2", 2, 13.42, "glowmmi", "MX"],
  ["Revive Eye", "Revive Eye x3", 3, 18.81, "glowmmi", "MX"],
  ["Revive Eye", "Revive Eye x2", 3, 18.81, "glowmmi", "US"],
  ["Revive Eye", "Revive Eye x3", 4, 26.84, "glowmmi", "US"],

  // INSTANTLIFT — glowmmi
  ["InstantLift", "InstantLift x1",        1,  7.80, "glowmmi", "MX"],
  ["InstantLift", "InstantLift x2",        2, 12.20, "glowmmi", "MX"],
  ["InstantLift", "InstantLift x3",        3, 16.60, "glowmmi", "MX"],
  ["InstantLift", "InstantLift x1",        1,  7.80, "glowmmi", "US"],
  ["InstantLift", "InstantLift 2+1 Free",  3, 16.60, "glowmmi", "US"],
  ["InstantLift", "InstantLift 3+2 Free",  5, 26.00, "glowmmi", "US"],

  // TONER PADS — glowmmi
  ["Toner Pads", "Toner Pads x1", 1, 14.19, "glowmmi", "MX"],
  ["Toner Pads", "Toner Pads x2", 2, 25.74, "glowmmi", "MX"],
  ["Toner Pads", "Toner Pads x3", 3, 37.29, "glowmmi", "MX"],

  // HERBIOTIC — balancea
  ["HerBiotic", "HerBiotic x1", 1, 14.52, "balancea", "MX"],
  ["HerBiotic", "HerBiotic x2", 2, 26.40, "balancea", "MX"],
  ["HerBiotic", "HerBiotic x3", 3, 38.28, "balancea", "MX"],
  ["HerBiotic", "HerBiotic x1", 1,  9.67, "balancea", "US"],
  ["HerBiotic", "HerBiotic x2", 2, 17.11, "balancea", "US"],
  ["HerBiotic", "HerBiotic x3", 3, 24.55, "balancea", "US"],

  // CLEARSTEM — balancea
  ["Clearstem", "Clearstem x1", 1, 10.80, "balancea", "MX"],
  ["Clearstem", "Clearstem x2", 2, 18.92, "balancea", "MX"],
  ["Clearstem", "Clearstem x3", 3, 27.06, "balancea", "MX"],
  ["Clearstem", "Clearstem x4", 4, 35.02, "balancea", "MX"],
  ["Clearstem", "Clearstem x5", 5, 43.34, "balancea", "MX"],

  // CUTTINGMIX — balancea
  ["CuttingMix", "CuttingMix x1", 1, 16.42, "balancea", "MX"],
  ["CuttingMix", "CuttingMix x2", 2, 30.41, "balancea", "MX"],
  ["CuttingMix", "CuttingMix x3", 3, 43.30, "balancea", "MX"],
  ["CuttingMix", "CuttingMix x1", 1, 13.02, "balancea", "US"],
  ["CuttingMix", "CuttingMix x2", 2, 23.80, "balancea", "US"],
  ["CuttingMix", "CuttingMix x3", 3, 34.58, "balancea", "US"],

  // COLLARES — joyeria (sin tienda asignada)
  ["Collar abrazo mama",  "Collar abrazo mama x1", 1,  6.31, "glowmmi", "MX"],
  ["Collar abrazo mama",  "Collar abrazo mama x2", 2,  8.47, "glowmmi", "MX"],
  ["Collar abrazo mama",  "Collar abrazo mama x3", 3,  9.85, "glowmmi", "MX"],
  ["Collar libro mama",   "Collar libro mama x1",  1,  8.72, "glowmmi", "MX"],
  ["Collar libro mama",   "Collar libro mama x2",  2, 13.31, "glowmmi", "MX"],
  ["Collar libro mama",   "Collar libro mama x3",  3, 17.09, "glowmmi", "MX"],
  ["Collar corazon mama", "Collar corazon mama x1",1,  7.52, "glowmmi", "MX"],
  ["Collar corazon mama", "Collar corazon mama x2",2, 10.71, "glowmmi", "MX"],
  ["Collar corazon mama", "Collar corazon mama x3",3, 13.05, "glowmmi", "MX"],

  // DEEP COLLAGEN — glowmmi
  ["Deep Collagen", "Deep Collagen x1", 1,  7.80, "glowmmi", "MX"],
  ["Deep Collagen", "Deep Collagen x2", 2, 11.39, "glowmmi", "MX"],
  ["Deep Collagen", "Deep Collagen x3", 3, 16.61, "glowmmi", "MX"],

  // GLOWFILL — glowmmi
  ["Glowfill", "Glowfill x1", 1, 10.68, "glowmmi", "MX"],
  ["Glowfill", "Glowfill x2", 2, 13.95, "glowmmi", "MX"],
  ["Glowfill", "Glowfill x3", 3, 16.82, "glowmmi", "MX"],
  ["Glowfill", "Glowfill x4", 4, 23.00, "glowmmi", "MX"],

  // DEBLOTED — balancea
  ["Debloted", "Debloted x1", 1,  8.80, "balancea", "MX"],
  ["Debloted", "Debloted x2", 2, 15.06, "balancea", "MX"],
  ["Debloted", "Debloted x3", 3, 20.85, "balancea", "MX"],

  // FLEXI — balancea
  ["Flexi", "Flexi x1", 1, 12.95, "balancea", "MX"],
  ["Flexi", "Flexi x2", 2, 24.83, "balancea", "MX"],
  ["Flexi", "Flexi x3", 3, 34.67, "balancea", "MX"],

  // INOSITOL — balancea
  ["Inositol", "Inositol x1", 1,  9.49, "balancea", "MX"],
  ["Inositol", "Inositol x2", 2, 16.95, "balancea", "MX"],
  ["Inositol", "Inositol x3", 3, 22.39, "balancea", "MX"],

  // MOUTHWASH — balancea
  ["Mouthwash", "Mouthwash x1", 1, 12.34, "balancea", "MX"],
  ["Mouthwash", "Mouthwash x2", 2, 23.13, "balancea", "MX"],
  ["Mouthwash", "Mouthwash x3", 3, 31.79, "balancea", "MX"],

  // ASTAXANTHIN — balancea
  ["Astaxanthin", "Astaxanthin x1", 1, 13.65, "balancea", "MX"],
  ["Astaxanthin", "Astaxanthin x2", 2, 24.01, "balancea", "MX"],
  ["Astaxanthin", "Astaxanthin x3", 3, 34.24, "balancea", "MX"],
];

async function main() {
  console.log("🌱 Seeding ProductCogsByCountry...");

  // Clear existing seed data (keep manually added records)
  const existing = await prisma.productCogsByCountry.count();
  if (existing > 0) {
    console.log(`  ${existing} rows already exist — skipping seed (use --force to re-seed)`);
    if (!process.argv.includes("--force")) {
      await prisma.$disconnect();
      return;
    }
    await prisma.productCogsByCountry.deleteMany({});
    console.log("  Cleared existing rows.");
  }

  let count = 0;
  for (const [productBaseName, offerName, unitsTotal, productCostTotalUsd, brand, countryCode] of SEED_DATA) {
    const unitCost = productCostTotalUsd / unitsTotal;
    await prisma.productCogsByCountry.create({
      data: {
        countryCode,
        storeId:                brand === "glowmmi" ? "brand_glowmmi" : "brand_balancea",
        storeName:              brand === "glowmmi" ? "Glowmmi"       : "Balancea",
        brand,
        productBaseName,
        offerName,
        unitsTotal,
        unitsPaid:              unitsTotal,
        unitsFree:              0,
        productCostTotalUsd,
        productCostUnitUsd:     Math.round(unitCost * 10000) / 10000,
        shippingIncludedInCogs: true,
        totalCostBeforeAdsUsd:  productCostTotalUsd, // shipping included in COGS
        dataQuality:            productCostTotalUsd > 0 ? "ok" : "missing_cost",
      },
    });
    count++;
  }

  console.log(`✅ Seeded ${count} COGS rows.`);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
