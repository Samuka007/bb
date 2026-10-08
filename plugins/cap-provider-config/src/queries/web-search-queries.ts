import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { fetchWithAppSurface } from "./provider-config-queries.js";

/**
 * #449 the web_search engine-chain write face: GET/PUT
 * /api/v1/system/web-search. The D1 `web_search` row is the sole 正本 (the
 * AGENT_DO_WEB_SEARCH env path is deleted — zero env fallback): `chain` is
 * the effective ordered chain with per-engine credential gates, `engines`
 * the zero-secret editable detail (non-secret values readable, secret
 * PRESENCE only), `availableEngines` the writable vocabulary. The companion
 * read face is the provider-projections webSearch row, refreshed through the
 * same invalidation.
 */

/** Plugin-local key: the app's core query-keys.ts stays pristine (#382). */
export const WEB_SEARCH_QUERY_KEY = "webSearch" as const;

const engineProjectionSchema = z.object({
  engine: z.string(),
  credentialsRequired: z.boolean(),
  credentialsPresent: z.boolean(),
});

export const webSearchResponseSchema = z.object({
  configured: z.boolean(),
  decodeError: z.boolean(),
  chain: z.array(engineProjectionSchema),
  timeoutSeconds: z.number().nullable(),
  browserBackedEngines: z.array(z.string()),
  availableEngines: z.array(z.string()),
  engines: z.object({
    brave: z.object({ hasApiKey: z.boolean() }),
    searxng: z.object({
      endpoint: z.string().nullable(),
      categories: z.string().nullable(),
      language: z.string().nullable(),
      safesearch: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
      hasToken: z.boolean(),
      hasBasicAuth: z.boolean(),
    }),
  }),
});

export type WebSearchResponse = z.infer<typeof webSearchResponseSchema>;

/**
 * The PUT request: `chain` is the full ordered chain; every engine field is
 * TRI-STATE — absent keeps the stored value, null clears, a string sets.
 */
export interface WebSearchPutRequest {
  chain?: string[];
  timeoutSeconds?: number;
  engines?: {
    brave?: { apiKey?: string | null };
    searxng?: {
      endpoint?: string | null;
      token?: string | null;
      basicUsername?: string | null;
      basicPassword?: string | null;
      categories?: string | null;
      language?: string | null;
      safesearch?: 0 | 1 | 2 | null;
    };
  };
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    return body.message ?? body.code ?? `HTTP ${String(response.status)}`;
  } catch {
    return `HTTP ${String(response.status)}`;
  }
}

export async function fetchWebSearch(): Promise<WebSearchResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/web-search", { method: "GET" });
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return webSearchResponseSchema.parse(await response.json());
}

export async function putWebSearch(
  payload: WebSearchPutRequest,
): Promise<WebSearchResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/web-search", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return webSearchResponseSchema.parse(await response.json());
}

export function useWebSearch(options: { enabled?: boolean } = {}): {
  data?: WebSearchResponse;
  error: Error | null;
  isPending: boolean;
  refetch: () => Promise<void>;
} {
  const query = useQuery<WebSearchResponse, Error>({
    queryKey: [WEB_SEARCH_QUERY_KEY],
    queryFn: fetchWebSearch,
    enabled: options.enabled ?? true,
  });
  return {
    data: query.data,
    error: query.error,
    isPending: query.isPending,
    refetch: async () => {
      await query.refetch();
    },
  };
}

/**
 * Write the engine-chain face. Both this face and the projections webSearch
 * row fold from the same D1 seat, so the write invalidates both.
 */
export function useSetWebSearch(): {
  save: (payload: WebSearchPutRequest) => Promise<WebSearchResponse>;
  isPending: boolean;
} {
  const pluginQueryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: WebSearchPutRequest) => putWebSearch(payload),
    onSuccess: () => {
      void pluginQueryClient.invalidateQueries({ queryKey: [WEB_SEARCH_QUERY_KEY] });
      void pluginQueryClient.invalidateQueries({ queryKey: ["providerProjections"] });
    },
  });
  return { save: mutation.mutateAsync, isPending: mutation.isPending };
}
