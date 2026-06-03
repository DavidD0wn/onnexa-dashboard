import { PrismaClient } from "@prisma/client";
import { subDays, startOfDay } from "date-fns";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  await prisma.task.deleteMany();
  await prisma.dailyMetric.deleteMany();
  await prisma.adSpend.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.supplierCostTier.deleteMany();
  await prisma.product.deleteMany();
  await prisma.store.deleteMany();
  await prisma.country.deleteMany();
  await prisma.brand.deleteMany();

  const glowmmi = await prisma.brand.create({ data: { id: "brand_glowmmi", name: "Glowmmi", status: "active" } });
  const balancea = await prisma.brand.create({ data: { id: "brand_balancea", name: "Balancea", status: "active" } });

  const usa = await prisma.country.create({ data: { id: "country_us", name: "Estados Unidos", code: "US", currency: "USD", exchangeRateToUsd: 1.0, gatewayFeePercent: 2.9, gatewayFixedFee: 0.3, defaultShippingCost: 6.5, targetCpa: 15, targetMargin: 30 } });
  const mexico = await prisma.country.create({ data: { id: "country_mx", name: "México", code: "MX", currency: "MXN", exchangeRateToUsd: 17.2, gatewayFeePercent: 3.6, gatewayFixedFee: 3.0, defaultShippingCost: 90, targetCpa: 180, targetMargin: 28 } });
  const chile = await prisma.country.create({ data: { id: "country_cl", name: "Chile", code: "CL", currency: "CLP", exchangeRateToUsd: 920, gatewayFeePercent: 3.49, gatewayFixedFee: 0.0, defaultShippingCost: 4500, targetCpa: 8000, targetMargin: 25 } });

  await prisma.store.createMany({
    data: [
      { id: "store_glowmmi_us", brandId: glowmmi.id, countryId: usa.id, name: "Glowmmi USA", currency: "USD" },
      { id: "store_glowmmi_mx", brandId: glowmmi.id, countryId: mexico.id, name: "Glowmmi México", currency: "MXN" },
      { id: "store_glowmmi_cl", brandId: glowmmi.id, countryId: chile.id, name: "Glowmmi Chile", currency: "CLP" },
      { id: "store_balancea_us", brandId: balancea.id, countryId: usa.id, name: "Balancea USA", currency: "USD" },
      { id: "store_balancea_mx", brandId: balancea.id, countryId: mexico.id, name: "Balancea México", currency: "MXN" },
      { id: "store_balancea_cl", brandId: balancea.id, countryId: chile.id, name: "Balancea Chile", currency: "CLP" },
    ],
  });

  await prisma.product.createMany({
    data: [
      { id: "prod_toner", brandId: glowmmi.id, storeId: "store_glowmmi_us", countryId: usa.id, name: "Toner Pads Glowmmi", status: "winner", supplierName: "Proveedor A", supplierCostUsd: 6.2, localPrice: 34.99, shippingCost: 6.5, targetCpa: 12, targetMargin: 35 },
      { id: "prod_serum", brandId: glowmmi.id, storeId: "store_glowmmi_mx", countryId: mexico.id, name: "Sérum Vitamina C", status: "scaling", supplierName: "Proveedor A", supplierCostUsd: 5.8, localPrice: 599, shippingCost: 90, targetCpa: 160, targetMargin: 30 },
      { id: "prod_acne", brandId: balancea.id, storeId: "store_balancea_us", countryId: usa.id, name: "Acne Relief Suplemento", status: "active", supplierName: "Proveedor B", supplierCostUsd: 9.4, localPrice: 49.99, shippingCost: 6.0, targetCpa: 18, targetMargin: 28 },
      { id: "prod_colagen", brandId: balancea.id, storeId: "store_balancea_mx", countryId: mexico.id, name: "Colágeno + Vitaminas", status: "test", supplierName: "Proveedor B", supplierCostUsd: 7.1, localPrice: 449, shippingCost: 85, targetCpa: 140, targetMargin: 28 },
    ],
  });

  await prisma.supplierCostTier.createMany({
    data: [
      { productId: "prod_toner", supplierName: "Proveedor A", minQuantity: 1, maxQuantity: 50, unitCostUsd: 7.2, shippingCostUsd: 0.5, landedCostUsd: 7.7 },
      { productId: "prod_toner", supplierName: "Proveedor A", minQuantity: 51, maxQuantity: 100, unitCostUsd: 6.2, shippingCostUsd: 0.4, landedCostUsd: 6.6 },
      { productId: "prod_toner", supplierName: "Proveedor A", minQuantity: 101, maxQuantity: 300, unitCostUsd: 5.4, shippingCostUsd: 0.3, landedCostUsd: 5.7 },
      { productId: "prod_toner", supplierName: "Proveedor A", minQuantity: 301, unitCostUsd: 4.8, shippingCostUsd: 0.25, landedCostUsd: 5.05 },
    ],
  });

  const metricsData: any[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = startOfDay(subDays(new Date(), i));
    const f = 0.85 + Math.random() * 0.3;

    const gUo = Math.round(12 * f), gUr = gUo * 34.99, gUa = gUo * (10 + Math.random() * 5);
    const gUc = gUo * 6.2, gUs = gUo * 6.5, gUf = gUr * 0.029 + gUo * 0.3;
    const gUp = gUr * 0.92 - gUc - gUs - gUa - gUf;
    metricsData.push({ date, brandId: glowmmi.id, countryId: usa.id, storeId: "store_glowmmi_us", ordersCount: gUo, unitsSold: gUo, grossRevenue: gUr, netRevenue: gUr * 0.92, adSpend: gUa, cogs: gUc, shippingCost: gUs, fees: gUf, netProfit: gUp, netMargin: (gUp / gUr) * 100, aov: 34.99, cpa: gUa / gUo, roas: (gUr * 0.92) / gUa, mer: gUr / gUa });

    const gMo = Math.round(18 * f), gMr = gMo * 599, gMa = gMo * (140 + Math.random() * 40);
    const gMc = gMo * (6.2 * 17.2), gMs = gMo * 90, gMf = gMr * 0.036 + gMo * 3;
    const gMp = gMr * 0.93 - gMc - gMs - gMa - gMf;
    metricsData.push({ date, brandId: glowmmi.id, countryId: mexico.id, storeId: "store_glowmmi_mx", ordersCount: gMo, unitsSold: gMo, grossRevenue: gMr, netRevenue: gMr * 0.93, adSpend: gMa, cogs: gMc, shippingCost: gMs, fees: gMf, netProfit: gMp, netMargin: (gMp / gMr) * 100, aov: 599, cpa: gMa / gMo, roas: (gMr * 0.93) / gMa, mer: gMr / gMa });

    const bUo = Math.round(9 * f), bUr = bUo * 49.99, bUa = bUo * (15 + Math.random() * 6);
    const bUc = bUo * 9.4, bUs = bUo * 6.0, bUf = bUr * 0.029 + bUo * 0.3;
    const bUp = bUr * 0.92 - bUc - bUs - bUa - bUf;
    metricsData.push({ date, brandId: balancea.id, countryId: usa.id, storeId: "store_balancea_us", ordersCount: bUo, unitsSold: bUo, grossRevenue: bUr, netRevenue: bUr * 0.92, adSpend: bUa, cogs: bUc, shippingCost: bUs, fees: bUf, netProfit: bUp, netMargin: (bUp / bUr) * 100, aov: 49.99, cpa: bUa / bUo, roas: (bUr * 0.92) / bUa, mer: bUr / bUa });

    const bMo = Math.round(14 * f), bMr = bMo * 449, bMa = bMo * (120 + Math.random() * 30);
    const bMc = bMo * (7.1 * 17.2), bMs = bMo * 85, bMf = bMr * 0.036 + bMo * 3;
    const bMp = bMr * 0.93 - bMc - bMs - bMa - bMf;
    metricsData.push({ date, brandId: balancea.id, countryId: mexico.id, storeId: "store_balancea_mx", ordersCount: bMo, unitsSold: bMo, grossRevenue: bMr, netRevenue: bMr * 0.93, adSpend: bMa, cogs: bMc, shippingCost: bMs, fees: bMf, netProfit: bMp, netMargin: (bMp / bMr) * 100, aov: 449, cpa: bMa / bMo, roas: (bMr * 0.93) / bMa, mer: bMr / bMa });
  }

  for (const m of metricsData) await prisma.dailyMetric.create({ data: m });

  await prisma.task.createMany({
    data: [
      { title: "Revisar CPA alto Glowmmi México", status: "pending", priority: "high", brandId: glowmmi.id, countryId: mexico.id, category: "Pauta" },
      { title: "Actualizar precio Sérum Vitamina C", status: "in_progress", priority: "medium", brandId: glowmmi.id, category: "Pricing" },
      { title: "Pedir cotización nuevo proveedor Toner", status: "pending", priority: "medium", brandId: glowmmi.id, category: "Proveedor" },
      { title: "Crear 3 hooks nuevos para Meta", status: "pending", priority: "high", brandId: balancea.id, category: "Creativos" },
      { title: "Revisar landing Acne Relief USA", status: "review", priority: "high", brandId: balancea.id, countryId: usa.id, category: "Landing" },
      { title: "Generar reporte semanal Balancea", status: "done", priority: "low", brandId: balancea.id, category: "Reporte" },
    ],
  });

  console.log("✅ Seed completado: 2 marcas, 3 países, 6 tiendas, 4 productos, 120 métricas diarias, 6 tareas.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
