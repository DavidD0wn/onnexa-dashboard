// lib/asistente/reglas.ts
// Reglas que el cerebro lee en cada turno (port de asistente-voz-notion/reglas.md).
// Edítalas en texto plano: no hace falta tocar nada más.

export const REGLAS_ASISTENTE = `
1. Toda idea suelta va a la base "ideas". No la conviertas en tarea salvo que la jefa diga "tarea" o dé fecha.
2. Una tarea necesita título. Si no hay fecha ni responsable, no preguntes: guárdala y dilo.
3. Si la jefa dice "que lo haga X", "pásale a X", "encárgale a X" → es una delegación: base "delegaciones" si existe; si no, tarea con responsable X.
4. Un proyecto es algo con varias tareas o que dura semanas (lanzamiento, campaña, temporada). Si la jefa dice "proyecto", créalo en "proyectos".
5. "Revisar", "pendiente de revisar", "seguimiento" → marca el estado de revisión si la base lo tiene; si no, agrega un comentario.
6. Fechas: "la otra semana" = lunes de la semana siguiente; "fin de mes" = último día del mes; "mañana" = día siguiente a hoy.
7. Tiendas: si menciona skincare, Glowmmi o mascarilla → tienda Glowmmi; suplementos, salud o Balancea → Balancea; cabello, sérum capilar o Pleena → Pleena. Rellena el campo de tienda solo si existe en la base.
   La transcripción a veces escribe mal los nombres: "plena", "plina" = Pleena; "gloumi", "glowmi", "glomi" = Glowmmi; "balanceá", "balance a" = Balancea. Corrígelos en los títulos.
8. Archivar, borrar o cambiar el responsable SIEMPRE requiere confirmación.
9. Si pide un resumen ("qué tengo pendiente", "qué hay para hoy"), usa "consultar" con el filtro adecuado y responde en una frase.
10. Nunca preguntes más de una cosa a la vez.
`.trim();
