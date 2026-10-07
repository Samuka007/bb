import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * cap-provider-config plugin server entry (cloudflare-agent-project
 * #362/#382).
 *
 * The bb plugin manifest requires a server entry, but this plugin needs NO
 * backend of its own: every face it renders talks to the CAP control plane's
 * first-party `/api/v1/system/*` routes directly (same-origin browser
 * requests riding the /api/v1 auth ladder). The backend registration is
 * deliberately empty — the plugin exists to contribute two settingsSection
 * slots to the host app.
 */
export default async function plugin(bb: BbPluginApi): Promise<void> {
  void bb;
}