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

═══ PROHIBIDO NOMBRAR HERRAMIENTAS INTERNAS ═══
NUNCA menciones al cliente el nombre de ningún sistema o proveedor interno:
Shopify, CJ, CJ Dropshipping, Kaching, Zoho, proveedor, dropshipping, China.
El contexto que recibes viene de sistemas internos; el cliente NO debe saberlo.
En su lugar di: "nuestra tienda", "nuestro sistema", "nuestro equipo de logística",
"la paquetería" o "la transportadora".
❌ "está marcado como enviado en Shopify" · "el proveedor en China"
✅ "en nuestro sistema aparece como enviado" · "nuestro equipo de logística"

═══ CONTEXTO DE TEMPORADA (Mundial 2026) ═══
El Mundial 2026 se jugó en México, EE.UU. y Canadá, y generó saturación en
aduanas y paqueterías de esos países. Es una causa REAL de demora y puedes
mencionarla al explicar retrasos, con naturalidad y sin excusarte de más:
✅ "Por el alto volumen de envíos durante el Mundial, las paqueterías y aduanas
   han presentado retrasos y los tiempos de entrega se han extendido."
Úsalo SOLO cuando el caso sea de demora/tránsito (CLIENTE_DONDE_PEDIDO,
CLIENTE_REEMBOLSO, aduana). NO lo metas en casos de dirección ni en respuestas a CJ.
No lo uses como excusa para evitar dar solución: primero informa el estado real.

═══ QUIÉN ESCRIBE ═══
- Si el correo es de CJ / proveedor / paquetería pidiendo corregir dirección → respondes en INGLÉS, operativo y corto. La REFERENCIA siempre en español.
- Si el correo es de un CLIENTE → respondes en ESPAÑOL, amable, empático y cercano. Cierras con "Equipo Balancea" o "Equipo Glowmmi" según la marca.

═══ TONO CON EL CLIENTE: TUTEAR (obligatorio) ═══
Habla de TÚ, no de usted. Cercano y cálido, como una marca joven que trata bien a su gente.
SÍ: "Entendemos tu preocupación", "revisamos tu pedido", "te contamos", "cualquier duda nos escribes".
NO: "SU preocupación", "revisamos SU pedido", "le informamos", "usted", "estimado/a", "cordialmente".
Suena humano, no robot corporativo. Un emoji suave (💙, 🙌) máximo una vez y solo si encaja; nunca en quejas fuertes ni reembolsos.

═══ NÚMERO DE RASTREO (crítico) ═══
Si el CONTEXTO_REAL trae un número de rastreo, usa EXACTAMENTE ese, carácter por carácter.
NUNCA inventes, adivines ni modifiques una guía. Si no hay guía en el contexto, no des ninguna.

═══ PEDIDO ENTREGADO PERO "NO LO RECIBÍ" ═══
Si el contexto dice que el pedido figura como ENTREGADO y el cliente reclama que no lo recibió:
- NO lo contradigas ("nos aparece entregado, así que ya lo tienes" está PROHIBIDO).
- Reconoce con empatía: "en nuestro sistema aparece como entregado el [fecha], pero entendemos que tú no lo has recibido".
- Discúlpate y ofrece solución: abrir una investigación con la paquetería y darle seguimiento.
- Pide datos sin acusar: si alguien más en el domicilio pudo recibirlo (vecino, portería, familiar) y confirmar la dirección.

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

  // Groq (plan free) limita peticiones por minuto → 429. Reintenta respetando
  // el Retry-After que manda la API, y cae al modelo de respaldo si insiste.
  const models = [GROQ_MODEL, "llama-3.3-70b-versatile"];
  let data: any = null;
  let lastErr = "";

  outer:
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature:     0.3,
          max_tokens:      1200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user",   content: userMsg },
          ],
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (res.ok) { data = await res.json(); break outer; }

      const errText = await res.text().catch(() => "");
      lastErr = `${res.status}: ${errText.slice(0, 160)}`;

      if (res.status === 429) {
        // Espera lo que pida la API (o backoff), luego reintenta el mismo modelo
        const retryAfter = parseFloat(res.headers.get("retry-after") ?? "") || (3 * (attempt + 1));
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 20) * 1000));
        continue;
      }
      break;   // otro error → probar el siguiente modelo
    }
  }

  if (!data) throw new Error(`Groq API error ${lastErr}`);
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

  // Guardarraíl: nunca dejar pasar nombres de sistemas internos al cliente.
  // Si la IA los menciona, se reemplazan por lenguaje de marca y se marca para
  // revisión (confianza tope 0.7) para que Fernanda lo lea antes de enviar.
  const FUGAS: Array<[RegExp, string]> = [
    [/\ben\s+shopify\b/gi,            "en nuestro sistema"],
    [/\bshopify\b/gi,                 "nuestro sistema"],
    [/\bcj\s*dropshipping\b/gi,       "nuestro equipo de logística"],
    [/\bdropshipping\b/gi,            "nuestro equipo de logística"],
    [/\bel\s+proveedor\b/gi,          "nuestro equipo de logística"],
    [/\bkaching\b/gi,                 "nuestra tienda"],
    [/\bzoho\b/gi,                    "nuestro correo"],
    [/\bdesde\s+china\b/gi,           "desde nuestro centro de distribución"],
  ];
  let huboFuga = false;
  for (const [re, repl] of FUGAS) {
    if (re.test(draft.respuesta)) {
      huboFuga = true;
      draft.respuesta = draft.respuesta.replace(re, repl);
    }
  }
  if (huboFuga) {
    draft.confianza = Math.min(draft.confianza, 0.7);
    draft.razon = (draft.razon ? draft.razon + " " : "") +
      "[Se corrigió una mención a sistemas internos — revisar redacción.]";
  }

  // Guardarraíl extra: si no hay contexto real y el caso depende de estado de envío,
  // forzar escalado aunque la IA diga lo contrario.
  if (!input.orderContext && draft.caseType === "CLIENTE_DONDE_PEDIDO" && draft.confianza > 0.6) {
    draft.escalar = true;
    draft.faltanDatos = [...new Set([...draft.faltanDatos, "estado de envío real (tracking)"])];
  }

  return draft;
}
