import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { fetchWithAppSurface } from "@/lib/app-surface";
import { SYSTEM_PROVIDERS_QUERY_KEY } from "./query-keys";

/**
 * The user-face provider configuration 正本 (#362): the D1 provider_configs
 * table behind `/api/v1/system/providers`. Port-only face — typed here
 * against the wire shape instead of `@bb/server-contract`, which ports bb
 * upstream verbatim and has no such endpoint (the #266 projection precedent).
 *
 * Secret discipline: `apiKey` is WRITE-ONLY — request bodies may carry it,
 * responses never do (`hasApiKey` presence only). PUT replaces the visible
 * face wholesale while the credential column is omission-preserving
 * (absent → keep, null → clear, string → set); the editor below relies on
 * that protocol so an edit that never mentions the key cannot wipe it.
 */

export const providerApiFamilySuggestions = [
  "anthropic",
  "openai-responses",
  "openai-completions",
] as const;

export const REASONING_LEVEL_OPTIONS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "ultracode",
  "max",
  "ultra",
] as const;

export type ReasoningLevelOption = (typeof REASONING_LEVEL_OPTIONS)[number];

const providerConfigModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  api: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(["text", "image"])).optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  description: z.string().optional(),
  reasoningLevels: z.array(z.string()).optional(),
  defaultReasoningLevel: z.string().optional(),
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number(),
      cacheWrite: z.number(),
    })
    .optional(),
});

export type ProviderConfigModel = z.infer<typeof providerConfigModelSchema>;

export const providerConfigRowSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable(),
  baseUrl: z.string().nullable(),
  api: z.string().nullable(),
  serviceTier: z.boolean(),
  /** The RAW stored models value — a broken row stays visible for repair. */
  models: z.array(z.unknown()),
  hasApiKey: z.boolean(),
  status: z.enum(["ok", "warning"]),
  warnings: z.array(z.string()),
  dispatchable: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ProviderConfigRow = z.infer<typeof providerConfigRowSchema>;

const providerConfigsListResponseSchema = z.object({
  providers: z.array(providerConfigRowSchema),
});

/** One model row as the editor holds it (all optional except id). */
export interface ProviderConfigModelDraft {
  id: string;
  name: string;
  description: string;
  api: string;
  reasoning: boolean;
  inputText: boolean;
  inputImage: boolean;
  contextWindow: string;
  maxTokens: string;
  reasoningLevels: ReasoningLevelOption[];
  defaultReasoningLevel: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
}

export function emptyModelDraft(): ProviderConfigModelDraft {
  return {
    id: "",
    name: "",
    description: "",
    api: "",
    reasoning: false,
    inputText: true,
    inputImage: false,
    contextWindow: "",
    maxTokens: "",
    reasoningLevels: [],
    defaultReasoningLevel: "",
    costInput: "",
    costOutput: "",
    costCacheRead: "",
    costCacheWrite: "",
  };
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Serialize an editor draft into the wire model entry (empty seats drop). */
export function modelDraftToWire(
  draft: ProviderConfigModelDraft,
): ProviderConfigModel {
  if (draft.id.trim() === "") throw new Error("a model row needs an id");
  const reasoningLevels = draft.reasoningLevels;
  const defaultLevel = draft.defaultReasoningLevel;
  if (
    defaultLevel !== "" &&
    !reasoningLevels.includes(defaultLevel as ReasoningLevelOption)
  ) {
    throw new Error(
      `default reasoning level "${defaultLevel}" must be a member of the ladder`,
    );
  }
  const input: ("text" | "image")[] = [];
  if (draft.inputText) input.push("text");
  if (draft.inputImage) input.push("image");
  const cost = {
    input: optionalNumber(draft.costInput),
    output: optionalNumber(draft.costOutput),
    cacheRead: optionalNumber(draft.costCacheRead),
    cacheWrite: optionalNumber(draft.costCacheWrite),
  };
  const costComplete =
    cost.input !== undefined &&
    cost.output !== undefined &&
    cost.cacheRead !== undefined &&
    cost.cacheWrite !== undefined;
  return {
    id: draft.id.trim(),
    ...(draft.name.trim() !== "" ? { name: draft.name.trim() } : {}),
    ...(draft.api.trim() !== "" ? { api: draft.api.trim() } : {}),
    ...(draft.description.trim() !== "" ? { description: draft.description.trim() } : {}),
    ...(draft.reasoning ? { reasoning: true } : {}),
    ...(input.length > 0 ? { input } : {}),
    ...(optionalNumber(draft.contextWindow) !== undefined
      ? { contextWindow: optionalNumber(draft.contextWindow) }
      : {}),
    ...(optionalNumber(draft.maxTokens) !== undefined
      ? { maxTokens: optionalNumber(draft.maxTokens) }
      : {}),
    ...(reasoningLevels.length > 0 ? { reasoningLevels: [...reasoningLevels] } : {}),
    ...(defaultLevel !== "" ? { defaultReasoningLevel: defaultLevel } : {}),
    ...(costComplete
      ? {
          cost: {
            input: cost.input ?? 0,
            output: cost.output ?? 0,
            cacheRead: cost.cacheRead ?? 0,
            cacheWrite: cost.cacheWrite ?? 0,
          },
        }
      : {}),
  };
}

/** Reverse of modelDraftToWire: a stored row back into editor drafts. */
export function modelWireToDraft(entry: unknown): ProviderConfigModelDraft {
  const parsed = providerConfigModelSchema.safeParse(entry);
  if (!parsed.success) return { ...emptyModelDraft(), id: "" };
  const model = parsed.data;
  const levels = (model.reasoningLevels ?? []).filter((level): level is ReasoningLevelOption =>
    (REASONING_LEVEL_OPTIONS as readonly string[]).includes(level),
  );
  return {
    id: model.id,
    name: model.name ?? "",
    description: model.description ?? "",
    api: model.api ?? "",
    reasoning: model.reasoning ?? false,
    inputText: (model.input ?? ["text"]).includes("text"),
    inputImage: (model.input ?? []).includes("image"),
    contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
    maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
    reasoningLevels: levels,
    defaultReasoningLevel: model.defaultReasoningLevel ?? "",
    costInput: model.cost === undefined ? "" : String(model.cost.input),
    costOutput: model.cost === undefined ? "" : String(model.cost.output),
    costCacheRead: model.cost === undefined ? "" : String(model.cost.cacheRead),
    costCacheWrite: model.cost === undefined ? "" : String(model.cost.cacheWrite),
  };
}

/** The wire shape of one discover verdict (skip-with-warning included). */
export const providerConfigDiscoverResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  models: z.array(z.object({ id: z.string(), name: z.string().optional() })),
  warnings: z.array(z.string()),
});

export type ProviderConfigDiscoverResponse = z.infer<
  typeof providerConfigDiscoverResponseSchema
>;

export const providerConfigTestResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});

export type ProviderConfigTestResponse = z.infer<typeof providerConfigTestResponseSchema>;

/**
 * The visible-face + credential body the editor submits. `apiKey` follows
 * the null protocol: undefined = keep, null = clear, string = set.
 */
export interface ProviderConfigWriteBody {
  displayName?: string;
  baseUrl?: string;
  api?: string;
  serviceTier?: boolean;
  models?: ProviderConfigModel[];
  apiKey?: string | null;
}

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    return body.message ?? body.code ?? `HTTP ${String(response.status)}`;
  } catch {
    return `HTTP ${String(response.status)}`;
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetchWithAppSurface(path, init);
  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }
  return schema.parse(await response.json());
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function fetchProviderConfigs(): Promise<ProviderConfigRow[]> {
  const payload = await requestJson(
    "/api/v1/system/providers",
    { method: "GET" },
    providerConfigsListResponseSchema,
  );
  return payload.providers;
}

export async function createProviderConfig(
  id: string,
  body: ProviderConfigWriteBody,
): Promise<ProviderConfigRow> {
  return requestJson(
    "/api/v1/system/providers",
    jsonInit("POST", { id, ...body }),
    providerConfigRowSchema,
  );
}

export async function replaceProviderConfig(
  id: string,
  body: ProviderConfigWriteBody,
): Promise<ProviderConfigRow> {
  return requestJson(
    `/api/v1/system/providers/${encodeURIComponent(id)}`,
    jsonInit("PUT", body),
    providerConfigRowSchema,
  );
}

export async function deleteProviderConfig(id: string): Promise<void> {
  await requestJson(
    `/api/v1/system/providers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    z.object({ ok: z.literal(true) }),
  );
}

export async function testProviderConfig(
  id: string,
): Promise<ProviderConfigTestResponse> {
  return requestJson(
    `/api/v1/system/providers/${encodeURIComponent(id)}/test`,
    { method: "POST" },
    providerConfigTestResponseSchema,
  );
}

export async function discoverProviderModels(body: {
  providerId?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<ProviderConfigDiscoverResponse> {
  return requestJson(
    "/api/v1/system/providers/discover-models",
    jsonInit("POST", body),
    providerConfigDiscoverResponseSchema,
  );
}

export function useProviderConfigs(options: { enabled?: boolean } = {}): {
  data?: ProviderConfigRow[];
  error: Error | null;
  isPending: boolean;
} {
  const query = useQuery<ProviderConfigRow[], Error>({
    queryKey: [SYSTEM_PROVIDERS_QUERY_KEY],
    queryFn: fetchProviderConfigs,
    enabled: options.enabled ?? true,
  });
  return { data: query.data, error: query.error, isPending: query.isPending };
}
