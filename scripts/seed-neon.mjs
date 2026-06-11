/**
 * Seed script — pobla Neon con las marcas, países, tiendas y cuentas de Meta Ads
 * Ejecutar: node scripts/seed-neon.mjs
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Sembrando base de datos en Neon...\n");

  // ── Marcas ──────────────────────────────────────────────────────────────────
  await prisma.brand.upsert({
    where: { id: "brand_glowmmi" },
    create: { id: "brand_glowmmi", name: "Glowmmi", status: "active" },
    update: { name: "Glowmmi", status: "active" },
  });
  await prisma.brand.upsert({
    where: { id: "brand_balancea" },
    create: { id: "brand_balancea", name: "Balancea", status: "active" },
    update: { name: "Balancea", status: "active" },
  });
  console.log("✅ Marcas: Glowmmi, Balancea");

  // ── Países ───────────────────────────────────────────────────────────────────
  const countries = [
    { id: "country_mx", name: "México",        code: "MX", currency: "MXN", exchangeRateToUsd: 17.3,  gatewayFeePercent: 3.6, gatewayFixedFee: 0.0,  defaultShippingCost: 3.5 },
    { id: "country_us", name: "Estados Unidos", code: "US", currency: "USD", exchangeRateToUsd: 1.0,  gatewayFeePercent: 2.9, gatewayFixedFee: 0.30, defaultShippingCost: 5.0 },
    { id: "country_cl", name: "Chile",          code: "CL", currency: "CLP", exchangeRateToUsd: 950.0, gatewayFeePercent: 3.5, gatewayFixedFee: 0.30, defaultShippingCost: 4.0 },
  ];
  for (const c of countries) {
    await prisma.country.upsert({ where: { id: c.id }, create: c, update: c });
  }
  console.log("✅ Países: México, USA, Chile");

  // ── Tiendas ──────────────────────────────────────────────────────────────────
  const stores = [
    { id: "store_glowmmi_us", brandId: "brand_glowmmi",  countryId: "country_us", name: "Glowmmi US",  shopifyUrl: "glm-1694.myshopify.com",  currency: "USD", status: "active" },
    { id: "store_glowmmi_mx", brandId: "brand_glowmmi",  countryId: "country_mx", name: "Glowmmi MX",  shopifyUrl: "glm-1694.myshopify.com",  currency: "MXN", status: "active" },
    { id: "store_glowmmi_cl", brandId: "brand_glowmmi",  countryId: "country_cl", name: "Glowmmi CL",  shopifyUrl: "glm-1694.myshopify.com",  currency: "CLP", status: "active" },
    { id: "store_balancea_mx", brandId: "brand_balancea", countryId: "country_mx", name: "Balancea MX", shopifyUrl: "mp0vab-bw.myshopify.com", currency: "MXN", status: "active" },
  ];
  for (const s of stores) {
    await prisma.store.upsert({ where: { id: s.id }, create: s, update: s });
  }
  console.log("✅ Tiendas: Glowmmi US/MX/CL, Balancea MX");

  // ── Cuentas de Meta Ads ──────────────────────────────────────────────────────
  const metaAccounts = [
    { id: "meta_glowmmi_main",   accountId: "act_586942987769865", accountName: "Glowmmi — Principal",  brandId: "brand_glowmmi",  currency: "MXN", isActive: true },
    { id: "meta_balancea_main",  accountId: "act_486942987769865", accountName: "Balancea — Principal", brandId: "brand_balancea", currency: "COP", isActive: true },
  ];
  for (const a of metaAccounts) {
    await prisma.metaAdsAccount.upsert({ where: { accountId: a.accountId }, create: a, update: a });
  }
  console.log("✅ Cuentas Meta Ads configuradas");

  console.log("\n🎉 ¡Seed completado! Ahora puedes sincronizar Shopify y Meta Ads desde el dashboard.");
}

main()
  .catch((e) => { console.error("❌ Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
