// lib/asistente/errores.ts
// Los mensajes de error llegan a la pantalla (sin PIN, cualquiera con la URL los ve):
// nunca deben llevar llaves. Se tachan las de Groq, Notion y cualquier "Bearer ...".

const PATRONES = [/gsk_[A-Za-z0-9]+/g, /ntn_[A-Za-z0-9]+/g, /secret_[A-Za-z0-9]+/g, /Bearer\s+\S+/gi];

export function mensajeSeguro(e: unknown): string {
  let m = e instanceof Error ? e.message : String(e);
  for (const p of PATRONES) m = m.replace(p, "[oculto]");
  return m.slice(0, 300);
}
