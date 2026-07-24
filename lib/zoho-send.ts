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
  fromEmail: string;
  subject: string | null;
  rfcMessageId?: string | null;
}

/** Envía la respuesta enganchada al hilo del cliente. Lanza error si falla. */
export async function enviarRespuesta(mailbox: string, conv: ConvParaEnviar, texto: string) {
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
