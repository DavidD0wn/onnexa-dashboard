// app/api/automatizaciones/zoho/regenerar/route.ts
// ── Regenera los borradores IA pendientes con las reglas actuales ──
// Útil tras mejorar el prompt: rehace la respuesta usando el texto del correo
// ya guardado (no necesita que el correo siga sin leer en Zoho).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateDraft } from "@/lib/ai-responder";
import { getOrderContext } from "@/lib/shopify-order-context";

function brandFromEmail(email: string): "Glowmmi" | "Balancea" {
  return /glowmmi/i.test(email) ? "Glowmmi" : "Balancea";
}

// POST: regenera hasta `limit` borradores pendientes (draft/escalated/needs_attention)
export async function POST(req: NextRequest) {
  const body  = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 8), 12);   // tope por tanda (evita saturar)
  const id    = body.id as string | undefined;           // opcional: regenerar solo uno

  const where: any = id
    ? { id }
    : { status: { in: ["draft", "escalated", "needs_attention"] }, hidden: false };

  const convs = await prisma.zohoConversation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: id ? 1 : limit,
    include: { config: { select: { emailAddress: true } } },
  });

  let regen = 0, fail = 0;
  for (const c of convs) {
    try {
      const brandName = brandFromEmail(c.config?.emailAddress ?? "");
      const ctx = await getOrderContext(c.fromEmail, c.inboundText);
      const draft = await generateDraft({
        inbound:      c.inboundText,
        fromName:     c.fromName,
        brandName,
        orderContext: ctx.found ? ctx.text : null,
      });
      await prisma.zohoConversation.update({
        where: { id: c.id },
        data: {
          aiDraft:      draft.respuesta,
          caseType:     draft.caseType,
          aiConfidence: draft.confianza,
          needsData:    JSON.stringify(draft.faltanDatos),
          orderContext: ctx.found ? ctx.text : null,
          status:       draft.escalar ? "escalated" : "draft",
        },
      });
      regen++;
    } catch {
      fail++;
    }
    await new Promise((r) => setTimeout(r, 1500));   // ritmo suave (límite Groq)
  }

  const pendientes = await prisma.zohoConversation.count({
    where: { status: { in: ["draft", "escalated", "needs_attention"] }, hidden: false },
  });

  return NextResponse.json({ ok: true, regenerados: regen, fallidos: fail, pendientes });
}
