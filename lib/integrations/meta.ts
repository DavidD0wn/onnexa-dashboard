import { createHmac } from "crypto";

export const META_GRAPH_API_VERSION = (() => {
  const configured = process.env.META_GRAPH_API_VERSION?.trim() || "v19.0";
  return configured.startsWith("v") ? configured : `v${configured}`;
})();

const BASE_URL = "https://graph.facebook.com";
const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_META_CODES = new Set([1, 2, 4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004]);

export type MetaApiErrorPayload = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  is_transient?: boolean;
};

export class MetaGraphError extends Error {
  status: number;
  code: number | null;
  subcode: number | null;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: number | null;
      subcode?: number | null;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "MetaGraphError";
    this.status = options.status ?? 500;
    this.code = options.code ?? null;
    this.subcode = options.subcode ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function credentials(): { token: string; appSecret: string } {
  const token = process.env.META_ADS_USER_TOKEN?.trim() ?? "";
  if (!token) throw new MetaGraphError("Falta META_ADS_USER_TOKEN", { status: 401 });
  const useAppSecretProof =
    process.env.META_USE_APPSECRET_PROOF?.trim().toLowerCase() === "true";
  return {
    token,
    appSecret: useAppSecretProof
      ? process.env.META_APP_SECRET?.trim() ?? ""
      : "",
  };
}

function safeMetaUrl(pathOrUrl: string): URL {
  const path = pathOrUrl.replace(/^\/+/, "");
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${BASE_URL}/${META_GRAPH_API_VERSION}/${path}`);
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
    throw new MetaGraphError("Meta devolvió una URL de paginación no confiable");
  }
  url.searchParams.delete("access_token");
  return url;
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response
    ? Number.parseFloat(response.headers.get("retry-after") ?? "")
    : Number.NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  return Math.min(1000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 300);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function metaGraphGet<T>(
  pathOrUrl: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const { token, appSecret } = credentials();
  const url = safeMetaUrl(pathOrUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  if (appSecret) {
    url.searchParams.set(
      "appsecret_proof",
      createHmac("sha256", appSecret).update(token).digest("hex"),
    );
  }

  let lastError: MetaGraphError | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    let response: Response | null = null;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: MetaApiErrorPayload;
      };
      if (response.ok && !payload.error) return payload as T;

      const metaError = payload.error ?? {};
      const code = metaError.code ?? null;
      const retryable =
        RETRYABLE_HTTP.has(response.status) ||
        metaError.is_transient === true ||
        (code !== null && RETRYABLE_META_CODES.has(code));
      lastError = new MetaGraphError(
        metaError.message || `Meta respondió HTTP ${response.status}`,
        {
          status: response.status,
          code,
          subcode: metaError.error_subcode ?? null,
          retryable,
        },
      );

      if (code === 190 || !retryable) throw lastError;
    } catch (error) {
      if (error instanceof MetaGraphError && !error.retryable) throw error;
      lastError =
        error instanceof MetaGraphError
          ? error
          : new MetaGraphError(
              error instanceof Error ? error.message : String(error),
              { retryable: true },
            );
    }

    if (attempt < 7) await sleep(retryDelayMs(response, attempt));
  }

  throw lastError ?? new MetaGraphError("Meta no respondió");
}

export async function fetchMetaPages<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | undefined;
  let pages = 0;

  do {
    if (++pages > 1000) throw new MetaGraphError("Paginación Meta anormalmente larga");
    const payload = await metaGraphGet<{
      data?: T[];
      paging?: { cursors?: { after?: string } };
    }>(path, { ...params, after });

    if (!Array.isArray(payload.data)) {
      throw new MetaGraphError("Meta devolvió una respuesta sin data[]");
    }
    rows.push(...payload.data);
    after = payload.paging?.cursors?.after;
  } while (after);

  return rows;
}
