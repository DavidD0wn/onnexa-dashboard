// responder-tracking-bot.cjs — responde TODOS los correos entrantes (Glowmmi + Balancea)
// con el link de rastreo 17TRACK, por lotes, remitente correcto por tienda, vía API Zoho.
const { PrismaClient } = require('@prisma/client');
const nodemailer = require('nodemailer');
const fs = require('fs');

function loadEnv(file){const o={};if(!fs.existsSync(file))return o;for(const l of fs.readFileSync(file,'utf8').split('\n')){if(l.trim().startsWith('#'))continue;const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m)o[m[1]]=m[2].replace(/^["']|["']$/g,'')}return o}
const denv = loadEnv(__dirname + '/.env');
const menv = loadEnv('C:/Users/hamle/Desktop/Claude Ayudas/mail-config.env');

const STORE = {
  'contact@glowmmi.store':  { nombre:'Glowmmi',  link:'https://glowmmi.store/apps/17TRACK',   emoji:'💛', smtpUser: denv.ZOHO_SMTP_EMAIL, smtpPass: denv.ZOHO_SMTP_PASSWORD },
  'contact@balanceaa.store':{ nombre:'Balancea', link:'https://balanceaa.store/apps/17TRACK', emoji:'💚', smtpUser: menv.BALANCEA_EMAIL, smtpPass: menv.BALANCEA_PASSWORD },
};

function noise(from, subj){from=(from||'').toLowerCase();subj=(subj||'').toLowerCase();
  if(/mailer-daemon|postmaster|no-?reply|donotreply|bounce@|notifications?@/.test(from))return 'auto';
  if(/undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned to sender|failure notice/.test(subj))return 'rebote';
  if(/@(shop\.)?tiktok\.com|@e?mail\.tiktok|@shopify\.com|@meta\.com|@facebookmail\.com|@mailchimp|@sendgrid|@klaviyo/.test(from))return 'plataforma';
  if(/unsubscribe|newsletter|webinar/.test(subj))return 'newsletter';
  return null;}

async function getToken(cfg){
  const r=await fetch(`${cfg.authDomain}/oauth/v2/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({refresh_token:cfg.refreshToken,grant_type:'refresh_token',client_id:denv.ZOHO_CLIENT_ID,client_secret:denv.ZOHO_CLIENT_SECRET}).toString()});
  const d=await r.json();if(!d.access_token)throw new Error('token: '+JSON.stringify(d).slice(0,150));return d.access_token;}
async function folderId(cfg,t){if(cfg.inboxFolderId)return cfg.inboxFolderId;const r=await fetch(`${cfg.apiDomain}/api/accounts/${cfg.accountId}/folders`,{headers:{Authorization:`Zoho-oauthtoken ${t}`}});const d=await r.json();const f=(d.data||[]).find(x=>x.folderName?.toLowerCase()==='inbox'||x.folderType?.toLowerCase()==='inbox');if(!f)throw new Error('sin inbox');return f.folderId;}
async function page(cfg,t,fid,start){const r=await fetch(`${cfg.apiDomain}/api/accounts/${cfg.accountId}/messages/view?folderId=${fid}&start=${start}&limit=50`,{headers:{Authorization:`Zoho-oauthtoken ${t}`}});const d=await r.json();return Array.isArray(d.data)?d.data:[];}
async function markRead(cfg,t,id){try{await fetch(`${cfg.apiDomain}/api/accounts/${cfg.accountId}/updatemessage`,{method:'PUT',headers:{Authorization:`Zoho-oauthtoken ${t}`,'Content-Type':'application/json'},body:JSON.stringify({mode:'markAsRead',messageId:[id]})});}catch{}}

const cuerpo = (s, nombre) => `¡Hola${nombre?` ${nombre}`:''}!\n\nGracias por escribirnos. Puedes rastrear tu pedido en cualquier momento aquí:\n👉 ${s.link}\n\nSolo ingresa y consulta el estado de tu envío. Cualquier duda, seguimos al pendiente. ${s.emoji}\n\n— Equipo ${s.nombre}`;

(async () => {
  const p = new PrismaClient();
  for (let i=0;i<5;i++){try{await p.$queryRaw`SELECT 1`;break}catch{await new Promise(r=>setTimeout(r,3000))}}
  const cfgs = await p.zohoBotConfig.findMany();
  const DIAS = 21, ahora = Date.now();

  for (const cfg of cfgs) {
    const s = STORE[cfg.emailAddress];
    if (!s) { console.log(`\n[${cfg.emailAddress}] sin mapeo de tienda, saltado`); continue; }
    if (!s.smtpUser || !s.smtpPass) { console.log(`\n[${s.nombre}] sin credenciales SMTP, saltado`); continue; }
    const tx = nodemailer.createTransport({ host:'smtp.zoho.com', port:465, secure:true, auth:{ user:s.smtpUser, pass:s.smtpPass } });
    let token, fid;
    try { token = await getToken(cfg); fid = await folderId(cfg, token); }
    catch (e) { console.log(`\n[${s.nombre}] ERROR auth: ${e.message}`); continue; }

    console.log(`\n=== ${s.nombre} (${cfg.emailAddress}) ===`);
    let replied=0, dup=0, ruido=0, viejo=0, err=0, bloqueado=false;
    for (let start=1; start<=301 && !bloqueado; start+=50) {
      const msgs = await page(cfg, token, fid, start);
      if (!msgs.length) break;
      for (const m of msgs) {
        const rt = m.receivedTime ? new Date(parseInt(m.receivedTime)) : null;
        if (rt && (ahora - rt.getTime()) > DIAS*86400000) { viejo++; continue; }
        const from = m.fromAddress || m.sender || '';
        if (from === cfg.emailAddress) continue;
        const nr = noise(from, m.subject); if (nr) { ruido++; continue; }
        const exists = await p.zohoConversation.findUnique({ where:{ messageId: m.messageId } });
        if (exists) { dup++; continue; }
        const subject = (m.subject||'').startsWith('Re:') ? m.subject : `Re: ${m.subject||''}`;
        const nombre = (m.sender||'').split(' ')[0] && !/[@<]/.test((m.sender||'').split(' ')[0]) ? (m.sender||'').split(' ')[0] : '';
        try {
          await tx.sendMail({ from:`"${s.nombre}" <${s.smtpUser}>`, to: from, subject, text: cuerpo(s, nombre) });
          await p.zohoConversation.create({ data:{ configId: cfg.id, messageId: m.messageId, fromEmail: from, fromName: m.sender||null, subject: m.subject||'(sin asunto)', inboundText: (m.summary||'').slice(0,500), outboundText: cuerpo(s,nombre), ruleMatched:'auto-tracking', status:'replied', source:'rule' } });
          await markRead(cfg, token, m.messageId);
          replied++;
          process.stdout.write(`  ✓ ${from}\n`);
          await new Promise(r=>setTimeout(r,4000));
        } catch (e) {
          const msg = String(e.message||e);
          if (/550|rate|blocked|too many|unusual/i.test(msg)) { console.log(`  ⛔ BLOQUEO Zoho: ${msg.slice(0,80)} — detengo ${s.nombre}`); bloqueado=true; break; }
          console.log(`  ✗ ${from}: ${msg.slice(0,80)}`); err++;
        }
      }
    }
    tx.close();
    console.log(`  → ${s.nombre}: respondidos=${replied} · ya_atendidos=${dup} · ruido=${ruido} · viejos=${viejo} · errores=${err}${bloqueado?' · DETENIDO por bloqueo':''}`);
  }
  await p.$disconnect();
  console.log('\nHecho.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
