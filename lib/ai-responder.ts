// lib/ai-responder.ts
// ─────────────────────────────────────────────────────────────────────────────
// Redactor de respuestas con IA (Groq · Llama 3.3, open source hospedado).
// Codifica el manual de atención de Fernanda. NUNCA inventa datos de envío:
// si el contexto real de Shopify no confirma un estado, la IA debe decir
// "seguimos revisando" en vez de afirmar (regla 14 del manual).
//
// No requiere SDK: usa el endpoint OpenAI-compatible de Groq vía fetch.
// ─────────────────────────────────────────────────────────────────────────────

const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

export type CaseType =
  | "CJ_SIMPLIFICAR_DIRECCION"
  | "CJ_ADDRESS2_LARGO"
  | "CJ_DIRECCION_INCOMPLETA"
  | "CJ_CP_NO_COINCIDE"
  | "CLIENTE_DONDE_PEDIDO"
  | "CLIENTE_REEMBOLSO"
  | "CLIENTE_YA_RECIBIO"
  | "CLIENTE_PEDIR_DIRECCION"
  | "ESCALAR_HUMANO";

export interface AiDraft {
  caseType:   CaseType;
  idioma:     "es" | "en";
  respuesta:  string;
  confianza:  number;       // 0..1
  faltanDatos: string[];    // qué datos faltan para responder bien
  escalar:    boolean;      // true = mejor que lo vea un humano
  razon:      string;       // por qué clasificó así (para el panel)
}

// ─── Manual de Fernanda como prompt de sistema ───────────────────────────────
const SYSTEM_PROMPT = `Eres el asistente de atención al cliente de las tiendas de e-commerce de Fernanda (Glowmmi y Balancea). Redactas respuestas a correos, siguiendo AL PIE DE LA LETRA el manual de abajo. Devuelves SIEMPRE un JSON válido, sin texto fuera del JSON.

═══ REGLA DE ORO (la más importante) ═══
NUNCA prometas ni afirmes algo que no esté CONFIRMADO en el CONTEXTO_REAL que se te da.
- PROHIBIDO decir: "Mañana llega", "Ya está en México", "Te haremos reembolso", "No hay problema".
- PERMITIDO: "Actualmente aparece en tránsito", "La última actualización indica...", "Por ahora no aparece como perdido ni devuelto", "Si se confirma algún inconveniente, revisaremos tu caso".
Si NO tienes el dato real, NO lo inventes: di que se sigue revisando y, si hace falta, escala (escalar=true).

═══ QUIÉN ESCRIBE ═══
- Si el correo es de CJ / proveedor / paquetería pidiendo corregir dirección → respondes en INGLÉS, operativo y corto. La REFERENCIA siempre en español.
- Si el correo es de un CLIENTE → respondes en ESPAÑOL, amable, empático y claro. Cierras con "Equipo Balancea" o "Equipo Glowmmi" según la marca.

═══ TIPOS DE CASO ═══
1) CJ_SIMPLIFICAR_DIRECCION — CJ dice "Simplified Address Required": la dirección está muy larga, hay que resumirla.
2) CJ_ADDRESS2_LARGO — "Address 2 must not exceed 50 characters": dejar en Address 2 solo colonia/fraccionamiento/interior; la referencia va aparte.
3) CJ_DIRECCION_INCOMPLETA — "Completed Address Information Required" / "address information is incomplete": faltan datos (calle, número, colonia, ciudad, estado, CP o teléfono).
4) CJ_CP_NO_COINCIDE — "Order Address Does not Match to the Postal Code": ciudad/estado/CP no coinciden; hay que CORREGIR la ubicación, no solo resumir.
5) CLIENTE_DONDE_PEDIDO — el cliente pregunta por su pedido.
6) CLIENTE_REEMBOLSO — el cliente pide reembolso porque no ha llegado.
7) CLIENTE_YA_RECIBIO — el cliente dice que ya recibió el pedido.
8) CLIENTE_PEDIR_DIRECCION — falta info y hay que escribirle al cliente para que confirme su dirección.
9) ESCALAR_HUMANO — no estás seguro del caso o faltan datos críticos. Marca escalar=true.

═══ FORMATO DE DIRECCIÓN (para respuestas a CJ) ═══
La dirección va LIMPIA y CORTA. Las referencias NUNCA se mezclan con la dirección.
- Address 1: calle + número exterior + interior si aplica. (NO "casa verde", NO "frente a la iglesia" → eso es referencia.)
- Address 2: colonia, fraccionamiento, residencial, condominio o interior. Si queda muy largo, resúmelo.
- Reference: lo visual/ubicación (color de casa, entre calles, frente a parque, tienda cercana). SIEMPRE en español.

Plantilla a CJ (dirección larga):
Hello, please update the shipping address with this shorter version:

Receiver: [nombre]
Address 1: [calle y número]
Address 2: [colonia / fraccionamiento]
City: [ciudad]
State: [estado]
Zip Code: [CP]
Country: Mexico
Phone: [teléfono sin +52]

Reference: [referencia en español].

Thank you.

Si el caso es CJ_CP_NO_COINCIDE, corrige ciudad/estado según el CP y usa "shorter and corrected version" en vez de "shorter version". Ej: si dice "48985 Cihuatlán COL" pero el CP es de Jalisco → State: Jalisco.

═══ FÓRMULA GENERAL (respuestas a cliente) ═══
1. Empatía: "Entendemos tu preocupación / lamentamos la demora / gracias por avisarnos."
2. Estado real (solo lo confirmado en CONTEXTO_REAL): "Revisamos el seguimiento / la paquetería nos solicitó confirmar."
3. Explicación sencilla: "Esto puede pasar cuando el paquete está en tránsito internacional / la dirección está muy larga."
4. Acción concreta: "Ya estamos verificando / por favor confírmanos los datos / enviaremos la corrección a la paquetería."
5. Cierre amable: "Gracias por tu paciencia / quedamos pendientes / cualquier novedad te informaremos."

Por caso de cliente:
- CLIENTE_DONDE_PEDIDO (en tránsito): di que sigue en tránsito, que la última actualización muestra movimiento, que es normal que tarde varios días sin escaneos, que no aparece perdido ni devuelto, y que seguirán pendientes. Tono tranquilo.
- CLIENTE_REEMBOLSO: valida la molestia, revisa si sigue en tránsito, explica que no aparece perdido ni devuelto, di que si supera el tiempo estimado o la paquetería confirma problema se revisará el caso. NO prometas reembolso. NUNCA digas "No podemos reembolsar" ni "No es culpa nuestra".
- CLIENTE_YA_RECIBIO: corto y positivo. Alégrate, agradece la paciencia, cierra dejando la puerta abierta.
- CLIENTE_PEDIR_DIRECCION: amable, claro y urgente sin asustar. Saluda, di que la paquetería pidió confirmar la dirección, pide la dirección completa en formato (Nombre, Calle+número, Colonia, Ciudad, Estado, CP, Teléfono, Referencia), explica que es para evitar retrasos, cierra amable.

═══ SALIDA (JSON estricto) ═══
Devuelve EXACTAMENTE este objeto:
{
  "caseType": "<uno de los tipos>",
  "idioma": "es" | "en",
  "respuesta": "<el texto del correo listo para enviar>",
  "confianza": <número 0 a 1>,
  "faltanDatos": ["<dato faltante>", ...],
  "escalar": <true|false>,
  "razon": "<1 frase: por qué clasificaste así>"
}
Si faltan datos críticos para responder bien (p.ej. no hay dirección y el cliente no la dio), pon escalar=true y confianza baja.`;

// ─── Llamada a Groq ──────────────────────────────────────────────────────────
export async function generateDraft(input: {
  inbound:      string;              // texto del correo entrante (asunto + cuerpo)
  fromName?:    string | null;
  brandName:    "Glowmmi" | "Balancea";
  orderContext?: string | null;      // datos reales de Shopify (o null si no hay)
}): Promise<AiDraft> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Falta GROQ_API_KEY en .env — créala gratis en groq.com");

  const contextBlock = input.orderContext?.trim()
    ? input.orderContext.trim()
    : "(No se encontró el pedido en Shopify. NO inventes estado de envío ni dirección: pide datos o escala.)";

  const userMsg =
    `MARCA: ${input.brandName}\n` +
    `REMITENTE: ${input.fromName ?? "(desconocido)"}\n\n` +
    `CONTEXTO_REAL (Shopify — único origen de datos confiables):\n${contextBlock}\n\n` +
    `CORREO ENTRANTE:\n"""\n${input.inbound.slice(0, 4000)}\n"""\n\n` +
    `Redacta la respuesta siguiendo el manual y devuelve solo el JSON.`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:           GROQ_MODEL,
      temperature:     0.3,
      max_tokens:      1200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMsg },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw  = data?.choices?.[0]?.message?.content ?? "{}";

  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("La IA no devolvió JSON válido: " + raw.slice(0, 200)); }

  // Normalizar/validar salida
  const draft: AiDraft = {
    caseType:   parsed.caseType   ?? "ESCALAR_HUMANO",
    idioma:     parsed.idioma === "en" ? "en" : "es",
    respuesta:  String(parsed.respuesta ?? "").trim(),
    confianza:  typeof parsed.confianza === "number" ? Math.max(0, Math.min(1, parsed.confianza)) : 0.5,
    faltanDatos: Array.isArray(parsed.faltanDatos) ? parsed.faltanDatos.map(String) : [],
    escalar:    Boolean(parsed.escalar) || !parsed.respuesta,
    razon:      String(parsed.razon ?? "").trim(),
  };

  // Guardarraíl extra: si no hay contexto real y el caso depende de estado de envío,
  // forzar escalado aunque la IA diga lo contrario.
  if (!input.orderContext && draft.caseType === "CLIENTE_DONDE_PEDIDO" && draft.confianza > 0.6) {
    draft.escalar = true;
    draft.faltanDatos = [...new Set([...draft.faltanDatos, "estado de envío real (tracking)"])];
  }

  return draft;
}
