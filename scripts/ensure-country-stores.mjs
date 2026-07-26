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
