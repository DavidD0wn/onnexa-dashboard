import "dotenv/config";
import dns from "node:dns";
import { resolve4 } from "node:dns/promises";
import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

dns.setDefaultResultOrder("ipv4first");
const configured = process.env.DATABASE_URL;
if (!configured) throw new Error("DATABASE_URL no configurada.");
const url = new URL(configured);
const endpointId = url.hostname.split(".")[0].replace(/-pooler$/, "");
if (url.hostname.endsWith(".aws.neon.tech") && !url.hostname.includes("-pooler.")) {
  const dot = url.hostname.indexOf(".");
  url.hostname = `${url.hostname.slice(0, dot)}-pooler${url.hostname.slice(dot)}`;
}
if (url.hostname.endsWith(".aws.neon.tech")) {
  const forced = process.env.NEON_IPV4_HOST;
  const ipv4 = forced ? [forced] : await resolve4(url.hostname).catch(() => []);
  if (ipv4.length && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipv4[0])) {
    url.hostname = ipv4[0];
    url.searchParams.set("options", `endpoint=${endpointId}`);
  }
}
url.searchParams.set("connect_timeout", "10");
url.searchParams.set("pool_timeout", "15");
url.searchParams.set("connection_limit", "2");
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
try {
  const ddl = await fs.readFile(new URL("../prisma/daily-financial-report.sql", import.meta.url), "utf8");
  for (const statement of ddl.split(/;\s*(?:\r?\n|$)/).map((part) => part.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
  const rows = await prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM "DailyFinancialReport"');
  console.log(`DailyFinancialReport lista (${String(rows[0].count)} registros).`);
} finally {
  await prisma.$disconnect();
}
