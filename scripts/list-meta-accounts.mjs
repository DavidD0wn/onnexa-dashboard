// Lista TODAS las cuentas publicitarias a las que el token tiene acceso real
const TOKEN = process.env.META_ADS_USER_TOKEN;

const url = `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,currency,account_status&limit=100&access_token=${TOKEN}`;
const res = await fetch(url);
const data = await res.json();

if (data.error) {
  console.log("❌ Error:", data.error.message);
} else {
  console.log("Cuentas accesibles con este token:\n");
  for (const acc of data.data ?? []) {
    console.log(`  ${acc.id} | ${acc.name} | ${acc.currency} | status: ${acc.account_status}`);
  }
}
