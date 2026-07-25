import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getShopifyStores,
  SHOPIFY_API_VERSION,
  shopifyFetch,
  shopifyRestUrl,
} from "@/lib/integrations/shopify";
import {
  META_GRAPH_API_VERSION,
  metaGraphGet,
} from "@/lib/integrations/meta";

type Check = {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
};

async function shopifyCheck(
  key: "glowmmi" | "balancea",
): Promise<Check> {
  try {
    const store = getShopifyStores()[key];
    const response = await shopifyFetch(
      store,
      shopifyRestUrl(store, "shop.json") +
        "?fields=id,name,currency,iana_timezone",
    );
    const payload = (await response.json()) as {
      shop?: {
        id?: number;
        name?: string;
        currency?: string;
        iana_timezone?: string;
      };
    };
    return {
      ok: true,
      message: `${store.brandName} conectada`,
      details: {
        shop: store.shop,
        name: payload.shop?.name,
        currency: payload.shop?.currency,
        timezone: payload.shop?.iana_timezone,
        requestedApiVersion: SHOPIFY_API_VERSION,
        servedApiVersion:
          response.headers.get("x-shopify-api-version") ?? "no informado",
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function metaCheck(): Promise<Check> {
  try {
    const me = await metaGraphGet<{ id?: string; name?: string }>("me", {
      fields: "id,name",
    });
    return {
      ok: true,
      message: "Meta Ads conectado",
      details: {
        userId: me.id,
        name: me.name,
        apiVersion: META_GRAPH_API_VERSION,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      details: { apiVersion: META_GRAPH_API_VERSION },
    };
  }
}

async function databaseCheck(): Promise<Check> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, message: "Base de datos conectada" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET() {
  const [database, glowmmi, balancea, meta] = await Promise.all([
    databaseCheck(),
    shopifyCheck("glowmmi"),
    shopifyCheck("balancea"),
    metaCheck(),
  ]);
  const checks = { database, shopify: { glowmmi, balancea }, meta };
  const ok = database.ok && glowmmi.ok && balancea.ok && meta.ok;

  return NextResponse.json(
    { ok, checkedAt: new Date().toISOString(), checks },
    { status: ok ? 200 : 503 },
  );
}
