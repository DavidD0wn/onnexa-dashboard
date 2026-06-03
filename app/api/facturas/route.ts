/**
 * GET  /api/facturas          — lista facturas con stats
 * POST /api/facturas          — sube y procesa un Excel del proveedor
 * PATCH /api/facturas         — actualiza status/pago de una factura
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as XLSX from "xlsx";

// ─── Shopify auth ─────────────────────────────────────────────────────────────
const STORES = {
  glowmmi: {
    shop: "glm-1694.myshopify.com",
    clientId: "de9e81a11394aabe11272947a4da0da5",
    clientSecret: "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",
    authType: "json" as const,
  },
  balancea: {
    shop: "mp0vab-bw.myshopify.com",
    clientId: "b06d2c272b5428556744aa476b8467f1",
    clientSecret: "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",
    authType: "urlencoded" as const,
  },
};

async function getShopifyToken(storeKey: "glowmmi" | "balancea") {
  const s = STORES[storeKey];
  const url = `https://${s.shop}/admin/oauth/access_token`;
  let body: string; let ct: string;
  if (s.authType === "urlencoded") {
    body = new URLSearchParams({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }).toString();
    ct = "application/x-www-form-urlencoded";
  } else {
    body = JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, grant_type: "client_credentials" });
    ct = "application/json";
  }
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": ct }, body });
  const data = await res.json();
  return data.access_token as string;
}

/** Fetch ALL orders in a numeric range in ONE GraphQL call — avoids per-order rate limiting */
async function fetchShopifyOrdersBulk(
  shop: string,
  token: string,
  orderNames: string[],
): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  if (orderNames.length === 0) return map;

  const nums = orderNames
    .map(n => parseInt(n.replace(/[^\d]/g, ""), 10))
    .filter(n => !isNaN(n));
  if (nums.length === 0) return map;
  const minN = Math.min(...nums);
  const maxN = Math.max(...nums);

  // Shopify GraphQL: name filter works on the numeric part (without #)
  const gql = `{
    orders(first: 250, query: "name:>=${minN} name:<=${maxN}", sortKey: NAME) {
      edges {
        node {
          id name cancelledAt
          lineItems(first: 20) {
            edges { node { name title quantity } }
          }
        }
      }
    }
  }`;

  const res = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql }),
  });
  if (!res.ok) return map;

  const json = await res.json();
  for (const edge of json.data?.orders?.edges ?? []) {
    const n = edge.node;
    const order = {
      name: n.name,
      cancelled_at: n.cancelledAt,
      line_items: (n.lineItems?.edges ?? []).map((e: any) => ({
        name:     e.node.name  ?? e.node.title ?? "",
        title:    e.node.title ?? e.node.name  ?? "",
        quantity: e.node.quantity,
      })),
    };
    // Index by full name (e.g. "#2354") AND by numeric suffix only (e.g. "2354")
    // so we can match regardless of store prefix (GLW-2354, GLOW-2354, #2354, etc.)
    map.set(n.name, order);
    const numericSuffix = n.name.replace(/[^\d]/g, "");
    if (numericSuffix) map.set(numericSuffix, order);
  }
  return map;
}

// ─── Mapeo nombre de producto → código ────────────────────────────────────────
function guessProductCode(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("holy basil") || n.includes("mascarilla coreana") || n.includes("albahaca")) return "HB01";
  if (n.includes("instantlift") || n.includes("instant lift") || n.includes("filler")) return "INS01";
  if (n.includes("deep collagen") || n.includes("collagen")) return "DC01";
  if (n.includes("retinal") || n.includes("retinol shot")) return "RS01";
  if (n.includes("toner pad") || n.includes("toner")) return "TP01";
  if (n.includes("glowfill") || n.includes("glow fill")) return "GF01";
  if (n.includes("debloted") || n.includes("de bloated")) return "DB01";
  if (n.includes("cutting") || n.includes("cutting mix")) return "CTX01";
  if (n.includes("herbiotic") || n.includes("her biotic")) return "HR01";
  if (n.includes("clearstem") || n.includes("clear stem")) return "ST01";
  if (n.includes("flexi")) return "FL01";
  if (n.includes("inositol")) return "IN01";
  if (n.includes("astaxanthin") || n.includes("astaxa")) return "AX01";
  if (n.includes("smyle") || n.includes("mouthwash")) return "MW01";
  if (n.includes("jtp") || n.includes("jiyu")) return "JTP01";
  if (n.includes("brocha") || n.includes("brush")) return null; // free accessory
  return null;
}

// ─── GET — lista facturas ─────────────────────────────────────────────────────
export async function GET() {
  const invoices = await prisma.supplierInvoice.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      orders: {
        select: { id: true, status: true, orderNumber: true },
      },
    },
  });
  return NextResponse.json(invoices);
}

// ─── POST — procesar Excel ────────────────────────────────────────────────────
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const brandId = (formData.get("brandId") as string) ?? "brand_glowmmi";
  const storeKey = brandId === "brand_balancea" ? "balancea" : "glowmmi";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const filename = file.name;
  const buffer = Buffer.from(await file.arrayBuffer());

  // ── Parse Excel ──────────────────────────────────────────────────────────────
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: Record<string, any>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

  // Filtrar solo filas con número de orden válido
  const orderRows = rows.filter((r) => {
    const name = String(r["Name"] ?? r["name"] ?? "").trim();
    return name.startsWith("#");
  });

  if (orderRows.length === 0) {
    return NextResponse.json({ error: "No se encontraron órdenes en el Excel (filas con # en columna Name)" }, { status: 400 });
  }

  // Agrupar por número de orden
  const grouped: Record<string, typeof orderRows> = {};
  for (const r of orderRows) {
    const name = String(r["Name"] ?? r["name"] ?? "").trim();
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(r);
  }

  const orderNumbers = Object.keys(grouped);

  // ── Cargar escalones del DB ───────────────────────────────────────────────────
  const escalones = await prisma.supplierEscalon.findMany();
  // Dict: { "HB01": { 1: { MX: 8.5, US: 10, CL: 9 }, 2: {...} } }
  const escDict: Record<string, Record<number, { MX?: number; US?: number; CL?: number }>> = {};
  for (const e of escalones) {
    if (!escDict[e.productCode]) escDict[e.productCode] = {};
    escDict[e.productCode][e.units] = {
      MX: e.costMx ?? undefined,
      US: e.costUs ?? undefined,
      CL: e.costCl ?? undefined,
    };
  }

  // ── Shopify: ONE bulk call for all orders ────────────────────────────────────
  let shopifyToken: string | null = null;
  const shop = STORES[storeKey].shop;
  try { shopifyToken = await getShopifyToken(storeKey); } catch { /* continuar sin Shopify */ }

  // Bulk-fetch all orders in a single GraphQL request (avoids per-order rate limiting)
  const shopifyMap = new Map<string, any>();
  let shopifyFetchAttempted = false;
  if (shopifyToken) {
    shopifyFetchAttempted = true;
    try {
      const bulk = await fetchShopifyOrdersBulk(shop, shopifyToken, orderNumbers);
      bulk.forEach((v, k) => shopifyMap.set(k, v));
    } catch { /* continuar sin Shopify */ }
  }

  // ── Procesar órdenes ──────────────────────────────────────────────────────────
  const processedOrders: {
    orderNumber: string; country: string; totalCost: number;
    status: string; discrepancies: string[];
    items: { lineitemName: string; productCode: string | null; quantity: number; costCharged: number; costExpected: number | null; isFree: boolean; hasDiscrepancy: boolean; discrepancyType: string | null; discrepancyDetail: string | null }[];
  }[] = [];

  let totalAmount = 0;
  let totalUnits = 0;
  let discrepancyCount = 0;
  let allDates: Date[] = [];

  for (const orderNumber of orderNumbers) {
    const lines = grouped[orderNumber];
    const country = String(lines[0]["Shipping Country"] ?? lines[0]["shipping_country"] ?? "").trim().toUpperCase() || "MX";
    const orderTotal = lines.reduce((s, r) => s + (parseFloat(String(r["Costo_total"] ?? r["costo_total"] ?? r["COSTO_TOTAL"] ?? 0)) || 0), 0);

    totalAmount += orderTotal;
    totalUnits += lines.reduce((s, r) => s + (parseInt(String(r["Lineitem quantity"] ?? r["lineitem_quantity"] ?? 1)) || 1), 0);

    // Intentar fecha
    const dateStr = String(lines[0]["Created at"] ?? lines[0]["created_at"] ?? "").trim();
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) allDates.push(d);
    }

    let orderStatus = "ok";
    const discrepancies: string[] = [];
    const items: typeof processedOrders[0]["items"] = [];

    // Look up in the pre-fetched map — try exact name first, then numeric suffix
    const numSuffix = orderNumber.replace(/[^\d]/g, "");
    const shopifyOrder = shopifyMap.get(orderNumber) ?? shopifyMap.get(numSuffix) ?? null;

    // Only flag as not_found if the bulk fetch actually worked and returned results
    // (shopifyMap.size > 0 means the request succeeded and returned at least one order)
    const bulkFetchWorked = shopifyFetchAttempted && shopifyMap.size > 0;

    if (!shopifyOrder && bulkFetchWorked) {
      orderStatus = "not_found";
      discrepancies.push(`Orden ${orderNumber} no encontrada en Shopify`);
    } else if (shopifyOrder?.cancelled_at) {
      orderStatus = "cancelled";
      discrepancies.push(`Orden ${orderNumber} está CANCELADA en Shopify pero fue cobrada`);
    }

    // Procesar líneas del Excel
    for (const line of lines) {
      const lineitemName = String(line["Lineitem name"] ?? line["lineitem_name"] ?? "").trim();
      const qty = parseInt(String(line["Lineitem quantity"] ?? line["lineitem_quantity"] ?? 1)) || 1;
      const costCharged = parseFloat(String(line["Costo_total"] ?? line["costo_total"] ?? 0)) || 0;
      const productCode = guessProductCode(lineitemName);
      const isFree = costCharged === 0;

      let costExpected: number | null = null;
      let hasDiscrepancy = false;
      let discrepancyType: string | null = null;
      let discrepancyDetail: string | null = null;

      if (!isFree && productCode) {
        const productEsc = escDict[productCode];
        if (productEsc) {
          // Buscar escalón más cercano por unidades
          const availableUnits = Object.keys(productEsc).map(Number).sort((a, b) => a - b);
          // Buscar escalón exacto, si no el más bajo que cubra la cantidad
          let matchedUnits = availableUnits.find((u) => u === qty);
          if (matchedUnits === undefined) {
            // buscar el escalón que aplique (menor o igual, o el primer disponible)
            const lower = availableUnits.filter((u) => u <= qty);
            matchedUnits = lower.length > 0 ? lower[lower.length - 1] : availableUnits[0];
          }

          if (matchedUnits !== undefined) {
            const countryKey = country as "MX" | "US" | "CL";
            const exp = productEsc[matchedUnits]?.[countryKey];
            if (exp !== undefined) {
              costExpected = exp;
              const diff = Math.abs(costCharged - exp);
              if (diff > 0.05) {
                hasDiscrepancy = true;
                discrepancyType = "price";
                discrepancyDetail = `Cobrado $${costCharged.toFixed(2)} | Esperado $${exp.toFixed(2)} (${country}, ${qty}u) | Diff $${(costCharged - exp).toFixed(2)}`;
                discrepancies.push(`${lineitemName} x${qty}: ${discrepancyDetail}`);
              }
            }
          }
        }
      }

      // Verificar cantidad vs Shopify
      if (shopifyOrder && !isFree && productCode) {
        const shopifyLine = shopifyOrder.line_items?.find((li: any) =>
          guessProductCode(li.name) === productCode || guessProductCode(li.title ?? "") === productCode
        );
        if (shopifyLine && shopifyLine.quantity !== qty) {
          hasDiscrepancy = true;
          discrepancyType = discrepancyType ?? "quantity";
          const detail = `Qty Excel: ${qty} | Shopify: ${shopifyLine.quantity}`;
          discrepancyDetail = discrepancyDetail ? `${discrepancyDetail} | ${detail}` : detail;
          if (!discrepancies.some((d) => d.includes(lineitemName) && d.includes("Qty"))) {
            discrepancies.push(`${lineitemName}: ${detail}`);
          }
        }
      }

      if (hasDiscrepancy && orderStatus === "ok") orderStatus = "discrepancy";

      items.push({ lineitemName, productCode, quantity: qty, costCharged, costExpected, isFree, hasDiscrepancy, discrepancyType, discrepancyDetail });
    }

    if (orderStatus === "discrepancy" || orderStatus === "not_found" || orderStatus === "cancelled") discrepancyCount++;

    processedOrders.push({ orderNumber, country, totalCost: orderTotal, status: orderStatus, discrepancies, items });
  }

  // ── Fechas de la factura ──────────────────────────────────────────────────────
  allDates.sort((a, b) => a.getTime() - b.getTime());
  const dateFrom = allDates[0] ?? null;
  const dateTo   = allDates[allDates.length - 1] ?? null;
  const invoiceMonth = dateFrom
    ? dateFrom.toLocaleDateString("es-MX", { month: "long", year: "numeric" })
    : null;

  // ── Guardar en DB ─────────────────────────────────────────────────────────────
  const invoice = await prisma.supplierInvoice.create({
    data: {
      filename,
      brandId,
      dateFrom,
      dateTo,
      invoiceMonth,
      totalAmount,
      totalOrders: orderNumbers.length,
      totalUnits,
      discrepancyCount,
      status: "pending",
      orders: {
        create: processedOrders.map((o) => ({
          orderNumber: o.orderNumber,
          country: o.country,
          totalCost: o.totalCost,
          status: o.status,
          discrepancies: JSON.stringify(o.discrepancies),
          items: {
            create: o.items.map((item) => ({
              lineitemName: item.lineitemName,
              productCode: item.productCode,
              quantity: item.quantity,
              costCharged: item.costCharged,
              costExpected: item.costExpected,
              isFree: item.isFree,
              hasDiscrepancy: item.hasDiscrepancy,
              discrepancyType: item.discrepancyType,
              discrepancyDetail: item.discrepancyDetail,
            })),
          },
        })),
      },
    },
    include: { orders: { include: { items: true } } },
  });

  return NextResponse.json({
    id: invoice.id,
    filename,
    totalOrders: orderNumbers.length,
    totalAmount,
    totalUnits,
    discrepancyCount,
    orders: processedOrders.map((o) => ({
      orderNumber: o.orderNumber,
      country: o.country,
      totalCost: o.totalCost,
      status: o.status,
      discrepancies: o.discrepancies,
    })),
  });
}

// ─── PATCH — marcar como pagada ───────────────────────────────────────────────
export async function PATCH(req: Request) {
  const { id, status, dateOfPayment, paymentMethod, notes } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updated = await prisma.supplierInvoice.update({
    where: { id },
    data: {
      status,
      dateOfPayment: dateOfPayment ? new Date(dateOfPayment) : undefined,
      paymentMethod: paymentMethod ?? undefined,
      notes: notes ?? undefined,
    },
  });
  return NextResponse.json(updated);
}
