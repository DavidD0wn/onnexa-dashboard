// app/api/automatizaciones/zoho/drafts/[id]/route.ts
// ── Acciones sobre un borrador: aprobar+enviar, editar, o descartar ──
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enviarRespuesta } from "@/lib/zoho-send";

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
  if (conv.hidden || !["draft", "escalated", "needs_attention", "error"].includes(conv.status)) {
    return NextResponse.json({ error: "Este correo ya no está pendiente de envío" }, { status: 409 });
  }

  const text = String(body.text ?? conv.aiDraft ?? "").trim();
  if (!text) return NextResponse.json({ error: "El borrador está vacío" }, { status: 400 });

  const mailbox = await mailboxOf(conv.configId);

  // Sacarlo de "draft" antes del envío evita duplicados si Zoho acepta el
  // correo y la escritura posterior en la base de datos falla.
  const reserved = await prisma.zohoConversation.updateMany({
    where: { id, hidden: false, status: { in: ["draft", "escalated", "needs_attention", "error"] } },
    data: { status: "sending", errorMsg: null },
  });
  if (reserved.count !== 1) {
    return NextResponse.json({ error: "Este correo ya está en proceso o fue enviado" }, { status: 409 });
  }

  try {
    // Misma implementación que el envío masivo (engancha el hilo con el Message-ID real)
    await enviarRespuesta(mailbox, conv, text);
  } catch (e: any) {
    await prisma.zohoConversation.update({
      where: { id },
      data:  { status: "error", errorMsg: e.message },
    });
    return NextResponse.json({ error: `No se pudo enviar: ${e.message}` }, { status: 500 });
  }

  let updated;
  try {
    updated = await prisma.zohoConversation.update({
      where: { id },
      data: { status: "replied", outboundText: text, errorMsg: null },
    });
  } catch (e: any) {
    const msg = `Correo enviado; registro pendiente: ${String(e?.message ?? "error")}`.slice(0, 300);
    updated = await prisma.zohoConversation.update({
      where: { id },
      data: { status: "sent_unrecorded", outboundText: text, errorMsg: msg },
    });
  }

  return NextResponse.json({ ok: true, conv: updated });
}

// Obtiene el correo del buzón (config) para saber la marca
async function mailboxOf(configId: string): Promise<string> {
  const cfg = await prisma.zohoBotConfig.findUnique({ where: { id: configId }, select: { emailAddress: true } });
  return cfg?.emailAddress ?? "";
}
