import { NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AppEntry } from "@/app/api/apps/route";

const FILE = join(process.cwd(), "data", "app-costs.json");

const STORES = [
  {
    id:           "brand_glowmmi" as const,
    shop:         process.env.SHOPIFY_GLOWMMI_SHOP!,
    clientId:     process.env.SHOPIFY_GLOWMMI_CLIENT_ID!,
    clientSecret: process.env.SHOPIFY_GLOWMMI_CLIENT_SECRET!,
    isBalancea:   false,
  },
  {
    id:           "brand_balancea" as const,
    shop:         process.env.SHOPIFY_BALANCEA_SHOP!,
    clientId:     process.env.SHOPIFY_BALANCEA_CLIENT_ID!,
    clientSecret: process.env.SHOPIFY_BALANCEA_CLIENT_SECRET!,
    isBalancea:   true,
  },
];

async function getToken(store: typeof STORES[0]): Promise<string> {
  const body = store.isBalancea
    ? new URLSearchParams({ grant_type: "client_credentials", client_id: store.clientId, client_secret: store.clientSecret }).toString()
    : JSON.stringify({ client_id: store.clientId, client_secret: store.clientSecret, grant_type: "client_credentials" });
  const res = await fetch(`https://${store.shop}/admin/oauth/access_token`, {
    method:  "POST",
    headers: { "Content-Type": store.isBalancea ? "application/x-www-form-urlencoded" : "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Auth ${store.shop} → ${res.status}`);
  return (await res.json()).access_token as string;
}

// Guess category from app name
function guessCategory(name: string): AppEntry["category"] {
  const n = name.toLowerCase();
  if (n.includes("shipping") || n.includes("envío") || n.includes("fulfillment") || n.includes("ship")) return "envio";
  if (n.includes("email") || n.includes("sms") || n.includes("marketing") || n.includes("klaviyo") || n.includes("omnisend")) return "marketing";
  if (n.includes("review") || n.includes("reseña") || n.includes("judge") || n.includes("yotpo")) return "analitica";
  if (n.includes("chat") || n.includes("support") || n.includes("help") || n.includes("atención")) return "atencion";
  if (n.includes("report") || n.includes("analytic") || n.includes("profit") || n.includes("insight")) return "analitica";
  if (n.includes("inventory") || n.includes("inventario") || n.includes("stock")) return "inventario";
  if (n.includes("design") || n.includes("diseño") || n.includes("page") || n.includes("theme")) return "diseno";
  if (n.includes("payment") || n.includes("finance") || n.includes("invoice") || n.includes("tax")) return "finanzas";
  return "plataforma";
}

// Apps to skip (internal Shopify / our own / no real cost)
const SKIP_APPS = new Set([
  "shopify claude connector app", "glowmmi api", "balancea api",
  "messaging", "facebook & instagram", "google & youtube",
  "shopify email", "inbox",
]);

export async function POST() {
  let file: { apps: AppEntry[] };
  try { file = JSON.parse(readFileSync(FILE, "utf-8")); }
  catch { file = { apps: [] }; }

  const discovered: AppEntry[] = [];
  const errors: string[]       = [];

  for (const store of STORES) {
    try {
      const token = await getToken(store);

      // Use GraphQL appInstallations (requires read_apps scope)
      const gql = `{
        appInstallations(first: 100) {
          edges { node { app { title id } } }
        }
      }`;
      const res = await fetch(`https://${store.shop}/admin/api/2024-01/graphql.json`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body:    JSON.stringify({ query: gql }),
      });
      if (!res.ok) { errors.push(`${store.id}: HTTP ${res.status}`); continue; }
      const json        = await res.json();
      const edges       = json?.data?.appInstallations?.edges ?? [];
      const today       = new Date().toISOString().slice(0, 10);

      for (const { node } of edges) {
        const name   = String(node.app?.title ?? "").trim();
        const nameLC = name.toLowerCase();
        if (!name || SKIP_APPS.has(nameLC)) continue;

        const synthId = `shopify-${store.id}-${encodeURIComponent(nameLC).slice(0, 40)}`;

        // If we already have this app (by id or name+store), keep its cost
        const existing = file.apps.find(
          (a) => a.id === synthId || (a.name.toLowerCase() === nameLC && a.store === store.id)
        );

        discovered.push({
          id:           existing?.id ?? synthId,
          name:         name,
          store:        store.id,
          category:     existing?.category ?? guessCategory(name),
          costUsd:      existing?.costUsd       ?? 0,   // Keep existing cost or default to 0
          billingCycle: existing?.billingCycle   ?? "monthly",
          active:       existing?.active         ?? true,
          startDate:    existing?.startDate      ?? today,
          notes:        existing?.notes          ?? `Detectada de Shopify · costo a ingresar manualmente`,
        });
      }
    } catch (e: any) {
      console.warn(`[apps-sync] ${store.id}:`, e?.message);
      errors.push(`${store.id}: ${e?.message}`);
    }
  }

  // Keep purely manual entries (not from Shopify), replace Shopify-detected ones
  const manual  = file.apps.filter((a) => !a.id.startsWith("shopify-"));
  const merged  = [...manual, ...discovered];
  writeFileSync(FILE, JSON.stringify({ apps: merged }, null, 2), "utf-8");

  return NextResponse.json({
    ok:           errors.length === 0,
    discovered:   discovered.length,
    manual:       manual.length,
    total:        merged.length,
    newApps:      discovered.filter(d => !file.apps.find(e => e.id === d.id)).map(d => d.name),
    errors,
  });
}
