import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { Switch } from "@bb/shared-ui/switch";
import {
  SettingsBadge,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "./ui/settings-section";
import {
  useProviderProjections,
  type ProviderProjectionsResponse,
} from "./queries/provider-projection-queries";
import {
  useSetWebSearch,
  useWebSearch,
  type WebSearchPutRequest,
} from "./queries/web-search-queries";
import { PluginQueryProvider } from "./plugin-query-client";

/**
 * Settings → Providers → Server (#266). Information architecture (#484):
 * every block names its source of truth. The web_search engine chain is
 * EDITABLE (#449): chain order, per-transport timeout, and per-engine
 * credentials write to the D1 `web_search` row (GET/PUT /system/web-search)
 * and hot-apply on the next turn — the env path (AGENT_DO_WEB_SEARCH) is
 * deleted, the row is the sole 正本. The relay harness is the LEGACY
 * deployment channel (Worker env MODEL_RELAY_*): read-only, and rendered
 * only when the deployment actually sets channel env (`envConfigured`,
 * #484) — at zero env the rows are pure HARNESS_DEFAULTS synthesis and
 * rendering them read as "my LLM provider is mock" next to the live D1
 * Configured rows (#450: provider_configs is the sole provider 正本).
 *
 * Secret discipline: key/token values are WRITE-ONLY — the face shows
 * presence badges only, an input left empty keeps the stored secret, and an
 * explicit clear (✕) removes it.
 *
 * Plugin adaptation (#382): moved out of the app
 * (`apps/app/src/components/settings/ServerProviderSettingsSection.tsx`)
 * once #362 made the user-face write path a plugin section — the app's
 * core wiring (settings-nav entry, SettingsView branch) reverts to upstream
 * pristine, and this face renders through the plugin settingsSection slot
 * instead.
 */

/** One projected fact: label on the left, read-only value on the right. */
function ProjectionRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <SettingsWithControl label={label}>
      <span className="text-sm text-subtle-foreground">{value}</span>
    </SettingsWithControl>
  );
}

/** Presence gates render as badges — key/credential VALUES never reach the UI. */
function PresenceBadge({ present }: { present: boolean }) {
  return (
    <SettingsBadge>{present ? "Configured" : "Not configured"}</SettingsBadge>
  );
}

function HarnessRows({ harness }: { harness: ProviderProjectionsResponse["harness"] }) {
  // #484: at zero channel env these rows are HARNESS_DEFAULTS synthesis
  // with no deployment input — the block must not render (the "mock /
  // open.bigmodel.cn / glm-5.3" defaults read as the user's provider). It
  // exists only when the deployment still feeds the legacy channel.
  if (!harness.envConfigured) return null;
  return (
    <SettingsRowList>
      <ProjectionRow label="Relay mode" value={harness.relayMode} />
      <ProjectionRow
        label="Relay endpoint"
        value={harness.relayBaseUrlHost ?? harness.relayBaseUrl}
      />
      <ProjectionRow label="Model" value={harness.relayModel} />
      <SettingsWithControl
        label="API key"
        description={
          harness.relayKeyPresent
            ? undefined
            : "MODEL_RELAY_API_KEY is unset — this legacy channel runs in mock mode (fixed replies) for turns without a selected provider."
        }
      >
        <PresenceBadge present={harness.relayKeyPresent} />
      </SettingsWithControl>
      <ProjectionRow label="Permission mode" value={harness.permissionMode} />
      <ProjectionRow label="Machine" value={harness.machineId} />
    </SettingsRowList>
  );
}

/** Display label per engine id ("public" reads better as Public Web). */
function engineLabel(engine: string): string {
  return engine === "public" ? "Public Web" : engine;
}

/**
 * Write helper shared by every control on the editor: a failed write
 * reports the server verdict and re-reads the stored truth instead of
 * moving local state (the image-source section precedent).
 */
function useWebSearchWrite(onError: (message: string) => void): {
  write: (payload: WebSearchPutRequest, okMessage: string) => void;
  isPending: boolean;
} {
  const { save, isPending } = useSetWebSearch();
  const write = (payload: WebSearchPutRequest, okMessage: string): void => {
    save(payload)
      .then(() => {
        toast.success(okMessage, {
          description: "Hot-applied — the next web_search uses it. No redeploy.",
        });
      })
      .catch((cause: Error) => {
        onError(cause.message);
        toast.error("Saving the web search configuration failed", {
          description: cause.message,
        });
      });
  };
  return { write, isPending };
}

const EMPTY_ENGINE_CREDENTIALS = {
  brave: { hasApiKey: false },
  searxng: {
    endpoint: null,
    categories: null,
    language: null,
    safesearch: null,
    hasToken: false,
    hasBasicAuth: false,
  },
} as const;

/**
 * #449 the editable engine-chain face: one row per available engine (chain
 * position + include toggle + reorder), the per-transport timeout, and the
 * per-engine credential inputs. Every interaction writes the FULL ordered
 * chain (order IS the payload); engine settings are tri-state on the wire,
 * so a partial write never disturbs unrelated stored fields.
 */
function WebSearchEditor() {
  const face = useWebSearch();
  const { write, isPending } = useWebSearchWrite((message) => setError(message));
  const [error, setError] = useState<string | null>(null);

  if (face.isPending || face.data === undefined) {
    return (
      <SettingsRowList>
        <p className="text-sm text-subtle-foreground">
          {face.error === null
            ? "Loading the web search engine chain…"
            : "Could not load the web search engine chain."}
        </p>
      </SettingsRowList>
    );
  }

  const data = face.data;
  if (data.decodeError) {
    return (
      <SettingsRowList>
        <ProjectionRow
          label="Engine chain"
          value="Unavailable — the stored web_search row failed to decode; repair the D1 web_search row (no chain is served until then)."
        />
      </SettingsRowList>
    );
  }

  const chain = data.chain.map((entry) => entry.engine);
  const gateOf = (engine: string) =>
    data.chain.find((entry) => entry.engine === engine);

  const move = (engine: string, delta: -1 | 1): void => {
    const index = chain.indexOf(engine);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= chain.length) return;
    const next = [...chain];
    [next[index], next[target]] = [next[target], next[index]];
    write({ chain: next }, `Engine chain updated — ${engineLabel(engine)} moved.`);
  };

  const toggle = (engine: string, included: boolean): void => {
    if (!included && chain.length === 1) {
      setError("The chain cannot be empty — keep at least one engine.");
      void face.refetch();
      return;
    }
    const next = included ? [...chain, engine] : chain.filter((id) => id !== engine);
    write({ chain: next }, included ? `${engineLabel(engine)} added to the chain.` : `${engineLabel(engine)} removed from the chain.`);
  };

  const credentials = data.engines ?? EMPTY_ENGINE_CREDENTIALS;

  return (
    <SettingsRowList>
      {data.availableEngines.map((engine) => {
        const gate = gateOf(engine);
        const inChain = gate !== undefined;
        const position = inChain ? chain.indexOf(engine) + 1 : null;
        return (
          <SettingsWithControl
            key={engine}
            label={engineLabel(engine)}
            description={
              inChain
                ? gate!.credentialsRequired
                  ? `Chain position ${position} — requires configured credentials to serve requests.`
                  : `Chain position ${position} — credential-free engine.`
                : "Not in the chain — toggle on to append it last."
            }
          >
            <div className="flex items-center gap-2">
              {inChain ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${engineLabel(engine)} up`}
                    disabled={position === 1 || isPending}
                    onClick={() => move(engine, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Move ${engineLabel(engine)} down`}
                    disabled={position === chain.length || isPending}
                    onClick={() => move(engine, 1)}
                  >
                    ↓
                  </Button>
                </>
              ) : null}
              <PresenceBadge present={!gate || gate.credentialsPresent} />
              <Switch
                aria-label={`Include ${engineLabel(engine)} in the chain`}
                checked={inChain}
                onCheckedChange={(checked) => toggle(engine, checked)}
              />
            </div>
          </SettingsWithControl>
        );
      })}
      <TimeoutRow timeoutSeconds={data.timeoutSeconds} onWrite={write} onError={setError} />
      <BraveCredentialRow
        hasApiKey={credentials.brave.hasApiKey}
        onWrite={write}
        onError={setError}
      />
      <SearxngCredentialRow
        searxng={credentials.searxng}
        onWrite={write}
        onError={setError}
      />
      {error !== null ? (
        <ProjectionRow label="Last error" value={error} />
      ) : null}
      <ProjectionRow
        label="Excluded engines"
        value={`${data.browserBackedEngines.join(", ")} — browser-backed, excluded from the server-side provider set`}
      />
    </SettingsRowList>
  );
}

/**
 * Per-transport ceiling (seconds, 1..300 server-side). Local state seeds
 * from the server; blur/Enter writes the parsed number.
 */
function TimeoutRow({
  timeoutSeconds,
  onWrite,
  onError,
}: {
  timeoutSeconds: number | null;
  onWrite: (payload: WebSearchPutRequest, okMessage: string) => void;
  onError: (message: string | null) => void;
}) {
  const [value, setValue] = useState(String(timeoutSeconds ?? ""));
  const submit = (): void => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      onError("Timeout must be a positive whole number of seconds.");
      return;
    }
    onError(null);
    onWrite({ timeoutSeconds: parsed }, `Timeout set to ${parsed}s.`);
  };
  return (
    <SettingsWithControl
      label="Timeout (seconds)"
      description="Per-transport ceiling — each engine in the chain gets its own window (default 60, cap 300)."
    >
      <div className="flex items-center gap-2">
        <Input
          className="w-24"
          inputMode="numeric"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={submit}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
      </div>
    </SettingsWithControl>
  );
}

/** Write-only Brave API key row: empty input = keep, Save sets, ✕ clears. */
function BraveCredentialRow({
  hasApiKey,
  onWrite,
  onError,
}: {
  hasApiKey: boolean;
  onWrite: (payload: WebSearchPutRequest, okMessage: string) => void;
  onError: (message: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const save = (): void => {
    if (value === "") return;
    onError(null);
    onWrite({ engines: { brave: { apiKey: value } } }, "Brave API key stored.");
    setValue("");
  };
  const clear = (): void => {
    onError(null);
    onWrite({ engines: { brave: { apiKey: null } } }, "Brave API key cleared.");
    setValue("");
  };
  return (
    <SettingsWithControl
      label="Brave API key"
      description="Brave Search subscription key. Write-only: the stored value never renders; an empty Save keeps it."
    >
      <div className="flex items-center gap-2">
        <PresenceBadge present={hasApiKey} />
        <Input
          className="w-56"
          type="password"
          placeholder={hasApiKey ? "Stored — type to replace" : "Type a key"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        <Button variant="outline" size="sm" disabled={value === ""} onClick={save}>
          Save
        </Button>
        <Button variant="ghost" size="sm" disabled={!hasApiKey} onClick={clear}>
          ✕
        </Button>
      </div>
    </SettingsWithControl>
  );
}

/**
 * SearXNG rows: the endpoint (non-secret, readable) plus the write-only
 * auth pair. Basic auth wins when both token and basic are set (omp auth
 * precedence), so clearing one at a time is honest.
 */
function SearxngCredentialRow({
  searxng,
  onWrite,
  onError,
}: {
  searxng: {
    endpoint: string | null;
    hasToken: boolean;
    hasBasicAuth: boolean;
  };
  onWrite: (payload: WebSearchPutRequest, okMessage: string) => void;
  onError: (message: string | null) => void;
}) {
  const [endpoint, setEndpoint] = useState(searxng.endpoint ?? "");
  const [token, setToken] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const saveEndpoint = (): void => {
    onError(null);
    const next = endpoint === "" ? null : endpoint;
    onWrite(
      { engines: { searxng: { endpoint: next } } },
      next === null ? "SearXNG endpoint cleared." : "SearXNG endpoint stored.",
    );
  };
  const saveAuth = (): void => {
    onError(null);
    onWrite(
      {
        engines: {
          searxng: {
            ...(token !== "" ? { token } : {}),
            ...(basicUsername !== "" ? { basicUsername } : {}),
            ...(basicPassword !== "" ? { basicPassword } : {}),
          },
        },
      },
      "SearXNG credentials stored.",
    );
    setToken("");
    setBasicUsername("");
    setBasicPassword("");
  };
  const clearAuth = (): void => {
    onError(null);
    onWrite(
      {
        engines: {
          searxng: { token: null, basicUsername: null, basicPassword: null },
        },
      },
      "SearXNG credentials cleared.",
    );
    setToken("");
    setBasicUsername("");
    setBasicPassword("");
  };
  return (
    <>
      <SettingsWithControl
        label="SearXNG endpoint"
        description="Instance base URL, e.g. https://searx.example.com — SearXNG serves only with one configured."
      >
        <div className="flex items-center gap-2">
          <Input
            className="w-72"
            placeholder="https://searx.example.com"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveEndpoint();
            }}
          />
          <Button variant="outline" size="sm" onClick={saveEndpoint}>
            Save
          </Button>
        </div>
      </SettingsWithControl>
      <SettingsWithControl
        label="SearXNG credentials"
        description="Bearer token or Basic auth pair (Basic wins when both are set). Write-only: values never render back."
      >
        <div className="flex items-center gap-2">
          <PresenceBadge present={searxng.hasToken || searxng.hasBasicAuth} />
          <Input
            className="w-40"
            type="password"
            placeholder={searxng.hasToken ? "Token stored" : "Token"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Input
            className="w-32"
            placeholder={searxng.hasBasicAuth ? "User stored" : "Basic user"}
            value={basicUsername}
            onChange={(event) => setBasicUsername(event.target.value)}
          />
          <Input
            className="w-32"
            type="password"
            placeholder="Basic password"
            value={basicPassword}
            onChange={(event) => setBasicPassword(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={token === "" && basicUsername === "" && basicPassword === ""}
            onClick={saveAuth}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!searxng.hasToken && !searxng.hasBasicAuth}
            onClick={clearAuth}
          >
            ✕
          </Button>
        </div>
      </SettingsWithControl>
    </>
  );
}

function ServerProviderPanel() {
  const projections = useProviderProjections();
  if (projections.isPending || projections.data === undefined) {
    return (
      <SettingsSection
        title="Server"
        description="Server-side provider configuration: the editable web_search engine chain (D1) plus the legacy deployment relay channel when configured."
      >
        <p className="text-sm text-subtle-foreground">
          {projections.error === null
            ? "Loading provider projection…"
            : "Could not load the provider projection."}
        </p>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection
      title="Server"
      description="Every block names its source of truth: provider configuration lives in the Configured rows (D1, hot-applied); the web search engine chain below writes to the D1 web_search row and hot-applies on the next turn; the deployment relay channel is legacy env machinery (read-only, redeploy to change) shown only when the deployment still sets MODEL_RELAY_*."
    >
      <div className="space-y-4">
        {projections.data.harness.envConfigured ? (
          <div>
            <Label className="text-sm font-medium">Deployment relay channel</Label>
            <p className="text-sm text-subtle-foreground">
              Legacy deployment-env channel (Worker vars/secrets: MODEL_RELAY_*;
              execution pins: DAEMON_MACHINE_ID, HARNESS_PERMISSION_MODE). The
              Configured rows are the provider configuration source of truth;
              this projection only matters for deployments that still set the
              env.
            </p>
          </div>
        ) : null}
        <HarnessRows harness={projections.data.harness} />
        <div>
          <Label className="text-sm font-medium">Web search engine chain</Label>
          <p className="text-sm text-subtle-foreground">
            Ordered fallback chain for the web_search tool — first engine with
            renderable content wins; engines without credentials are skipped.
          </p>
        </div>
        <WebSearchEditor />
      </div>
    </SettingsSection>
  );
}

/**
 * The slot-facing component: supplies the plugin's own query cache (#387).
 * The plugin bundles its own react-query copy (the SDK runtime-shims react
 * but NOT react-query), so the host's provider is on a different context
 * object and cannot be inherited — mounting this section bare throws "No
 * QueryClient set" and the per-slot error boundary disables the section for
 * the session.
 */
export function ServerProviderSettingsSection() {
  return (
    <PluginQueryProvider>
      <ServerProviderPanel />
    </PluginQueryProvider>
  );
}
