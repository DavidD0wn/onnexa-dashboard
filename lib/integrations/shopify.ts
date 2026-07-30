type ShopifyStoreKey = "glowmmi" | "balancea";
type ShopifyAuthType = "json" | "urlencoded";

export type ShopifyStoreConfig = {
  key: ShopifyStoreKey;
  shop: string;
  clientId: string;
  clientSecret: string;
  staticToken: string;
  authType: ShopifyAuthType;
  brandId: string;
  brandName: "Glowmmi" | "Balancea";
  countryId: string;
  storeId: string;
  currency: "USD" | "MXN";
  payoutCurrency: "USD" | "MXN";
  gatewayPct: number;
  gatewayFixed: number;
  splitByCountry: boolean;
  storeUtcOffset: number;
  color: string;
};

export const SHOPIFY_API_VERSION =
  process.env.SHOPIFY_API_VERSION?.trim() || "2026-07";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const tokenCache = new Map<ShopifyStoreKey, { token: string; expiresAt: number }>();

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function normalizeShop(value: string, fallback: string): string {
  const shop = (value || fallback)
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error(`Dominio Shopify inválido para ${fallback}`);
  }
  return shop;
}

function authType(value: string, fallback: ShopifyAuthType): ShopifyAuthType {
  return value === "json" || value === "urlencoded" ? value : fallback;
}

export function getShopifyStores(): Record<ShopifyStoreKey, ShopifyStoreConfig> {
  return {
    glowmmi: {
      key: "glowmmi",
      shop: normalizeShop(env("SHOPIFY_GLOWMMI_SHOP"), "glm-1694.myshopify.com"),
      clientId: env("SHOPIFY_GLOWMMI_CLIENT_ID"),
      clientSecret: env("SHOPIFY_GLOWMMI_CLIENT_SECRET"),
      staticToken: env("SHOPIFY_GLOWMMI_TOKEN"),
      authType: authType(env("SHOPIFY_GLOWMMI_AUTH_TYPE"), "json"),
      brandId: "brand_glowmmi",
      brandName: "Glowmmi",
      countryId: "country_us",
      storeId: "store_glowmmi_us",
      currency: "MXN",
      payoutCurrency: "USD",
      gatewayPct: 0.029,
      gatewayFixed: 0.3,
      splitByCountry: true,
      storeUtcOffset: -6,
      color: "#EC4899",
    },
    balancea: {
      key: "balancea",
      shop: normalizeShop(env("SHOPIFY_BALANCEA_SHOP"), "mp0vab-bw.myshopify.com"),
      clientId: env("SHOPIFY_BALANCEA_CLIENT_ID"),
      clientSecret: env("SHOPIFY_BALANCEA_CLIENT_SECRET"),
      staticToken: env("SHOPIFY_BALANCEA_TOKEN"),
      authType: authType(env("SHOPIFY_BALANCEA_AUTH_TYPE"), "urlencoded"),
      brandId: "brand_balancea",
      brandName: "Balancea",
      countryId: "country_mx",
      storeId: "store_balancea_mx",
      currency: "MXN",
      payoutCurrency: "USD",
      gatewayPct: 0.036,
      gatewayFixed: 0,
      splitByCountry: true,
      storeUtcOffset: -6,
      color: "#10B981",
    },
  };
}

export function getShopifyStore(key: string): ShopifyStoreConfig {
  const stores = getShopifyStores();
  if (key !== "glowmmi" && key !== "balancea") {
    throw new Error("Tienda no válida. Usa 'glowmmi' o 'balancea'");
  }
  return stores[key];
}

export function shopifyRestUrl(
  store: ShopifyStoreConfig,
  resource: string,
): string {
  const clean = resource.replace(/^\/+/, "");
  return `https://${store.shop}/admin/api/${SHOPIFY_API_VERSION}/${clean}`;
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response
    ? Number.parseFloat(response.headers.get("retry-after") ?? "")
    : Number.NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 30_000);
  }
  const backoff = Math.min(750 * 2 ** attempt, 20_000);
  return backoff + Math.floor(Math.random() * 250);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getShopifyAccessToken(
  store: ShopifyStoreConfig,
): Promise<string> {
  const cached = tokenCache.get(store.key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  if (!store.clientId || !store.clientSecret) {
    if (store.staticToken) return store.staticToken;
    throw new Error(
      `Faltan credenciales de Shopify para ${store.brandName}. Revisa SHOPIFY_${store.key.toUpperCase()}_CLIENT_ID y CLIENT_SECRET.`,
    );
  }

  const payload = {
    grant_type: "client_credentials",
    client_id: store.clientId,
    client_secret: store.clientSecret,
  };
  const body =
    store.authType === "urlencoded"
      ? new URLSearchParams(payload).toString()
      : JSON.stringify(payload);
  const contentType =
    store.authType === "urlencoded"
      ? "application/x-www-form-urlencoded"
      : "application/json";

  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(`https://${store.shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": contentType, Accept: "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          access_token?: string;
          expires_in?: number;
        };
        if (!data.access_token) throw new Error("Shopify no devolvió access_token");
        tokenCache.set(store.key, {
          token: data.access_token,
          expiresAt: Date.now() + Math.max(300, data.expires_in ?? 3600) * 1000,
        });
        return data.access_token;
      }

      const detail = (await response.text()).slice(0, 180);
      lastError = `HTTP ${response.status}: ${detail}`;
      if (!RETRYABLE_STATUS.has(response.status)) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(retryDelayMs(response, attempt));
  }

  if (store.staticToken) return store.staticToken;
  throw new Error(`No fue posible autenticar ${store.brandName}: ${lastError}`);
}

function assertStoreUrl(store: ShopifyStoreConfig, value: string): URL {
  const url = new URL(value, `https://${store.shop}`);
  if (url.protocol !== "https:" || url.hostname !== store.shop) {
    throw new Error(`Shopify devolvió una URL de paginación no confiable para ${store.brandName}`);
  }
  return url;
}

export async function shopifyFetch(
  store: ShopifyStoreConfig,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = assertStoreUrl(store, input);
  let token = await getShopifyAccessToken(store);
  let lastError = "";
  let staticTokenTried = token === store.staticToken;

  for (let attempt = 0; attempt < 8; attempt++) {
    let response: Response | null = null;
    try {
      const headers = new Headers(init.headers);
      headers.set("X-Shopify-Access-Token", token);
      headers.set("Accept", "application/json");

      response = await fetch(url, {
        ...init,
        headers,
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });

      if (response.status === 401 && attempt === 0) {
        tokenCache.delete(store.key);
        token = await getShopifyAccessToken(store);
        continue;
      }
      if (
        response.status === 401 &&
        store.staticToken &&
        !staticTokenTried
      ) {
        token = store.staticToken;
        staticTokenTried = true;
        continue;
      }

      if (response.ok) return response;

      const detail = (await response.clone().text()).slice(0, 240);
      lastError = `HTTP ${response.status}: ${detail}`;
      if (!RETRYABLE_STATUS.has(response.status)) {
        throw new Error(`Shopify ${store.brandName} respondió ${lastError}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 7) break;
    }
    await sleep(retryDelayMs(response, attempt));
  }

  throw new Error(
    `Shopify ${store.brandName} no respondió después de varios intentos: ${lastError}`,
  );
}

export async function fetchShopifyPaginated<T>(
  store: ShopifyStoreConfig,
  startUrl: string,
  responseKey: string,
): Promise<T[]> {
  const rows: T[] = [];
  const seenIds = new Set<string>();
  let nextUrl: string | null = startUrl;
  let pages = 0;

  while (nextUrl) {
    if (++pages > 500) {
      throw new Error(`Paginación Shopify anormalmente larga para ${store.brandName}`);
    }
    const response = await shopifyFetch(store, nextUrl);
    const payload = (await response.json()) as Record<string, unknown>;
    const pageRows = payload[responseKey];
    if (!Array.isArray(pageRows)) {
      throw new Error(`Respuesta Shopify inválida: falta '${responseKey}'`);
    }
    for (const row of pageRows as T[]) {
      const id =
        row && typeof row === "object" && "id" in row
          ? String((row as { id?: unknown }).id ?? "")
          : "";
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      rows.push(row);
    }

    const match = (response.headers.get("link") ?? "").match(
      /<([^>]+)>;\s*rel="next"/,
    );
    nextUrl = match?.[1] ?? null;
  }

  return rows;
}

export function clearShopifyTokenCache(): void {
  tokenCache.clear();
}
