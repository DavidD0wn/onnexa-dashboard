/**
 * GET /api/novedades
 * Genera alertas automáticas:
 * - Pedidos sin fulfillment >10 días
 * - Pedidos sin tracking >10 días (fulfilled pero sin tracking URL)
 * - Órdenes canceladas recientemente
 * - Pedidos con posible problema de entrega (devueltos, sin entrega en CL/US por días)
 * - Productos con discrepancias en facturas
 * - Facturas sin pagar de más de 30 días
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchShopifyPaginated,
  getShopifyStores,
  isShopifyStoreConfigured,
  shopifyRestUrl,
  type ShopifyStoreConfig,
} from "@/lib/integrations/shopify";

async function fetchOrders(store: ShopifyStoreConfig, params: string) {
  return fetchShopifyPaginated<any>(
    store,
    shopifyRestUrl(store, `orders.json?${params}&limit=250`),
    "orders",
  );
}

/* Palabras clave en tags/notas que indican un problema de entrega confirmado */
const DELIVERY_ISSUE_TAGS = [
  "returned", "return to sender", "retornado", "devuelto", "devuelta",
  "undelivered", "no entregado", "held", "hold for instructions",
  "address not found", "direccion incorrecta", "rechazado",
];

function hasDeliveryIssueTag(tags: string): boolean {
  if (!tags) return false;
  const t = tags.toLowerCase();
  return DELIVERY_ISSUE_TAGS.some((kw) => t.includes(kw));
}

export async function GET() {
  const alerts: {
    id: string; type: string; severity: "critical"|"warning"|"info";
    title: string; detail: string; orderName?: string;
    store?: string; brandColor?: string; shopUrl?: string;
    orderId?: string; createdAt: string; daysSince?: number;
  }[] = [];
  const storeErrors: Array<{ store: string; error: string }> = [];

  const now = Date.now();

  // ── Shopify alerts ─────────────────────────────────────────────────────────
  const stores = Object.values(getShopifyStores());
  for (const store of stores) {
    try {
      if (!isShopifyStoreConfigured(store)) {
        throw new Error("Credenciales no configuradas");
      }

      // 1. Unfulfilled >10 days
      const cutoff10 = new Date(now - 10 * 864e5).toISOString();
      const unfulfilledOld = await fetchOrders(store,
        `fulfillment_status=unfulfilled&financial_status=paid&status=open&created_at_max=${cutoff10}&fields=id,name,created_at,email,customer,total_price,currency`
      );
      for (const o of unfulfilledOld) {
        const days = Math.floor((now - new Date(o.created_at).getTime()) / 864e5);
        alerts.push({
          id:          `unf-${o.id}`,
          type:        "unfulfilled",
          severity:    days > 20 ? "critical" : "warning",
          title:       `Pedido sin enviar ${days} días`,
          detail:      `${o.name} — ${o.customer?.first_name ?? "cliente"} | ${o.currency} ${o.total_price}`,
          orderName:   o.name,
          store:       store.key,
          brandColor:  store.color,
          shopUrl:     store.shop,
          orderId:     String(o.id),
          createdAt:   o.created_at,
          daysSince:   days,
        });
      }

      // 2. Fulfilled but no tracking >10 days
      const since30 = new Date(now - 30 * 864e5).toISOString();
      const fulfilledOrders = await fetchOrders(store,
        `fulfillment_status=fulfilled&financial_status=paid&created_at_min=${since30}&fields=id,name,created_at,fulfillments,customer,total_price,currency`
      );
      for (const o of fulfilledOrders) {
        const hasTracking = (o.fulfillments ?? []).some((f: any) =>
          f.tracking_number || f.tracking_url || f.tracking_company
        );
        if (!hasTracking) {
          const days = Math.floor((now - new Date(o.created_at).getTime()) / 864e5);
          if (days >= 10) {
            alerts.push({
              id:         `notrack-${o.id}`,
              type:       "no_tracking",
              severity:   "warning",
              title:      `Sin número de tracking (${days}d)`,
              detail:     `${o.name} — cumplido pero sin tracking | ${o.currency} ${o.total_price}`,
              orderName:  o.name,
              store:      store.key,
              brandColor: store.color,
              shopUrl:    store.shop,
              orderId:    String(o.id),
              createdAt:  o.created_at,
              daysSince:  days,
            });
          }
        }
      }

      // 3. Recently cancelled (last 3 days)
      const since3 = new Date(now - 3 * 864e5).toISOString();
      const cancelled = await fetchOrders(store,
        `status=cancelled&cancelled_at_min=${since3}&fields=id,name,created_at,cancelled_at,cancel_reason,total_price,currency,customer`
      );
      for (const o of cancelled) {
        alerts.push({
          id:         `canc-${o.id}`,
          type:       "cancelled",
          severity:   "info",
          title:      `Orden cancelada`,
          detail:     `${o.name} — ${o.cancel_reason ?? "sin motivo"} | ${o.currency} ${o.total_price}`,
          orderName:  o.name,
          store:      store.key,
          brandColor: store.color,
          shopUrl:    store.shop,
          orderId:    String(o.id),
          createdAt:  o.cancelled_at ?? o.created_at,
        });
      }

      // 4. Posibles problemas de entrega
      //    a) Órdenes cumplidas >20 días a Chile (alta tasa de devolución)
      //    b) Órdenes cumplidas >28 días a USA
      //    c) Cualquier orden con tag de devolución/problema en los últimos 60 días
      const since60 = new Date(now - 60 * 864e5).toISOString();
      const recentFulfilled = await fetchOrders(store,
        `fulfillment_status=fulfilled&financial_status=paid&created_at_min=${since60}` +
        `&fields=id,name,created_at,fulfillments,customer,total_price,currency,shipping_address,tags`
      );

      for (const o of recentFulfilled) {
        const shippingCountry = (o.shipping_address?.country_code ?? "").toUpperCase();
        const tags            = o.tags ?? "";
        const fulfillDate     = (o.fulfillments?.[0]?.created_at) ?? o.created_at;
        const daysSinceFulfil = Math.floor((now - new Date(fulfillDate).getTime()) / 864e5);

        // Check by tag first (confirmed issues)
        if (hasDeliveryIssueTag(tags)) {
          const daysSince = Math.floor((now - new Date(o.created_at).getTime()) / 864e5);
          alerts.push({
            id:         `deliv-tag-${o.id}`,
            type:       "delivery_issue",
            severity:   "critical",
            title:      `Problema de entrega detectado`,
            detail:     `${o.name} — ${shippingCountry || "?"} | ${o.currency} ${o.total_price} | Tag: ${tags.slice(0, 60)}`,
            orderName:  o.name,
            store:      store.key,
            brandColor: store.color,
            shopUrl:    store.shop,
            orderId:    String(o.id),
            createdAt:  o.created_at,
            daysSince,
          });
          continue;
        }

        // Heuristic: Chile >20 days since fulfillment
        if (shippingCountry === "CL" && daysSinceFulfil >= 20) {
          alerts.push({
            id:         `deliv-cl-${o.id}`,
            type:       "delivery_issue",
            severity:   daysSinceFulfil >= 30 ? "critical" : "warning",
            title:      `Posible devolución — Chile (${daysSinceFulfil}d)`,
            detail:     `${o.name} — enviado hace ${daysSinceFulfil} días, sin confirmación de entrega | ${o.currency} ${o.total_price}`,
            orderName:  o.name,
            store:      store.key,
            brandColor: store.color,
            shopUrl:    store.shop,
            orderId:    String(o.id),
            createdAt:  o.created_at,
            daysSince:  daysSinceFulfil,
          });
          continue;
        }

        // Heuristic: USA >28 days since fulfillment
        if (shippingCountry === "US" && daysSinceFulfil >= 28) {
          alerts.push({
            id:         `deliv-us-${o.id}`,
            type:       "delivery_issue",
            severity:   daysSinceFulfil >= 35 ? "critical" : "warning",
            title:      `Posible no entregado — USA (${daysSinceFulfil}d)`,
            detail:     `${o.name} — enviado hace ${daysSinceFulfil} días sin confirmación | ${o.currency} ${o.total_price}`,
            orderName:  o.name,
            store:      store.key,
            brandColor: store.color,
            shopUrl:    store.shop,
            orderId:    String(o.id),
            createdAt:  o.created_at,
            daysSince:  daysSinceFulfil,
          });
          continue;
        }
      }

    } catch (e: any) {
      console.error(`[novedades] ${store.shop}:`, e.message);
      storeErrors.push({ store: store.key, error: e.message });
    }
  }

  // ── DB alerts ───────────────────────────────────────────────────────────────

  // 4. Facturas sin pagar >30 días
  try {
    const cutoffDate = new Date(now - 30 * 864e5);
    const oldInvoices = await prisma.supplierInvoice.findMany({
      where: { status: "pending", createdAt: { lt: cutoffDate } },
      select: { id: true, filename: true, totalAmount: true, createdAt: true },
    });
    for (const inv of oldInvoices) {
      const days = Math.floor((now - inv.createdAt.getTime()) / 864e5);
      alerts.push({
        id:        `inv-${inv.id}`,
        type:      "invoice_unpaid",
        severity:  days > 45 ? "critical" : "warning",
        title:     `Factura sin pagar (${days}d)`,
        detail:    `${inv.filename} — $${inv.totalAmount.toFixed(2)} USD pendiente`,
        createdAt: inv.createdAt.toISOString(),
        daysSince: days,
      });
    }
  } catch {}

  // 5. Facturas con discrepancias sin resolver
  try {
    const discInvoices = await prisma.supplierInvoice.findMany({
      where: { discrepancyCount: { gt: 0 }, status: "pending" },
      select: { id: true, filename: true, discrepancyCount: true, totalAmount: true, createdAt: true },
      take: 10,
    });
    for (const inv of discInvoices) {
      alerts.push({
        id:        `disc-${inv.id}`,
        type:      "invoice_discrepancy",
        severity:  "warning",
        title:     `${inv.discrepancyCount} discrepancia${inv.discrepancyCount > 1 ? "s" : ""} en factura`,
        detail:    `${inv.filename} — revisa los cobros del proveedor`,
        createdAt: inv.createdAt.toISOString(),
      });
    }
  } catch {}

  // Sort: critical first, then by date desc
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => {
    const so = severityOrder[a.severity] - severityOrder[b.severity];
    if (so !== 0) return so;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const counts = {
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning:  alerts.filter((a) => a.severity === "warning").length,
    info:     alerts.filter((a) => a.severity === "info").length,
    total:    alerts.length,
  };

  const payload = {
    alerts,
    counts,
    dataComplete: storeErrors.length === 0,
    storeErrors,
  };
  if (storeErrors.length === stores.length) {
    return NextResponse.json(
      { ...payload, error: "Shopify no respondió para ninguna tienda. Las alarmas no están completas." },
      { status: 502 },
    );
  }
  return NextResponse.json(payload);
}
