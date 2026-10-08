import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  createProviderConfig,
  deleteProviderConfig,
  discoveredMetaLine,
  discoveredModelToDraft,
  discoveredImageMetaLine,
  discoveredImageModelToDraft,
  discoverProviderModels,
  emptyImageModelDraft,
  emptyModelDraft,
  importModelsYml,
  imageModelDraftToWire,
  imageModelWireToDraft,
  IMAGE_SOURCE_API_FAMILY,
  modelFamilyOfApi,
  modelDraftToWire,
  modelWireToDraft,
  modelApiFamilySchema,
  providerApiFamilySchema,
  PROVIDER_CONFIGS_QUERY_KEY,
  EFFORT_OPTIONS,
  THINKING_MODE_OPTIONS,
  type EffortOption,
  replaceProviderConfig,
  testProviderConfig,
  useProviderConfigs,
  type ProviderConfigDiscoverResponse,
  type ProviderConfigImportResponse,
  type ProviderConfigModelDraft,
  type ProviderConfigRow,
  type ProviderConfigTestResponse,
  type ImageModelDraft,
} from "./queries/provider-config-queries";
import { PROVIDER_PROJECTIONS_QUERY_KEY } from "./queries/provider-projection-queries";
import { PluginQueryProvider, pluginQueryClient } from "./plugin-query-client";
import { SettingsSection } from "./ui/settings-section";
import { ConfirmDeleteDialog, ConfirmDeleteDialogContent } from "./ui/confirm-delete-dialog";

/**
 * Settings → Providers → Configured (#362): the USER-face write path onto
 * the D1 provider_configs 正本. The panel adds/edits/removes providers
 * (baseUrl / api family / write-only apiKey / full model directory with the
 * pi thinking editor — transport + effort ladder + default), pulls upstream
 * /models discovery, and
 * probes test-connection — all hot against `/api/v1/system/providers`.
 * (#364) The paste import lifts an omp `~/.omp/agent/models.yml` fragment
 * into the same rows in one request — "cloud = local omp" in one paste.
 *
 * (#388) The list face is the MERGED directory truth: env-seed providers no
 * D1 row overrides render read-only with a deployment-seed badge, so the
 * panel shows exactly the provider set execution-options serves (the seed
 * used to be invisible here while the picker kept serving it).
 *
 * Plugin adaptation (#382, zero-core-touch delivery): moved out of the app
 * core into this plugin's settingsSection slot. The plugin owns its
 * react-query instance (the SDK runtime-shims react but not react-query, so
 * the plugin provides its own QueryClientProvider — one per page, module
 * singleton). Host faces re-read through the server: every successful write
 * responds and the server broadcasts system `config-changed`, which the
 * host's realtime registry maps to execution-options/provider invalidation
 * — no host-side invalidation hook is reachable from a plugin bundle.
 */

/** The family-agnostic editor shell (fields shared by both families). */
interface EditorShell {
  /** null = the add form; otherwise the row being edited. */
  editingId: string | null;
  id: string;
  displayName: string;
  baseUrl: string;
  api: string;
  serviceTier: boolean;
  /** undefined = leave the stored key alone; null = clear it. */
  apiKey: string | undefined;
  clearApiKey: boolean;
  /** Discovery notices: merged-row summary + skip-with-warning lines. */
  notices: string[];
}

/**
 * #485 the editor is FAMILY-PAIRED: an api=openai-images row edits image
 * drafts (sizes/format/per-image price), every other api edits the chat
 * dictionary. The discriminant is the state's own `family` field, kept in
 * lockstep with `api` by the one mutation that can move it (applyApiFamily).
 */
type EditorState =
  | (EditorShell & { family: "chat"; models: ProviderConfigModelDraft[] })
  | (EditorShell & { family: "image"; models: ImageModelDraft[] });

function editorFromRow(row: ProviderConfigRow): EditorState {
  const shell: EditorShell = {
    editingId: row.id,
    id: row.id,
    displayName: row.displayName ?? "",
    baseUrl: row.baseUrl ?? "",
    api: row.api ?? "",
    serviceTier: row.serviceTier,
    apiKey: undefined,
    clearApiKey: false,
    notices: [...row.warnings],
  };
  return modelFamilyOfApi(row.api) === "image"
    ? { ...shell, family: "image", models: row.models.map(imageModelWireToDraft) }
    : { ...shell, family: "chat", models: row.models.map(modelWireToDraft) };
}

function emptyEditor(): EditorState {
  return {
    editingId: null,
    id: "",
    displayName: "",
    baseUrl: "",
    api: "",
    serviceTier: false,
    apiKey: undefined,
    clearApiKey: false,
    family: "chat",
    models: [emptyModelDraft()],
    notices: [],
  };
}

/** Did any draft carry a seat the target family cannot represent? */
function chatSeatsInUse(models: ProviderConfigModelDraft[]): boolean {
  return models.some(
    (draft) =>
      draft.reasoning ||
      draft.inputImage ||
      !draft.inputText ||
      draft.contextWindow.trim() !== "" ||
      draft.maxTokens.trim() !== "" ||
      draft.thinkingEfforts.length > 0 ||
      draft.thinkingMode !== "" ||
      draft.thinkingDefault !== "" ||
      draft.thinkingRequiresEffort ||
      draft.costInput.trim() !== "" ||
      draft.costOutput.trim() !== "" ||
      draft.costCacheRead.trim() !== "" ||
      draft.costCacheWrite.trim() !== "",
  );
}

function imageSeatsInUse(models: ImageModelDraft[]): boolean {
  return models.some(
    (draft) =>
      draft.sizes.trim() !== "" || draft.outputFormat.trim() !== "" || draft.costPerImage.trim() !== "",
  );
}

/**
 * #485 the ONE mutation that moves the editor's family: picking a different
 * api seat converts the drafts (id/name/description survive; seats the target
 * family cannot represent are dropped WITH a notice — the wire would 422
 * them, and a silent drop is not this panel's discipline).
 */
function applyApiFamily(state: EditorState, api: string): EditorState {
  const nextFamily = modelFamilyOfApi(api);
  if (nextFamily === state.family) return { ...state, api };
  if (state.family === "chat") {
    const droppedSeat = chatSeatsInUse(state.models);
    const models: ImageModelDraft[] = state.models.map((draft) => ({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      sizes: "",
      outputFormat: "",
      costPerImage: "",
    }));
    return {
      ...state,
      api,
      family: "image",
      models,
      notices: droppedSeat
        ? [
            ...state.notices,
            "api family switched to openai-images — chat seats (reasoning/input/contextWindow/maxTokens/thinking ladder/token cost) dropped; image rows carry sizes/format/per-image price",
          ]
        : state.notices,
    };
  }
  const droppedSeat = imageSeatsInUse(state.models);
  const models: ProviderConfigModelDraft[] = state.models.map((draft) => ({
    ...emptyModelDraft(),
    id: draft.id,
    name: draft.name,
    description: draft.description,
  }));
  return {
    ...state,
    api,
    family: "chat",
    models,
    notices: droppedSeat
      ? [
          ...state.notices,
          "api family moved off openai-images — image seats (sizes/outputFormat/per-image price) dropped; chat rows carry the token dictionary",
        ]
      : state.notices,
  };
}

function apiKeyField(state: EditorState): string | null | undefined {
  if (state.clearApiKey) return null;
  if (state.apiKey !== undefined && state.apiKey !== "") return state.apiKey;
  return undefined;
}

function testVerdictText(verdict: ProviderConfigTestResponse): string {
  if (verdict.ok) return `Reachable (${String(verdict.latencyMs ?? 0)} ms)`;
  if (verdict.status !== null) {
    return `Failed (${String(verdict.status)}): ${verdict.error ?? "upstream error"}`;
  }
  return `Failed: ${verdict.error ?? "unreachable"}`;
}

/**
 * The unset sentinel for the family Select (Radix items reject empty-string
 * values); selecting it maps back to "" — no api seat on the wire, so the
 * server's fallback chain rules (model row → provider row → the relay
 * default face).
 */
const DEFAULT_API_FAMILY = "__default__";

/**
 * The api-family control (#452): a single-select over the server contract's
 * vocabulary. It replaces the free-text Input+datalist whose suggested
 * "anthropic" was a label the contract rejects — 422 validation_failed at
 * the model seat, a skip-with-warning stranded row at the provider seat. A
 * stored value that predates the contract stays visible as an explicit
 * out-of-contract entry (never hidden behind the placeholder, never silently
 * rewritten); picking any contract family replaces it.
 */
function ApiFamilySelect({
  value,
  options,
  unsetLabel,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: string;
  options: readonly string[];
  unsetLabel: string;
  ariaLabel: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const offContract = value !== "" && !options.includes(value);
  return (
    <Select
      value={value === "" ? DEFAULT_API_FAMILY : value}
      disabled={disabled}
      onValueChange={(next) => onChange(next === DEFAULT_API_FAMILY ? "" : next)}
    >
      <SelectTrigger aria-label={ariaLabel} className="h-8 font-mono text-xs">
        <SelectValue>{value === "" ? unsetLabel : value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_API_FAMILY}>{unsetLabel}</SelectItem>
        {offContract ? <SelectItem value={value}>Out of contract · {value}</SelectItem> : null}
        {options.map((family) => (
          <SelectItem key={family} value={family}>
            {family}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The shared row frame: label, discovery-metadata line, remove control. */
function ModelRowShell({
  index,
  metaLine,
  disabled,
  onRemove,
  children,
}: {
  index: number;
  metaLine: string | null;
  disabled: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const label = `Model ${String(index + 1)}`;
  return (
    <div className="space-y-2 rounded-md border border-border p-3" aria-label={label}>
      <div className="flex items-center gap-2">
        <span className="text-2xs font-medium text-subtle-foreground">{label}</span>
        {metaLine !== null ? (
          <span
            className="text-2xs text-subtle-foreground"
            aria-label={`${label} discovery metadata`}
          >
            Metadata: {metaLine}
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
      {children}
    </div>
  );
}

/** One CHAT model row inside the editor grid — every catalog seat visible. */
function ChatModelRowEditor({
  index,
  draft,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  draft: ProviderConfigModelDraft;
  disabled: boolean;
  onChange: (next: ProviderConfigModelDraft) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<ProviderConfigModelDraft>) => onChange({ ...draft, ...patch });
  const toggleEffort = (level: EffortOption) =>
    update({
      thinkingEfforts: draft.thinkingEfforts.includes(level)
        ? draft.thinkingEfforts.filter((entry) => entry !== level)
        : [...draft.thinkingEfforts, level],
    });
  const label = `Model ${String(index + 1)}`;
  return (
    <ModelRowShell
      index={index}
      metaLine={draft.discoveredMeta !== undefined ? discoveredMetaLine(draft) : null}
      disabled={disabled}
      onRemove={onRemove}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Model id
          <Input
            value={draft.id}
            disabled={disabled}
            className="h-8 font-mono text-xs"
            aria-label={`${label} id`}
            onChange={(event) => update({ id: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Display name
          <Input
            value={draft.name}
            disabled={disabled}
            className="h-8 text-xs"
            aria-label={`${label} display name`}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          API family
          <ApiFamilySelect
            value={draft.api}
            options={modelApiFamilySchema.options}
            unsetLabel="Inherit provider family"
            ariaLabel={`${label} api family`}
            disabled={disabled}
            onChange={(api) => update({ api })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Description
          <Input
            value={draft.description}
            disabled={disabled}
            className="h-8 text-xs"
            aria-label={`${label} description`}
            onChange={(event) => update({ description: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Context window (tokens)
          <Input
            type="number"
            min={1}
            value={draft.contextWindow}
            disabled={disabled}
            className="h-8 text-xs"
            aria-label={`${label} context window`}
            onChange={(event) => update({ contextWindow: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Max output tokens
          <Input
            type="number"
            min={1}
            value={draft.maxTokens}
            disabled={disabled}
            className="h-8 text-xs"
            aria-label={`${label} max tokens`}
            onChange={(event) => update({ maxTokens: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Thinking transport (pi mode)
          <select
            value={draft.thinkingMode}
            disabled={disabled || draft.thinkingEfforts.length === 0}
            aria-label={`${label} thinking mode`}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            onChange={(event) => update({ thinkingMode: event.target.value })}
          >
            {THINKING_MODE_OPTIONS.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-2xs text-subtle-foreground">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.reasoning}
            disabled={disabled}
            aria-label={`${label} reasoning capable`}
            onChange={(event) => update({ reasoning: event.target.checked })}
          />
          Reasoning
        </label>
        <span>Input:</span>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.inputText}
            disabled={disabled}
            aria-label={`${label} text input`}
            onChange={(event) => update({ inputText: event.target.checked })}
          />
          text
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.inputImage}
            disabled={disabled}
            aria-label={`${label} image input`}
            onChange={(event) => update({ inputImage: event.target.checked })}
          />
          image
        </label>
      </div>
      <div className="space-y-1 text-2xs text-subtle-foreground">
        <span>Effort ladder (thinking.efforts — "none" is always offered off):</span>
        <div className="flex flex-wrap items-center gap-3">
          {EFFORT_OPTIONS.map((level) => (
            <label key={level} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.thinkingEfforts.includes(level)}
                disabled={disabled}
                aria-label={`${label} effort ${level}`}
                onChange={() => toggleEffort(level)}
              />
              {level}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.thinkingRequiresEffort}
              disabled={disabled}
              aria-label={`${label} requires effort`}
              onChange={(event) => update({ thinkingRequiresEffort: event.target.checked })}
            />
            requiresEffort (off must be explicit)
          </label>
          <select
            value={draft.thinkingDefault}
            disabled={disabled || draft.thinkingEfforts.length === 0}
            aria-label={`${label} default effort`}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            onChange={(event) => update({ thinkingDefault: event.target.value })}
          >
            <option value="">default (lowest)…</option>
            {draft.thinkingEfforts.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
      </div>
      <details className="text-2xs text-subtle-foreground">
        <summary>Cost (per 1M tokens, optional)</summary>
        <div className="mt-1 grid grid-cols-4 gap-2">
          <label className="space-y-1">
            input
            <Input
              type="number"
              min={0}
              value={draft.costInput}
              disabled={disabled}
              className="h-8 text-xs"
              aria-label={`${label} cost input`}
              onChange={(event) => update({ costInput: event.target.value })}
            />
          </label>
          <label className="space-y-1">
            output
            <Input
              type="number"
              min={0}
              value={draft.costOutput}
              disabled={disabled}
              className="h-8 text-xs"
              aria-label={`${label} cost output`}
              onChange={(event) => update({ costOutput: event.target.value })}
            />
          </label>
          <label className="space-y-1">
            cache read
            <Input
              type="number"
              min={0}
              value={draft.costCacheRead}
              disabled={disabled}
              className="h-8 text-xs"
              aria-label={`${label} cost cache read`}
              onChange={(event) => update({ costCacheRead: event.target.value })}
            />
          </label>
          <label className="space-y-1">
            cache write
            <Input
              type="number"
              min={0}
              value={draft.costCacheWrite}
              disabled={disabled}
              className="h-8 text-xs"
              aria-label={`${label} cost cache write`}
              onChange={(event) => update({ costCacheWrite: event.target.value })}
            />
          </label>
        </div>
      </details>
    </ModelRowShell>
  );
}

const OUTPUT_FORMAT_UNSET = "__unset__";

/** The output-format single-select (unset = the upstream default). */
function OutputFormatSelect({
  value,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onChange: (next: string) => void;
}) {
  return (
    <Select
      value={value === "" ? OUTPUT_FORMAT_UNSET : value}
      disabled={disabled}
      onValueChange={(next) => onChange(next === OUTPUT_FORMAT_UNSET ? "" : next)}
    >
      <SelectTrigger aria-label={ariaLabel} className="h-8 font-mono text-xs">
        <SelectValue>{value === "" ? "Unset" : value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={OUTPUT_FORMAT_UNSET}>Unset</SelectItem>
        {["png", "jpeg", "webp"].map((format) => (
          <SelectItem key={format} value={format}>
            {format}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * #485 one IMAGE model row: image semantics only — id/name/description plus
 * the declared sizes, output format, and per-image price. The chat seats
 * (reasoning/input/context window/max tokens/thinking ladder/token cost) do
 * not exist on this row, not even as disabled fields.
 */
function ImageModelRowEditor({
  index,
  draft,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  draft: ImageModelDraft;
  disabled: boolean;
  onChange: (next: ImageModelDraft) => void;
  onRemove: () => void;
}) {
  const update = (patch: Partial<ImageModelDraft>) => onChange({ ...draft, ...patch });
  const label = `Model ${String(index + 1)}`;
  return (
    <ModelRowShell
      index={index}
      metaLine={draft.discoveredMeta !== undefined ? discoveredImageMetaLine(draft) : null}
      disabled={disabled}
      onRemove={onRemove}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Model id
          <Input
            value={draft.id}
            disabled={disabled}
            className="h-8 font-mono text-xs"
            aria-label={`${label} id`}
            onChange={(event) => update({ id: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Display name
          <Input
            value={draft.name}
            disabled={disabled}
            className="h-8 text-xs"
            aria-label={`${label} display name`}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Description
          <Input
            value={draft.description}
            disabled={disabled}
            className="h-8 text-xs"
            aria-label={`${label} description`}
            onChange={(event) => update({ description: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Sizes (comma-separated)
          <Input
            value={draft.sizes}
            disabled={disabled}
            className="h-8 font-mono text-xs"
            placeholder="1024x1024, 1536x1024"
            aria-label={`${label} sizes`}
            onChange={(event) => update({ sizes: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Output format
          <OutputFormatSelect
            value={draft.outputFormat}
            disabled={disabled}
            ariaLabel={`${label} output format`}
            onChange={(outputFormat) => update({ outputFormat })}
          />
        </label>
        <label className="space-y-1 text-2xs text-subtle-foreground">
          Price per image (USD)
          <Input
            type="number"
            min={0}
            step="0.01"
            value={draft.costPerImage}
            disabled={disabled}
            className="h-8 text-xs"
            placeholder="e.g. 0.04"
            aria-label={`${label} price per image`}
            onChange={(event) => update({ costPerImage: event.target.value })}
          />
        </label>
      </div>
      <p className="text-2xs text-subtle-foreground">
        Image model rows carry image semantics only — id / sizes / output format / per-image price.
        Reasoning, context window, and token seats do not exist here.
      </p>
    </ModelRowShell>
  );
}

function ConfiguredProviderPanel() {
  // Plugin-local invalidation: the panel's own faces re-read after a write.
  // The host's faces (execution options, projections) re-read on the server's
  // system config-changed broadcast instead — a plugin bundle cannot reach
  // the host's query cache.
  const invalidate = () => {
    void pluginQueryClient.invalidateQueries({
      queryKey: [PROVIDER_CONFIGS_QUERY_KEY],
    });
    void pluginQueryClient.invalidateQueries({
      queryKey: [PROVIDER_PROJECTIONS_QUERY_KEY],
    });
  };
  const providersQuery = useProviderConfigs();
  const providers = providersQuery.data ?? [];
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [removing, setRemoving] = useState<ProviderConfigRow | null>(null);
  const [testVerdicts, setTestVerdicts] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importVerdict, setImportVerdict] = useState<ProviderConfigImportResponse | null>(null);

  const discover = useMutation({
    mutationFn: async (state: EditorState): Promise<ProviderConfigDiscoverResponse> => {
      if (state.editingId !== null && state.apiKey === undefined && !state.clearApiKey) {
        // Saved row: the server probes with the stored (encrypted) key.
        return discoverProviderModels({ providerId: state.editingId });
      }
      return discoverProviderModels({
        baseUrl: state.baseUrl,
        // #485 the unsaved-row family hint: an image row being composed
        // discovers as image (the server annotates every entry accordingly).
        ...(state.api.trim() !== "" ? { api: state.api.trim() } : {}),
        ...(state.apiKey !== undefined && state.apiKey !== "" ? { apiKey: state.apiKey } : {}),
      });
    },
    onSuccess: (verdict, state) => {
      if (editor === null) return;
      if (!verdict.ok) {
        setEditor({
          ...state,
          notices: [...state.notices, `Discovery failed: ${verdict.error ?? "upstream error"}`],
        });
        return;
      }
      // #485 family-paired merge (skip-with-warning discipline): on an image
      // row every discovered id lands as an image draft; on a chat row
      // image-family entries are REFUSED with the Image Source pointer —
      // never merged as chat models. Manual rows stay either way.
      const knownIds = new Set(state.models.map((model) => model.id.trim()));
      const added: string[] = [];
      const refusedImageIds: string[] = [];
      // Provenance summary over the whole verdict (#447): the counts name
      // where each row's metadata came from, so a degraded (no-host) run is
      // visible in numbers, not just in the row-level unavailable marking.
      const enrichedNotice = verdict.models.some((model) => model.metadataSource !== "unavailable")
        ? [
            "",
            `Enrichment: ${String(verdict.models.filter((model) => model.metadataSource === "models_dev").length)}× models.dev, ${String(verdict.models.filter((model) => model.metadataSource === "bundled").length)}× bundled, ${String(verdict.models.filter((model) => model.metadataSource === "none").length)}× no catalog match.`,
          ]
        : [];
      if (state.family === "image") {
        const merged = [...state.models];
        for (const model of verdict.models) {
          if (knownIds.has(model.id)) continue;
          knownIds.add(model.id);
          merged.push(discoveredImageModelToDraft(model));
          added.push(model.id);
        }
        setEditor({
          ...state,
          models: merged,
          notices: [
            ...state.notices,
            `Discovered ${String(verdict.models.length)} models (${String(added.length)} new merged).`,
            ...(added.length > 0
              ? [
                  "These models serve image generation — select this row in Settings → Providers → Image Source to hand generate_image to it.",
                ]
              : []),
            ...enrichedNotice,
            ...verdict.warnings,
          ],
        });
        return;
      }
      const merged = [...state.models];
      for (const model of verdict.models) {
        if (knownIds.has(model.id)) continue;
        if (model.family === "image") {
          refusedImageIds.push(model.id);
          continue;
        }
        knownIds.add(model.id);
        merged.push(discoveredModelToDraft(model));
        added.push(model.id);
      }
      const refusedNotice =
        refusedImageIds.length > 0
          ? (() => {
              const listed = refusedImageIds.slice(0, 5).join(", ");
              const listedIds =
                refusedImageIds.length > 5
                  ? `${listed} +${String(refusedImageIds.length - 5)} more`
                  : listed;
              return `Skipped ${String(refusedImageIds.length)} image-generation model(s) (${listedIds}) — 产图族 cannot import into a chat row; create an api=openai-images row and select it in Settings → Providers → Image Source.`;
            })()
          : null;
      setEditor({
        ...state,
        models: merged,
        notices: [
          ...state.notices,
          `Discovered ${String(verdict.models.length)} models (${String(added.length)} new merged).`,
          ...(refusedNotice !== null ? [refusedNotice] : []),
          ...enrichedNotice,
          ...verdict.warnings,
        ],
      });
    },
    onError: (error: Error, state) => {
      if (editor === null) return;
      setEditor({
        ...state,
        notices: [...state.notices, `Discovery failed: ${error.message}`],
      });
    },
  });

  const save = useMutation({
    mutationFn: async (state: EditorState) => {
      // Throws (surfaced by onError) when a model row is unusable — e.g. a
      // missing id, an off-ladder default rung, or a malformed budget.
      const models =
        state.family === "image"
          ? state.models.map((draft) => imageModelDraftToWire(draft))
          : state.models.map((draft) => modelDraftToWire(draft));
      const body = {
        ...(state.displayName.trim() !== "" ? { displayName: state.displayName.trim() } : {}),
        ...(state.baseUrl.trim() !== "" ? { baseUrl: state.baseUrl.trim() } : {}),
        ...(state.api.trim() !== "" ? { api: state.api.trim() } : {}),
        serviceTier: state.serviceTier,
        models,
        ...(apiKeyField(state) !== undefined ? { apiKey: apiKeyField(state) } : {}),
      };
      if (state.editingId !== null) {
        return replaceProviderConfig(state.editingId, body);
      }
      return createProviderConfig(state.id.trim(), body);
    },
    onSuccess: (row) => {
      setEditor(null);
      invalidate();
      toast.success(`Provider ${row.id} saved`, {
        description: "Execution options pick it up on the next request — no redeploy.",
      });
    },
    onError: (error: Error) => {
      toast.error("Saving the provider failed", { description: error.message });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProviderConfig(id),
    onSuccess: () => {
      setRemoving(null);
      invalidate();
      toast.success("Provider removed");
    },
    onError: (error: Error) => {
      toast.error("Removing the provider failed", { description: error.message });
    },
  });

  const test = useMutation({
    mutationFn: (id: string) => testProviderConfig(id),
    onSuccess: (verdict, id) => {
      setTestVerdicts((previous) => ({ ...previous, [id]: testVerdictText(verdict) }));
    },
    onError: (error: Error, id) => {
      setTestVerdicts((previous) => ({ ...previous, [id]: `Failed: ${error.message}` }));
    },
  });

  // #364 the models.yml paste import: one POST carries the fragment (any
  // apiKey plaintext rides exactly this body); the verdict transcript is
  // the honest created/skipped report the panel renders verbatim.
  const importYml = useMutation({
    mutationFn: (yaml: string) => importModelsYml(yaml),
    onSuccess: (verdict) => {
      setImportVerdict(verdict);
      invalidate();
      if (verdict.created > 0) {
        toast.success(`Imported ${verdict.created} provider${verdict.created === 1 ? "" : "s"}`, {
          description: "Execution options pick them up on the next request — no redeploy.",
        });
      }
    },
    onError: (error: Error) => {
      toast.error("The models.yml import failed", { description: error.message });
    },
  });

  const isPending = save.isPending || discover.isPending;

  return (
    <SettingsSection
      title="Configured"
      description="The provider directory execution options serve: your configured rows plus the deployment seed (marked deployment-seed — read-only, edits happen at redeploy). Your edits hot-apply on the next request. The API key is write-only: it is encrypted at rest and never shown again."
      action={
        editor === null ? (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setImportText("");
                setImportVerdict(null);
                setImportOpen(true);
              }}
            >
              Import models.yml
            </Button>
            <Button type="button" size="sm" onClick={() => setEditor(emptyEditor())}>
              Add provider
            </Button>
          </div>
        ) : null
      }
    >
      {providersQuery.isPending || providersQuery.data === undefined ? (
        <p className="text-sm text-subtle-foreground">
          {providersQuery.error === null
            ? "Loading configured providers…"
            : "Could not load the configured providers."}
        </p>
      ) : null}

      {editor !== null ? (
        <div className="space-y-3 rounded-md border border-border p-3" aria-label="Provider editor">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-2xs text-subtle-foreground">
              Provider id
              <Input
                value={editor.id}
                disabled={isPending || editor.editingId !== null}
                placeholder="my-newapi"
                className="h-8 font-mono text-xs"
                aria-label="Provider id"
                onChange={(event) => setEditor({ ...editor, id: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-2xs text-subtle-foreground">
              Display name
              <Input
                value={editor.displayName}
                disabled={isPending}
                className="h-8 text-xs"
                aria-label="Provider display name"
                onChange={(event) => setEditor({ ...editor, displayName: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-2xs text-subtle-foreground">
              Base URL
              <Input
                value={editor.baseUrl}
                disabled={isPending}
                placeholder="https://upstream.example.com/v1"
                className="h-8 font-mono text-xs"
                aria-label="Provider base URL"
                onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-2xs text-subtle-foreground">
              API family
              <ApiFamilySelect
                value={editor.api}
                options={providerApiFamilySchema.options}
                unsetLabel="Provider default"
                ariaLabel="Provider api family"
                disabled={isPending}
                onChange={(api) => setEditor(applyApiFamily(editor, api))}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-2xs text-subtle-foreground">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={editor.serviceTier}
                disabled={isPending}
                aria-label="Service tier capable"
                onChange={(event) => setEditor({ ...editor, serviceTier: event.target.checked })}
              />
              Service tier
            </label>
            <label className="flex items-center gap-1.5">
              API key
              <Input
                type="password"
                value={editor.apiKey ?? ""}
                disabled={isPending}
                placeholder={
                  editor.editingId !== null
                    ? "Unchanged — leave blank to keep"
                    : "sk-… (write-only)"
                }
                className="h-8 w-56 font-mono text-xs"
                aria-label="API key"
                onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
              />
            </label>
            {editor.editingId !== null ? (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={editor.clearApiKey}
                  disabled={isPending}
                  aria-label="Clear stored API key"
                  onChange={(event) => setEditor({ ...editor, clearApiKey: event.target.checked })}
                />
                Clear stored key
              </label>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || editor.baseUrl.trim() === ""}
              aria-label="Discover models"
              onClick={() => discover.mutate(editor)}
            >
              {discover.isPending ? "Discovering…" : "Discover models"}
            </Button>
          </div>
          <p className="text-2xs text-subtle-foreground">
            {editor.family === "image"
              ? "Discovery reads {baseUrl}/models and merges rows below as IMAGE model entries (id / sizes / output format / per-image price — unknown seats say \"unknown\"); this row's models serve the generate_image tool, never the chat picker."
              : "Discovery reads {baseUrl}/models (OpenAI models-list) and merges rows below: manual rows stay, discovered ids merge in with their catalog metadata (contextWindow / maxTokens / reasoning / thinking / cost — unknown seats say \"unknown\"). Image-generation ids are refused here with the Image Source pointer — never silently imported as chat models."}
          </p>
          {editor.notices.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-2xs text-foreground">
              {editor.notices.map((notice, index) => (
                <li key={`notice-${String(index)}`}>⚠ {notice}</li>
              ))}
            </ul>
          ) : null}
          <div className="space-y-2">
            {editor.family === "image"
              ? editor.models.map((draft, index) => (
                  <ImageModelRowEditor
                    key={String(index)}
                    index={index}
                    draft={draft}
                    disabled={isPending}
                    onChange={(next) =>
                      setEditor({
                        ...editor,
                        models: editor.models.map((entry, entryIndex) =>
                          entryIndex === index ? next : entry,
                        ),
                      })
                    }
                    onRemove={() =>
                      setEditor({
                        ...editor,
                        models: editor.models.filter((_, entryIndex) => entryIndex !== index),
                      })
                    }
                  />
                ))
              : editor.models.map((draft, index) => (
                  <ChatModelRowEditor
                    key={String(index)}
                    index={index}
                    draft={draft}
                    disabled={isPending}
                    onChange={(next) =>
                      setEditor({
                        ...editor,
                        models: editor.models.map((entry, entryIndex) =>
                          entryIndex === index ? next : entry,
                        ),
                      })
                    }
                    onRemove={() =>
                      setEditor({
                        ...editor,
                        models: editor.models.filter((_, entryIndex) => entryIndex !== index),
                      })
                    }
                  />
                ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              aria-label="Add model row"
              onClick={() =>
                setEditor(
                  editor.family === "image"
                    ? { ...editor, models: [...editor.models, emptyImageModelDraft()] }
                    : { ...editor, models: [...editor.models, emptyModelDraft()] },
                )
              }
            >
              Add model row
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={() => save.mutate(editor)}
            >
              {save.isPending
                ? "Saving…"
                : editor.editingId !== null
                  ? "Save changes"
                  : "Create provider"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setEditor(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-2 pt-1">
        {providers.map((provider) => (
          <li
            key={`${provider.source}-${provider.id}`}
            className="flex items-start gap-3 rounded-md border border-border p-3"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-center gap-2 text-sm text-foreground">
                {provider.displayName ?? provider.id}
                <span className="font-mono text-2xs text-subtle-foreground">{provider.id}</span>
                {provider.source === "deployment-seed" ? (
                  <Badge
                    variant="outline"
                    className="text-2xs font-normal"
                    title="Served from the deployment env seed (MODEL_RELAY_CATALOG). Read-only here — edits happen at redeploy."
                  >
                    deployment-seed
                  </Badge>
                ) : null}
                {provider.api !== null ? (
                  <Badge variant="outline" className="text-2xs font-normal">
                    {provider.api}
                  </Badge>
                ) : null}
                <Badge variant="outline" className="text-2xs font-normal">
                  {provider.hasApiKey ? "Key configured" : "No key (mock)"}
                </Badge>
                {provider.status === "warning" ? (
                  <Badge variant="outline" className="border-amber-500/60 text-2xs font-normal">
                    Warning
                  </Badge>
                ) : null}
                {provider.dispatchable ? null : (
                  <Badge variant="outline" className="text-2xs font-normal">
                    Not dispatchable
                  </Badge>
                )}
              </p>
              <p className="truncate font-mono text-2xs text-subtle-foreground">
                {provider.baseUrl ?? "no baseUrl"}
              </p>
              {provider.source === "deployment-seed" ? (
                <p className="text-2xs text-subtle-foreground">
                  {provider.models.length} model rows · deployment seed (read-only)
                </p>
              ) : (
                <p className="text-2xs text-subtle-foreground">
                  {provider.models.length} model rows · updated{" "}
                  {new Date(provider.updatedAt).toLocaleString()}
                </p>
              )}
              {provider.warnings.length > 0 ? (
                <ul className="space-y-0.5 text-2xs text-amber-600">
                  {provider.warnings.map((warning, index) => (
                    <li key={`${provider.id}-warning-${String(index)}`}>⚠ {warning}</li>
                  ))}
                </ul>
              ) : null}
              {testVerdicts[provider.id] !== undefined ? (
                <p className="text-2xs text-subtle-foreground">{testVerdicts[provider.id]}</p>
              ) : null}
            </div>
            {provider.source === "deployment-seed" ? null : (
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={test.isPending}
                  aria-label={`Test ${provider.id}`}
                  onClick={() => test.mutate(provider.id)}
                >
                  Test
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Edit ${provider.id}`}
                  onClick={() => setEditor(editorFromRow(provider))}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${provider.id}`}
                  onClick={() => setRemoving(provider)}
                >
                  Remove
                </Button>
              </div>
            )}
          </li>
        ))}
        {providers.length === 0 && editor === null && !providersQuery.isPending ? (
          <li className="rounded-md border border-dashed border-border p-3 text-sm text-subtle-foreground">
            No user-configured providers yet. This section lists only rows stored here (the server's
            provider_configs 正本); the deployment's declared catalog is read-only on the Server
            section and keeps serving until you add a provider.
          </li>
        ) : null}
      </ul>

      <ConfirmDeleteDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null);
        }}
      >
        <ConfirmDeleteDialogContent
          title={`Remove ${removing?.id ?? "provider"}?`}
          description="The stored row (including its encrypted key) is deleted. Threads that selected it fail closed with a named 422 until re-created."
          confirmLabel={remove.isPending ? "Removing…" : "Remove"}
          pending={remove.isPending}
          onConfirm={() => {
            if (removing !== null) remove.mutate(removing.id);
          }}
          onCancel={() => setRemoving(null)}
        />
      </ConfirmDeleteDialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open && !importYml.isPending) {
            setImportOpen(false);
            setImportVerdict(null);
          }
        }}
      >
        <DialogContent>
          {importOpen ? (
            <div className="space-y-3">
              <DialogHeader>
                <DialogTitle>Import models.yml</DialogTitle>
                <DialogDescription>
                  Paste an omp ~/.omp/agent/models.yml fragment (the full `providers:` map or a bare
                  fragment of it). Every provider becomes a configured row; an API key rides this
                  one request and is encrypted at rest. omp-only declarations (discovery, headers,
                  compat wire flags, out-of-family api values) are reported — never silently
                  dropped.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={importText}
                disabled={importYml.isPending}
                rows={12}
                className="font-mono text-xs"
                aria-label="models.yml fragment"
                placeholder={
                  "providers:\n  my-relay:\n    baseUrl: https://up.example.com/v1\n    api: openai-responses\n    models:\n      - id: my-model"
                }
                onChange={(event) => setImportText(event.target.value)}
              />
              {importVerdict !== null ? (
                <div
                  className="space-y-2 rounded-md border border-border p-2 text-2xs"
                  aria-label="Import verdicts"
                >
                  <p className="text-subtle-foreground">
                    Created {importVerdict.created} · skipped {importVerdict.skipped}
                  </p>
                  <ul className="space-y-1.5">
                    {importVerdict.providers.map((entry) => (
                      <li key={entry.id} className="space-y-0.5">
                        <p className="flex items-center gap-2 text-foreground">
                          <span className="font-mono">{entry.id}</span>
                          <Badge
                            variant="outline"
                            className={
                              entry.verdict === "created"
                                ? "text-2xs font-normal"
                                : "border-amber-500/60 text-2xs font-normal"
                            }
                          >
                            {entry.verdict === "created"
                              ? `created (${entry.modelCount} models)`
                              : `skipped ${entry.status}`}
                          </Badge>
                          {entry.hasApiKey ? null : (
                            <Badge variant="outline" className="text-2xs font-normal">
                              No key (mock)
                            </Badge>
                          )}
                        </p>
                        <p className="text-subtle-foreground">{entry.message}</p>
                        {entry.warnings.length > 0 ? (
                          <ul className="space-y-0.5 text-amber-600">
                            {entry.warnings.map((warning, index) => (
                              <li key={`${entry.id}-warning-${String(index)}`}>⚠ {warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={importYml.isPending}
                  onClick={() => {
                    setImportOpen(false);
                    setImportVerdict(null);
                  }}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={importYml.isPending || importText.trim() === ""}
                  onClick={() => importYml.mutate(importText)}
                >
                  {importYml.isPending ? "Importing…" : "Import"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

/**
 * The slot-facing component: supplies the plugin's own query cache (the SDK
 * runtime-shims react but NOT react-query, so the host's provider is on a
 * different context object and cannot be inherited).
 */
export function ConfiguredProviderSettingsSection() {
  return (
    <PluginQueryProvider>
      <ConfiguredProviderPanel />
    </PluginQueryProvider>
  );
}
