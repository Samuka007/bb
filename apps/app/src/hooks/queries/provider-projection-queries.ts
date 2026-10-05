import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { fetchWithAppSurface } from "@/lib/app-surface";
import {
  systemProviderProjectionsQueryKey,
  type SystemProviderProjectionsQueryKey,
} from "./query-keys";
import { SERVER_SESSION_QUERY_POLICY } from "./query-policies";

/**
 * Provider read-only projections (#266). Port-only face: the fork's server
 * exposes `GET /system/provider-projections` (#255 solution C — the config
 * source of truth stays the deployment env, this is status only). Typed here
 * against the wire shape instead of `@bb/server-contract`, which ports bb
 * upstream verbatim and has no such endpoint.
 */

const providerWebSearchEngineProjectionSchema = z.object({
  engine: z.string(),
  credentialsRequired: z.boolean(),
  credentialsPresent: z.boolean(),
});

export const providerProjectionsResponseSchema = z.object({
  harness: z.object({
    relayMode: z.string(),
    relayBaseUrl: z.string(),
    relayBaseUrlHost: z.string().nullable(),
    relayKeyPresent: z.boolean(),
    relayModel: z.string(),
    relayMaxTokens: z.number(),
    relayThinking: z.string(),
    machineId: z.string(),
    executionModel: z.string(),
    executionServiceTier: z.string(),
    executionReasoningLevel: z.string(),
    permissionMode: z.string(),
  }),
  webSearch: z.object({
    configured: z.boolean(),
    decodeError: z.boolean(),
    chain: z.array(providerWebSearchEngineProjectionSchema),
    timeoutSeconds: z.number().nullable(),
    browserBackedEngines: z.array(z.string()),
  }),
});

export type ProviderProjectionsResponse = z.infer<
  typeof providerProjectionsResponseSchema
>;

export type SystemProviderProjectionsQuery = {
  data?: ProviderProjectionsResponse;
  error: Error | null;
  isPending: boolean;
};

export function useProviderProjections(
  options: { enabled?: boolean } = {},
): SystemProviderProjectionsQuery {
  const query = useQuery<
    ProviderProjectionsResponse,
    Error,
    ProviderProjectionsResponse,
    SystemProviderProjectionsQueryKey
  >({
    queryKey: systemProviderProjectionsQueryKey(),
    queryFn: async ({ signal }) => {
      const response = await fetchWithAppSurface(
        "/api/v1/system/provider-projections",
        { signal },
      );
      if (!response.ok) {
        throw new Error(
          `Provider projections request failed (${String(response.status)})`,
        );
      }
      return providerProjectionsResponseSchema.parse(await response.json());
    },
    enabled: options.enabled ?? true,
    // Deployment-env facts: they only change on a redeploy, not while the
    // page is open. Session policy (1h) keeps that freshness while still
    // retrying a failed first fetch on the next mount.
    ...SERVER_SESSION_QUERY_POLICY,
  });
  return {
    data: query.data,
    error: query.error,
    isPending: query.isPending,
  };
}
