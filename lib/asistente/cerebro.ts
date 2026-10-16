// lib/asistente/cerebro.ts
// ─────────────────────────────────────────────────────────────────────────────
// Cerebro del asistente de voz: Groq (mismo modelo que lib/ai-responder.ts, JSON) convierte lo que dice
// Fernanda en acciones, y el Ejecutor las traduce a propiedades reales de Notion.
// Port de asistente-voz-notion/cerebro.py. Sin SDK: endpoint OpenAI-compatible.
// ─────────────────────────────────────────────────────────────────────────────
import { mensajeSeguro } from "./errores";
import * as notion from "@/lib/notion";
import { NotionError, tituloDe, valorLegible, type Json } from "@/lib/notion";
import type { Base, Campo, Mapa } from "./mapa";
import { REGLAS_ASISTENTE } from "./reglas";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// llama-3.3-70b-versatile ya no está disponible para esta llave de Groq (404 model_not_found).
const MODELO = process.env.ASISTENTE_MODELO ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const ZONA = process.env.ASISTENTE_TZ ?? "America/Mexico_City";

export type Accion = {
  tipo: "crear" | "actualizar" | "comentar" | "archivar" | "consultar";
  base: string;
  propiedades?: Json;
  contenido?: string;
  buscar?: string;
  texto?: string;
  filtro?: Json | null;
  limite?: number;
};

export type Plan = {
  respuesta: string;
  pregunta: string | null;
  necesita_confirmacion: boolean;
  acciones: Accion[];
};

export type Turno = { role: "user" | "assistant"; content: string };

const FORMATO_RESPUESTA = `
Responde SIEMPRE con un único objeto JSON con esta forma exacta:
{
  "respuesta": "frase corta y natural que se le dirá en voz alta a la jefa",
  "pregunta": null | "pregunta concreta si falta un dato indispensable",
  "necesita_confirmacion": false | true,
  "acciones": [
    {"tipo": "crear", "base": "<rol de base>", "propiedades": {"<campo>": <valor>}, "contenido": "texto largo opcional para el cuerpo"},
    {"tipo": "actualizar", "base": "<rol de base>", "buscar": "<palabras del título a localizar>", "propiedades": {"<campo>": <valor>}},
    {"tipo": "comentar", "base": "<rol de base>", "buscar": "<título>", "texto": "<nota a agregar>"},
    {"tipo": "archivar", "base": "<rol de base>", "buscar": "<título>"},
    {"tipo": "consultar", "base": "<rol de base>", "filtro": {"<campo>": <valor> | {"distinto": "<opción>"}} | null, "limite": 10}
  ]
}
Reglas de los valores:
- Usa EXACTAMENTE los nombres de campo y las opciones listadas en el esquema. Si la jefa dice algo parecido a una opción, elige la opción más cercana.
- Fechas en formato ISO AAAA-MM-DD. "mañana", "el viernes", "en dos semanas" se calculan a partir de la fecha de hoy indicada.
- Para campos de personas usa el nombre tal como aparece en la lista de personas.
- Si "pregunta" no es null, "acciones" debe ir vacío: primero se pregunta, luego se guarda.
- Para archivar algo o cambiar su responsable NO preguntes "¿confirmas?": emite la acción completa en "acciones". La app le muestra a la jefa un botón de Confirmar antes de ejecutarla.
- "pregunta" es la frase completa y natural que se le dirá (por ejemplo "¿Cómo quieres llamar al proyecto?"), no una etiqueta.
- Si la jefa solo saluda, pide ayuda o pregunta qué puedes hacer, responde sin acciones.
- Nunca inventes campos ni bases que no estén en el esquema.
`;

const CAMPOS_SOLO_LECTURA = new Set(["created_time", "last_edited_time", "created_by", "last_edited_by", "formula", "rollup", "unique_id"]);

function hoy(): string {
  const f = new Date();
  const dia = f.toLocaleDateString("es-MX", { weekday: "long", timeZone: ZONA });
  const iso = f.toLocaleDateString("en-CA", { timeZone: ZONA }); // AAAA-MM-DD
  return `${dia} ${iso}`;
}

function describirEsquema(m: Mapa): string {
  const lineas: string[] = [];
  const porId = Object.fromEntries(Object.entries(m.roles).map(([r, id]) => [id, r]));
  for (const [id, esq] of Object.entries(m.bases)) {
    const rol = porId[id];
    if (!rol) continue; // solo las bases con rol entran al prompt
    lineas.push(`Base "${rol}" (título real: ${esq.titulo}):`);
    for (const [nombre, c] of Object.entries(esq.campos)) {
      if (CAMPOS_SOLO_LECTURA.has(c.tipo)) continue;
      const extra = c.opciones?.length ? ` opciones: ${c.opciones.join(", ")}` : "";
      const rolCampo = Object.entries(esq.roles_campos).find(([, n]) => n === nombre)?.[0];
      lineas.push(`  - ${nombre} (${c.tipo})${rolCampo ? ` [${rolCampo}]` : ""}${extra}`);
    }
  }
  let personas = m.personas.map((p) => p.nombre).join(", ") || "(ninguna)";
  const alias = Object.entries(m.alias_personas);
  if (alias.length) personas += ". Alias: " + alias.map(([a, n]) => `'${a}' = ${n}`).join(", ");
  lineas.push(`Personas del workspace: ${personas}`);
  lineas.push(`Valores válidos para "base" en las acciones: ${Object.keys(m.roles).join(", ")} (en español, tal cual).`);
  if (!m.roles.delegaciones) lineas.push('No hay base "delegaciones": un encargo a otra persona se guarda como tarea con responsable.');
  return lineas.join("\n");
}

function sistema(m: Mapa): string {
  return (
    "Eres el asistente de voz de María Fernanda Rey (la jefa), dueña de tres tiendas Shopify: " +
    "Glowmmi (skincare), Balancea (salud/suplementos) y Pleena (cuidado capilar). " +
    "Ella te habla en español; tú registras y actualizas su Notion. Sé breve, cálido y concreto: " +
    "tus respuestas se leen en voz alta, así que máximo dos frases, sin listas ni símbolos.\n\n" +
    `Hoy es ${hoy()}.\n\n` +
    "ESQUEMA DE NOTION DISPONIBLE:\n" + describirEsquema(m) + "\n\n" +
    "REGLAS DEL ASISTENTE:\n" + REGLAS_ASISTENTE + "\n\n" + FORMATO_RESPUESTA
  );
}

export async function pensar(m: Mapa, texto: string, historial: Turno[]): Promise<{ plan: Plan; crudo: string }> {
  // En Vercel la variable llegó con la llave repetida en varias líneas: se usa la primera.
  const key = process.env.GROQ_API_KEY?.split(/\s+/).find(Boolean);
  if (!key) throw new Error("Falta GROQ_API_KEY");
  const cuerpo = JSON.stringify({
    model: MODELO,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: sistema(m) }, ...historial.slice(-10), { role: "user", content: texto }],
  });
  let r: Response;
  for (let intento = 0; ; intento++) {
    r = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: cuerpo,
    });
    // Plan gratis: 8k tokens/min compartidos con el bot de correos. Una espera corta suele bastar.
    if (r.status !== 429 || intento >= 1) break;
    const espera = Math.min(8, Number(r.headers.get("retry-after")) || 4);
    await new Promise((res) => setTimeout(res, espera * 1000));
  }
  if (r.status === 429) throw new Error("Groq está saturado en este momento (límite por minuto del plan gratis). Inténtalo en un minuto.");
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const crudo: string = data.choices?.[0]?.message?.content ?? "{}";
  let p: Partial<Plan> = {};
  try {
    p = JSON.parse(crudo);
  } catch {
    const hit = crudo.match(/\{[\s\S]*\}/);
    if (hit) p = JSON.parse(hit[0]);
  }
  return {
    crudo,
    plan: {
      respuesta: p.respuesta ?? "",
      pregunta: p.pregunta ?? null,
      necesita_confirmacion: !!p.necesita_confirmacion,
      acciones: Array.isArray(p.acciones) ? p.acciones : [],
    },
  };
}

// ======================= traducción de valores a Notion =======================
const SINONIMOS_ROL: Record<string, string> = {
  tasks: "tareas", task: "tareas", tarea: "tareas",
  projects: "proyectos", project: "proyectos", proyecto: "proyectos",
  idea: "ideas", notas: "ideas", nota: "ideas", notes: "ideas",
  delegacion: "delegaciones", "delegación": "delegaciones", delegations: "delegaciones",
};

export type Resultado = { texto: string; url?: string; ok: boolean };

export class Ejecutor {
  private porNombre: Record<string, string> = {};

  constructor(private m: Mapa) {
    for (const p of m.personas) this.porNombre[p.nombre.toLowerCase()] = p.id;
    for (const [alias, nombre] of Object.entries(m.alias_personas)) {
      const id = this.porNombre[nombre.toLowerCase()];
      if (id) this.porNombre[alias.toLowerCase()] = id;
    }
  }

  private base(rol: string): [string, Base] {
    const r = (rol ?? "").toLowerCase().trim();
    // El modelo a veces responde con el nombre en inglés o el título real de la tabla.
    const id =
      this.m.roles[r] ??
      this.m.roles[SINONIMOS_ROL[r] ?? ""] ??
      Object.values(this.m.roles).find((bid) => this.m.bases[bid]?.titulo.toLowerCase() === r);
    if (!id) throw new NotionError(`No hay una base configurada para '${rol}'`);
    return [id, this.m.bases[id]];
  }

  private persona(nombre: string): string | null {
    const n = nombre.toLowerCase().trim();
    if (this.porNombre[n]) return this.porNombre[n];
    for (const [k, v] of Object.entries(this.porNombre)) if (n.includes(k) || k.includes(n)) return v; // "fer" → "María Fernanda Rey"
    return null;
  }

  private static opcion(valor: string, opciones: string[] = []): string {
    const v = valor.toLowerCase().trim();
    return (
      opciones.find((o) => o.toLowerCase() === v) ??
      opciones.find((o) => v.includes(o.toLowerCase()) || o.toLowerCase().includes(v)) ??
      valor // Notion crea la opción nueva en select/multi_select
    );
  }

  private async prop(campo: Campo, valor: unknown): Promise<Json | null> {
    const t = campo.tipo;
    if (valor == null || valor === "") return null;
    const s = String(valor);
    switch (t) {
      case "title":
        return { title: [{ text: { content: s.slice(0, 200) } }] };
      case "rich_text":
        return { rich_text: [{ text: { content: s.slice(0, 1900) } }] };
      case "select":
      case "status":
        return { [t]: { name: Ejecutor.opcion(s, campo.opciones) } };
      case "multi_select": {
        const vals = Array.isArray(valor) ? valor.map(String) : s.split(",").map((x) => x.trim());
        return { multi_select: vals.filter(Boolean).map((v) => ({ name: Ejecutor.opcion(v, campo.opciones) })) };
      }
      case "date":
        if (typeof valor === "object" && !Array.isArray(valor)) {
          const d = valor as Json;
          return { date: { start: d.start ?? d.inicio, end: d.end ?? d.fin ?? null } };
        }
        return { date: { start: s } };
      case "people": {
        const nombres = Array.isArray(valor) ? valor : [valor];
        const ids = nombres.map((x) => this.persona(String(x))).filter(Boolean) as string[];
        return ids.length ? { people: ids.map((id) => ({ id })) } : null;
      }
      case "checkbox":
        return { checkbox: typeof valor === "string" ? ["sí", "si", "true", "1", "yes"].includes(valor.toLowerCase()) : !!valor };
      case "number": {
        const n = Number(s.replace(",", "."));
        return Number.isFinite(n) ? { number: n } : null;
      }
      case "url":
        return { url: s };
      case "email":
        return { email: s };
      case "phone_number":
        return { phone_number: s };
      case "relation": {
        const rel = campo.base_relacionada;
        const esqRel = rel ? this.m.bases[rel] : undefined;
        if (!rel || !esqRel) return null;
        const paginas = await notion.buscarPorTitulo(rel, esqRel.campo_titulo, s);
        return paginas.length ? { relation: [{ id: paginas[0].id }] } : null;
      }
      default:
        return null;
    }
  }

  private nombreReal(esq: Base, nombre: string): string | null {
    if (esq.campos[nombre]) return nombre;
    return Object.keys(esq.campos).find((c) => c.toLowerCase() === nombre.toLowerCase()) ?? esq.roles_campos[nombre.toLowerCase()] ?? null;
  }

  private async propiedades(esq: Base, props: Json = {}): Promise<Json> {
    const out: Json = {};
    for (const [nombre, valor] of Object.entries(props)) {
      const real = this.nombreReal(esq, nombre);
      if (!real || CAMPOS_SOLO_LECTURA.has(esq.campos[real].tipo)) continue;
      const p = await this.prop(esq.campos[real], valor);
      if (p) out[real] = p;
    }
    return out;
  }

  private async localizar(id: string, esq: Base, texto = ""): Promise<Json[]> {
    if (!texto) return [];
    let res = await notion.buscarPorTitulo(id, esq.campo_titulo, texto);
    if (!res.length) {
      // intenta con las dos palabras más largas
      for (const palabra of texto.split(/\s+/).sort((a, b) => b.length - a.length).slice(0, 2)) {
        if (palabra.length <= 3) continue;
        res = await notion.buscarPorTitulo(id, esq.campo_titulo, palabra);
        if (res.length) break;
      }
    }
    return res;
  }

  private filtro(esq: Base, filtro?: Json | null): Json | null {
    if (!filtro) return null;
    const partes: Json[] = [];
    for (const [nombre, valor] of Object.entries(filtro)) {
      const real = this.nombreReal(esq, nombre);
      if (!real) continue;
      const c = esq.campos[real];
      const t = c.tipo;
      if (t === "select" || t === "status") {
        // {"distinto": "Completed"} o {"distinto": ["Completed","Archivada"]} → excluye esas opciones
        const excluir = valor && typeof valor === "object" && !Array.isArray(valor) ? ((valor as Json).distinto ?? (valor as Json).no) : null;
        if (excluir != null) {
          for (const x of Array.isArray(excluir) ? excluir : [excluir]) {
            partes.push({ property: real, [t]: { does_not_equal: Ejecutor.opcion(String(x), c.opciones) } });
          }
        } else partes.push({ property: real, [t]: { equals: Ejecutor.opcion(String(valor), c.opciones) } });
      }
      else if (t === "multi_select") partes.push({ property: real, multi_select: { contains: String(valor) } });
      else if (t === "people") {
        const pid = this.persona(String(valor));
        if (pid) partes.push({ property: real, people: { contains: pid } });
      } else if (t === "date") {
        if (valor && typeof valor === "object") {
          const d = valor as Json;
          if (d.start ?? d.inicio) partes.push({ property: real, date: { on_or_after: d.start ?? d.inicio } });
          if (d.end ?? d.fin) partes.push({ property: real, date: { on_or_before: d.end ?? d.fin } });
        } else partes.push({ property: real, date: { equals: String(valor) } });
      } else if (t === "checkbox") partes.push({ property: real, checkbox: { equals: !!valor } });
      else if (t === "title" || t === "rich_text") partes.push({ property: real, [t]: { contains: String(valor) } });
    }
    if (!partes.length) return null;
    return partes.length === 1 ? partes[0] : { and: partes };
  }

  async ejecutar(a: Accion): Promise<Resultado> {
    const [id, esq] = this.base(a.base ?? "");
    const nombreBase = esq.titulo;

    if (a.tipo === "crear") {
      const props = await this.propiedades(esq, a.propiedades);
      if (!props[esq.campo_titulo]) throw new NotionError("La acción no trae título");
      const pag = await notion.crearPagina(id, props, a.contenido);
      return { ok: true, texto: `Creado en ${nombreBase}: ${tituloDe(pag)}`, url: pag.url };
    }

    if (a.tipo === "actualizar" || a.tipo === "comentar" || a.tipo === "archivar") {
      const encontrados = await this.localizar(id, esq, a.buscar);
      if (!encontrados.length) return { ok: false, texto: `No encontré '${a.buscar}' en ${nombreBase}` };
      if (encontrados.length > 1) {
        const nombres = encontrados.slice(0, 4).map(tituloDe).join("; ");
        return { ok: false, texto: `AMBIGUO: hay ${encontrados.length} coincidencias en ${nombreBase}: ${nombres}. ¿A cuál te refieres?` };
      }
      const pag = encontrados[0];
      if (a.tipo === "actualizar") {
        const props = await this.propiedades(esq, a.propiedades);
        if (!Object.keys(props).length) return { ok: false, texto: "No había campos válidos para actualizar" };
        await notion.actualizarPagina(pag.id, props);
        return { ok: true, texto: `Actualizado en ${nombreBase}: ${tituloDe(pag)} → ${Object.keys(props).join(", ")}`, url: pag.url };
      }
      if (a.tipo === "comentar") {
        await notion.comentar(pag.id, a.texto ?? "");
        return { ok: true, texto: `Nota agregada a ${tituloDe(pag)}`, url: pag.url };
      }
      await notion.archivarPagina(pag.id);
      return { ok: true, texto: `Archivado: ${tituloDe(pag)}` };
    }

    if (a.tipo === "consultar") {
      const filas = await notion.consultar(id, this.filtro(esq, a.filtro), undefined, Number(a.limite) || 10);
      if (!filas.length) return { ok: true, texto: `No hay resultados en ${nombreBase}` };
      const lineas = filas.slice(0, 10).map((f) => {
        const detalles = ["estado", "responsable", "fecha"]
          .map((rol) => esq.roles_campos[rol])
          .filter((c) => c && f.properties?.[c])
          .map((c) => valorLegible(f.properties[c]))
          .filter(Boolean);
        return tituloDe(f) + (detalles.length ? ` (${detalles.join(", ")})` : "");
      });
      return { ok: true, texto: `${filas.length} en ${nombreBase}: ${lineas.join("; ")}` };
    }

    throw new NotionError(`Acción desconocida: ${a.tipo}`);
  }

  async ejecutarTodo(acciones: Accion[]): Promise<Resultado[]> {
    const out: Resultado[] = [];
    for (const a of acciones) {
      try {
        out.push(await this.ejecutar(a));
      } catch (e) {
        out.push({ ok: false, texto: `ERROR ${mensajeSeguro(e)}` });
      }
    }
    return out;
  }
}

/** Archivar o cambiar el responsable siempre pasa por el botón de Confirmar (lo decide el código, no el modelo). */
export function pendientesDeConfirmar(m: Mapa, acciones: Accion[]): string[] {
  const avisos: string[] = [];
  for (const a of acciones) {
    const esq = m.bases[m.roles[a.base]];
    const nombre = a.buscar ? `«${a.buscar}»` : "eso";
    if (a.tipo === "archivar") avisos.push(`archivar ${nombre}${esq ? ` en ${esq.titulo}` : ""}`);
    if (a.tipo === "actualizar" && esq) {
      const campoResp = esq.roles_campos.responsable?.toLowerCase();
      const toca = Object.keys(a.propiedades ?? {}).some((k) => k.toLowerCase() === "responsable" || k.toLowerCase() === campoResp);
      if (toca) avisos.push(`cambiar el responsable de ${nombre}`);
    }
  }
  return avisos;
}

/** Qué decirle a Fernanda después de ejecutar (misma lógica que asistente.py). */
export function mensajeFinal(plan: Plan, resultados: Resultado[]): string {
  const error = resultados.find((r) => r.texto.startsWith("ERROR"));
  if (error) return "Hubo un problema: " + error.texto.replace(/^ERROR /, "");
  const ambiguo = resultados.find((r) => r.texto.startsWith("AMBIGUO"));
  if (ambiguo) return ambiguo.texto.replace("AMBIGUO: ", "");
  const noEncontrado = resultados.find((r) => r.texto.startsWith("No encontré"));
  if (noEncontrado) return noEncontrado.texto + ".";
  const consulta = resultados.find((r) => / en /.test(r.texto) && !/^(Creado|Actualizado|Archivado|Nota)/.test(r.texto));
  if (consulta) return consulta.texto;
  return plan.respuesta || resultados[0]?.texto || "Listo.";
}
