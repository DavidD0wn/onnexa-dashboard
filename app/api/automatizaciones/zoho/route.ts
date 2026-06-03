import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CLIENT_ID    = process.env.ZOHO_CLIENT_ID ?? "";
const REDIRECT_URI = process.env.ZOHO_REDIRECT_URI ?? "http://localhost:3000/api/auth/zoho/callback";

const AUTH_URL =
  `https://accounts.zoho.com/oauth/v2/auth` +
  `?scope=ZohoMail.messages.ALL,ZohoMail.accounts.READ` +
  `&client_id=${CLIENT_ID}` +
  `&response_type=code` +
  `&access_type=offline` +
  `&prompt=consent` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

export async function GET() {
  const config = await prisma.zohoBotConfig.findFirst();

  return NextResponse.json({
    connected: !!config,
    authUrl:   AUTH_URL,
    config: config
      ? {
          id:               config.id,
          emailAddress:     config.emailAddress,
          displayName:      config.displayName,
          autoReplyEnabled: config.autoReplyEnabled,
          lastSyncAt:       config.lastSyncAt,
        }
      : null,
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
