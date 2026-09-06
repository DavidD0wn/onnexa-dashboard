import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const stores = [
  {
    id: "store_balancea_us",
    brandId: "brand_balancea",
    countryId: "country_us",
    name: "Balancea US",
    shopifyUrl: "mp0vab-bw.myshopify.com",
    currency: "USD",
    status: "active",
  },
  {
    id: "store_balancea_cl",
    brandId: "brand_balancea",
    countryId: "country_cl",
    name: "Balancea Chile",
    shopifyUrl: "mp0vab-bw.myshopify.com",
    currency: "CLP",
    status: "active",
  },
  {
    id: "store_glowmmi_es",
    brandId: "brand_glowmmi",
    countryId: "country_es",
    name: "Glowmmi España",
    shopifyUrl: "glm-1694.myshopify.com",
    currency: "EUR",
    status: "active",
  },
  {
    id: "store_balancea_es",
    brandId: "brand_balancea",
    countryId: "country_es",
    name: "Balancea España",
    shopifyUrl: "mp0vab-bw.myshopify.com",
    currency: "EUR",
    status: "active",
  },
  {
    id: "store_pleena_es",
    brandId: "brand_pleena",
    countryId: "country_es",
    name: "Pleena España",
    shopifyUrl: "s31nvm-ng.myshopify.com",
    currency: "EUR",
    status: "active",
  },
];

try {
  for (const store of stores) {
    await prisma.store.upsert({
      where: { id: store.id },
      create: store,
      update: store,
    });
  }
  console.log(`Country stores ready: ${stores.map((store) => store.id).join(", ")}`);
} finally {
  await prisma.$disconnect();
}
