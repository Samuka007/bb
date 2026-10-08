import { useState } from "react";
import type { ThreadTimelineModelFallback } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { rawStringLocalStorage } from "@/lib/browser-storage";

/**
 * #499: two shapes share one dismissal mechanism
 * (`bb.thread.model-fallback-dismissed.<threadId>`, occurrence-keyed):
 *
 * - Provider-initiated fallback reported on the timeline (pre-#499 behavior,
 *   unchanged).
 * - The thread's stored model left the directory — or the zeroth cell, no
 *   model selected at all. The card only OFFERS the nearest available row;
 *   the switch itself is the user's explicit click, never automatic. The
 *   composer's send gate stays in force while the selection is dead, so a
 *   dismissed card never unblocks a dispatch the server would 422.
 */
export type ThreadModelFallbackCardProps =
  | { fallback: ThreadTimelineModelFallback; threadId: string }
  | {
      threadId: string;
      /** The last-use model that left the directory; null = no selection. */
      unavailableModel: { value: string; label: string } | null;
      /** Nearest available directory row; null when nothing is offered. */
      suggestion: { value: string; label: string } | null;
      onUseSuggestion: (value: string) => void;
      isApplying?: boolean;
    };

function dismissalStorageKey(threadId: string): string {
  return `bb.thread.model-fallback-dismissed.${threadId}`;
}

function modelLabel(model: string): string {
  const parts = model
    .replace(/^(?:anthropic[-/])?claude-/i, "")
    .split("-")
    .filter(Boolean);
  const versionStart = parts.findIndex((part) => /^\d+$/.test(part));
  const nameParts = versionStart === -1 ? parts : parts.slice(0, versionStart);
  const versionParts = versionStart === -1 ? [] : parts.slice(versionStart);
  const name = nameParts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const [major, minor, ...qualifiers] = versionParts;
  const version = major
    ? [minor ? `${major}.${minor}` : major, ...qualifiers].join(" ")
    : "";
  return [name, version].filter(Boolean).join(" ") || model;
}

export function ThreadModelFallbackCard(props: ThreadModelFallbackCardProps) {
  const { threadId } = props;
  const fallback = "fallback" in props ? props.fallback : null;
  const unavailable = "fallback" in props ? null : props;
  const occurrence =
    fallback !== null
      ? String(fallback.sourceSeq)
      : unavailable?.unavailableModel != null
        ? `unavailable:${unavailable.unavailableModel.value}`
        : "unavailable:missing";
  const storageKey = dismissalStorageKey(threadId);
  const [dismissedOccurrence, setDismissedOccurrence] = useState(() =>
    rawStringLocalStorage.getItem(storageKey, ""),
  );

  if (dismissedOccurrence === occurrence) {
    return null;
  }

  const title = fallback !== null
    ? "Model fallback"
    : unavailable?.unavailableModel != null
      ? "Model unavailable"
      : "No model selected";
  const body =
    fallback !== null
      ? `Switched from ${modelLabel(fallback.originalModel)} to ${modelLabel(fallback.fallbackModel)}`
      : unavailable?.unavailableModel != null
        ? `${unavailable.unavailableModel.label} is no longer available.`
        : "This thread has no model selected.";
  const suggestion = unavailable?.suggestion ?? null;
  const isApplying = unavailable?.isApplying ?? false;

  return (
    <PromptStackCard ariaLabel={title} className="overflow-hidden">
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-8 items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <Icon
          name="AlertTriangle"
          className="size-3.5 shrink-0 text-warning-text"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">{title}</span>
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground"
          title={fallback !== null ? fallback.message : body}
        >
          {body}
        </span>
        {suggestion !== null ? (
          <Button
            type="button"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={isApplying}
            onClick={() => {
              unavailable?.onUseSuggestion(suggestion.value);
            }}
          >
            {isApplying ? "Switching..." : `Use ${suggestion.label}`}
          </Button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss model fallback"
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          onClick={() => {
            rawStringLocalStorage.setItem(storageKey, occurrence);
            setDismissedOccurrence(occurrence);
          }}
        >
          <Icon name="X" className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </PromptStackCard>
  );
}
