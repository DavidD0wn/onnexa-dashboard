/**
 * Normaliza product-costs.json a costos POR UNIDAD en todas las claves "xN".
 *
 * El motor de COGS (shopify/sync y products/analytics) calcula:
 *     cogs = costoUnitario × unidadesFísicas
 * por lo que las claves "Producto xN" deben guardar el costo POR UNIDAD del
 * escalón N del proveedor (total del escalón ÷ N).
 *
 * Detección: si valor(xN) > valor(x1) es un TOTAL → se divide por N.
 *            si valor(xN) ≤ valor(x1) ya es por unidad → se deja igual.
 */
import fs from "fs";

const PATH = "./data/product-costs.json";
const data = JSON.parse(fs.readFileSync(PATH, "utf-8"));

const report = [];

for (const cc of ["mx", "us", "cl"]) {
  const flat = data[cc];
  if (!flat) continue;

  for (const [key, val] of Object.entries(flat)) {
    const m = key.match(/^(.*)\sx(\d+)\s*$/);
    if (!m) continue;
    const n = parseInt(m[2]);
    if (n < 2) continue;

    // Busca el x1 del mismo producto
    const x1Key = Object.keys(flat).find(k => k.replace(/\s+$/, "") === `${m[1]} x1`);
    const x1Val = x1Key ? flat[x1Key] : null;
    if (x1Val == null) { report.push(`⚠️  ${cc}/${key}: sin x1, no se tocó`); continue; }

    if (val > x1Val) {
      const perUnit = Math.round((val / n) * 100) / 100;
      flat[key] = perUnit;
      report.push(`${cc} | ${key}: ${val} (total) → ${perUnit}/unidad`);
    }
  }
}

// CuttingMix x4 — nuevo escalón del proveedor: $45.35 total → 11.34/unidad
for (const cc of ["mx", "us", "cl"]) {
  data[cc]["Cutting Mix x4"] = 11.34;
  data[cc]["CuttingMix x4"]  = 11.34;
}
report.push("➕ CuttingMix x4 agregado: 11.34/unidad (total 45.35) en mx/us/cl");

data._version = 4;
data._updated = "2026-06-11 — Normalización: claves xN ahora son costo POR UNIDAD (total escalón ÷ N). CuttingMix x4 agregado.";
data._nota = "COGS en USD por país de envío. Claves 'Producto xN' = costo POR UNIDAD del escalón N del proveedor (el motor multiplica por unidades físicas). Claves de oferta sin xN (ej. '2 + 1 Free') = costo TOTAL de la oferta. Claves de título largo = costo x1 por unidad.";

fs.writeFileSync(PATH, JSON.stringify(data, null, 2) + "\n");
console.log(report.join("\n"));
console.log(`\n✅ ${report.length} cambios aplicados — versión 4`);
