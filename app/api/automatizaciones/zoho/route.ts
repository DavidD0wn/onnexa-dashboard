import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


const CLIENT_ID    = process.env.ZOHO_CLIENT_ID ?? "";
const REDIRECT_URI = process.env.ZOHO_REDIRECT_URI ?? "http://localhost:3000/api/auth/zoho/callback";

const AUTH_URL =
  `https://accounts.zoho.com/oauth/v2/auth` +
  `?scope=ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.ALL` +
  `&client_id=${CLIENT_ID}` +
  `&response_type=code` +
  `&access_type=offline` +
  `&prompt=consent` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

export async function GET() {
  // Devolver TODAS las cuentas conectadas: el bot lee varios buzones
  // (Glowmmi y Balancea) y la UI debe poder mostrarlos todos.
  const all = await prisma.zohoBotConfig.findMany({ orderBy: { createdAt: "asc" } });

  const shape = (c: (typeof all)[number]) => ({
    id:               c.id,
    emailAddress:     c.emailAddress,
    displayName:      c.displayName,
    autoReplyEnabled: c.autoReplyEnabled,
    lastSyncAt:       c.lastSyncAt,
    brand:            /glowmmi/i.test(c.emailAddress) ? "Glowmmi" : "Balancea",
  });

  return NextResponse.json({
    connected: all.length > 0,
    authUrl:   AUTH_URL,
    configs:   all.map(shape),
    // `config` se mantiene por compatibilidad con la UI existente
    config:    all.length ? shape(all[0]) : null,
  });
}

export async function PUT(req: NextRequest) {
  const { autoReplyEnabled } = await req.json();
  const config = await prisma.zohoBotConfig.findFirst();
  if (!config) return NextResponse.json({ error: "Sin config" }, { status: 404 });

  const updated = await prisma.zohoBotConfig.update({
    where: { id: config.id },
    data:  { autoReplyEnabled },
  });
  return NextResponse.json({ ok: true, autoReplyEnabled: updated.autoReplyEnabled });
}

export async function DELETE() {
  const config = await prisma.zohoBotConfig.findFirst();
  if (!config) return NextResponse.json({ error: "Sin config" }, { status: 404 });

  await prisma.zohoConversation.deleteMany({ where: { configId: config.id } });
  await prisma.zohoBotRule.deleteMany({ where: { configId: config.id } });
  await prisma.zohoBotConfig.delete({ where: { id: config.id } });

  return NextResponse.json({ ok: true });
}
