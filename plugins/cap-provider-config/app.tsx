import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ConfiguredProviderSettingsSection } from "./src/ConfiguredProviderSettingsSection";
import { ServerProviderSettingsSection } from "./src/ServerProviderSettingsSection";

/**
 * cap-provider-config (cloudflare-agent-project #362/#382): the provider
 * configuration panel delivered as a frontend plugin — settingsSection slots
 * only, zero app-core wiring. The app's settings-nav/SettingsView stay
 * upstream-pristine; this replaces the core-wired "server"+"configured"
 * provider entries (the #266 port wiring reverts along with the #362 WIP).
 *
 * - `configured` — the user-face write path: CRUD onto
 *   /api/v1/system/providers (D1 provider_configs 正本), discovery, probes.
 * - `server` — the #266 read-only projection migrated here: deployment-env
 *   facts (relay harness + web_search chain), no controls.
 *
 * Both render on the plugin's canonical Settings page
 * (/settings/plugins/cap-provider-config), stacked in registration order
 * (PluginSettingsSections.tsx); the nav row appears from
 * settingsSections.some(...) once the bundle registers.
 */
export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "configured",
    title: "Configured",
    description: "User-configurable providers — add, edit, probe, remove; hot-applied.",
    component: ConfiguredProviderSettingsSection,
  });
  app.slots.settingsSection({
    id: "server",
    title: "Server",
    description: "Read-only projection of the deployment-env provider configuration.",
    component: ServerProviderSettingsSection,
  });
});