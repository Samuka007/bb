import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The plugin's own react-query wiring (#387). The plugin bundles its own
 * react-query copy — the SDK runtime-shims react but NOT react-query — so the
 * host app's QueryClientProvider lives on a different context object and
 * cannot be inherited: every slot-facing section that mounts a `useQuery`
 * MUST sit under this provider, or react-query throws "No QueryClient set"
 * and the per-slot error boundary disables the section for the session (the
 * #387 staging crash: the Server section mounted bare).
 *
 * One client per page load (module singleton), shared by both sections so a
 * Configured write can invalidate the Server projection by query key.
 */

/** The plugin's own query cache, one per page load (module singleton). */
export const pluginQueryClient = new QueryClient();

/** Test seam: clear the singleton cache between cases. */
export function resetPluginQueryClientForTest(): void {
  pluginQueryClient.clear();
}

/** Slot-facing wrapper every query-mounting settingsSection renders under. */
export function PluginQueryProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={pluginQueryClient}>{children}</QueryClientProvider>
  );
}
