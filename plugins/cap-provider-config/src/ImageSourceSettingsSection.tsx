import { useState } from "react";
import { toast } from "sonner";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { Label } from "@bb/shared-ui/label";
import {
  SettingsBadge,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "./ui/settings-section";
import { useProviderConfigs } from "./queries/provider-config-queries";
import {
  useImageSource,
  useSetImageSource,
} from "./queries/image-source-queries";
import { PluginQueryProvider } from "./plugin-query-client";

/**
 * #448 the image source (产图源) section: the explicit generate_image source
 * seat. Shows the currently effective source row, offers every dispatchable
 * api=openai-images row as a radio choice, and writes the selection to D1
 * (PUT /system/image-source) — hot-applied on the next turn, zero env
 * fallback (#450): clearing the seat is the only not-configured state.
 *
 * Candidate labels ride the Configured section's row cache (display name per
 * id); an unknown id degrades to the raw id, never a fetch of its own.
 */

function candidateLabel(
  candidates: string[],
  id: string,
  rows: { id: string; displayName: string | null }[] | undefined,
): string {
  const row = rows?.find((entry) => entry.id === id);
  if (row?.displayName !== undefined && row.displayName !== null && row.displayName !== "") {
    return `${row.displayName} (${id})`;
  }
  return id;
}

function ImageSourcePanel() {
  const seat = useImageSource();
  // Enabled only when candidates exist — the labels ride the row cache.
  const rowsQuery = useProviderConfigs({ enabled: (seat.data?.candidates.length ?? 0) > 0 });
  const { select, isPending } = useSetImageSource();
  const [error, setError] = useState<string | null>(null);

  const providerId = seat.data?.providerId ?? null;
  const candidates = seat.data?.candidates ?? [];

  const choose = (value: string): void => {
    const next = value === "none" ? null : value;
    if (next === providerId) return;
    setError(null);
    select(next)
      .then((applied) => {
        toast.success(
          applied.providerId === null
            ? "Image source cleared — generate_image is now unavailable."
            : `Image source set to ${applied.providerId}. The next turn generates through it.`,
          { description: "Hot-applied — no redeploy." },
        );
      })
      .catch((cause: Error) => {
        setError(cause.message);
        toast.error("Setting the image source failed", { description: cause.message });
        void seat.refetch();
      });
  };

  if (seat.isPending || seat.data === undefined) {
    return (
      <SettingsSection
        title="Image Source"
        description="Which provider row generates images for the generate_image tool."
      >
        <p className="text-sm text-subtle-foreground">
          {seat.error === null ? "Loading image source… " : ""}
          {seat.error !== null ? "Could not load the image source seat." : ""}
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title="Image Source"
      description="Which api=openai-images provider row supplies the generate_image tool. The row's baseUrl, stored key, and first model are the source; switching is hot-applied on the next turn. No source selected = the tool answers that it is not configured (no deployment-env fallback)."
    >
      {candidates.length === 0 ? (
        <SettingsRowList>
          <SettingsWithControl
            label="Current source"
            description="No dispatchable api=openai-images provider row exists. Add one in the Configured section (api = openai-images, at least one model row, optional key), then select it here."
          >
            <SettingsBadge>Not configured</SettingsBadge>
          </SettingsWithControl>
        </SettingsRowList>
      ) : (
        <SettingsRowList>
          <SettingsWithControl
            label="Current source"
            description={
              providerId === null
                ? "Nothing selected — generate_image is unavailable."
                : undefined
            }
          >
            <SettingsBadge>{providerId === null ? "Not configured" : providerId}</SettingsBadge>
          </SettingsWithControl>
          <SettingsWithControl label="Select source" description={error ?? undefined}>
            <RadioGroup value={providerId ?? "none"} onValueChange={choose} disabled={isPending}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="none" id="image-source-none" />
                <Label htmlFor="image-source-none" className="text-sm">
                  None — generate_image unavailable
                </Label>
              </div>
              {candidates.map((id) => (
                <div className="flex items-center gap-2" key={id}>
                  <RadioGroupItem value={id} id={`image-source-${id}`} />
                  <Label htmlFor={`image-source-${id}`} className="text-sm">
                    {candidateLabel(candidates, id, rowsQuery.data)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </SettingsWithControl>
        </SettingsRowList>
      )}
    </SettingsSection>
  );
}

/**
 * The slot-facing component: supplies the plugin's own query cache (#387 —
 * the host's provider is on a different react-query copy and cannot be
 * inherited).
 */
export function ImageSourceSettingsSection() {
  return (
    <PluginQueryProvider>
      <ImageSourcePanel />
    </PluginQueryProvider>
  );
}
