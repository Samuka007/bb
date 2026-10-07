import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { fetchWithAppSurface } from "./provider-config-queries.js";

/**
 * #448 the explicit image source (产图源) face: GET/PUT
 * /api/v1/system/image-source. `providerId` names the api=openai-images
 * provider row that supplies generate_image (D1 image_source 正本); null =
 * no source — generate_image is unavailable (zero env fallback, #450).
 * `candidates` lists the dispatchable openai-images row ids the radio can
 * offer. The companion read face is the provider-projections catalog row
 * (`imageGeneration.configured` + `providerId`), refreshed through the same
 * invalidation.
 */

/** Plugin-local key: the app's core query-keys.ts stays pristine (#382). */
export const IMAGE_SOURCE_QUERY_KEY = "imageSource" as const;

export const imageSourceResponseSchema = z.object({
  providerId: z.string().nullable(),
  candidates: z.array(z.string()),
});

export type ImageSourceResponse = z.infer<typeof imageSourceResponseSchema>;

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    return body.message ?? body.code ?? `HTTP ${String(response.status)}`;
  } catch {
    return `HTTP ${String(response.status)}`;
  }
}

export async function fetchImageSource(): Promise<ImageSourceResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/image-source", { method: "GET" });
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return imageSourceResponseSchema.parse(await response.json());
}

export async function putImageSource(providerId: string | null): Promise<ImageSourceResponse> {
  const response = await fetchWithAppSurface("/api/v1/system/image-source", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId }),
  });
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return imageSourceResponseSchema.parse(await response.json());
}

export function useImageSource(options: { enabled?: boolean } = {}): {
  data?: ImageSourceResponse;
  error: Error | null;
  isPending: boolean;
  refetch: () => Promise<void>;
} {
  const query = useQuery<ImageSourceResponse, Error>({
    queryKey: [IMAGE_SOURCE_QUERY_KEY],
    queryFn: fetchImageSource,
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
 * Select (or clear) the seat. Both this face and the projections presence
 * bit fold from the same seat, so the write invalidates both.
 */
export function useSetImageSource(): {
  select: (providerId: string | null) => Promise<ImageSourceResponse>;
  isPending: boolean;
} {
  const pluginQueryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (providerId: string | null) => putImageSource(providerId),
    onSuccess: () => {
      void pluginQueryClient.invalidateQueries({ queryKey: [IMAGE_SOURCE_QUERY_KEY] });
      void pluginQueryClient.invalidateQueries({ queryKey: ["providerProjections"] });
    },
  });
  return { select: mutation.mutateAsync, isPending: mutation.isPending };
}
