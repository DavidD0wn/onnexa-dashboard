/**
 * Corrige las cuentas de Meta Ads en Neon con los IDs reales del token.
 * Identificación por códigos de producto en las campañas:
 *   BANANA #9 → TP01/GF01/DP01/INS01/RE01 → Glowmmi
 *   BANANA #8 → HR01/CT01/FX01/INO01/DB01 → Balancea
 *   Banana #1 → HB01 Holy Basil → Balancea
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 1. Borrar la cuenta falsa que nunca existió
const deleted = await prisma.metaAdsAccount.deleteMany({
  where: { accountId: "act_586942987769865" },
});
console.log(`🗑️  Cuentas falsas eliminadas: ${deleted.count}`);

// 2. Upsert de las 3 cuentas reales
const accounts = [
  { id: "meta_glowmmi_b9",  accountId: "act_584670343484624",  accountName: "CONT. BANANA #9 — Glowmmi",  brandId: "brand_glowmmi",  currency: "USD", isActive: true },
  { id: "meta_balancea_b8", accountId: "act_5751316951640293", accountName: "CONT. BANANA #8 — Balancea", brandId: "brand_balancea", currency: "USD", isActive: true },
  { id: "meta_balancea_b1", accountId: "act_486942987769865",  accountName: "Banana #1 — Balancea",       brandId: "brand_balancea", currency: "COP", isActive: true },
];
for (const a of accounts) {
  await prisma.metaAdsAccount.upsert({ where: { accountId: a.accountId }, create: a, update: a });
  console.log(`✅ ${a.accountId} → ${a.accountName} (${a.currency})`);
}

const all = await prisma.metaAdsAccount.findMany();
console.log(`\nTotal cuentas activas en Neon: ${all.filter(a => a.isActive).length}`);
await prisma.$disconnect();
