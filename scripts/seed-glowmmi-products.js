// scripts/seed-glowmmi-products.js
// Upserts all Glowmmi MX products from Shopify into the local SQLite DB.
// Safe to run multiple times — uses stable IDs, does NOT delete existing data.
//
// Run: node scripts/seed-glowmmi-products.js

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const STORE_ID   = "store_glowmmi_mx";
const BRAND_ID   = "brand_glowmmi";
const COUNTRY_ID = "country_mx";

// All 30 products fetched from Glowmmi MX Shopify store (May 2026)
// Drafts excluded: Youtful Formula (7872851542064), InstantLift Copy (7968560709680)
const PRODUCTS = [
  // ── Physical skincare ──────────────────────────────────────────────────────
  {
    shopifyId: "7810722168880",
    name:      "Mascarilla coreana para puntos negros",
    price:     590,
    cost:      6.2,
    status:    "active",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7816744271920",
    name:      "Brocha Instantlift",
    price:     100,
    cost:      2.5,
    status:    "active",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7885424525360",
    name:      "Retinal Shot",
    price:     590,
    cost:      7.0,
    status:    "active",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7901472784432",
    name:      "ReviveLift™",
    price:     590,
    cost:      7.0,
    status:    "active",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7908046831664",
    name:      "Korean Toner Pads™ zonas oscuras",
    price:     690,
    cost:      6.5,
    status:    "active",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7909382848560",
    name:      "InstantLift™",
    price:     590,
    cost:      6.2,
    status:    "winner",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7931502067760",
    name:      "Deep Collagen",
    price:     599,
    cost:      6.8,
    status:    "winner",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7959152361520",
    name:      "GlowFill™",
    price:     599,
    cost:      7.2,
    status:    "active",
    shipping:  90,
    notes:     null,
  },
  {
    shopifyId: "7966465949744",
    name:      "Jiyu Toner Pads K-Beauty",
    price:     699,
    cost:      6.5,
    status:    "active",
    shipping:  90,
    notes:     null,
  },

  // ── Ebooks / Digital ───────────────────────────────────────────────────────
  {
    shopifyId: "7867802746928",
    name:      "Poros Bajo Control en 7 Días",
    price:     200,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7870255726640",
    name:      "Glow desde Adentro: Alimentos",
    price:     200,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7893997387824",
    name:      "Poros abiertos y arrugas 30 días",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7894076096560",
    name:      "Hábitos y alimentación",
    price:     200,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7908060856368",
    name:      "Rutina Anti-Manchas por Zona",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7908061741104",
    name:      "Tracker Anti-Manchas 21D",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7922381488176",
    name:      "Protocolo Borrador de Ojeras",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7922424381488",
    name:      "Calendario 7 dias Mirada Perfecta",
    price:     180,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7924536606768",
    name:      "Guía Premium tensor natural",
    price:     130,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7924537884720",
    name:      "Tracker Anticansancio",
    price:     170,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7927305044016",
    name:      "21D Tono Uniforme",
    price:     130,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7947427577904",
    name:      "Lifting Desde Dentro: Recetas Colágeno",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7947427643440",
    name:      "Guía Masajes Faciales Efecto Lifting",
    price:     130,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7962296942640",
    name:      "Filler Sin Agujas: El Ritual Coreano",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },
  {
    shopifyId: "7962297696304",
    name:      "Agenda Glow Coreana 30 Días",
    price:     150,
    cost:      0,
    status:    "active",
    shipping:  0,
    notes:     "ebook",
  },

  // ── Upsells / Order bumps ──────────────────────────────────────────────────
  {
    shopifyId: "7868760588336",
    name:      "Protección de Pedido",
    price:     49,
    cost:      0.5,
    status:    "active",
    shipping:  0,
    notes:     "upsell",
  },
  {
    shopifyId: "7942262226992",
    name:      "Glowmmi Fórmula Pro +20%",
    price:     170,
    cost:      3.5,
    status:    "active",
    shipping:  0,
    notes:     "upsell",
  },
  {
    shopifyId: "7942292111408",
    name:      "Rendimiento Extendido +10 Usos",
    price:     170,
    cost:      3.5,
    status:    "active",
    shipping:  0,
    notes:     "upsell",
  },
  {
    shopifyId: "7942293422128",
    name:      "Pureza Extendida",
    price:     170,
    cost:      3.5,
    status:    "active",
    shipping:  0,
    notes:     "upsell",
  },
  {
    shopifyId: "7943263158320",
    name:      "Fórmula Reafirmante 2.0",
    price:     170,
    cost:      3.5,
    status:    "active",
    shipping:  0,
    notes:     "upsell",
  },
  {
    shopifyId: "7943263191088",
    name:      "Rendimiento Máximo +15 Días",
    price:     170,
    cost:      3.5,
    status:    "active",
    shipping:  0,
    notes:     "upsell",
  },
];

async function main() {
  console.log("🛍️  Seeding Glowmmi MX products...\n");

  let created = 0;
  let skipped = 0;

  for (const p of PRODUCTS) {
    const id = `prod_glw_${p.shopifyId}`;

    // Check if already exists
    const existing = await prisma.product.findUnique({ where: { id } });

    if (existing) {
      // Only update name and price (safe non-destructive update)
      await prisma.product.update({
        where: { id },
        data: { name: p.name, localPrice: p.price, shopifyProductId: p.shopifyId },
      });
      skipped++;
      console.log(`  ↻  Ya existe: ${p.name}`);
    } else {
      await prisma.product.create({
        data: {
          id,
          brandId:         BRAND_ID,
          storeId:         STORE_ID,
          countryId:       COUNTRY_ID,
          name:            p.name,
          shopifyProductId: p.shopifyId,
          status:          p.status,
          supplierName:    p.notes === "ebook" ? null : "Proveedor Glowmmi",
          supplierCostUsd: p.cost,
          localPrice:      p.price,
          shippingCost:    p.shipping,
          targetMargin:    28,
          notes:           p.notes,
        },
      });
      created++;
      console.log(`  ✅ Creado: ${p.name} — MXN $${p.price}`);
    }
  }

  console.log(`\n🎉 Listo: ${created} creados, ${skipped} ya existían (sin modificar)`);
}

main()
  .catch((e) => { console.error("❌ Error:", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
