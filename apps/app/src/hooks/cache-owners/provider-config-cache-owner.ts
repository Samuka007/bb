import type { QueryClient } from "@tanstack/react-query";
import {
  SYSTEM_PROVIDER_PROJECTIONS_QUERY_KEY,
  SYSTEM_PROVIDERS_QUERY_KEY,
  allSystemExecutionOptionsQueryKeyPrefix,
} from "../queries/query-keys";

/**
 * Cache owner for the user-face provider configuration (#362). A panel write
 * lands the D1 provider_configs 正本: the CRUD list moves, and because the
 * merged directory feeds both the execution-options pickers and the
 * read-only projection status, all three faces invalidate together.
 */
export function invalidateProviderConfigFaces(args: { queryClient: QueryClient }): void {
  void args.queryClient.invalidateQueries({
    queryKey: [SYSTEM_PROVIDERS_QUERY_KEY],
  });
  void args.queryClient.invalidateQueries({
    queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
  });
  void args.queryClient.invalidateQueries({
    queryKey: [SYSTEM_PROVIDER_PROJECTIONS_QUERY_KEY],
  });
}
