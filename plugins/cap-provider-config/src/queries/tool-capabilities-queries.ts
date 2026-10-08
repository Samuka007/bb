import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { fetchWithAppSurface } from "./provider-config-queries.js";

/**
 * #502 the experimental tool-capability face: GET/PUT
 * /api/v1/system/tool-capabilities. The three #150 gates — think /
 * context_notes + new_context / checkpoint + rewind — live in the D1
 * `tool_capabilities` single-row seat (the only 正本; the deployment env
 * gates are deleted, zero env fallback). `configured: false` means no row
 * exists yet, which is the omp posture: all five tools off. Every write is
 * hot-applied on the next turn (the agent DO's refresh rides the same
 * provider-overlay fingerprint as the provider rows).
 */

/** Plugin-local key: the app's core query-keys.ts stays pristine (#382). */
export const TOOL_CAPABILITIES_QUERY_KEY = "toolCapabilities" as const;

export const toolCapabilitiesResponseSchema = z.object({
  configured: z.boolean(),
  externalThinking: z.boolean(),
  contextNotes: z.boolean(),
  checkpoint: z.boolean(),
});

export type ToolCapabilitiesResponse = z.infer<typeof toolCapabilitiesResponseSchema>;

/** The writable half (the PUT body — `configured` is read-side presence). */
export type ToolCapabilitiesWrite = Omit<ToolCapabilitiesResponse, "configured">;

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    return body.message ?? body.code ?? `HTTP ${String(response.status)}`;
  } catch {
    return `HTTP ${String(response.status)}`;
  }
}

export async function fetchToolCapabilities(): Promise<ToolCapabilitiesResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/tool-capabilities", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return toolCapabilitiesResponseSchema.parse(await response.json());
}

export async function putToolCapabilities(
  capabilities: ToolCapabilitiesWrite,
): Promise<ToolCapabilitiesResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/tool-capabilities", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(capabilities),
  });
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return toolCapabilitiesResponseSchema.parse(await response.json());
}

export function useToolCapabilities(): {
  data?: ToolCapabilitiesResponse;
  error: Error | null;
  isPending: boolean;
  refetch: () => Promise<void>;
} {
  const query = useQuery<ToolCapabilitiesResponse, Error>({
    queryKey: [TOOL_CAPABILITIES_QUERY_KEY],
    queryFn: fetchToolCapabilities,
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
 * Apply the whole seat (the PUT replaces all three gates — no tri-state
 * merge). The success response IS the post-write truth; the cache is
 * invalidated so every mounted face re-reads it.
 */
export function useSetToolCapabilities(): {
  apply: (capabilities: ToolCapabilitiesWrite) => Promise<ToolCapabilitiesResponse>;
  isPending: boolean;
} {
  const pluginQueryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (capabilities: ToolCapabilitiesWrite) => putToolCapabilities(capabilities),
    onSuccess: () => {
      void pluginQueryClient.invalidateQueries({ queryKey: [TOOL_CAPABILITIES_QUERY_KEY] });
    },
  });
  return { apply: mutation.mutateAsync, isPending: mutation.isPending };
}
