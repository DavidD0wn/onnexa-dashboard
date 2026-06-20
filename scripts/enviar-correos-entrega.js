/**
 * Envía correos a clientes de Glowmmi sobre incidencias de entrega.
 * Busca cada pedido en Shopify (email + nombre), arma el mensaje según el tipo
 * de problema y lo envía por Zoho SMTP (contact@glowmmi.store).
 *
 * USO:
 *   node scripts/enviar-correos-entrega.js          → DRY RUN (solo muestra, NO envía)
 *   node scripts/enviar-correos-entrega.js --enviar → ENVÍA de verdad
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const nodemailer = require("nodemailer");

const ENVIAR = process.argv.includes("--enviar");

// Pedidos a omitir (email inválido / revisar manual). #2611 Marvin → tahoo.com
const OMITIR = new Set([2611]);

// ── Pedidos con incidencia ───────────────────────────────────────
const PEDIDOS = [
  { num: 2611, guia: "JTHQ830000506159", tipo: "direccion" },
  { num: 2615, guia: "UL210506021YP",    tipo: "clima" },
  { num: 2494, guia: "UL188000204YP",    tipo: "direccion" },
  { num: 2575, guia: "UL200164203YP",    tipo: "direccion_intentos" },
  { num: 2574, guia: "UL200164185YP",    tipo: "ausente" },
  { num: 2578, guia: "JTHQ830000502536", tipo: "direccion" },
  { num: 1924, guia: "JTHQ830000471883", tipo: "direccion" },
];

// ── Mensajes por tipo de problema ────────────────────────────────
function buildEmail(nombre, num, guia, tipo) {
  const hola = nombre ? `Hola ${nombre},` : "Hola,";
  const firma = "\n\nCon cariño,\nEquipo Glowmmi 💚";

  if (tipo === "clima") {
    return {
      subject: `Tu pedido #${num} viene en camino — Glowmmi 💚`,
      text: `${hola}\n\nTe escribimos del equipo de Glowmmi para contarte sobre tu pedido #${num} (guía ${guia}).\n\nLa entrega presenta un pequeño retraso debido a condiciones climáticas en la ruta. Tu paquete está seguro y la transportadora lo entregará en cuanto las condiciones lo permitan.\n\nGracias por tu paciencia. Si tienes cualquier duda, respóndenos este correo y con gusto te ayudamos.${firma}`,
    };
  }
  if (tipo === "ausente") {
    return {
      subject: `No pudimos entregar tu pedido #${num} — Glowmmi 💚`,
      text: `${hola}\n\nTe escribimos del equipo de Glowmmi sobre tu pedido #${num} (guía ${guia}).\n\nLa transportadora intentó entregar tu paquete pero no había nadie en el domicilio. Realizará un nuevo intento de entrega en los próximos días.\n\nPara asegurar la entrega, te pedimos por favor:\n  • Estar pendiente del teléfono y del domicilio en los próximos días.\n  • Si prefieres otro horario o dirección, respóndenos este correo y lo coordinamos.\n\n¡Gracias por tu comprensión!${firma}`,
    };
  }
  if (tipo === "direccion_intentos") {
    return {
      subject: `Necesitamos confirmar tu dirección — pedido #${num} Glowmmi 💚`,
      text: `${hola}\n\nTe escribimos del equipo de Glowmmi sobre tu pedido #${num} (guía ${guia}).\n\nLa transportadora realizó varios intentos de entrega los días 11, 12, 13 y 14, pero no fue posible completarla: la dirección no pudo ser localizada y no logramos contactarte por teléfono.\n\nPara poder entregarte tu pedido, ¿podrías ayudarnos con lo siguiente?\n  • Confirmar tu dirección de entrega COMPLETA y correcta (calle, número, colonia, ciudad, estado, código postal y referencias).\n  • Un número de teléfono donde puedan contactarte.\n\nTambién puedes comunicarte directamente con la transportadora:\n  • Teléfono: 800 953 8888\n  • WhatsApp: 55 2948 4706\n\nQuedamos atentos para que tu pedido llegue lo antes posible.${firma}`,
    };
  }
  // tipo === "direccion" (por defecto)
  return {
    subject: `Necesitamos confirmar tu dirección — pedido #${num} Glowmmi 💚`,
    text: `${hola}\n\nTe escribimos del equipo de Glowmmi sobre tu pedido #${num} (guía ${guia}).\n\nLa transportadora no pudo completar la entrega por un inconveniente con la dirección registrada.\n\nPara poder enviarte tu pedido sin más demoras, ¿podrías confirmarnos tu dirección de entrega COMPLETA y correcta?\n  • Calle y número\n  • Colonia\n  • Ciudad y estado\n  • Código postal\n  • Referencias del domicilio\n  • Un teléfono de contacto\n\nEn cuanto nos confirmes los datos, coordinamos un nuevo envío. ¡Gracias por tu ayuda!${firma}`,
  };
}

// ── Shopify (credenciales desde .env) ────────────────────────────
const SHOP          = process.env.SHOPIFY_GLOWMMI_SHOP          || "glm-1694.myshopify.com";
const CLIENT_ID     = process.env.SHOPIFY_GLOWMMI_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) { console.error("❌ Faltan SHOPIFY_GLOWMMI_CLIENT_ID / SHOPIFY_GLOWMMI_CLIENT_SECRET en .env"); process.exit(1); }

async function getToken() {
  const r = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" }),
  });
  return (await r.json()).access_token;
}

// Trae pedidos en el rango de order_number que necesitamos y los indexa
async function fetchOrdersByNumber(token, numbers) {
  const want = new Set(numbers);
  const found = {};
  let url = `https://${SHOP}/admin/api/2024-01/orders.json?status=any&limit=250&fields=order_number,email,customer,shipping_address`;
  while (url) {
    const r = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (!r.ok) break;
    const d = await r.json();
    for (const o of d.orders ?? []) {
      if (want.has(o.order_number)) found[o.order_number] = o;
    }
    if (Object.keys(found).length === want.size) break;
    const next = (r.headers.get("Link") ?? "").match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return found;
}

// ── Main ─────────────────────────────────────────────────────────
(async () => {
  console.log(ENVIAR ? "🚀 MODO ENVÍO REAL\n" : "🔍 DRY RUN (no se envía nada)\n");

  const token = await getToken();
  const orders = await fetchOrdersByNumber(token, PEDIDOS.map(p => p.num));

  const transporter = ENVIAR ? nodemailer.createTransport({
    host: "smtp.zoho.com", port: 465, secure: true,
    auth: { user: process.env.ZOHO_SMTP_EMAIL, pass: process.env.ZOHO_SMTP_PASSWORD },
  }) : null;

  let ok = 0, sinEmail = 0, noEncontrado = 0, omitidos = 0;
  for (const ped of PEDIDOS) {
    if (OMITIR.has(ped.num)) { console.log(`⏭️  #${ped.num}: omitido (revisar manual)\n`); omitidos++; continue; }
    const o = orders[ped.num];
    if (!o) { console.log(`❌ #${ped.num}: no encontrado en Shopify`); noEncontrado++; continue; }
    const email = o.email ?? o.customer?.email ?? "";
    const nombre = o.customer?.first_name ?? o.shipping_address?.first_name ?? "";
    if (!email) { console.log(`⚠️  #${ped.num}: sin email registrado`); sinEmail++; continue; }

    const { subject, text } = buildEmail(nombre, ped.num, ped.guia, ped.tipo);
    console.log(`📧 #${ped.num} → ${email} (${nombre || "sin nombre"}) | tipo: ${ped.tipo}`);
    console.log(`   Asunto: ${subject}`);

    if (ENVIAR) {
      try {
        await transporter.sendMail({ from: `"Glowmmi" <${process.env.ZOHO_SMTP_EMAIL}>`, to: email, subject, text });
        console.log(`   ✅ Enviado`);
        ok++;
      } catch (e) {
        console.log(`   ❌ Error al enviar: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    } else {
      ok++;
    }
    console.log("");
  }

  console.log(`\n── Resumen ──`);
  console.log(`${ENVIAR ? "Enviados" : "Listos para enviar"}: ${ok} | Sin email: ${sinEmail} | No encontrados: ${noEncontrado}`);
  if (!ENVIAR) console.log(`\nPara enviar de verdad: node scripts/enviar-correos-entrega.js --enviar`);
})();
