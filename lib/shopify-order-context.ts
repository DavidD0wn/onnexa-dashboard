// lib/shopify-order-context.ts
// ─────────────────────────────────────────────────────────────────────────────
// Trae datos REALES de un pedido de Shopify para inyectarlos al prompt de la IA.
// Sin esto la IA inventaría estados de envío (violando la regla 14 del manual).
//
// Busca en ambas tiendas (Glowmmi y Balancea) por correo del cliente o por
// número de orden detectado en el texto del correo entrante.
// ─────────────────────────────────────────────────────────────────────────────

interface StoreCfg { key: "Glowmmi" | "Balancea"; shop: string; token: string; clientId: string; clientSecret: string; }

function stores(): StoreCfg[] {
  const all: StoreCfg[] = [
    {
      key: "Glowmmi",
      shop:         process.env.SHOPIFY_GLOWMMI_SHOP          ?? "",
      token:        process.env.SHOPIFY_GLOWMMI_TOKEN         ?? "",
      clientId:     process.env.SHOPIFY_GLOWMMI_CLIENT_ID     ?? "",
      clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET ?? "",
    },
    {
      key: "Balancea",
      shop:         process.env.SHOPIFY_BALANCEA_SHOP          ?? "",
      token:        process.env.SHOPIFY_BALANCEA_TOKEN         ?? "",
      clientId:     process.env.SHOPIFY_BALANCEA_CLIENT_ID     ?? "",
      clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET ?? "",
    },
  ];
  return all.filter((s) => s.shop);
}

// Token fresco por client_credentials.
// OJO: los `atkn_` guardados en .env EXPIRAN (devuelven 401) y hacían que el
// bot creyera que los pedidos no existían — la IA respondía "no encontramos tu
// pedido" a clientes con pedidos reales. Por eso siempre pedimos uno nuevo.
const tokenCache: Record<string, { token: string; exp: number }> = {};

async function getToken(s: StoreCfg): Promise<string> {
  const cached = tokenCache[s.key];
  if (cached && cached.exp > Date.now()) return cached.token;

  const res = await fetch(`https://${s.shop}/admin/oauth/access_token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id:  s.clientId,
      client_secret: s.clientSecret,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`No token ${s.key}: ${JSON.stringify(data).slice(0, 120)}`);

  // Cachear ~50 min (los tokens suelen durar 1h) para no pedir uno por correo
  tokenCache[s.key] = { token: data.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return data.access_token;
}

export interface OrderContext {
  found:     boolean;
  store?:    string;
  brandName: "Glowmmi" | "Balancea";
  text:      string;   // bloque de texto listo para el prompt
}

const MX_MONTHS = 30 * 24 * 3600 * 1000;

// Detecta un número de orden en el texto (#1234, orden 1234, order 1234)
export function detectOrderNumber(text: string): string | null {
  const m = text.match(/(?:orden|order|pedido|#)\s*#?\s*(\d{3,6})/i);
  return m ? m[1] : null;
}

async function fetchOrder(s: StoreCfg, token: string, params: string): Promise<any | null> {
  const url = `https://${s.shop}/admin/api/2024-10/orders.json?${params}&status=any&limit=5` +
    `&fields=id,name,email,phone,created_at,financial_status,fulfillment_status,customer,shipping_address,line_items,fulfillments`;
  const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
  if (!res.ok) {
    // No fallar en silencio: si Shopify rechaza, la IA respondería "no
    // encontramos tu pedido" a un cliente que SÍ tiene pedido.
    console.warn(`[order-context] Shopify ${s.key} respondió ${res.status} para ${params}`);
    return null;
  }
  const data = await res.json();
  return (data.orders && data.orders[0]) || null;
}

function formatOrder(s: StoreCfg, o: any): OrderContext {
  const sa = o.shipping_address ?? {};
  const f  = (o.fulfillments ?? [])[0] ?? {};
  const tracking = f.tracking_number ?? (f.tracking_numbers ?? [])[0] ?? "(sin guía aún)";
  const trackCompany = f.tracking_company ?? "";
  const items = (o.line_items ?? []).map((li: any) => `${li.quantity}x ${li.title}`).join(", ");
  const ageDays = o.created_at ? Math.floor((Date.now() - new Date(o.created_at).getTime()) / (24 * 3600 * 1000)) : null;

  // Estado de fulfillment REAL de Shopify (no inventar más allá de esto)
  const fulfillment = o.fulfillment_status ?? "unfulfilled";
  // OJO: nada de esta redacción debe nombrar herramientas internas (Shopify,
  // CJ, etc.). La IA repite lo que lee, y el cliente no debe saber qué usamos.
  const estadoTxt = {
    fulfilled: "Marcado como ENVIADO en nuestro sistema (tiene guía asignada).",
    partial:   "Envío PARCIAL registrado.",
    restocked: "Reingresado a inventario (posible cancelación/devolución).",
    unfulfilled: "AÚN NO marcado como enviado en nuestro sistema.",
  }[fulfillment as string] ?? `Estado: ${fulfillment}`;

  const text =
    `Pedido: ${o.name} (tienda ${s.key})\n` +
    `[INTERNO — no menciones nunca al cliente de dónde salen estos datos]\n` +
    `Cliente: ${[o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || sa.name || "(s/d)"}\n` +
    `Correo: ${o.email ?? "(s/d)"}  ·  Tel: ${sa.phone ?? o.phone ?? "(s/d)"}\n` +
    `Productos: ${items || "(s/d)"}\n` +
    `Fecha del pedido: ${(o.created_at ?? "").slice(0, 10)}${ageDays !== null ? ` (hace ${ageDays} días)` : ""}\n` +
    `Pago: ${o.financial_status ?? "(s/d)"}\n` +
    `Fulfillment (real, Shopify): ${estadoTxt}\n` +
    `Guía / tracking: ${tracking}${trackCompany ? ` (${trackCompany})` : ""}\n` +
    `--- Dirección registrada en el pedido ---\n` +
    `Address 1: ${sa.address1 ?? "(VACÍO)"}\n` +
    `Address 2: ${sa.address2 ?? "(vacío)"}\n` +
    `Ciudad: ${sa.city ?? "(VACÍO)"}  ·  Estado: ${sa.province ?? sa.province_code ?? "(s/d)"}  ·  CP: ${sa.zip ?? "(VACÍO)"}  ·  País: ${sa.country_code ?? "(s/d)"}\n` +
    `NOTA INTERNA: no hay estado de tránsito en vivo. Solo sabes si tiene guía asignada, no dónde va el paquete. No afirmes ubicaciones que no estén aquí.`;

  return { found: true, store: s.key, brandName: s.key, text };
}

/** Busca el pedido por correo del remitente y/o número de orden en el texto. */
export async function getOrderContext(fromEmail: string, inboundText: string): Promise<OrderContext> {
  const orderNum = detectOrderNumber(inboundText);

  for (const s of stores()) {
    try {
      const token = await getToken(s);

      // 1) por número de orden (más preciso)
      if (orderNum) {
        const byNum = await fetchOrder(s, token, `name=${encodeURIComponent("#" + orderNum)}`);
        if (byNum) return formatOrder(s, byNum);
      }
      // 2) por correo del cliente (el más reciente)
      if (fromEmail) {
        const byEmail = await fetchOrder(s, token, `email=${encodeURIComponent(fromEmail)}`);
        if (byEmail) return formatOrder(s, byEmail);
      }
    } catch { /* probar siguiente tienda */ }
  }

  return { found: false, brandName: "Balancea", text: "" };
}
