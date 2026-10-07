import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ConfiguredProviderSettingsSection } from "./src/ConfiguredProviderSettingsSection";
import { ImageSourceSettingsSection } from "./src/ImageSourceSettingsSection";
import { ServerProviderSettingsSection } from "./src/ServerProviderSettingsSection";
import { ToolCapabilitiesSettingsSection } from "./src/ToolCapabilitiesSettingsSection";

/**
 * cap-provider-config (cloudflare-agent-project #362/#382): the provider
 * configuration panel delivered as a frontend plugin — settingsSection slots
 * only, zero app-core wiring. The app's settings-nav/SettingsView stay
 * upstream-pristine; this replaces the core-wired "server"+"configured"
 * provider entries (the #266 port wiring reverts along with the #362 WIP).
 *
 * - `configured` — the user-face write path: CRUD onto
 *   /api/v1/system/providers (D1 provider_configs 正本), discovery, probes.
 * - `imageSource` — the #448 产图源 seat: which openai-images row supplies
 *   generate_image (GET/PUT /api/v1/system/image-source, D1 image_source).
 * - `toolCapabilities` — the #502 experimental tool gates: think /
 *   context_notes + new_context / checkpoint + rewind (GET/PUT
 *   /api/v1/system/tool-capabilities, D1 tool_capabilities).
 * - `server` — the #266 projection migrated here: the #449 editable
 *   web_search chain (D1 正本) plus the #484 legacy deployment relay
 *   channel, rendered only when the deployment sets its env.
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
    description:
      "User-configurable providers — add, import models.yml, edit, probe, remove; hot-applied.",
    component: ConfiguredProviderSettingsSection,
  });
  app.slots.settingsSection({
    id: "imageSource",
    title: "Image Source",
    description: "Which provider row generates images for the generate_image tool.",
    component: ImageSourceSettingsSection,
  });
  app.slots.settingsSection({
    id: "toolCapabilities",
    title: "Tool Capabilities",
    description:
      "Experimental tool gates (think / context notes / checkpoints) — D1-backed, hot-applied on the next turn.",
    component: ToolCapabilitiesSettingsSection,
  });
  app.slots.settingsSection({
    id: "server",
    title: "Server",
    description:
      "Web search engine chain (editable, D1) plus the legacy deployment relay channel — shown only when the deployment sets MODEL_RELAY_* env (#484).",
    component: ServerProviderSettingsSection,
  });
});