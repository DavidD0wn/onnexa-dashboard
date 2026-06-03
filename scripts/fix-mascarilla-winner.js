// scripts/fix-mascarilla-winner.js
// Sets "Mascarilla coreana para puntos negros" status to "winner"
// Safe to run multiple times.

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const id = "prod_glw_7810722168880";

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) {
    console.log("❌ Producto no encontrado:", id);
    return;
  }

  console.log(`📦 Producto: ${product.name}`);
  console.log(`   Estado actual: ${product.status}`);

  if (product.status === "winner") {
    console.log("✅ Ya está en estado 'winner'. Sin cambios.");
    return;
  }

  await prisma.product.update({
    where: { id },
    data:  { status: "winner" },
  });

  console.log("🏆 Estado actualizado a 'winner'.");
}

main()
  .catch(e => { console.error("❌", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
