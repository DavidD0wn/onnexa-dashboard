import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

// ── Resiliencia ante el "cold start" de Neon ──────────────────────────────────
// El plan free de Neon suspende la BD tras unos minutos de inactividad. La
// primera consulta la despierta pero falla con P1001 ("Can't reach database").
// Sin esto, la app local mostraba 500 / "offline" a cada rato. Con este wrapper
// la consulta se reintenta hasta 4 veces mientras Neon arranca (~2-3s).
function withNeonRetry(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        const MAX = 6;   // ~1+2+3+4+5 = 15s de margen para el cold start de Neon
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
            // Espera creciente mientras Neon despierta: 1s, 2s, 3s, 4s, 5s
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalThis.prismaGlobal ?? withNeonRetry(new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prisma;
}
