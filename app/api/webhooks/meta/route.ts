import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";

/* ── GET — verificación del webhook ──────────────────────────── */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/* ── POST — eventos de Meta ──────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const object = body.object;

    for (const entry of body.entry ?? []) {
      // Identificar la página/cuenta que recibió el evento
      const entryPageId = entry.id as string | undefined;

      // Buscar config por pageId (Facebook) o igAccountId (Instagram)
      const config = entryPageId
        ? await prisma.metaBotConfig.findFirst({
            where: {
              OR: [
                { pageId:      entryPageId },
                { igAccountId: entryPageId },
              ],
            },
          })
        : null;

      if (!config) {
        console.warn(`[Meta Webhook] Sin config para pageId/igId: ${entryPageId} — ignorado`);
        continue;
      }

      // DMs Instagram
      if (object === "instagram" && entry.messaging) {
        for (const msg of entry.messaging) {
          if (!msg.message?.text || msg.message.is_echo) continue;
          if (!config.replyToDMs) continue;
          await handleInbound({ config, platform: "instagram", type: "dm",
            senderId: msg.sender.id, senderName: null,
            inboundText: msg.message.text, threadId: msg.sender.id,
            rawPayload: JSON.stringify(msg) });
        }
      }
      // Comentarios Instagram
      if (object === "instagram" && entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== "comments") continue;
          if (!config.replyToComments) continue;
          const v = change.value;
          if (!v?.text) continue;
          await handleInbound({ config, platform: "instagram", type: "comment",
            senderId: v.from?.id ?? "unknown", senderName: v.from?.username ?? null,
            inboundText: v.text, commentId: v.id, postId: v.media?.id ?? null,
            rawPayload: JSON.stringify(v) });
        }
      }
      // DMs Facebook
      if (object === "page" && entry.messaging) {
        for (const msg of entry.messaging) {
          if (!msg.message?.text || msg.message.is_echo) continue;
          if (!config.replyToDMs) continue;
          await handleInbound({ config, platform: "facebook", type: "dm",
            senderId: msg.sender.id, senderName: null,
            inboundText: msg.message.text, threadId: msg.sender.id,
            rawPayload: JSON.stringify(msg) });
        }
      }
      // Comentarios Facebook
      if (object === "page" && entry.changes) {
        for (const change of entry.changes) {
          if (change.field !== "feed") continue;
          const v = change.value;
          if (v?.item !== "comment" || !v?.message) continue;
          if (!config.replyToComments) continue;
          await handleInbound({ config, platform: "facebook", type: "comment",
            senderId: v.from?.id ?? "unknown", senderName: v.from?.name ?? null,
            inboundText: v.message, commentId: v.comment_id, postId: v.post_id ?? null,
            rawPayload: JSON.stringify(v) });
        }
      }
    }
    return NextResponse.json({ status: "ok" });
  } catch (err: any) {
    console.error("[Meta Webhook]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/* ── handleInbound ───────────────────────────────────────────── */
interface InboundParams {
  config:      any;
  platform:    "instagram" | "facebook";
  type:        "comment" | "dm";
  senderId:    string;
  senderName:  string | null;
  inboundText: string;
  commentId?:  string | null;
  postId?:     string | null;
  threadId?:   string | null;
  rawPayload?: string;
}

async function handleInbound(p: InboundParams) {
  const conv = await prisma.metaConversation.create({
    data: {
      configId:    p.config.id,
      platform:    p.platform,
      type:        p.type,
      senderId:    p.senderId,
      senderName:  p.senderName,
      inboundText: p.inboundText,
      commentId:   p.commentId,
      postId:      p.postId,
      threadId:    p.threadId,
      rawPayload:  p.rawPayload,
      status:      "pending",
    },
  });

  if (!p.config.autoReplyEnabled || !p.config.pageAccessToken) {
    await prisma.metaConversation.update({ where: { id: conv.id }, data: { status: "skipped" } });
    return;
  }

  // Buscar regla que aplique
  const matched = await matchRule(p.config.id, p.inboundText);

  if (!matched) {
    // Sin regla → necesita atención manual
    await prisma.metaConversation.update({ where: { id: conv.id }, data: { status: "needs_attention" } });
    return;
  }

  // Reglas de alerta → responde Y marca para revisión manual
  const isEscalation = matched.name.startsWith("🚨") || matched.name.startsWith("⚠️");

  // Construir respuesta con variables
  const reply = buildResponse(matched.response, {
    nombre:     p.senderName ?? "amig@",
    plataforma: p.platform,
  });

  // Guardar regla y respuesta ANTES de enviar (para que siempre quede registrado)
  await prisma.metaConversation.update({
    where: { id: conv.id },
    data:  { ruleMatched: matched.name, outboundText: reply },
  });

  try {
    // Enviar a Meta
    await sendReply({ config: p.config, platform: p.platform, type: p.type,
      senderId: p.senderId, commentId: p.commentId, threadId: p.threadId, replyText: reply });

    // Actualizar stats de la regla
    await prisma.metaBotRule.update({
      where: { id: matched.id },
      data:  { matchCount: { increment: 1 } },
    });

    await prisma.metaConversation.update({
      where: { id: conv.id },
      data:  { status: isEscalation ? "escalated" : "replied" },
    });
  } catch (err: any) {
    // Graph API falló (ej: ID de prueba inválido) — igual guardamos la respuesta generada
    await prisma.metaConversation.update({
      where: { id: conv.id },
      data:  { status: "error", errorMsg: err.message },
    });
  }
}

/* ── matchRule — busca la regla con mayor prioridad ─────────── */
async function matchRule(configId: string, text: string) {
  const rules = await prisma.metaBotRule.findMany({
    where:   { configId, isActive: true },
    orderBy: { priority: "desc" },
  });

  const lower = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Detectar si el mensaje parece un número de guía:
  // Debe tener al menos 8 caracteres Y contener mínimo 2 dígitos (ej: TN123456789MX, 123456789)
  // Esto evita que palabras normales como "disponible" hagan match
  const tokens = text.trim().split(/\s+/);
  const looksLikeTracking = tokens.some(t =>
    (/^[A-Z0-9]{8,}$/i.test(t) && (t.match(/\d/g) ?? []).length >= 2) ||
    /^\d{8,}$/.test(t)
  );

  for (const rule of rules) {
    // Regla especial con keyword "__TRACKING_NUMBER__" → solo activa si parece guía
    const keywords: string[] = JSON.parse(rule.keywords);
    if (keywords.includes("__TRACKING_NUMBER__")) {
      if (looksLikeTracking) return rule;
      continue;
    }

    const hit = keywords.some(kw => {
      const k = kw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      return lower.includes(k);
    });
    if (hit) return rule;
  }
  return null;
}

/* ── buildResponse — reemplaza variables en la plantilla ─────── */
function buildResponse(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/* ── sendReply — Graph API ───────────────────────────────────── */
async function sendReply(opts: {
  config: any; platform: string; type: string;
  senderId: string; commentId?: string | null; threadId?: string | null; replyText: string;
}) {
  const token = opts.config.pageAccessToken;
  let url: string;
  let bodyData: Record<string, string>;

  if (opts.type === "comment" && opts.commentId) {
    url      = `https://graph.facebook.com/v19.0/${opts.commentId}/replies`;
    bodyData = { message: opts.replyText, access_token: token };
  } else {
    url      = `https://graph.facebook.com/v19.0/me/messages`;
    bodyData = {
      recipient:    JSON.stringify({ id: opts.senderId }),
      message:      JSON.stringify({ text: opts.replyText }),
      access_token: token,
    };
  }

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(bodyData),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API: ${err}`);
  }
}
