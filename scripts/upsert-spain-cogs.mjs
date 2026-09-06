import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: ".env.local", override: true, quiet: true });

const prisma = new PrismaClient();

const products = [
  { brand: "glowmmi", productBaseName: "Jiyu Toner Pads", totals: [9.16, 14.70, 20.90, 27.87] },
  { brand: "balancea", productBaseName: "HerBiotic", totals: [8.66, 14.33, 20.03] },
  { brand: "balancea", productBaseName: "Mouthwash", totals: [10.00, 17.03, 20.67, 35.04] },
  { brand: "balancea", productBaseName: "GOMFIT", totals: [9.79, 16.91, 23.66, 30.41] },
];

const brands = [
  { id: "brand_glowmmi", name: "Glowmmi", shop: "glm-1694.myshopify.com" },
  { id: "brand_balancea", name: "Balancea", shop: "mp0vab-bw.myshopify.com" },
  { id: "brand_pleena", name: "Pleena", shop: "s31nvm-ng.myshopify.com" },
];

try {
  await prisma.country.upsert({
    where: { id: "country_es" },
    create: {
      id: "country_es",
      name: "España",
      code: "ES",
      currency: "EUR",
      exchangeRateToUsd: 0.8604,
      gatewayFeePercent: 2.9,
      gatewayFixedFee: 0.3,
      defaultShippingCost: 0,
      targetMargin: 30,
    },
    update: {
      name: "España",
      code: "ES",
      currency: "EUR",
      exchangeRateToUsd: 0.8604,
    },
  });

  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { id: brand.id },
      create: { id: brand.id, name: brand.name, status: "active" },
      update: { name: brand.name, status: "active" },
    });
    const key = brand.id.replace(/^brand_/, "");
    await prisma.store.upsert({
      where: { id: `store_${key}_es` },
      create: {
        id: `store_${key}_es`,
        brandId: brand.id,
        countryId: "country_es",
        name: `${brand.name} España`,
        shopifyUrl: brand.shop,
        currency: "EUR",
        status: "active",
      },
      update: {
        brandId: brand.id,
        countryId: "country_es",
        name: `${brand.name} España`,
        shopifyUrl: brand.shop,
        currency: "EUR",
        status: "active",
      },
    });
  }

  let created = 0;
  let updated = 0;
  let duplicatesDeactivated = 0;

  for (const product of products) {
    for (let index = 0; index < product.totals.length; index += 1) {
      const units = index + 1;
      const total = product.totals[index];
      const unit = Math.round((total / units) * 10_000) / 10_000;
      const matches = await prisma.productCogsByCountry.findMany({
        where: {
          countryCode: "ES",
          brand: product.brand,
          productBaseName: product.productBaseName,
          unitsTotal: units,
        },
        orderBy: { updatedAt: "desc" },
      });
      const data = {
        countryCode: "ES",
        storeId: `store_${product.brand}_es`,
        storeName: `${product.brand === "glowmmi" ? "Glowmmi" : "Balancea"} España`,
        brand: product.brand,
        productBaseName: product.productBaseName,
        offerName: `${product.productBaseName} x${units}`,
        unitsTotal: units,
        unitsPaid: units,
        unitsFree: 0,
        productCostTotalUsd: total,
        productCostUnitUsd: unit,
        shippingCostUsd: 0,
        shippingIncludedInCogs: true,
        gatewayFeeUsd: 0,
        gatewayFeePercent: 2.9,
        fulfillmentCostUsd: 0,
        otherCostsUsd: 0,
        totalCostBeforeAdsUsd: total,
        isActive: true,
        dataQuality: "ok",
        notes: product.productBaseName === "Mouthwash" && units === 4
          ? "COGS España 2026-09-06. La fuente rotula x3, pero la columna de unidades indica 4; normalizado a x4."
          : "COGS España proporcionado 2026-09-06.",
      };

      if (matches.length === 0) {
        await prisma.productCogsByCountry.create({ data });
        created += 1;
      } else {
        await prisma.productCogsByCountry.update({ where: { id: matches[0].id }, data });
        updated += 1;
        if (matches.length > 1) {
          const extras = matches.slice(1).map((row) => row.id);
          const result = await prisma.productCogsByCountry.updateMany({
            where: { id: { in: extras } },
            data: { isActive: false },
          });
          duplicatesDeactivated += result.count;
        }
      }
    }
  }

  const rows = await prisma.productCogsByCountry.findMany({
    where: { countryCode: "ES", isActive: true },
    select: {
      brand: true,
      productBaseName: true,
      offerName: true,
      unitsTotal: true,
      productCostTotalUsd: true,
      productCostUnitUsd: true,
    },
    orderBy: [{ brand: "asc" }, { productBaseName: "asc" }, { unitsTotal: "asc" }],
  });

  process.stdout.write(`${JSON.stringify({ created, updated, duplicatesDeactivated, rows }, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
