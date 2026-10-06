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
import { PluginQueryProvider } from "./plugin-query-client";

/**
 * Settings → Providers → Server (#266). Read-only projection of the
 * server-side provider configuration (#255 solution C): the relay harness
 * (mode / endpoint host / model / key presence) and the web_search engine
 * chain (order + per-engine credential gates + browser-backed exclusions).
 *
 * There is deliberately no control on this section — the configuration's
 * source of truth is the deployment env (control-plane layer §3.2: secrets
 * and deployment topology never enter the control-plane DB), so the section
 * only projects facts and points at where edits happen.
 *
 * Plugin adaptation (#382): moved verbatim out of the app
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
            : "Without a relay key the harness runs in mock mode (fixed replies)."
        }
      >
        <PresenceBadge present={harness.relayKeyPresent} />
      </SettingsWithControl>
      <ProjectionRow label="Permission mode" value={harness.permissionMode} />
      <ProjectionRow label="Machine" value={harness.machineId} />
    </SettingsRowList>
  );
}

function WebSearchRows({
  webSearch,
}: {
  webSearch: ProviderProjectionsResponse["webSearch"];
}) {
  if (webSearch.decodeError) {
    return (
      <SettingsRowList>
        <ProjectionRow
          label="Engine chain"
          value="Unavailable — the AGENT_DO_WEB_SEARCH env failed to decode; fix the deployment env and redeploy."
        />
      </SettingsRowList>
    );
  }
  return (
    <SettingsRowList>
      {webSearch.chain.map((entry) => (
        <SettingsWithControl
          key={entry.engine}
          label={entry.engine === "public" ? "Public Web" : entry.engine}
          description={
            entry.credentialsRequired
              ? "Requires configured credentials to serve requests."
              : "Credential-free engine."
          }
        >
          <PresenceBadge present={entry.credentialsPresent} />
        </SettingsWithControl>
      ))}
      {webSearch.chain.length === 0 ? (
        <ProjectionRow label="Engine chain" value="Empty chain configured." />
      ) : null}
      <ProjectionRow
        label="Excluded engines"
        value={`${webSearch.browserBackedEngines.join(", ")} — browser-backed, excluded from the server-side provider set`}
      />
    </SettingsRowList>
  );
}

function ServerProviderPanel() {
  const projections = useProviderProjections();
  if (projections.isPending || projections.data === undefined) {
    return (
      <SettingsSection
        title="Server"
        description="Read-only projection of the server-side provider configuration."
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
      description="Read-only projection of the server-side provider configuration. Editing happens in the deployment env (Worker vars/secrets: MODEL_RELAY_*, AGENT_DO_WEB_SEARCH; per-host: DAEMON_AGENT_AUTH) followed by a redeploy — this section has no write path (ops/staging-relay.md precedent)."
    >
      <div className="space-y-4">
        <HarnessRows harness={projections.data.harness} />
        <WebSearchRows webSearch={projections.data.webSearch} />
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