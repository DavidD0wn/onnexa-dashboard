import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import Papa from "papaparse";
import { parse, isValid } from "date-fns";

async function fetchCsv(url: string): Promise<string> {
  let res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseDate(raw: string): Date | null {
  const formats = ["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy", "d/M/yyyy", "dd-MM-yyyy"];
  for (const fmt of formats) {
    const d = parse(raw.trim(), fmt, new Date());
    if (isValid(d)) return d;
  }
  const d = new Date(raw);
  return isValid(d) ? d : null;
}

function num(v: any): number {
  if (v == null || v === "" || v === "-") return 0;
  return parseFloat(String(v).replace(/[$,\s%]/g, "")) || 0;
}

function detectCol(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx >= 0) return headers[idx];
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { url, csvText, type = "ventas" } = body as { url?: string; csvText?: string; type?: string };

    let raw: string;
    if (url) {
      raw = await fetchCsv(url);
    } else if (csvText) {
      raw = csvText;
    } else {
      return NextResponse.json({ error: "Provide url or csvText" }, { status: 400 });
    }

    const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
    const rows = parsed.data as Record<string, string>[];
    const headers = parsed.meta.fields ?? [];

    if (rows.length === 0) {
      return NextResponse.json({ error: "CSV vacío o sin filas válidas" }, { status: 400 });
    }

    if (type === "ventas") {
      return importVentas(rows, headers);
    }
    if (type === "productos") {
      return importProductos(rows, headers);
    }
    return NextResponse.json({ error: "Tipo no reconocido" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function importVentas(rows: Record<string, string>[], headers: string[]) {
  const colFecha = detectCol(headers, ["fecha", "date"]);
  const colMarca = detectCol(headers, ["marca", "brand"]);
  const colPais = detectCol(headers, ["país", "pais", "country", "país"]);
  const colPedidos = detectCol(headers, ["pedidos", "orders", "órdenes", "ordenes"]);
  const colVentasUsd = detectCol(headers, ["ventas usd", "revenue usd", "ventas_usd", "gross_revenue_usd", "gross revenue"]);
  const colVentasMxn = detectCol(headers, ["ventas mxn", "ventas_mxn"]);
  const colVentasLocal = detectCol(headers, ["ventas", "ventas loc", "revenue", "gross revenue", "facturación"]);
  const colPauta = detectCol(headers, ["pauta", "ads usd", "ads_usd", "ad spend", "gasto pauta", "spend"]);
  const colCpa = detectCol(headers, ["cpa real", "cpa"]);
  const colUtilidad = detectCol(headers, ["utilidad usd", "utilidad_usd", "profit usd", "utilidad", "profit"]);
  const colMargen = detectCol(headers, ["margen", "margin", "utilidad %", "utilidad%"]);
  const colRoas = detectCol(headers, ["roas"]);
  const colCogs = detectCol(headers, ["cogs", "costo producto", "product cost"]);
  const colEnvio = detectCol(headers, ["envío", "envio", "shipping"]);

  if (!colFecha) {
    return NextResponse.json({ error: "No se encontró columna de fecha. Asegúrate de que tenga una columna 'Fecha' o 'Date'." }, { status: 400 });
  }

  const [brands, countries, stores] = await Promise.all([
    prisma.brand.findMany(),
    prisma.country.findMany(),
    prisma.store.findMany(),
  ]);

  const brandMap: Record<string, string> = {};
  for (const b of brands) brandMap[b.name.toLowerCase()] = b.id;

  const countryMap: Record<string, string> = {};
  for (const c of countries) {
    countryMap[c.name.toLowerCase()] = c.id;
    countryMap[c.code.toLowerCase()] = c.id;
    countryMap[c.currency.toLowerCase()] = c.id;
  }

  let imported = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    const rawDate = colFecha ? row[colFecha] : "";
    const dateObj = parseDate(rawDate);
    if (!dateObj) {
      errors.push(`Fila ${rowNum}: fecha inválida "${rawDate}"`);
      continue;
    }

    let brandId: string | null = null;
    if (colMarca) {
      const rawBrand = row[colMarca]?.toLowerCase().trim();
      brandId = brandMap[rawBrand] ?? null;
      if (!brandId) {
        for (const [k, v] of Object.entries(brandMap)) {
          if (rawBrand?.includes(k)) { brandId = v; break; }
        }
      }
    }
    if (!brandId) brandId = brands[0]?.id ?? null;
    if (!brandId) { errors.push(`Fila ${rowNum}: marca no encontrada`); continue; }

    let countryId: string | null = null;
    if (colPais) {
      const rawCountry = row[colPais]?.toLowerCase().trim();
      countryId = countryMap[rawCountry] ?? null;
      if (!countryId) {
        for (const [k, v] of Object.entries(countryMap)) {
          if (rawCountry?.includes(k)) { countryId = v; break; }
        }
      }
    }
    if (!countryId) countryId = countries.find((c) => c.currency === "USD")?.id ?? countries[0]?.id ?? null;
    if (!countryId) { errors.push(`Fila ${rowNum}: país no encontrado`); continue; }

    const store = stores.find((s) => s.brandId === brandId && s.countryId === countryId);
    if (!store) { errors.push(`Fila ${rowNum}: tienda no encontrada para esta marca/país`); continue; }

    const revenueUsd = colVentasUsd ? num(row[colVentasUsd]) : 0;
    const revenueMxn = colVentasMxn ? num(row[colVentasMxn]) : 0;
    const revenueLocal = colVentasLocal ? num(row[colVentasLocal]) : 0;
    const grossRevenue = revenueUsd || revenueLocal || revenueMxn;

    const orders = colPedidos ? Math.round(num(row[colPedidos])) : 0;
    const adSpend = colPauta ? num(row[colPauta]) : 0;
    const cpa = colCpa ? num(row[colCpa]) : (orders > 0 && adSpend > 0 ? adSpend / orders : null);
    const profit = colUtilidad ? num(row[colUtilidad]) : 0;
    const margin = colMargen ? num(row[colMargen]) : (grossRevenue > 0 ? (profit / grossRevenue) * 100 : 0);
    const roas = colRoas ? num(row[colRoas]) : (adSpend > 0 ? grossRevenue / adSpend : null);
    const cogs = colCogs ? num(row[colCogs]) : 0;
    const shipping = colEnvio ? num(row[colEnvio]) : 0;
    const aov = orders > 0 ? grossRevenue / orders : 0;

    try {
      await prisma.dailyMetric.upsert({
        where: {
          id: `import_${dateObj.toISOString().split("T")[0]}_${brandId}_${countryId}`,
        },
        update: {
          ordersCount: orders,
          unitsSold: orders,
          grossRevenue,
          netRevenue: grossRevenue * 0.97,
          adSpend,
          cogs,
          shippingCost: shipping,
          netProfit: profit,
          netMargin: margin,
          aov,
          cpa: cpa ?? undefined,
          roas: roas ?? undefined,
          mer: adSpend > 0 ? grossRevenue / adSpend : undefined,
        },
        create: {
          id: `import_${dateObj.toISOString().split("T")[0]}_${brandId}_${countryId}`,
          date: dateObj,
          brandId,
          countryId,
          storeId: store.id,
          ordersCount: orders,
          unitsSold: orders,
          grossRevenue,
          netRevenue: grossRevenue * 0.97,
          adSpend,
          cogs,
          shippingCost: shipping,
          netProfit: profit,
          netMargin: margin,
          aov,
          cpa: cpa ?? undefined,
          roas: roas ?? undefined,
          mer: adSpend > 0 ? grossRevenue / adSpend : undefined,
        },
      });
      imported++;
    } catch (e: any) {
      errors.push(`Fila ${rowNum}: ${e.message}`);
    }
  }

  await prisma.import.create({
    data: {
      type: "ventas",
      filename: "google-sheets",
      status: errors.length === 0 ? "success" : "partial",
      totalRows: rows.length,
      importedRows: imported,
      errorRows: errors.length,
      errors: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
    },
  });

  return NextResponse.json({ imported, errors: errors.slice(0, 10), total: rows.length });
}

async function importProductos(rows: Record<string, string>[], headers: string[]) {
  const colNombre = detectCol(headers, ["nombre", "producto", "name", "product"]);
  const colMarca = detectCol(headers, ["marca", "brand"]);
  const colPrecio = detectCol(headers, ["precio", "sale price", "price"]);
  const colCosto = detectCol(headers, ["costo proveedor", "supplier price", "costo", "cost"]);
  const colEnvio = detectCol(headers, ["envío", "shipping", "envio"]);
  const colPais = detectCol(headers, ["país", "pais", "country"]);
  const colStatus = detectCol(headers, ["status", "estado"]);

  if (!colNombre) {
    return NextResponse.json({ error: "No se encontró columna de nombre de producto." }, { status: 400 });
  }

  const [brands, countries, stores] = await Promise.all([
    prisma.brand.findMany(),
    prisma.country.findMany(),
    prisma.store.findMany(),
  ]);

  const brandMap: Record<string, string> = {};
  for (const b of brands) brandMap[b.name.toLowerCase()] = b.id;
  const countryMap: Record<string, string> = {};
  for (const c of countries) {
    countryMap[c.name.toLowerCase()] = c.id;
    countryMap[c.code.toLowerCase()] = c.id;
  }

  let imported = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row[colNombre]?.trim();
    if (!name) continue;

    let brandId = brands[0]?.id;
    if (colMarca) {
      const rawBrand = row[colMarca]?.toLowerCase().trim();
      brandId = brandMap[rawBrand] ?? brands[0]?.id;
    }

    let countryId = countries.find((c) => c.currency === "USD")?.id ?? countries[0]?.id!;
    if (colPais) {
      const rawCountry = row[colPais]?.toLowerCase().trim();
      countryId = countryMap[rawCountry] ?? countryId;
    }

    const store = stores.find((s) => s.brandId === brandId && s.countryId === countryId);
    if (!store) { errors.push(`Fila ${i + 2}: tienda no encontrada`); continue; }

    const localPrice = colPrecio ? num(row[colPrecio]) : undefined;
    const supplierCostUsd = colCosto ? num(row[colCosto]) : undefined;
    const shippingCost = colEnvio ? num(row[colEnvio]) : undefined;

    try {
      await prisma.product.upsert({
        where: { id: `prod_import_${name.toLowerCase().replace(/\s+/g, "_").slice(0, 30)}` },
        update: { localPrice, supplierCostUsd, shippingCost },
        create: {
          id: `prod_import_${name.toLowerCase().replace(/\s+/g, "_").slice(0, 30)}`,
          name,
          brandId: brandId!,
          storeId: store.id,
          countryId,
          status: colStatus ? row[colStatus]?.toLowerCase().replace(/\s+/g, "_") ?? "active" : "active",
          localPrice,
          supplierCostUsd,
          shippingCost,
        },
      });
      imported++;
    } catch (e: any) {
      errors.push(`Fila ${i + 2}: ${e.message}`);
    }
  }

  await prisma.import.create({
    data: {
      type: "productos",
      filename: "google-sheets",
      status: errors.length === 0 ? "success" : "partial",
      totalRows: rows.length,
      importedRows: imported,
      errorRows: errors.length,
      errors: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
    },
  });

  return NextResponse.json({ imported, errors: errors.slice(0, 10), total: rows.length });
}

export async function GET() {
  const imports = await prisma.import.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ imports });
}
