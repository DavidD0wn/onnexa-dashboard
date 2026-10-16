# Asistente de voz → Notion

Fernanda habla o escribe en Automatizaciones → Asistente de voz (`/automatizaciones/asistente`) y el asistente crea, actualiza,
comenta, archiva o consulta filas en las bases de su Notion (workspace de la página E-COMMERCE).

## Piezas

| Archivo | Qué hace |
|---|---|
| `lib/asistente/config.ts` | Llave de Notion guardada en Neon (tabla `AsistenteConfig`); respaldo: `NOTION_TOKEN` de Vercel. |
| `app/api/asistente/notion` | Recibe la llave pegada en la pantalla, la prueba contra Notion, la guarda y conecta al instante. |
| `lib/notion.ts` | Cliente REST de Notion (llave de integración interna, API 2022-06-28). |
| `lib/asistente/mapa.ts` | Descubre en vivo las bases que ve la integración y adivina su rol (ideas, tareas, proyectos, delegaciones). Caché de 10 min. |
| `lib/asistente/cerebro.ts` | Prompt + llamada a Groq (JSON) + Ejecutor que traduce a propiedades de Notion. |
| `lib/asistente/reglas.ts` | Reglas del asistente en texto plano. |
| `app/api/asistente` | Un turno de conversación; `ejecutar` para lo que Fernanda confirmó con el botón. |
| `app/automatizaciones/asistente` | Chat, micrófono (Web Speech API, es-MX, Chrome/Edge) y voz del navegador. |

Archivar o cambiar un responsable **siempre** pide Confirmar en pantalla; lo decide el código, no el modelo.

Sin PIN, por decisión de Hamlet (16-oct-2026): cualquiera con la URL del dashboard puede usar el asistente y cambiar la llave.

## Variables de entorno (Vercel)

| Variable | Obligatoria | Nota |
|---|---|---|
| `NOTION_TOKEN` | no | Solo respaldo: lo normal es pegar la llave en la pantalla del asistente. La página E-COMMERCE debe estar conectada a la integración. |
| `GROQ_API_KEY` | ya existe | Plan gratis: 8.000 tokens/min compartidos con el bot de correos (unos 4 turnos/min). |
| `NOTION_ROLES` | no | `{"tareas":"<id base>"}` si la adivinanza por nombre falla. |
| `NOTION_ALIAS_PERSONAS` | no | `{"Fer":"María Fernanda Rey"}` |
| `ASISTENTE_MODELO` | no | Por defecto `GROQ_MODEL` o `openai/gpt-oss-120b`. `llama-3.3-70b-versatile` ya no está disponible para esta llave. |
| `ASISTENTE_TZ` | no | Zona para "hoy", "mañana", "el lunes". Por defecto `America/Mexico_City`. |

## Probar en local

La copia `onnexa-dashboard-asistente` usa un enlace a `node_modules`, así que Turbopack falla:
arrancar con `npx next dev --webpack --port 3001`. Este PC tiene cortes de red hacia Groq/Shopify
(IPv6); en Vercel no pasa.
