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
 * deleted, the row is the sole 正本. #500: the legacy deployment-channel
 * relay block is DELETED with its env scalars — the D1 provider_configs
 * rows are the panel's sole provider 正本 (the Configured section above).
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
  exa: { hasApiKey: false },
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
  // #538 the rows read in chain order: in-chain engines sorted by their
  // position, not-in-chain engines trailing in the server's fixed vocabulary
  // order (stable sort) — otherwise the "Chain position N" labels fight the
  // row layout and the chain reads scrambled.
  const orderedEngines = [...data.availableEngines].sort((a, b) => {
    const posA = chain.indexOf(a);
    const posB = chain.indexOf(b);
    if (posA !== -1 && posB !== -1) return posA - posB;
    if (posA !== -1) return -1;
    if (posB !== -1) return 1;
    return 0;
  });

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
      {orderedEngines.map((engine) => {
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
      <ApiKeyCredentialRow
        engine="brave"
        label="Brave API key"
        description="Brave Search subscription key. Write-only: the stored value never renders; an empty Save keeps it."
        hasApiKey={credentials.brave.hasApiKey}
        onWrite={write}
        onError={setError}
      />
      <ApiKeyCredentialRow
        engine="exa"
        label="Exa API key"
        description="Exa search API key (api.exa.ai). Write-only: the stored value never renders; an empty Save keeps it."
        hasApiKey={credentials.exa.hasApiKey}
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

/**
 * Write-only API key row — the keyed-engine credential pattern (Brave/Exa):
 * empty input = keep, Save sets, ✕ clears. The typed value never renders
 * back, and the wire payload is scoped to the row's own engine.
 */
function ApiKeyCredentialRow({
  engine,
  label,
  description,
  hasApiKey,
  onWrite,
  onError,
}: {
  engine: "brave" | "exa";
  label: string;
  description: string;
  hasApiKey: boolean;
  onWrite: (payload: WebSearchPutRequest, okMessage: string) => void;
  onError: (message: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const payload = (apiKey: string | null): WebSearchPutRequest => ({
    engines: engine === "brave" ? { brave: { apiKey } } : { exa: { apiKey } },
  });
  const save = (): void => {
    if (value === "") return;
    onError(null);
    onWrite(payload(value), `${label} stored.`);
    setValue("");
  };
  const clear = (): void => {
    onError(null);
    onWrite(payload(null), `${label} cleared.`);
    setValue("");
  };
  return (
    <SettingsWithControl label={label} description={description}>
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
        stacked
        label="SearXNG credentials"
        description="Bearer token or Basic auth pair (Basic wins when both are set). Write-only: values never render back."
      >
        {/* #538 stacked full-width controls: three inputs plus actions don't
            fit the side-by-side control column without starving the label. */}
        <div className="flex flex-wrap items-center gap-2">
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
  return (
    <SettingsSection
      title="Server"
      description="Every block names its source of truth: provider configuration lives in the Configured rows (D1, hot-applied); the web search engine chain below writes to the D1 web_search row and hot-applies on the next turn. The legacy deployment relay channel is deleted (#500) — the D1 rows are the sole provider 正本."
    >
      <div className="space-y-4">
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
