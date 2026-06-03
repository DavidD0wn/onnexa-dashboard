import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ── GET — leer config ───────────────────────────────────────── */
export async function GET() {
  const config = await prisma.metaBotConfig.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!config) {
    // Devolver defaults vacíos
    return NextResponse.json({
      id:              null,
      platform:        "both",
      pageId:          "",
      pageAccessToken: "",
      igAccountId:     "",
      autoReplyEnabled: false,
      replyToComments:  true,
      replyToDMs:       true,
      systemPrompt:    defaultSystemPrompt(),
      signatureText:   "",
      brandContext:    "",
      appId:           process.env.META_APP_ID ?? "",
      verifyToken:     process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
    });
  }

  return NextResponse.json({
    ...config,
    appId:       process.env.META_APP_ID ?? "",
    verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
  });
}

/* ── POST — guardar config ───────────────────────────────────── */
export async function POST(req: NextRequest) {
  const data = await req.json();

  const existing = await prisma.metaBotConfig.findFirst({
    orderBy: { createdAt: "desc" },
  });

  const payload = {
    platform:         data.platform        ?? "both",
    pageId:           data.pageId          ?? null,
    pageAccessToken:  data.pageAccessToken ?? null,
    igAccountId:      data.igAccountId     ?? null,
    autoReplyEnabled: data.autoReplyEnabled ?? false,
    replyToComments:  data.replyToComments  ?? true,
    replyToDMs:       data.replyToDMs       ?? true,
    systemPrompt:     data.systemPrompt     ?? null,
    signatureText:    data.signatureText    ?? null,
    brandContext:     data.brandContext     ?? null,
  };

  const config = existing
    ? await prisma.metaBotConfig.update({ where: { id: existing.id }, data: payload })
    : await prisma.metaBotConfig.create({ data: payload });

  return NextResponse.json({ ok: true, config });
}

function defaultSystemPrompt() {
  return `Eres una asistente virtual amable y profesional de una tienda de e-commerce.
Tu objetivo es responder preguntas de clientes de forma cálida, honesta y concisa.
Si no sabes la respuesta exacta, ofrece ayudar a conseguirla.
Responde siempre en español, de forma natural y sin ser robótica.`;
}
