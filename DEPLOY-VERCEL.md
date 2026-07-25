# Checklist para desplegar en Vercel

> Objetivo: que los datos SÍ funcionen esta vez. La causa principal de que fallaran
> antes fue la conexión a la base de datos sin "pooler" + variables sin configurar.

---

## Paso 1 — Conseguir las 2 URLs de la base de datos (Neon)

En **console.neon.tech** → tu proyecto → botón **Connect**:

1. **DATABASE_URL** → elige la opción **"Pooled connection"** (tiene `-pooler` en el host).
   Ejemplo: `postgresql://...@ep-crimson-truth-ap0k6ey2-pooler.c-7...neon.tech/neondb?sslmode=require`
2. **DIRECT_URL** → la opción **"Direct connection"** (SIN `-pooler`).
   Es la que ya usabas.

> ⚠️ El pooler es LO QUE ARREGLA que los datos no cargaran en Vercel. No lo saltes.

---

## Paso 2 — Poner las variables en Vercel

En **vercel.com** → tu proyecto → **Settings → Environment Variables**.
Pega cada una (marca "Production" y "Preview"). Los valores están en tu archivo `.env` local,
EXCEPTO las 4 marcadas con 👉 que cambian para producción:

| Variable | Valor |
|---|---|
| 👉 `DATABASE_URL` | la **POOLED** (con `-pooler`) del paso 1 |
| 👉 `DIRECT_URL` | la **directa** del paso 1 |
| 👉 `NEXT_PUBLIC_BASE_URL` | la URL de tu app en Vercel (ej. `https://onnexa-dashboard.vercel.app`) |
| 👉 `ZOHO_REDIRECT_URI` | `https://TU-URL-VERCEL/api/auth/zoho/callback` |
| `ANTHROPIC_API_KEY` | (igual que en .env) |
| `GROQ_API_KEY` | (igual) |
| `META_ADS_USER_TOKEN` | (igual) |
| `META_APP_ID` | (igual) |
| `META_APP_SECRET` | (igual) |
| `META_WEBHOOK_VERIFY_TOKEN` | (igual) |
| `SHOPIFY_GLOWMMI_CLIENT_ID` | (igual) |
| `SHOPIFY_GLOWMMI_CLIENT_SECRET` | (igual) |
| `SHOPIFY_GLOWMMI_SHOP` | (igual) |
| `SHOPIFY_GLOWMMI_TOKEN` | (igual) |
| `SHOPIFY_BALANCEA_CLIENT_ID` | (igual) |
| `SHOPIFY_BALANCEA_CLIENT_SECRET` | (igual) |
| `SHOPIFY_BALANCEA_SHOP` | (igual) |
| `SHOPIFY_BALANCEA_TOKEN` | (igual) |
| `ZOHO_CLIENT_ID` | (igual) |
| `ZOHO_CLIENT_SECRET` | (igual) |
| `ZOHO_SMTP_EMAIL` | (igual) |
| `ZOHO_SMTP_PASSWORD` | (igual) |
| `ZOHO_SMTP_EMAIL_BALANCEA` | (igual) |
| `ZOHO_SMTP_PASSWORD_BALANCEA` | (igual) |

---

## Paso 3 — Registrar la nueva URL de Zoho (para "Conectar cuenta")

En **Zoho API Console** (api-console.zoho.com) → tu app OAuth → **Redirect URIs** →
agrega: `https://TU-URL-VERCEL/api/auth/zoho/callback`

(Si no lo haces, el botón "Conectar cuenta Zoho" fallará en producción, pero el
resto de la app sí funciona.)

---

## Paso 4 — Redesplegar

Después de guardar las variables, en Vercel → **Deployments** → botón **Redeploy**
(o se redespliega solo con el próximo push a `main`).

---

## Qué NO va a funcionar igual que en local (ser honestos)

- **La base free de Neon se suspende** tras inactividad. Con el pooler mejora, pero si
  nadie visita la app en horas, la primera visita puede tardar o dar error mientras
  Neon despierta. Para que sea 100% estable 24/7 haría falta el plan pago de Neon.
- **Las sincronizaciones largas** (Shopify/Meta) pueden pasarse del límite de tiempo
  de funciones de Vercel (10s en plan Hobby). Mejor sincronizar por tandas o desde local.
