/**
 * Verifica el formato real de los line items de Shopify (título + variante + qty)
 * para validar cómo el motor de COGS resuelve los costos por bundle.
 */
const STORES = [
  { name: "Glowmmi", shop: "glm-1694.myshopify.com", clientId: process.env.SHOPIFY_GLOWMMI_CLIENT_ID, clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET, authType: "json" },
  { name: "Balancea", shop: "mp0vab-bw.myshopify.com", clientId: process.env.SHOPIFY_BALANCEA_CLIENT_ID, clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET, authType: "urlencoded" },
];

async function getToken(s) {
  const url = `https://${s.shop}/admin/oauth/access_token`;
  const body = s.authType === "urlencoded"
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret }).toString()
    : JSON.stringify({ grant_type: "client_credentials", client_id: s.clientId, client_secret: s.clientSecret });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": s.authType === "urlencoded" ? "application/x-www-form-urlencoded" : "application/json" }, body });
  return (await res.json()).access_token;
}

for (const s of STORES) {
  const token = await getToken(s);
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const res = await fetch(
    `https://${s.shop}/admin/api/2024-01/orders.json?status=any&financial_status=paid&created_at_min=${since}&limit=30&fields=id,line_items`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  const data = await res.json();
  console.log(`\n══════ ${s.name} — line items últimos 14 días ══════`);
  const seen = new Set();
  for (const o of data.orders ?? []) {
    for (const li of o.line_items ?? []) {
      const key = `${li.title}||${li.variant_title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  título: "${li.title}" | variante: "${li.variant_title}" | qty: ${li.quantity} | precio: ${li.price}`);
    }
  }
  if (!seen.size) console.log("  (sin órdenes)");
}
