// Muestra campañas recientes de cada cuenta para inferir la marca
const TOKEN = process.env.META_ADS_USER_TOKEN;

const ACCOUNTS = [
  "act_5751316951640293",
  "act_584670343484624",
  "act_486942987769865",
];

for (const acc of ACCOUNTS) {
  const url = `https://graph.facebook.com/v19.0/${acc}/campaigns?fields=name,status,effective_status&limit=15&access_token=${TOKEN}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`\n══ ${acc} ══`);
  if (data.error) { console.log("  ❌", data.error.message); continue; }
  for (const c of data.data ?? []) {
    console.log(`  [${c.effective_status}] ${c.name}`);
  }
  if (!(data.data ?? []).length) console.log("  (sin campañas)");
}
