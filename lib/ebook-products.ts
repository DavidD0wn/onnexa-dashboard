// ─── Config central de productos con ebooks ──────────────────────────────────
// Para agregar un nuevo producto: añade una entrada al objeto EBOOK_PRODUCTS.

export interface EbookFile {
  path:     string;
  filename: string;
  /** Keyword en el título del line-item de Shopify que activa este ebook */
  trigger:  string;
}

export interface EbookProduct {
  key:             string;
  name:            string;
  /** Keyword para detectar órdenes de este producto en Shopify */
  shopifyKeyword:  string;
  ebooks:          EbookFile[];
  buildEmail:      (nombre: string, ebookCount: number) => { subject: string; text: string };
}

const BASE = "C:\\Users\\hamle\\Desktop\\Tiendas\\Balancea";

export const EBOOK_PRODUCTS: Record<string, EbookProduct> = {

  // ── HerBiotic ──────────────────────────────────────────────
  herbiotic: {
    key:            "herbiotic",
    name:           "HerBiotic™",
    shopifyKeyword: "herbiotic",
    ebooks: [
      {
        trigger:  "infecciones",
        path:     `${BASE}\\HerBiotic\\Ebook\\Guía para evitar infecciones recurrentes — HerBiotic™.pdf`,
        filename: "Guía para evitar infecciones recurrentes — HerBiotic™.pdf",
      },
      {
        trigger:  "ritual",
        path:     `${BASE}\\HerBiotic\\Ebook\\Bienvenida a tu Ritual Íntimo 7D.pdf`,
        filename: "Bienvenida a tu Ritual Íntimo 7D.pdf",
      },
    ],
    buildEmail: (nombre, count) => {
      const hola = nombre ? `Hola ${nombre},` : "Hola,";
      if (count >= 2) {
        return {
          subject: "Tus dos ebooks de regalo — HerBiotic™ 💖",
          text: `${hola}

¡Gracias por formar parte de Glowmmi! 💖

Queremos consentirte con un regalo especial, por eso en este correo encontrarás adjuntos dos ebooks en formato PDF, diseñados para complementar tu experiencia y acompañarte durante tu proceso.

📚 Archivos adjuntos:
  • Guía para evitar infecciones recurrentes — HerBiotic™
  • Bienvenida a tu Ritual Íntimo 7D

Esperamos que disfrutes este contenido y que te sea de mucha utilidad.

Si tienes cualquier pregunta, no dudes en escribirnos. Estaremos felices de ayudarte.

¡Gracias por confiar en Glowmmi! ✨💕

Con cariño,
Equipo Glowmmi 💖`,
        };
      }
      return {
        subject: "Tu ebook de regalo — HerBiotic™ 💖",
        text: `${hola}

¡Muchas gracias por tu compra! 💖

Como parte de tu experiencia, queremos compartir contigo un material especial que hemos preparado para ayudarte a sacar el mayor provecho de tu proceso.

📖 En este correo encontrarás adjunto tu ebook en formato PDF.

Esperamos que esta guía te sea de gran ayuda y que puedas disfrutar de todo su contenido.

Si tienes alguna duda, estaremos encantados de ayudarte.

¡Gracias por confiar en nosotros! ✨

Con cariño,
Equipo Glowmmi 💕`,
      };
    },
  },

  // ── Cutting Mix ────────────────────────────────────────────
  "cutting-mix": {
    key:            "cutting-mix",
    name:           "Cutting Mix™",
    shopifyKeyword: "cutting mix",
    ebooks: [
      {
        trigger:  "protocolo",
        path:     `${BASE}\\Cutting Mix\\Ebook\\Protocolo Control de Antojos — Cutting Mix.pdf`,
        filename: "Protocolo Control de Antojos — Cutting Mix.pdf",
      },
      {
        trigger:  "recetario",
        path:     `${BASE}\\Cutting Mix\\Ebook\\Guia 200 Platillos - Recetario Cutting Mix.pdf`,
        filename: "Guía 200 Platillos — Recetario Cutting Mix.pdf",
      },
    ],
    buildEmail: (nombre, count) => {
      const hola = nombre ? `Hola ${nombre},` : "Hola,";
      if (count >= 2) {
        return {
          subject: "Tus 2 guías de regalo — Cutting Mix™ 💪",
          text: `${hola}

¡Gracias por tu compra de Cutting Mix™! 💪

Queremos ayudarte a sacar el máximo provecho a tu suplemento, por eso te enviamos dos guías especiales que van perfectas con tu proceso.

📚 Archivos adjuntos:
  • Protocolo Control de Antojos — Cutting Mix™
  • Guía 200 Platillos — Recetario Cutting Mix™

Con estas guías tendrás todo lo que necesitas para controlar los antojos, mantener la energía y alcanzar tus metas más rápido.

Si tienes cualquier pregunta, escríbenos y con gusto te ayudamos.

¡Mucho éxito en tu proceso! ✨

Con cariño,
Equipo Glowmmi 💚`,
        };
      }
      return {
        subject: "Tu guía de regalo — Cutting Mix™ 💪",
        text: `${hola}

¡Gracias por tu compra de Cutting Mix™! 💪

Para ayudarte a sacar el máximo provecho a tu suplemento, te enviamos esta guía especial que va perfecta con tu proceso.

📖 En este correo encontrarás adjunta tu guía en formato PDF: Protocolo Control de Antojos.

Con esta guía aprenderás a controlar los antojos, mantener la energía y alcanzar tus metas más rápido.

Si tienes cualquier pregunta, escríbenos y con gusto te ayudamos.

¡Mucho éxito en tu proceso! ✨

Con cariño,
Equipo Glowmmi 💚`,
      };
    },
  },
};

// ── Detectar cuántos ebooks corresponden a una orden ─────────
export function detectEbooks(
  lineItems: any[],
  product: EbookProduct
): EbookFile[] {
  const result: EbookFile[] = [];
  for (const ebook of product.ebooks) {
    const found = lineItems.some((item) =>
      (item.title ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .includes(ebook.trigger.toLowerCase())
    );
    if (found) result.push(ebook);
  }
  return result;
}
