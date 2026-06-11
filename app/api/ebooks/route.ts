import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import nodemailer from "nodemailer";
import { EBOOK_PRODUCTS, detectEbooks } from "@/lib/ebook-products";

const prisma = new PrismaClient();

const SHOP       = "mp0vab-bw.myshopify.com";
const CLIENT_ID  = "b06d2c272b5428556744aa476b8467f1";
const CLIENT_SEC = "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";

// ── SMTP transporter ──────────────────────────────────────────
function createTransporter() {
  const email    = process.env.ZOHO_SMTP_EMAIL    ?? "";
  const password = process.env.ZOHO_SMTP_PASSWORD ?? "";
  if (!email || !password || email.includes("tu_correo")) {
    throw new Error("Faltan credenciales SMTP en .env (ZOHO_SMTP_EMAIL / ZOHO_SMTP_PASSWORD)");
  }
  return nodemailer.createTransport({
    host: "smtp.zoho.com", port: 465, secure: true,
    auth: { user: email, pass: password },
  });
}

// ── Shopify ───────────────────────────────────────────────────
async function getShopifyToken(): Promise<string> {
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID, client_secret: CLIENT_SEC,
    }).toString(),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error("Sin access_token de Shopify");
  return d.access_token;
}

async function fetchOrdersForProduct(token: string, keyword: string): Promise<any[]> {
  const all: any[] = [];
  let url: string | null =
    `https://${SHOP}/admin/api/2024-01/orders.json` +
    `?status=any&financial_status=paid,partially_paid,partially_refunded&limit=250` +
    `&fields=id,order_number,created_at,customer,email,line_items`;

  while (url) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!res.ok) break;
    const data = await res.json();
    for (const order of data.orders ?? []) {
      const hasProduct = (order.line_items ?? []).some((i: any) =>
        (i.title ?? "").toLowerCase().includes(keyword.toLowerCase())
      );
      if (hasProduct) all.push(order);
    }
    const next: RegExpMatchArray | null = (res.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
}

// ── GET /api/ebooks?product=herbiotic ─────────────────────────
export async function GET(req: NextRequest) {
  const productKey = req.nextUrl.searchParams.get("product") ?? "herbiotic";
  const product    = EBOOK_PRODUCTS[productKey];
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  try {
    const token  = await getShopifyToken();
    const orders = await fetchOrdersForProduct(token, product.shopifyKeyword);

    const sent    = await prisma.ebookSend.findMany({ where: { productKey } });
    const sentMap = new Map(sent.map((s) => [s.shopifyOrderId, s]));

    const result = [];
    for (const order of orders) {
      const detectedEbooks = detectEbooks(order.line_items ?? [], product);
      if (detectedEbooks.length === 0) continue; // skip orders sin ebooks

      const email    = order.email ?? order.customer?.email ?? "";
      const nombre   = order.customer?.first_name ?? "";
      const orderId  = String(order.id);
      const existing = sentMap.get(orderId);

      result.push({
        shopifyOrderId: orderId,
        orderNumber:    `#${order.order_number}`,
        customerEmail:  email,
        customerName:   nombre,
        ebookCount:     detectedEbooks.length,
        status:   existing?.status   ?? "pending",
        sentAt:   existing?.sentAt   ?? null,
        errorMsg: existing?.errorMsg ?? null,
        createdAt: order.created_at,
      });
    }

    result.sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({
      ok: true,
      productKey,
      productName: product.name,
      summary: {
        total:   result.length,
        pending: result.filter((r) => r.status === "pending").length,
        sent:    result.filter((r) => r.status === "sent").length,
        error:   result.filter((r) => r.status === "error").length,
      },
      orders: result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST /api/ebooks — enviar ─────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productKey = "herbiotic", shopifyOrderId, sendAll } = body as {
      productKey?: string;
      shopifyOrderId?: string;
      sendAll?: boolean;
    };

    const product = EBOOK_PRODUCTS[productKey];
    if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

    createTransporter(); // verifica credenciales antes de empezar

    const shopifyToken = await getShopifyToken();
    const allOrders    = await fetchOrdersForProduct(shopifyToken, product.shopifyKeyword);

    let toSend = allOrders.filter((o) => detectEbooks(o.line_items ?? [], product).length > 0);

    if (shopifyOrderId) {
      toSend = toSend.filter((o) => String(o.id) === shopifyOrderId);
    } else if (sendAll) {
      const alreadySent = new Set(
        (await prisma.ebookSend.findMany({ where: { productKey, status: "sent" } }))
          .map((s) => s.shopifyOrderId)
      );
      toSend = toSend.filter((o) => !alreadySent.has(String(o.id)));
    }

    if (toSend.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "Sin órdenes pendientes" });
    }

    const transporter = createTransporter();
    const fromEmail   = process.env.ZOHO_SMTP_EMAIL!;
    let sent = 0, errors = 0;
    const details: any[] = [];

    for (const order of toSend) {
      const orderId     = String(order.id);
      const email       = order.email ?? order.customer?.email ?? "";
      const nombre      = order.customer?.first_name ?? "";
      const orderNumber = `#${order.order_number}`;
      const ebooksToSend = detectEbooks(order.line_items ?? [], product);
      const ebookCount   = ebooksToSend.length;

      const upsertKey = { shopifyOrderId_productKey: { shopifyOrderId: orderId, productKey } };

      if (!email) {
        await prisma.ebookSend.upsert({
          where:  upsertKey,
          create: { shopifyOrderId: orderId, productKey, orderNumber, customerEmail: "", customerName: nombre, ebookCount, status: "error", errorMsg: "Sin email" },
          update: { status: "error", errorMsg: "Sin email" },
        });
        errors++;
        details.push({ orderNumber, status: "error", reason: "Sin email" });
        continue;
      }

      try {
        // Verificar que los archivos existen
        for (const e of ebooksToSend) {
          if (!fs.existsSync(e.path)) throw new Error(`Archivo no encontrado: ${e.filename}`);
        }

        const { subject, text } = product.buildEmail(nombre, ebookCount);

        await transporter.sendMail({
          from:        `"Equipo Glowmmi" <${fromEmail}>`,
          to:          email,
          subject,
          text,
          attachments: ebooksToSend.map(({ path, filename }) => ({
            filename, path, contentType: "application/pdf",
          })),
        });

        await prisma.ebookSend.upsert({
          where:  upsertKey,
          create: { shopifyOrderId: orderId, productKey, orderNumber, customerEmail: email, customerName: nombre, ebookCount, status: "sent", sentAt: new Date() },
          update: { status: "sent", sentAt: new Date(), errorMsg: null },
        });

        sent++;
        details.push({ orderNumber, email, ebookCount, status: "sent" });
      } catch (err: any) {
        await prisma.ebookSend.upsert({
          where:  upsertKey,
          create: { shopifyOrderId: orderId, productKey, orderNumber, customerEmail: email, customerName: nombre, ebookCount, status: "error", errorMsg: err.message },
          update: { status: "error", errorMsg: err.message },
        });
        errors++;
        details.push({ orderNumber, email, status: "error", reason: err.message });
      }

      if (toSend.length > 1) await new Promise((r) => setTimeout(r, 1000));
    }

    return NextResponse.json({ ok: true, sent, errors, details });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PATCH /api/ebooks — reset errors a pending ────────────────
export async function PATCH(req: NextRequest) {
  const { productKey = "herbiotic" } = await req.json();
  const r = await prisma.ebookSend.updateMany({
    where:  { productKey, status: "error" },
    data:   { status: "pending", errorMsg: null, sentAt: null },
  });
  return NextResponse.json({ ok: true, reset: r.count });
}
