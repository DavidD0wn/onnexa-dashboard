import "dotenv/config";

// Lista TODAS las cuentas publicitarias a las que el token tiene acceso real
const TOKEN = process.env.META_ADS_USER_TOKEN;
const META_VERSION = process.env.META_GRAPH_API_VERSION || "v19.0";

const url = `https://graph.facebook.com/${META_VERSION}/me/adaccounts?fields=id,name,currency,account_status&limit=100`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
const data = await res.json();

if (data.error) {
  console.log("❌ Error:", data.error.message);
} else {
  console.log("Cuentas accesibles con este token:\n");
  for (const acc of data.data ?? []) {
    console.log(`  ${acc.id} | ${acc.name} | ${acc.currency} | status: ${acc.account_status}`);
  }
}
