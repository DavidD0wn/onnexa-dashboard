// lib/asistente/config.ts
// Ajustes del asistente guardados en Neon (tabla AsistenteConfig, clave/valor):
//  - notion_token: la llave de Notion que se pega en Automatizaciones → Asistente de voz.
//    Funciona al instante, sin volver a publicar. Respaldo: NOTION_TOKEN de Vercel.
//  - notion_roles: qué tabla es ideas/tareas/proyectos (se descubre una vez y se recuerda,
//    porque recorrer E-COMMERCE completo tarda más de un minuto).
import { prisma } from "@/lib/prisma";

const CLAVE_TOKEN = "notion_token";
const CLAVE_ROLES = "notion_roles";

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
  // Llave nueva = quizá otro Notion: los roles recordados ya no valen.
  await prisma.asistenteConfig.deleteMany({ where: { clave: CLAVE_ROLES } });
  cache = { token, hasta: Date.now() + 60 * 1000 };
}

// Lo que Mafis le enseña al asistente ("recuerda que…"): se suma a las reglas en cada turno.
const CLAVE_APRENDIZAJES = "aprendizajes";
const MAX_APRENDIZAJES = 50; // shortcut: lista plana con tope; si crece mucho, resumirla o pasar a una tabla

export async function leerAprendizajes(): Promise<string[]> {
  const fila = await prisma.asistenteConfig.findUnique({ where: { clave: CLAVE_APRENDIZAJES } });
  try {
    return fila ? JSON.parse(fila.valor) : [];
  } catch {
    return [];
  }
}

export async function guardarAprendizaje(texto: string): Promise<void> {
  const lista = [...(await leerAprendizajes()), texto.trim().slice(0, 500)].slice(-MAX_APRENDIZAJES);
  const valor = JSON.stringify(lista);
  await prisma.asistenteConfig.upsert({ where: { clave: CLAVE_APRENDIZAJES }, create: { clave: CLAVE_APRENDIZAJES, valor }, update: { valor } });
}

export async function leerRolesGuardados(): Promise<Record<string, string>> {
  const fila = await prisma.asistenteConfig.findUnique({ where: { clave: CLAVE_ROLES } });
  try {
    return fila ? JSON.parse(fila.valor) : {};
  } catch {
    return {};
  }
}

export async function guardarRoles(roles: Record<string, string>): Promise<void> {
  const valor = JSON.stringify(roles);
  await prisma.asistenteConfig.upsert({
    where: { clave: CLAVE_ROLES },
    create: { clave: CLAVE_ROLES, valor },
    update: { valor },
  });
}
