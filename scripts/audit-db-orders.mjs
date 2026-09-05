import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

loadEnv({ path: ".env.local", override: true, quiet: true });
const prisma = new PrismaClient();
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split("=");
    return [key, rest.join("=")];
  }),
);
const from = args.get("--from") || "2026-03-01";
const to = args.get("--to") || new Date().toISOString().slice(0, 10);
const rows = await prisma.dailyMetric.findMany({
  where: {
    date: {
      gte: new Date(`${from}T00:00:00Z`),
      lte: new Date(`${to}T23:59:59Z`),
    },
    brandId: { in: ["brand_glowmmi", "brand_balancea", "brand_pleena"] },
  },
  select: { brandId: true, date: true, ordersCount: true },
});
const result = {};
for (const row of rows) {
  const store = row.brandId.replace("brand_", "");
  const day = row.date.toISOString().slice(0, 10);
  result[store] ||= { total: 0, byDay: {} };
  result[store].total += row.ordersCount;
  result[store].byDay[day] = (result[store].byDay[day] || 0) + row.ordersCount;
}
await prisma.$disconnect();
process.stdout.write(`${JSON.stringify({ from, to, stores: result }, null, 2)}\n`);
