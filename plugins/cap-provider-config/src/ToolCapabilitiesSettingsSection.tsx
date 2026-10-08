import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@bb/shared-ui/switch";
import {
  SettingsBadge,
  SettingsRowList,
  SettingsSection,
  SettingsWithControl,
} from "./ui/settings-section";
import {
  useSetToolCapabilities,
  useToolCapabilities,
  type ToolCapabilitiesResponse,
  type ToolCapabilitiesWrite,
} from "./queries/tool-capabilities-queries";
import { PluginQueryProvider } from "./plugin-query-client";

/**
 * #502 the Tool Capabilities section: the three #150 experimental gates as
 * live switches writing the D1 `tool_capabilities` single-row seat (GET/PUT
 * /system/tool-capabilities) — hot-applied on the next turn, zero env
 * fallback (the deployment env gates are deleted). The absent row (badge:
 * no row) is the ruled omp posture — all five tools off; the first flip
 * materializes the row. generate_image is NOT one of these gates: it has
 * its own seat in the Image Source section.
 */

type GateField = "externalThinking" | "contextNotes" | "checkpoint";

interface GateDefinition {
  field: GateField;
  /** Row label; the tool family the gate renders on the wire. */
  label: string;
  /** The wire rows the switch enables, named for the aria label. */
  family: string;
  description: string;
}

const GATES: readonly GateDefinition[] = [
  {
    field: "externalThinking",
    label: "External thinking",
    family: "think",
    description:
      "Renders the think tool (external CoT). The wire pairs it with the forceReasoningOff pin; models whose native reasoning would collide refuse it.",
  },
  {
    field: "contextNotes",
    label: "Context notes",
    family: "context_notes + new_context",
    description: "Renders the experimental persistent notebook tools (16 KiB cap).",
  },
  {
    field: "checkpoint",
    label: "Checkpoints",
    family: "checkpoint + rewind",
    description:
      "Renders the exploration checkpoint tools — rewind retains only the concise report.",
  },
];

/** The whole-seat write (the PUT replaces all three gates — no merge). */
function writeOf(
  current: ToolCapabilitiesResponse,
  field: GateField,
  checked: boolean,
): ToolCapabilitiesWrite {
  return {
    externalThinking: field === "externalThinking" ? checked : current.externalThinking,
    contextNotes: field === "contextNotes" ? checked : current.contextNotes,
    checkpoint: field === "checkpoint" ? checked : current.checkpoint,
  };
}

function ToolCapabilitiesPanel() {
  const seat = useToolCapabilities();
  const { apply, isPending } = useSetToolCapabilities();
  const [error, setError] = useState<string | null>(null);

  if (seat.isPending || seat.data === undefined) {
    return (
      <SettingsSection
        title="Tool Capabilities"
        description="Experimental tool gates for this deployment."
      >
        <p className="text-sm text-subtle-foreground">
          {seat.error === null ? "Loading tool gates… " : ""}
          {seat.error !== null ? "Could not load the tool gates seat." : ""}
        </p>
      </SettingsSection>
    );
  }

  const current = seat.data;

  const toggle = (gate: GateDefinition, checked: boolean): void => {
    setError(null);
    apply(writeOf(current, gate.field, checked))
      .then((applied) => {
        toast.success(`${gate.label} ${applied[gate.field] ? "enabled" : "disabled"}.`, {
          description: "Hot-applied on the next turn — no redeploy.",
        });
      })
      .catch((cause: Error) => {
        setError(cause.message);
        toast.error("Updating the tool gates failed", { description: cause.message });
        // A failed write reports the server verdict and re-reads the stored
        // truth instead of moving the switch (the image-source precedent).
        void seat.refetch();
      });
  };

  return (
    <SettingsSection
      title="Tool Capabilities"
      description="Experimental tool gates stored in D1 and hot-applied on the next turn — no redeploy. All five tools default OFF (the omp posture); generate_image has its own seat under Image Source. An absent row means all gates off — the first flip stores the row."
      action={
        <SettingsBadge>
          {current.configured ? "Stored in D1" : "No row — all off (omp defaults)"}
        </SettingsBadge>
      }
    >
      <SettingsRowList>
        {GATES.map((gate) => (
          <SettingsWithControl
            key={gate.field}
            label={gate.label}
            labelBadge={gate.family}
            description={gate.description}
          >
            <Switch
              aria-label={`Enable ${gate.family}`}
              checked={current[gate.field]}
              disabled={isPending}
              onCheckedChange={(checked) => {
                toggle(gate, checked);
              }}
            />
          </SettingsWithControl>
        ))}
        {error !== null ? (
          <SettingsWithControl label="Last write failed" description={error}>
            {null}
          </SettingsWithControl>
        ) : null}
      </SettingsRowList>
    </SettingsSection>
  );
}

/**
 * The slot-facing component: supplies the plugin's own query cache (#387 —
 * the host's provider is on a different react-query copy and cannot be
 * inherited).
 */
export function ToolCapabilitiesSettingsSection() {
  return (
    <PluginQueryProvider>
      <ToolCapabilitiesPanel />
    </PluginQueryProvider>
  );
}
