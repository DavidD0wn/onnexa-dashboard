// lib/asistente/config.ts
// La llave de Notion se pega desde Automatizaciones → Asistente de voz y se guarda
// en Neon (tabla AsistenteConfig), así funciona al instante, sin volver a publicar.
// Si no hay llave guardada, se usa NOTION_TOKEN de Vercel como respaldo.
import { prisma } from "@/lib/prisma";

const CLAVE_TOKEN = "notion_token";

let cache: { token: string | null; hasta: number } | null = null;

export async function leerTokenNotion(): Promise<string | null> {
  if (cache && cache.hasta > Date.now()) return cache.token;
  const fila = await prisma.asistenteConfig.findUnique({ where: { clave: CLAVE_TOKEN } });
  const token = fila?.valor || process.env.NOTION_TOKEN || null;
  cache = { token, hasta: Date.now() + 60 * 1000 };
  return token;
}

export async function guardarTokenNotion(token: string): Promise<void> {
  await prisma.asistenteConfig.upsert({
    where: { clave: CLAVE_TOKEN },
    create: { clave: CLAVE_TOKEN, valor: token },
    update: { valor: token },
  });
  cache = { token, hasta: Date.now() + 60 * 1000 };
}
