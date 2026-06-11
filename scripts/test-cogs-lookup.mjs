/**
 * Simula el lookup de COGS del motor con títulos REALES de pedidos
 * (verificados contra la API de Shopify) y la tabla normalizada v4.
 */
import fs from "fs";
const data = JSON.parse(fs.readFileSync("./data/product-costs.json", "utf-8"));

// — Réplica exacta de las funciones del motor —
const normName = (n) => n.toLowerCase().replace(/[™®–—\-]/g, " ").replace(/\s+/g, " ").trim();
const baseOf   = (n) => n.split(/\s*[|—–]\s*/)[0].replace(/[™®]/g, "").trim();
function lookupCostSync(title, variant, flatCosts) {
  const base = baseOf(title), nTitle = normName(title), nBase = normName(base);
  const nVariant = variant ? normName(variant) : "";
  if (nVariant) {
    return (
      flatCosts[`${base} ${variant}`]    ?? flatCosts[`${nBase} ${nVariant}`] ??
      flatCosts[`${title} ${variant}`]   ?? flatCosts[`${title} — ${variant}`] ??
      flatCosts[`${nTitle} ${nVariant}`] ?? flatCosts[title]  ??
      flatCosts[base]  ?? flatCosts[nTitle] ?? flatCosts[nBase] ?? 0
    );
  }
  return flatCosts[title] ?? flatCosts[base] ?? flatCosts[nTitle] ?? flatCosts[nBase] ?? 0;
}
function addToCostMap(map, key, val) { map[key] = val; map[normName(key)] = val; }
function buildFlat(cc) {
  const flat = {};
  for (const [k, v] of Object.entries(data[cc])) {
    if (typeof v === "number" && v > 0) addToCostMap(flat, k, v);
  }
  return flat;
}

// — Casos reales (título de Shopify, qty, país, total esperado del proveedor) —
const CASES = [
  ["Cutting Mix – Control del apetito, energía y apoyo al metabolismo", 2, "mx", 23.80],
  ["Cutting Mix – Control del apetito, energía y apoyo al metabolismo", 3, "mx", 34.58],
  ["Cutting Mix – Control del apetito, energía y apoyo al metabolismo", 4, "mx", 45.35],
  ["HerBiotic™ | Controla el mal olor y restaura la humedad íntima",    1, "mx",  9.67],
  ["HerBiotic™ | Controla el mal olor y restaura la humedad íntima",    2, "mx", 17.11],
  ["HerBiotic™ | Controla el mal olor y restaura la humedad íntima",    3, "mx", 24.55],
  ["Toner Pads — K-Beauty Para Aclarar tus Zonas Íntimas",              2, "mx", 14.80],
  ["Toner Pads — K-Beauty Para Aclarar tus Zonas Íntimas",              2, "us", 17.40],
  ["Toner Pads — K-Beauty Para Aclarar tus Zonas Íntimas",              3, "us", 23.60],
  ["InstantLift™ | Efecto tensor para ojeras y bolsas en 5 minutos",    2, "mx", 11.50],
  ["InstantLift™ | Efecto tensor para ojeras y bolsas en 5 minutos",    3, "us", 14.90],
  ["Holy Basil",                                                        2, "us", 15.30],
  ["Mascarilla coreana para puntos negros — sin irritar piel sensible", 1, "mx",  6.20],
];

let ok = 0, fail = 0;
for (const [title, qty, cc, expected] of CASES) {
  const flat = buildFlat(cc);
  // Lógica nueva del motor: sin variante → probar escalón xN primero
  let unitCost = 0;
  if (qty > 1) unitCost = lookupCostSync(title, `x${qty}`, flat);
  if (unitCost <= 0) unitCost = lookupCostSync(title, "", flat);
  const total = Math.round(unitCost * qty * 100) / 100;
  const pass = Math.abs(total - expected) <= 0.02;
  pass ? ok++ : fail++;
  console.log(`${pass ? "✅" : "❌"} [${cc}] ${title.slice(0, 45)}… qty=${qty} → $${total} (esperado $${expected})`);
}
console.log(`\n${ok}/${CASES.length} correctos${fail ? ` — ${fail} FALLARON` : ""}`);
process.exit(fail ? 1 : 0);
