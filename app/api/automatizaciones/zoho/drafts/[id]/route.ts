// app/api/automatizaciones/zoho/drafts/[id]/route.ts
// ── Acciones sobre un borrador: aprobar+enviar, editar, o descartar ──
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";


// Transporters reutilizables (uno por buzón). Antes se creaba uno NUEVO por
// cada envío y no se cerraba: al aprobar muchos borradores seguidos se
// acumulaban conexiones a Zoho y el servidor se saturaba/caía.
// Con pool: reusa una sola conexión y limita el ritmo (rateLimit correos/rateDelta).
const transporters: Record<string, nodemailer.Transporter> = {};
function getPooledTransporter(user: string, pass: string): nodemailer.Transporter {
  if (!transporters[user]) {
    transporters[user] = nodemailer.createTransport({
      host: "smtp.zoho.com", port: 465, secure: true,
      auth: { user, pass },
      pool: true,
      maxConnections: 1,     // una sola conexión reutilizada
      maxMessages: 50,
      rateDelta: 1000,       // ventana de 1 s
      rateLimit: 1,          // máx 1 correo por segundo (respeta a Zoho)
    });
  }
  return transporters[user];
}

// Resuelve el remitente + contraseña SMTP según la marca del buzón.
// Glowmmi ya está en el .env; Balancea requiere ZOHO_SMTP_PASSWORD_BALANCEA.
function smtpFor(email: string): { user: string; pass: string; name: string } {
  const isGlowmmi = /glowmmi/i.test(email);
  if (isGlowmmi) {
    return {
      user: process.env.ZOHO_SMTP_EMAIL    ?? "contact@glowmmi.store",
      pass: process.env.ZOHO_SMTP_PASSWORD ?? "",
      name: "Glowmmi",
    };
  }
  return {
    user: process.env.ZOHO_SMTP_EMAIL_BALANCEA    ?? "contact@balanceaa.store",
    pass: process.env.ZOHO_SMTP_PASSWORD_BALANCEA ?? "",
    name: "Balancea",
  };
}

// PATCH: editar el texto del borrador sin enviar
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const conv = await prisma.zohoConversation.update({
    where: { id },
    data:  { aiDraft: String(body.aiDraft ?? "") },
  });
  return NextResponse.json({ ok: true, conv });
}

// DELETE: descartar el borrador (lo oculta, no lo borra — queda para auditoría)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.zohoConversation.update({
    where: { id },
    data:  { hidden: true, status: "discarded" },
  });
  return NextResponse.json({ ok: true });
}

// POST: aprobar y ENVIAR el borrador (opcionalmente con texto editado en body.text)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const conv = await prisma.zohoConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Borrador no encontrado" }, { status: 404 });

  const text = String(body.text ?? conv.aiDraft ?? "").trim();
  if (!text) return NextResponse.json({ error: "El borrador está vacío" }, { status: 400 });

  const mailbox = await mailboxOf(conv.configId);
  const smtp = smtpFor(mailbox);
  if (!smtp.pass) {
    return NextResponse.json({
      error: `Falta la contraseña SMTP de ${smtp.name} en el .env (ZOHO_SMTP_PASSWORD${smtp.name === "Balancea" ? "_BALANCEA" : ""}).`,
    }, { status: 400 });
  }

  const transporter = getPooledTransporter(smtp.user, smtp.pass);

  const subject = conv.subject?.startsWith("Re:") ? conv.subject : `Re: ${conv.subject ?? ""}`;

  // Enganchar al hilo del cliente: usar el Message-ID REAL del correo
  // (conv.messageId es el ID interno de Zoho y NO agrupa el hilo).
  const threadHeaders = (conv as any).rfcMessageId
    ? { inReplyTo: (conv as any).rfcMessageId, references: (conv as any).rfcMessageId }
    : {};

  try {
    await transporter.sendMail({
      from:       `"${smtp.name}" <${smtp.user}>`,
      to:         conv.fromEmail,
      subject,
      text,
      ...threadHeaders,
    });
  } catch (e: any) {
    await prisma.zohoConversation.update({
      where: { id },
      data:  { status: "error", errorMsg: e.message },
    });
    return NextResponse.json({ error: `No se pudo enviar: ${e.message}` }, { status: 500 });
  }

  const updated = await prisma.zohoConversation.update({
    where: { id },
    data:  { status: "replied", outboundText: text },
  });

  return NextResponse.json({ ok: true, conv: updated });
}

// Obtiene el correo del buzón (config) para saber la marca
async function mailboxOf(configId: string): Promise<string> {
  const cfg = await prisma.zohoBotConfig.findUnique({ where: { id: configId }, select: { emailAddress: true } });
  return cfg?.emailAddress ?? "";
}
