// Prueba rápida: gasto de los últimos 7 días por cuenta
const TOKEN = process.env.META_ADS_USER_TOKEN;
const ACCOUNTS = [
  ["act_584670343484624", "BANANA #9 (Glowmmi, USD)"],
  ["act_5751316951640293", "BANANA #8 (Balancea, USD)"],
  ["act_486942987769865", "Banana #1 (Balancea, COP)"],
];

const until = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);

for (const [acc, label] of ACCOUNTS) {
  const url = `https://graph.facebook.com/v19.0/${acc}/insights` +
    `?fields=spend,impressions,clicks&level=account` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    `&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) { console.log(`❌ ${label}: ${data.error.message.slice(0, 80)}`); continue; }
  const row = data.data?.[0];
  console.log(row
    ? `✅ ${label}: spend=${row.spend} | impresiones=${row.impressions} | clics=${row.clicks}`
    : `⚠️  ${label}: sin datos en los últimos 7 días`);
}
