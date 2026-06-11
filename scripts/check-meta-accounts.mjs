import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const accounts = await prisma.metaAdsAccount.findMany();
console.log("Cuentas Meta Ads en Neon:");
console.table(accounts.map(a => ({
  accountId: a.accountId,
  name: a.accountName,
  brand: a.brandId,
  currency: a.currency,
  active: a.isActive,
})));

// Test token
const TOKEN = process.env.META_ADS_USER_TOKEN;
console.log("\nToken configurado:", TOKEN ? TOKEN.slice(0, 20) + "..." : "❌ NO HAY TOKEN");

for (const acc of accounts) {
  const url = `https://graph.facebook.com/v19.0/${acc.accountId}?fields=name,currency,account_status&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`\n${acc.accountId}:`, data.error ? `❌ ${data.error.message}` : `✅ ${data.name} (${data.currency})`);
}

await prisma.$disconnect();
