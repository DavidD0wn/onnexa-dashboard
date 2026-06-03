import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/* ── Token helper ────────────────────────────────────────────── */
async function getAccessToken(config: any): Promise<string> {
  // Usar token guardado si sigue vigente (>60s)
  if (config.accessToken && config.tokenExpiry) {
    const remaining = new Date(config.tokenExpiry).getTime() - Date.now();
    if (remaining > 60_000) return config.accessToken;
  }

  const res = await fetch(`${config.authDomain}/oauth/v2/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: config.refreshToken,
      grant_type:    "refresh_token",
      client_id:     process.env.ZOHO_CLIENT_ID ?? "",
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    }).toString(),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("Token refresh falló: " + JSON.stringify(data));

  const tokenExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);
  await prisma.zohoBotConfig.update({
    where: { id: config.id },
    data:  { accessToken: data.access_token, tokenExpiry },
  });

  return data.access_token;
}

/* ── Inbox folder ID ─────────────────────────────────────────── */
async function getInboxFolderId(config: any, token: string): Promise<string> {
  if (config.inboxFolderId) return config.inboxFolderId;

  const res  = await fetch(`${config.apiDomain}/api/accounts/${config.accountId}/folders`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const data = await res.json();

  const inbox = (data.data ?? []).find((f: any) =>
    f.folderName?.toLowerCase() === "inbox" ||
    f.path?.toLowerCase()?.endsWith("inbox") ||
    f.folderType?.toLowerCase() === "inbox"
  );

  if (!inbox) throw new Error("Carpeta Inbox no encontrada en Zoho Mail");

  await prisma.zohoBotConfig.update({
    where: { id: config.id },
    data:  { inboxFolderId: inbox.folderId },
  });

  return inbox.folderId;
}

/* ── Listar mensajes del inbox ───────────────────────────────── */
async function fetchMessages(config: any, token: string, folderId: string) {
  const res = await fetch(
    `${config.apiDomain}/api/accounts/${config.accountId}/folders/${folderId}/messages/view?limit=50&start=0&sortorder=desc`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  const data = await res.json();
  return (data.data ?? []) as any[];
}

/* ── Contenido completo del mensaje ─────────────────────────── */
async function getContent(config: any, token: string, folderId: string, messageId: string): Promise<string> {
  const res = await fetch(
    `${config.apiDomain}/api/accounts/${config.accountId}/folders/${folderId}/messages/${messageId}/content`,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } }
  );
  const data = await res.json();
  const raw  = data.data?.content ?? data.data?.summary ?? "";
  return stripHtml(raw);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

/* ── Enviar respuesta ────────────────────────────────────────── */
async function sendReply(config: any, token: string, msg: any, replyText: string) {
  const subject = msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject ?? ""}`;

  const res = await fetch(
    `${config.apiDomain}/api/accounts/${config.accountId}/messages`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fromAddress: config.emailAddress,
        toAddress:   msg.fromAddress,
        subject,
        content:     replyText,
        mailFormat:  "plaintext",
        inReplyTo:   msg.messageId,
      }),
    }
  );
  const data = await res.json();
  if (data.status?.code !== 200 && data.status?.code !== 201) {
    throw new Error("Zoho send error: " + JSON.stringify(data));
  }
}

/* ── Marcar como leído ───────────────────────────────────────── */
async function markAsRead(config: any, token: string, messageId: string) {
  await fetch(
    `${config.apiDomain}/api/accounts/${config.accountId}/updatemessage`,
    {
      method:  "PUT",
      headers: {
        Authorization:  `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "markAsRead", messageId: [messageId] }),
    }
  );
}

/* ── matchRule ───────────────────────────────────────────────── */
async function matchRule(configId: string, text: string) {
  const rules = await prisma.zohoBotRule.findMany({
    where:   { configId, isActive: true },
    orderBy: { priority: "desc" },
  });

  const lower  = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = text.trim().split(/\s+/);
  const looksLikeTracking = tokens.some(
    (t) =>
      (/^[A-Z0-9]{8,}$/i.test(t) && (t.match(/\d/g) ?? []).length >= 2) ||
      /^\d{8,}$/.test(t)
  );

  for (const rule of rules) {
    const keywords: string[] = JSON.parse(rule.keywords);
    if (keywords.includes("__TRACKING_NUMBER__")) {
      if (looksLikeTracking) return rule;
      continue;
    }
    const hit = keywords.some((kw) => {
      const k = kw.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      return lower.includes(k);
    });
    if (hit) return rule;
  }
  return null;
}

function buildResponse(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/* ── GET /api/automatizaciones/zoho/process ─────────────────── */
export async function GET() {
  try {
    const configs = await prisma.zohoBotConfig.findMany();
    if (configs.length === 0) {
      return NextResponse.json({ error: "Sin configuración Zoho" }, { status: 404 });
    }

    const results = [];

    for (const config of configs) {
      let processed = 0, replied = 0, skipped = 0, errors = 0;

      try {
        const token      = await getAccessToken(config);
        const folderId   = await getInboxFolderId(config, token);
        const messages   = await fetchMessages(config, token, folderId);

        for (const msg of messages) {
          // Saltar mensajes ya procesados
          const exists = await prisma.zohoConversation.findUnique({
            where: { messageId: msg.messageId },
          });
          if (exists) continue;

          // Saltar nuestros propios correos (evitar loop)
          if (msg.fromAddress === config.emailAddress) continue;

          // Solo procesar correos no leídos
          const unread = msg.status === "0" || msg.status === 0;
          if (!unread) continue;

          processed++;

          /* Obtener contenido ───────────────── */
          let content = "";
          try {
            content = await getContent(config, token, msg.folderId ?? folderId, msg.messageId);
          } catch {
            content = stripHtml(msg.summary ?? "");
          }

          const fullText = `${msg.subject ?? ""} ${content}`.trim();

          /* Buscar regla ────────────────────── */
          const matched = config.autoReplyEnabled
            ? await matchRule(config.id, fullText)
            : null;

          const isEscalation =
            matched?.name?.startsWith("🚨") || matched?.name?.startsWith("⚠️");

          if (!matched) {
            await prisma.zohoConversation.create({
              data: {
                configId:    config.id,
                messageId:   msg.messageId,
                fromEmail:   msg.fromAddress,
                fromName:    msg.displayName ?? null,
                subject:     msg.subject ?? "(sin asunto)",
                inboundText: fullText,
                status: config.autoReplyEnabled ? "needs_attention" : "skipped",
              },
            });
            skipped++;
            continue;
          }

          /* Construir respuesta ─────────────── */
          const reply = buildResponse(matched.response, {
            nombre: msg.displayName ?? "amig@",
          });

          /* Guardar ANTES de enviar ─────────── */
          const conv = await prisma.zohoConversation.create({
            data: {
              configId:    config.id,
              messageId:   msg.messageId,
              fromEmail:   msg.fromAddress,
              fromName:    msg.displayName ?? null,
              subject:     msg.subject ?? "(sin asunto)",
              inboundText: fullText,
              outboundText: reply,
              ruleMatched: matched.name,
              status:      "pending",
            },
          });

          try {
            await sendReply(config, token, msg, reply);
            await markAsRead(config, token, msg.messageId);

            await prisma.zohoBotRule.update({
              where: { id: matched.id },
              data:  { matchCount: { increment: 1 } },
            });

            await prisma.zohoConversation.update({
              where: { id: conv.id },
              data:  { status: isEscalation ? "escalated" : "replied" },
            });

            replied++;
          } catch (err: any) {
            await prisma.zohoConversation.update({
              where: { id: conv.id },
              data:  { status: "error", errorMsg: err.message },
            });
            errors++;
          }
        }

        await prisma.zohoBotConfig.update({
          where: { id: config.id },
          data:  { lastSyncAt: new Date() },
        });

        results.push({ email: config.emailAddress, processed, replied, skipped, errors });
      } catch (err: any) {
        results.push({ email: config.emailAddress, error: err.message });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
