// lib/zoho-send.ts
// ─────────────────────────────────────────────────────────────────────────────
// Envío de respuestas por Zoho SMTP — implementación ÚNICA usada por el envío
// individual y el masivo (para que no se desincronicen).
//
// Claves:
//  • Transporter con POOL reutilizado por buzón (antes se creaba uno por correo
//    y las conexiones se acumulaban hasta tumbar la app).
//  • rateLimit 1 correo/seg → nunca satura a Zoho.
//  • In-Reply-To / References con el Message-ID REAL → la respuesta se engancha
//    al hilo del cliente en vez de llegar como correo suelto.
// ─────────────────────────────────────────────────────────────────────────────
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";

export function smtpFor(mailbox: string): { user: string; pass: string; name: string } {
  const isGlowmmi = /glowmmi/i.test(mailbox);
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

const transporters: Record<string, nodemailer.Transporter> = {};
export function getPooledTransporter(user: string, pass: string): nodemailer.Transporter {
  if (!transporters[user]) {
    transporters[user] = nodemailer.createTransport({
      host: "smtp.zoho.com", port: 465, secure: true,
      auth: { user, pass },
      pool: true,
      maxConnections: 1,
      maxMessages: 50,
      rateDelta: 1000,
      rateLimit: 1,
    });
  }
  return transporters[user];
}

export interface ConvParaEnviar {
  messageId?: string;
  fromEmail: string;
  subject: string | null;
  rfcMessageId?: string | null;
}

async function tokenOAuth(config: any): Promise<string> {
  if (config.accessToken && config.tokenExpiry) {
    const remaining = new Date(config.tokenExpiry).getTime() - Date.now();
    if (remaining > 60_000) return config.accessToken;
  }

  const response = await fetch(`${config.authDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID ?? "",
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error("Zoho no pudo renovar la autorización del buzón.");
  }

  const tokenExpiry = new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000);
  await prisma.zohoBotConfig.update({
    where: { id: config.id },
    data: { accessToken: data.access_token, tokenExpiry },
  });
  return data.access_token;
}

async function enviarConOAuth(mailbox: string, conv: ConvParaEnviar, texto: string): Promise<boolean> {
  if (!conv.messageId) return false;
  const config = await prisma.zohoBotConfig.findFirst({ where: { emailAddress: mailbox } });
  if (!config) return false;

  const token = await tokenOAuth(config);
  const subject = conv.subject?.startsWith("Re:") ? conv.subject : `Re: ${conv.subject ?? ""}`;
  const response = await fetch(
    `${config.apiDomain}/api/accounts/${config.accountId}/messages/${conv.messageId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        fromAddress: mailbox,
        toAddress: conv.fromEmail,
        subject,
        content: texto,
        mailFormat: "plaintext",
        action: "reply",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Zoho rechazó la respuesta por API (${response.status}).`);
  }
  return true;
}

/** Envía la respuesta enganchada al hilo del cliente. Lanza error si falla. */
export async function enviarRespuesta(mailbox: string, conv: ConvParaEnviar, texto: string) {
  // La cuenta ya está autorizada por OAuth. Es el canal principal porque no
  // depende de una contraseña SMTP y responde sobre el mensaje original.
  if (await enviarConOAuth(mailbox, conv, texto)) return;

  // Respaldo para instalaciones antiguas que todavía no guardan messageId.
  const smtp = smtpFor(mailbox);
  if (!smtp.pass) {
    throw new Error(
      `Falta la contraseña SMTP de ${smtp.name} en el .env ` +
      `(ZOHO_SMTP_PASSWORD${smtp.name === "Balancea" ? "_BALANCEA" : ""}).`
    );
  }

  const transporter = getPooledTransporter(smtp.user, smtp.pass);
  const subject = conv.subject?.startsWith("Re:") ? conv.subject : `Re: ${conv.subject ?? ""}`;

  // Sin Message-ID real no se puede enganchar el hilo: se envía igual, pero suelto.
  const thread = conv.rfcMessageId
    ? { inReplyTo: conv.rfcMessageId, references: conv.rfcMessageId }
    : {};

  await transporter.sendMail({
    from: `"${smtp.name}" <${smtp.user}>`,
    to:   conv.fromEmail,
    subject,
    text: texto,
    ...thread,
  });
}
