# Asistente de voz → Notion

Fernanda habla en `/asistente` (o con el botón 🎤 flotante) y el asistente crea, actualiza,
comenta, archiva o consulta filas en las bases de su Notion (workspace de la página E-COMMERCE).

## Piezas

| Archivo | Qué hace |
|---|---|
| `proxy.ts` | Pide PIN **solo** en `/asistente` y `/api/asistente/*`. Crons, webhooks y el resto de la app no pasan por aquí. |
| `lib/asistente/sesion.ts` | Cookie firmada (HMAC) de 30 días. Cambiar el PIN cierra todas las sesiones. |
| `app/entrar`, `app/api/entrar` | Pantalla y validación del PIN. |
| `lib/notion.ts` | Cliente REST de Notion (token de integración interna, API 2022-06-28). |
| `lib/asistente/mapa.ts` | Descubre en vivo las bases que ve la integración y adivina su rol (ideas, tareas, proyectos, delegaciones). Caché de 10 min. |
| `lib/asistente/cerebro.ts` | Prompt + llamada a Groq (JSON) + Ejecutor que traduce a propiedades de Notion. |
| `lib/asistente/reglas.ts` | Reglas del asistente en texto plano. |
| `app/api/asistente` | Un turno de conversación; `ejecutar` para lo que Fernanda confirmó con el botón. |
| `app/asistente` | Chat, micrófono (Web Speech API, es-MX, Chrome/Edge) y voz del navegador. |

Archivar o cambiar un responsable **siempre** pide Confirmar en pantalla; lo decide el código, no el modelo.

## Variables de entorno (Vercel)

| Variable | Obligatoria | Nota |
|---|---|---|
| `NOTION_TOKEN` | sí | Llave de la integración "Asistente de voz" de Fernanda. La página E-COMMERCE debe estar conectada a esa integración. |
| `ASISTENTE_PIN` | sí | 6-8 dígitos. Sin PIN no se puede entrar. |
| `ASISTENTE_SECRET` | recomendable | Texto aleatorio largo para firmar la cookie. |
| `GROQ_API_KEY` | ya existe | Plan gratis: 8.000 tokens/min compartidos con el bot de correos (unos 4 turnos/min). |
| `NOTION_ROLES` | no | `{"tareas":"<id base>"}` si la adivinanza por nombre falla. |
| `NOTION_ALIAS_PERSONAS` | no | `{"Fer":"María Fernanda Rey"}` |
| `ASISTENTE_MODELO` | no | Por defecto `GROQ_MODEL` o `openai/gpt-oss-120b`. `llama-3.3-70b-versatile` ya no está disponible para esta llave. |
| `ASISTENTE_TZ` | no | Zona para "hoy", "mañana", "el lunes". Por defecto `America/Mexico_City`. |

## Probar en local

La copia `onnexa-dashboard-asistente` usa un enlace a `node_modules`, así que Turbopack falla:
arrancar con `npx next dev --webpack --port 3001`. Este PC tiene cortes de red hacia Groq/Shopify
(IPv6); en Vercel no pasa.
