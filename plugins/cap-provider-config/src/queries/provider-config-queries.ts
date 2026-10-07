import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

/**
 * The user-face provider configuration 正本 (#362): the D1 provider_configs
 * table behind `/api/v1/system/providers`. Port-only face — typed here
 * against the wire shape instead of `@bb/server-contract`, which ports bb
 * upstream verbatim and has no such endpoint (the #266 projection precedent).
 *
 * Secret discipline: `apiKey` is WRITE-ONLY — request bodies may carry it,
 * responses never do (`hasApiKey` presence only). PUT replaces the visible
 * face wholesale while the credential column is omission-preserving
 * (absent → keep, null → clear, string → set); the editor relies on that
 * protocol so an edit that never mentions the key cannot wipe it.
 *
 * Plugin adaptation (zero-core-touch delivery #382): the query layer moved
 * verbatim out of the app (`apps/app/src/hooks/queries/`) into this plugin —
 * local query keys (the app's `query-keys.ts` stays pristine), and
 * `fetchWithAppSurface` re-implemented from the host's `lib/app-surface.ts`
 * semantics (the `x-bb-app-surface` discriminator header, same-origin).
 */

const APP_SURFACE_HEADER_NAME = "x-bb-app-surface";

export async function fetchWithAppSurface(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): Promise<Response> {
  // lib/app-surface.ts: desktop builds expose window.bbDesktop; everything
  // else (this web surface included) reports "web".
  const headers = new Headers(init?.headers);
  // The host global's full type lives in the app (`types/bb-desktop.d.ts`);
  // the plugin only feature-detects it via `in` (no shape is trusted here).
  const isDesktop =
    typeof window !== "undefined" && "bbDesktop" in window && window.bbDesktop !== undefined;
  headers.set(APP_SURFACE_HEADER_NAME, isDesktop ? "desktop" : "web");
  return fetch(input, { ...init, headers });
}

/** Query keys live plugin-local: the app's core query-keys.ts stays pristine. */
export const PROVIDER_CONFIGS_QUERY_KEY = "providerConfigs" as const;

/**
 * The per-model api seat vocabulary (#452): the server contract validates
 * model rows against @cap/agent-do's `relayCatalogModelSchema`, whose api
 * seat admits ONLY the three relay chat faces (`relayApiValues`,
 * packages/agent-do/src/provider-catalog.ts) — anything else is a 422
 * validation_failed on POST/PUT. This zod enum is the panel's ONE source for
 * that seat: the model-row family control renders exactly `.options`, so the
 * editor can no longer suggest an off-contract label ("anthropic" used to
 * ride the free-text datalist straight into the 422).
 */
export const modelApiFamilySchema = z.enum([
  "anthropic-messages",
  "openai-responses",
  "openai-completions",
]);
export type ModelApiFamily = z.infer<typeof modelApiFamilySchema>;

/**
 * The provider-level api seat vocabulary (#452): the server resolves provider
 * rows through `relayCatalogProviderSchema` — `relayApiValues` PLUS the #362
 * image-source family (`IMAGE_SOURCE_API_FAMILY`; an api=openai-images row is
 * the generate_image source, never an LLM chat provider). The seat is
 * optional: an absent api falls back to the relay default
 * (anthropic-messages). Derived from the model seat + the image family so the
 * two controls can never drift apart — the exact union the server admits.
 */
export const providerApiFamilySchema = z.enum([...modelApiFamilySchema.options, "openai-images"]);
export type ProviderApiFamily = z.infer<typeof providerApiFamilySchema>;

/** #485 the row-level image family literal (the server's IMAGE_SOURCE_API_FAMILY). */
export const IMAGE_SOURCE_API_FAMILY = "openai-images" as const;

/**
 * #485 the model-entry family of a provider row, derived from its api seat —
 * the ONE rule every panel face uses (editor mode, discovery merge, candidate
 * summaries). Only the exact openai-images seat is the image family; an
 * unset/off-contract seat stays chat.
 */
export function modelFamilyOfApi(api: string | null): "chat" | "image" {
  return api === IMAGE_SOURCE_API_FAMILY ? "image" : "chat";
}

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
  /** The row's thinking budget (#362): wins over the deployment scalar. */
  thinkingBudgetTokens: z.number().int().positive().nullable().optional(),
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

/**
 * #485 the image row's stored model entry (the server's relayImageModelSchema
 * mirror): image semantics only — no chat seats exist here.
 */
export const providerConfigImageModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  sizes: z.array(z.string()).optional(),
  outputFormat: z.string().optional(),
  cost: z.object({ perImage: z.number() }).optional(),
});

export type ProviderConfigImageModel = z.infer<typeof providerConfigImageModelSchema>;

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
  /**
   * #388 row provenance on the merged display face: "user" = a stored D1 row
   * (editable here); "deployment-seed" = an env MODEL_RELAY_CATALOG provider
   * riding the list read-only (redeploy-managed). Defaults to "user" so an
   * older server (no source seat yet) keeps every row editable.
   */
  source: z.enum(["user", "deployment-seed"]).default("user"),
});

export type ProviderConfigRow = z.infer<typeof providerConfigRowSchema>;

/**
 * #485 the Image Source candidate row's 产图元信息 line: first model id plus
 * its declared sizes/format/per-image price (each seat honestly "unknown"
 * when undeclared), and how many further models the row carries. A row whose
 * models never parsed says so instead of an empty cell.
 */
export function imageSourceRowSummary(row: ProviderConfigRow | undefined): string | null {
  if (row === undefined) return null;
  const first = row.models[0];
  const parsed = providerConfigImageModelSchema.safeParse(first);
  const more =
    row.models.length > 1 ? ` · +${String(row.models.length - 1)} more model row(s)` : "";
  if (!parsed.success) {
    return `${String(row.models.length)} model row(s) · 产图元信息 unavailable (repair the row in Configured)${more}`;
  }
  const model = parsed.data;
  const sizes =
    model.sizes === undefined || model.sizes.length === 0 ? "sizes unknown" : model.sizes.join(", ");
  const format = model.outputFormat ?? "format unknown";
  const price =
    model.cost === undefined ? "price unknown" : `${String(model.cost.perImage)} USD/image`;
  return `${model.id} · ${sizes} · ${format} · ${price}${more}`;
}

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
  /** "" = unset (the deployment scalar rules); a positive integer = budget. */
  thinkingBudgetTokens: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  /**
   * #447 discovery provenance, kept for the row's display face only — set
   * when the row came out of a discover merge, absent for manual/stored rows.
   * Never serialized (modelDraftToWire ignores it; the stored catalog schema
   * rejects display seats).
   */
  discoveredMeta?: DiscoveredModelMeta;
}

/**
 * The discovery truth a merged row displays (#447): the seats the editor's
 * checkboxes/inputs cannot express as "looked and unknown" ride here so the
 * row can render explicit unknowns instead of silently blank fields.
 */
export interface DiscoveredModelMeta {
  /** The wire's metadataSource seat verbatim. */
  source: "models_dev" | "bundled" | "none" | "unavailable";
  /** Discovery's reasoning verdict; null = looked and unknown. */
  reasoning: boolean | null;
  /** Discovery's input capabilities; null = looked and unknown. */
  input: ("text" | "image")[] | null;
  /** The omp thinking ladder verbatim; null = no thinking seat on the row. */
  thinkingEfforts: string[] | null;
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
    thinkingBudgetTokens: "",
    costInput: "",
    costOutput: "",
    costCacheRead: "",
    costCacheWrite: "",
  };
}

/**
 * #485 one IMAGE row's model as the editor holds it: image semantics only
 * (sizes/outputFormat/per-image price) — the chat seats simply do not exist.
 * `discoveredMeta` mirrors the chat draft's provenance seat (display only).
 */
export interface ImageModelDraft {
  id: string;
  name: string;
  description: string;
  /** Comma-separated declared sizes (e.g. "1024x1024, 1536x1024"). */
  sizes: string;
  /** "" = unset; otherwise one of png/jpeg/webp. */
  outputFormat: string;
  /** Per-image price in USD; "" = undeclared. */
  costPerImage: string;
  discoveredMeta?: DiscoveredImageModelMeta;
}

/** The discovery provenance an image draft displays (source only). */
export interface DiscoveredImageModelMeta {
  source: "models_dev" | "bundled" | "none" | "unavailable";
}

export function emptyImageModelDraft(): ImageModelDraft {
  return {
    id: "",
    name: "",
    description: "",
    sizes: "",
    outputFormat: "",
    costPerImage: "",
  };
}

function optionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Serialize an editor draft into the wire model entry (empty seats drop). */
export function modelDraftToWire(draft: ProviderConfigModelDraft): ProviderConfigModel {
  if (draft.id.trim() === "") throw new Error("a model row needs an id");
  const reasoningLevels = draft.reasoningLevels;
  const defaultLevel = draft.defaultReasoningLevel;
  if (defaultLevel !== "" && !reasoningLevels.includes(defaultLevel as ReasoningLevelOption)) {
    throw new Error(`default reasoning level "${defaultLevel}" must be a member of the ladder`);
  }
  // A budget edit is either dropped ("" → absent, the deployment scalar
  // rules), cleared (explicit -1 → null = budget-off), or set to the typed
  // positive integer. The server schema (relayCatalogModelSchema) accepts
  // int-positive-or-null; a bad value fails the PUT/PATCH with a named 422
  // the editor surfaces.
  const budgetRaw = draft.thinkingBudgetTokens.trim();
  let thinkingBudgetTokens: number | null | undefined;
  if (budgetRaw === "-1") {
    thinkingBudgetTokens = null;
  } else if (budgetRaw !== "") {
    const parsed = optionalNumber(budgetRaw);
    if (parsed === undefined || parsed <= 0 || !Number.isInteger(parsed)) {
      throw new Error(
        `thinking budget must be a positive integer (tokens), "" for unset, or -1 for budget-off — got "${draft.thinkingBudgetTokens}"`,
      );
    }
    thinkingBudgetTokens = parsed;
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
    ...(thinkingBudgetTokens !== undefined ? { thinkingBudgetTokens } : {}),
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
    // null → "-1" (budget-off); undefined → "" (unset); number → the value.
    thinkingBudgetTokens:
      model.thinkingBudgetTokens === null
        ? "-1"
        : model.thinkingBudgetTokens === undefined
          ? ""
          : String(model.thinkingBudgetTokens),
    costInput: model.cost === undefined ? "" : String(model.cost.input),
    costOutput: model.cost === undefined ? "" : String(model.cost.output),
    costCacheRead: model.cost === undefined ? "" : String(model.cost.cacheRead),
    costCacheWrite: model.cost === undefined ? "" : String(model.cost.cacheWrite),
  };
}

/**
 * #485 one image draft → the wire entry. Only image seats serialize; a bad
 * size list, format, or price throws the SAME editor-grade error a chat
 * draft throws, so the save face surfaces it instead of writing junk the
 * server would 422 on.
 */
export function imageModelDraftToWire(draft: ImageModelDraft): ProviderConfigImageModel {
  if (draft.id.trim() === "") throw new Error("a model row needs an id");
  const sizes = draft.sizes
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const outputFormat = draft.outputFormat.trim();
  if (outputFormat !== "" && !["png", "jpeg", "webp"].includes(outputFormat)) {
    throw new Error(`output format "${outputFormat}" is not png/jpeg/webp — leave it blank for unset`);
  }
  const costRaw = draft.costPerImage.trim();
  let perImage: number | undefined;
  if (costRaw !== "") {
    perImage = optionalNumber(costRaw);
    if (perImage === undefined || perImage < 0) {
      throw new Error(`per-image price must be a non-negative number or blank — got "${draft.costPerImage}"`);
    }
  }
  return {
    id: draft.id.trim(),
    ...(draft.name.trim() !== "" ? { name: draft.name.trim() } : {}),
    ...(draft.description.trim() !== "" ? { description: draft.description.trim() } : {}),
    ...(sizes.length > 0 ? { sizes } : {}),
    ...(outputFormat !== "" ? { outputFormat } : {}),
    ...(perImage !== undefined ? { cost: { perImage } } : {}),
  };
}

/** Reverse of imageModelDraftToWire: a stored image entry back into drafts. */
export function imageModelWireToDraft(entry: unknown): ImageModelDraft {
  const parsed = providerConfigImageModelSchema.safeParse(entry);
  if (!parsed.success) return { ...emptyImageModelDraft(), id: "" };
  const model = parsed.data;
  return {
    id: model.id,
    name: model.name ?? "",
    description: model.description ?? "",
    sizes: (model.sizes ?? []).join(", "),
    outputFormat: model.outputFormat ?? "",
    costPerImage: model.cost === undefined ? "" : String(model.cost.perImage),
  };
}

/**
 * One discovered model row with the omp catalog metadata seats (#447). The
 * shape mirrors the server's `discoveredModelEntrySchema` (@cap/daemon-service
 * protocol, the wire 正本): every metadata seat is value-or-null —
 * null = looked and unknown, so the panel renders "unknown", never an empty
 * cell. `metadataSource` names where the seats came from ("models_dev" live
 * catalog / "bundled" snapshot / "none" no catalog knew the id /
 * "unavailable" enrichment never ran — the no-host edge fallback).
 */
export const discoveredModelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  /**
   * #485 the server-derived import family: "image" entries land on an image
   * row (or are refused on a chat row with the Image Source pointer).
   * Optional so an older worker (no family seat yet) degrades to the
   * pre-#485 chat merge instead of failing the parse.
   */
  family: z.enum(["chat", "image"]).optional(),
  reasoning: z.boolean().nullable().optional(),
  input: z
    .array(z.enum(["text", "image"]))
    .nullable()
    .optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  cost: z
    .object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative(),
      cacheWrite: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
  thinking: z
    .object({
      mode: z.string().min(1).nullable(),
      efforts: z.array(z.string().min(1)),
    })
    .nullable()
    .optional(),
  metadataSource: z.enum(["models_dev", "bundled", "none", "unavailable"]),
});

export type DiscoveredModelEntry = z.infer<typeof discoveredModelEntrySchema>;

/**
 * #447: one discovered entry → an editor draft. Known catalog seats fill the
 * editor fields directly (contextWindow/maxTokens/cost/reasoning ladder), so
 * "Save" persists exactly what discovery learned; unknown seats stay "" and
 * the row's provenance (`discoveredMeta`) drives the explicit-unknown display
 * line — a merged row never renders a silently blank cell for metadata the
 * catalog looked for and missed.
 */
export function discoveredModelToDraft(entry: DiscoveredModelEntry): ProviderConfigModelDraft {
  const efforts = entry.thinking?.efforts ?? [];
  const levels: ReasoningLevelOption[] = [];
  for (const level of efforts) {
    if (
      (REASONING_LEVEL_OPTIONS as readonly string[]).includes(level) &&
      !levels.includes(level as ReasoningLevelOption)
    ) {
      levels.push(level as ReasoningLevelOption);
    }
  }
  return {
    id: entry.id,
    name: entry.name ?? "",
    description: "",
    api: entry.api ?? "",
    reasoning: entry.reasoning === true,
    inputText:
      entry.input === null || entry.input === undefined ? true : entry.input.includes("text"),
    inputImage:
      entry.input === null || entry.input === undefined ? false : entry.input.includes("image"),
    contextWindow: entry.contextWindow == null ? "" : String(entry.contextWindow),
    maxTokens: entry.maxTokens == null ? "" : String(entry.maxTokens),
    reasoningLevels: levels,
    defaultReasoningLevel: "",
    // Discovery carries no budget knowledge — the deployment scalar rules.
    thinkingBudgetTokens: "",
    costInput: entry.cost == null ? "" : String(entry.cost.input),
    costOutput: entry.cost == null ? "" : String(entry.cost.output),
    costCacheRead: entry.cost == null ? "" : String(entry.cost.cacheRead),
    costCacheWrite: entry.cost == null ? "" : String(entry.cost.cacheWrite),
    discoveredMeta: {
      source: entry.metadataSource,
      reasoning: entry.reasoning ?? null,
      input: entry.input ?? null,
      thinkingEfforts: entry.thinking == null ? null : [...entry.thinking.efforts],
    },
  };
}

/**
 * The row's discovery display line (#447 acceptance: known values render,
 * looked-and-missed seats render the literal "unknown" — never an empty
 * cell). Numeric/cost seats read the live draft fields, so the line tracks
 * user edits; capability seats read the provenance truth.
 */
export function discoveredMetaLine(draft: ProviderConfigModelDraft): string {
  const meta = draft.discoveredMeta;
  if (meta === undefined) return "";
  const seat = (value: string): string => {
    const trimmed = value.trim();
    return trimmed === "" ? "unknown" : trimmed;
  };
  const costSeats = [draft.costInput, draft.costOutput, draft.costCacheRead, draft.costCacheWrite];
  const cost = costSeats.every((value) => value.trim() !== "")
    ? costSeats.map((value) => value.trim()).join(" / ")
    : "unknown";
  const reasoning = meta.reasoning === null ? "unknown" : meta.reasoning ? "yes" : "no";
  const input =
    meta.input === null ? "unknown" : meta.input.length === 0 ? "none" : meta.input.join("+");
  const thinking =
    meta.reasoning === false && meta.thinkingEfforts === null
      ? "no"
      : meta.thinkingEfforts === null || meta.thinkingEfforts.length === 0
        ? "unknown"
        : meta.thinkingEfforts.join(" / ");
  return [
    `source ${meta.source}`,
    `contextWindow ${seat(draft.contextWindow)}`,
    `maxTokens ${seat(draft.maxTokens)}`,
    `reasoning ${reasoning}`,
    `thinking ${thinking}`,
    `input ${input}`,
    `cost (in/out/cacheRead/cacheWrite) ${cost}`,
  ].join(" · ");
}

/**
 * #485 one discovered entry → an IMAGE draft (the merge target on an
 * api=openai-images row): id/name transfer; the image seats start undeclared
 * (the discovery face carries chat-catalog metadata only) — never a chat
 * field smuggled onto an image row.
 */
export function discoveredImageModelToDraft(entry: DiscoveredModelEntry): ImageModelDraft {
  return {
    id: entry.id,
    name: entry.name ?? "",
    description: "",
    sizes: "",
    outputFormat: "",
    costPerImage: "",
    discoveredMeta: { source: entry.metadataSource },
  };
}

/**
 * The image row's discovery display line: source + the image seats, with
 * looked-and-missed seats rendering the literal "unknown" (the #447 posture
 * applied to the image dictionary).
 */
export function discoveredImageMetaLine(draft: ImageModelDraft): string {
  const meta = draft.discoveredMeta;
  if (meta === undefined) return "";
  const seat = (value: string): string => (value.trim() === "" ? "unknown" : value.trim());
  const price = draft.costPerImage.trim() === "" ? "unknown" : `${draft.costPerImage.trim()} USD/image`;
  return [
    `source ${meta.source}`,
    `sizes ${seat(draft.sizes)}`,
    `format ${seat(draft.outputFormat)}`,
    `price ${price}`,
  ].join(" · ");
}

/** The wire shape of one discover verdict (skip-with-warning included). */
export const providerConfigDiscoverResponseSchema = z.object({
  ok: z.boolean(),
  status: z.number().nullable(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
  models: z.array(discoveredModelEntrySchema),
  warnings: z.array(z.string()),
});

export type ProviderConfigDiscoverResponse = z.infer<typeof providerConfigDiscoverResponseSchema>;

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
  /** #485 family-paired: chat rows write chat entries, image rows image entries. */
  models?: ProviderConfigModel[] | ProviderConfigImageModel[];
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

async function requestJson<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
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

export async function testProviderConfig(id: string): Promise<ProviderConfigTestResponse> {
  return requestJson(
    `/api/v1/system/providers/${encodeURIComponent(id)}/test`,
    { method: "POST" },
    providerConfigTestResponseSchema,
  );
}

export async function discoverProviderModels(body: {
  providerId?: string;
  baseUrl?: string;
  /** #485 unsaved-row family hint (an api=openai-images new row discovers as image). */
  api?: string;
  apiKey?: string;
}): Promise<ProviderConfigDiscoverResponse> {
  return requestJson(
    "/api/v1/system/providers/discover-models",
    jsonInit("POST", body),
    providerConfigDiscoverResponseSchema,
  );
}

/**
 * One per-provider verdict from the models.yml import (#364). `created`
 * rows report HTTP-grade 201; every refusal is a named code with its
 * HTTP-grade status (409 exists/reserved, 422 unsupported api / master-key
 * gate) — an out-of-family api value is an explicit 422 unsupported_api
 * verdict, never a silent drop. `warnings` is the migration transcript.
 */
export const providerConfigImportEntrySchema = z.object({
  id: z.string().min(1),
  verdict: z.enum(["created", "skipped"]),
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string(),
  modelCount: z.number().int().nonnegative(),
  hasApiKey: z.boolean(),
  warnings: z.array(z.string()),
});

export const providerConfigImportResponseSchema = z.object({
  providers: z.array(providerConfigImportEntrySchema),
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export type ProviderConfigImportResponse = z.infer<typeof providerConfigImportResponseSchema>;

/**
 * The paste import (#364): the pasted YAML text rides ONE request body;
 * the server encrypts any apiKey through the #362 chain and never echoes
 * it back (verdicts carry hasApiKey presence only).
 */
export async function importModelsYml(yaml: string): Promise<ProviderConfigImportResponse> {
  return requestJson(
    "/api/v1/system/providers/import-models-yml",
    jsonInit("POST", { yaml }),
    providerConfigImportResponseSchema,
  );
}

export function useProviderConfigs(options: { enabled?: boolean } = {}): {
  data?: ProviderConfigRow[];
  error: Error | null;
  isPending: boolean;
} {
  const query = useQuery<ProviderConfigRow[], Error>({
    queryKey: [PROVIDER_CONFIGS_QUERY_KEY],
    queryFn: fetchProviderConfigs,
    enabled: options.enabled ?? true,
  });
  return { data: query.data, error: query.error, isPending: query.isPending };
}
