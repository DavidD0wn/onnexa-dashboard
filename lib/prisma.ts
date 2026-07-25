import { PrismaClient } from "@prisma/client";
import dns from "node:dns";

// Neon publishes IPv4 and IPv6. Some Windows networks resolve IPv6 first but
// cannot route it, which looks like a database/pool timeout.
dns.setDefaultResultOrder("ipv4first");

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

function runtimeDatabaseUrl(): string | undefined {
  const configured = process.env.DATABASE_URL;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    const endpointId = url.hostname.split(".")[0].replace(/-pooler$/, "");
    if (
      url.hostname.endsWith(".aws.neon.tech") &&
      !url.hostname.includes("-pooler.")
    ) {
      const firstDot = url.hostname.indexOf(".");
      url.hostname =
        url.hostname.slice(0, firstDot) +
        "-pooler" +
        url.hostname.slice(firstDot);
    }
    const forcedIpv4 = process.env.NEON_IPV4_HOST?.trim();
    if (forcedIpv4 && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(forcedIpv4)) {
      url.hostname = forcedIpv4;
      url.searchParams.set("options", `endpoint=${endpointId}`);
    }
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "10");
    }
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", forcedIpv4 ? "1" : "3");
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "5");
    }
    return url.toString();
  } catch {
    return configured;
  }
}

// ── Resiliencia ante el "cold start" de Neon ──────────────────────────────────
// El plan free de Neon suspende la BD tras unos minutos de inactividad. La
// primera consulta la despierta pero falla con P1001 ("Can't reach database").
// Sin esto, la app local mostraba 500 / "offline" a cada rato. Con este wrapper
// la consulta se reintenta brevemente mientras Neon arranca.
function withNeonRetry(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX = 3;
        let lastErr: any;
        for (let attempt = 0; attempt < MAX; attempt++) {
          try {
            return await query(args);
          } catch (e: any) {
            const msg  = String(e?.message ?? "");
            const code = e?.code;
            const isWaking =
              code === "P1001" ||                       // can't reach db
              code === "P1002" ||                       // timed out
              msg.includes("Can't reach database") ||
              msg.includes("Closed") ||
              msg.includes("connection");
            if (!isWaking || attempt === MAX - 1) throw e;
            lastErr = e;
            // La UI debe informar el fallo pronto, no quedar colgada.
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  }) as unknown as PrismaClient;
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = runtimeDatabaseUrl();
  return withNeonRetry(
    new PrismaClient(
      databaseUrl
        ? { datasources: { db: { url: databaseUrl } } }
        : undefined,
    ),
  );
}

export const prisma = globalThis.prismaGlobal ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
