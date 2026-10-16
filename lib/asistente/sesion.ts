// lib/asistente/sesion.ts
// Cookie firmada con HMAC (Web Crypto, funciona en proxy y en rutas).
// La llave sale de ASISTENTE_PIN + ASISTENTE_SECRET: si cambias el PIN,
// todas las sesiones abiertas caducan solas.

export const COOKIE_SESION = "asistente_sesion";
export const DURACION_SEG = 60 * 60 * 24 * 30; // 30 días

const enc = new TextEncoder();

async function llave(): Promise<CryptoKey | null> {
  const pin = process.env.ASISTENTE_PIN;
  if (!pin) return null;
  const secreto = `${pin}:${process.env.ASISTENTE_SECRET ?? "onnexa-asistente"}`;
  return crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function firmar(datos: string): Promise<string | null> {
  const k = await llave();
  if (!k) return null;
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(datos)));
}

export async function crearSesion(): Promise<string | null> {
  const vence = Math.floor(Date.now() / 1000) + DURACION_SEG;
  const firma = await firmar(String(vence));
  return firma ? `${vence}.${firma}` : null;
}

export async function sesionValida(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [vence, firma] = token.split(".");
  if (!vence || !firma || Number(vence) < Date.now() / 1000) return false;
  const esperada = await firmar(vence);
  if (!esperada || esperada.length !== firma.length) return false;
  let dif = 0;
  for (let i = 0; i < firma.length; i++) dif |= firma.charCodeAt(i) ^ esperada.charCodeAt(i);
  return dif === 0;
}

export function pinCorrecto(intento: string): boolean {
  const pin = process.env.ASISTENTE_PIN;
  if (!pin || intento.length !== pin.length) return false;
  let dif = 0;
  for (let i = 0; i < pin.length; i++) dif |= pin.charCodeAt(i) ^ intento.charCodeAt(i);
  return dif === 0;
}
