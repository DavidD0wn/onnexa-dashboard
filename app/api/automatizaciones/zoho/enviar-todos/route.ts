// app/api/automatizaciones/zoho/enviar-todos/route.ts
// ── Envío masivo de borradores pendientes ──
// Envía por TANDAS (no todos de golpe) para que la petición no se cuelgue y la
// app no se sature. La UI llama esto en bucle hasta que `pendientes` sea 0.
//
// IMPORTANTE: solo envía los de status "draft" (los que la IA resolvió con
// confianza). Los "escalated" / "needs_attention" quedan fuera a propósito:
// esos la IA los marcó para revisión humana y deben leerse uno por uno.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enviarRespuesta } from "@/lib/zoho-send";

export async function POST(req: NextRequest) {
  const body  = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 10), 15);   // tope por tanda
  const brand = body.brand as string | undefined;          // opcional: "Glowmmi" | "Balancea"

  const where: any = { status: "draft", hidden: false };
  if (brand === "Glowmmi")  where.config = { emailAddress: { contains: "glowmmi" } };
  if (brand === "Balancea") where.config = { emailAddress: { contains: "balancea" } };

  const convs = await prisma.zohoConversation.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { config: { select: { emailAddress: true } } },
  });

  const enviados: string[] = [];
  const fallidos: { email: string; error: string }[] = [];

  for (const c of convs) {
    const texto = (c.aiDraft ?? "").trim();
    if (!texto) {
      fallidos.push({ email: c.fromEmail, error: "borrador vacío" });
      continue;
    }
    try {
      await enviarRespuesta(c.config?.emailAddress ?? "", c, texto);
      await prisma.zohoConversation.update({
        where: { id: c.id },
        data:  { status: "replied", outboundText: texto },
      });
      enviados.push(c.fromEmail);
    } catch (e: any) {
      // Un fallo no debe abortar la tanda: se marca y se sigue con el resto.
      const msg = String(e?.message ?? "error").slice(0, 300);
      fallidos.push({ email: c.fromEmail, error: msg });
      await prisma.zohoConversation.update({
        where: { id: c.id },
        data:  { status: "error", errorMsg: msg },
      }).catch(() => {});
    }
  }

  const [pendientes, paraRevisar] = await Promise.all([
    prisma.zohoConversation.count({ where: { status: "draft", hidden: false } }),
    prisma.zohoConversation.count({
      where: { status: { in: ["escalated", "needs_attention"] }, hidden: false },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    enviados: enviados.length,
    fallidos,
    pendientes,      // cuántos draft quedan (la UI repite hasta 0)
    paraRevisar,     // escalados que NO se envían en masa (revisión manual)
  });
}
