import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const accountsServer =
    searchParams.get("accounts-server") ?? "https://accounts.zoho.com";

  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  /* ── 1. Intercambiar code por tokens ─────────────────────── */
  const tokenRes = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID ?? "",
      client_secret: process.env.ZOHO_CLIENT_SECRET ?? "",
      redirect_uri: process.env.ZOHO_REDIRECT_URI ?? "",
    }).toString(),
  });

  const tokens = await tokenRes.json();

  if (!tokens.access_token) {
    return new NextResponse(
      `<h2>Error OAuth</h2><pre>${JSON.stringify(tokens, null, 2)}</pre>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  /* ── 2. API domain según DC ──────────────────────────────── */
  const apiDomain = accountsServer.replace("accounts.", "mail.");

  /* ── 3. Info de la cuenta Zoho Mail ─────────────────────── */
  const accountsRes = await fetch(`${apiDomain}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` },
  });
  const accountsData = await accountsRes.json();
  const account = accountsData.data?.[0];

  if (!account) {
    return new NextResponse(
      `<h2>No se encontró cuenta Zoho Mail</h2><pre>${JSON.stringify(accountsData, null, 2)}</pre>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  /* emailAddress puede venir como array [{mailId, isPrimary}] o como string */
  const emailAddress: string = Array.isArray(account.emailAddress)
    ? (account.emailAddress.find((e: any) => e.isPrimary)?.mailId ??
       account.emailAddress[0]?.mailId ??
       "")
    : (account.emailAddress ?? "");

  /* ── 4. Upsert config ────────────────────────────────────── */
  const tokenExpiry = new Date(
    Date.now() + (tokens.expires_in ?? 3600) * 1000
  );

  const existing = await prisma.zohoBotConfig.findFirst({
    where: { accountId: String(account.accountId) },
  });

  let configId: string;

  if (existing) {
    await prisma.zohoBotConfig.update({
      where: { id: existing.id },
      data: {
        // Solo sobreescribir refreshToken si Zoho envió uno nuevo
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        accessToken:  tokens.access_token,
        tokenExpiry,
        authDomain:   accountsServer,
        apiDomain,
        emailAddress: emailAddress || existing.emailAddress,
        displayName:  account.displayName ?? existing.displayName,
      },
    });
    configId = existing.id;
  } else {
    if (!tokens.refresh_token) {
      return new NextResponse(
        `<h2>Faltó el refresh_token de Zoho</h2>
         <p>Zoho no envió el refresh_token. Haz click en el botón de nuevo — si el problema persiste, revoca el acceso en <a href="https://accounts.zoho.com/home#clients">Zoho Clients</a> y vuelve a intentar.</p>
         <pre>${JSON.stringify(tokens, null, 2)}</pre>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    const created = await prisma.zohoBotConfig.create({
      data: {
        accountId:    String(account.accountId),
        emailAddress,
        displayName:  account.displayName ?? null,
        refreshToken: tokens.refresh_token,
        accessToken:  tokens.access_token,
        tokenExpiry,
        authDomain:   accountsServer,
        apiDomain,
        autoReplyEnabled: true,
      },
    });
    configId = created.id;

    /* ── 5. Sembrar reglas por defecto (solo la primera vez) ─ */
    await seedDefaultRules(configId, emailAddress);
  }

  return NextResponse.redirect(
    new URL("/automatizaciones/zoho?connected=1", req.url)
  );
}

/* ── Reglas por defecto ──────────────────────────────────────── */
async function seedDefaultRules(configId: string, email: string) {
  const brand = email.toLowerCase().includes("balancea") ? "Balancea" : "Glowmmi";
  const site  = brand === "Balancea" ? "www.balanceaa.com" : "www.glowmmi.com";
  const sign  = `Equipo ${brand} 💚`;

  const rules = [
    {
      name: "📦 Número de guía / Rastreo",
      keywords: JSON.stringify(["__TRACKING_NUMBER__"]),
      response: `Hola {nombre} 💚 ¡Gracias por escribirnos!\n\nHemos recibido tu número de guía. Puedes rastrear tu pedido en tiempo real aquí:\n👉 https://tracking.buhologistics.com\n\nEl tiempo de entrega es de 5 a 20 días hábiles. Si ya superaste ese tiempo, responde este correo y lo revisamos.\n\nCon cariño, ${sign}`,
      priority: 10,
    },
    {
      name: "🔍 Rastreo / Dónde está mi pedido",
      keywords: JSON.stringify(["rastreo","tracking","mi pedido","donde esta","dónde está","cuando llega","cuándo llega","no ha llegado","sigo esperando","tarda","envio","envío"]),
      response: `Hola {nombre} 💚 ¡Gracias por escribirnos!\n\nPuedes rastrear tu pedido en tiempo real aquí:\n👉 https://tracking.buhologistics.com\n\nEl tiempo de entrega es de 5 a 20 días hábiles. Si ya pasó ese tiempo o tienes dudas, escríbenos y lo revisamos juntos.\n\nCon cariño, ${sign}`,
      priority: 8,
    },
    {
      name: "⏳ Queja de demora",
      keywords: JSON.stringify(["mucho tiempo","demasiado","semanas","tardanza","lleva mucho","dias y nada","días y nada"]),
      response: `Hola {nombre} 💚 ¡Gracias por escribirnos!\n\nLamentamos la espera. Nuestros envíos tardan entre 5 y 20 días hábiles.\n\nRastreo en tiempo real:\n👉 https://tracking.buhologistics.com\n\nSi ya superaste ese tiempo, responde con tu número de orden y lo revisamos de inmediato.\n\nCon cariño, ${sign}`,
      priority: 7,
    },
    {
      name: "💰 Precio / Costo",
      keywords: JSON.stringify(["precio","cuanto cuesta","cuánto cuesta","costo","cuanto vale","cuánto vale","tarifa","cuanto cobran"]),
      response: `Hola {nombre} 💚 ¡Gracias por tu interés!\n\nPuedes ver todos nuestros precios y promociones vigentes aquí:\n👉 ${site}\n\nSi tienes dudas sobre algún producto en específico, ¡con gusto te ayudamos!\n\nCon cariño, ${sign}`,
      priority: 5,
    },
    {
      name: "🚚 Envío / Tiempo de entrega",
      keywords: JSON.stringify(["shipping","envian","envían","hacen envios","tiempo de entrega","dias habiles","días hábiles","internacional","estados unidos","mexico","méxico"]),
      response: `Hola {nombre} 💚 ¡Gracias por tu mensaje!\n\nRealizamos envíos a toda la República Mexicana y Estados Unidos. El tiempo de entrega es de 5 a 20 días hábiles.\n\nPara más información visita:\n👉 ${site}\n\nCon cariño, ${sign}`,
      priority: 4,
    },
    {
      name: "🧴 Cómo funciona / Ingredientes",
      keywords: JSON.stringify(["como funciona","cómo funciona","para que sirve","para qué sirve","ingredientes","beneficios","que hace","qué hace"]),
      response: `Hola {nombre} 💚 ¡Excelente pregunta!\n\nEn nuestra tienda encontrarás toda la información del producto, ingredientes y resultados reales:\n👉 ${site}\n\nSi tienes una duda específica, ¡responde este correo y te orientamos!\n\nCon cariño, ${sign}`,
      priority: 3,
    },
    {
      name: "⚠️ Decepcionada / Queja seria",
      keywords: JSON.stringify(["decepcionada","decepcionado","muy mal","terrible","pesimo","pésimo","horrible","estafa","fraude","mala calidad"]),
      response: `Hola {nombre} 💚 ¡Gracias por escribirnos!\n\nNos importa mucho tu experiencia. Queremos escucharte y encontrar la mejor solución para ti.\n\nPor favor responde con tu número de orden y cuéntanos qué pasó. Nuestro equipo lo atenderá de manera prioritaria.\n\nCon cariño, ${sign}`,
      priority: 9,
    },
    {
      name: "🚨 Insulto / Agresión",
      keywords: JSON.stringify(["idiota","imbecil","imbécil","estupida","estúpida","ladrones","malditos","inutiles","inútiles"]),
      response: `Hola {nombre} 💚 Gracias por escribirnos.\n\nEntendemos que algo no salió como esperabas. Estamos aquí para ayudarte.\n\nPor favor responde con tu número de orden y con gusto resolvemos tu caso de manera prioritaria.\n\nCon cariño, ${sign}`,
      priority: 10,
    },
    {
      name: "💬 Saludo / Mensaje general",
      keywords: JSON.stringify(["hola","buenas","buen dia","buenos dias","buenas tardes","buenas noches"]),
      response: `Hola {nombre} 💚 ¡Gracias por escribirnos!\n\nCon gusto te ayudamos. Puedes explorar nuestros productos, precios y promociones aquí:\n👉 ${site}\n\nSi tienes alguna pregunta específica, ¡escríbenos y te respondemos!\n\nCon cariño, ${sign}`,
      priority: 1,
    },
  ];

  for (const r of rules) {
    await prisma.zohoBotRule.create({
      data: { configId, ...r, isActive: true },
    });
  }
}
