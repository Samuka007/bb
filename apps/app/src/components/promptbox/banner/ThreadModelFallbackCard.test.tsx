// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadModelFallbackCard } from "./ThreadModelFallbackCard";

const fallback = {
  sourceSeq: 42,
  detectedAt: 123,
  originalModel: "claude-fable-5",
  fallbackModel: "claude-opus-4-8",
  reason: "refusal" as const,
  message: "Fable refused this request. Switched to Opus.",
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ThreadModelFallbackCard", () => {
  it("renders as a compact prompt-stack card and persists dismissal", () => {
    const first = render(
      <ThreadModelFallbackCard fallback={fallback} threadId="thread-1" />,
    );

    expect(screen.getByText("Model fallback")).toBeTruthy();
    expect(screen.getByText("Switched from Fable 5 to Opus 4.8")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss model fallback" }),
    );
    expect(screen.queryByText("Model fallback")).toBeNull();

    first.unmount();
    render(<ThreadModelFallbackCard fallback={fallback} threadId="thread-1" />);
    expect(screen.queryByText("Model fallback")).toBeNull();
  });

  it("shows a later fallback occurrence after an earlier one was dismissed", () => {
    window.localStorage.setItem(
      "bb.thread.model-fallback-dismissed.thread-1",
      "42",
    );

    render(
      <ThreadModelFallbackCard
        fallback={{ ...fallback, sourceSeq: 43 }}
        threadId="thread-1"
      />,
    );
    expect(screen.getByText("Model fallback")).toBeTruthy();
  });

  it("#499 renders the unavailable notice and applies the suggestion only on click", () => {
    const onUseSuggestion = vi.fn();
    render(
      <ThreadModelFallbackCard
        threadId="thread-1"
        unavailableModel={{ value: "glm-5.3-flash", label: "GLM-5.3 Flash" }}
        suggestion={{ value: "glm-5.3", label: "GLM-5.3" }}
        onUseSuggestion={onUseSuggestion}
      />,
    );

    expect(screen.getByText("Model unavailable")).toBeTruthy();
    expect(
      screen.getByText("GLM-5.3 Flash is no longer available."),
    ).toBeTruthy();
    // Nothing switches on render — the rewrite is the user's explicit click.
    expect(onUseSuggestion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use GLM-5.3" }));
    expect(onUseSuggestion).toHaveBeenCalledWith("glm-5.3");
  });

  it("#499 dismisses the unavailable notice per last-use model", () => {
    const first = render(
      <ThreadModelFallbackCard
        threadId="thread-1"
        unavailableModel={{ value: "glm-5.3-flash", label: "GLM-5.3 Flash" }}
        suggestion={null}
        onUseSuggestion={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss model fallback" }),
    );
    expect(screen.queryByText("Model unavailable")).toBeNull();
    first.unmount();

    // The same dead model stays dismissed across mounts…
    render(
      <ThreadModelFallbackCard
        threadId="thread-1"
        unavailableModel={{ value: "glm-5.3-flash", label: "GLM-5.3 Flash" }}
        suggestion={null}
        onUseSuggestion={() => undefined}
      />,
    );
    expect(screen.queryByText("Model unavailable")).toBeNull();

    // …while a different dead model is a new occurrence.
    cleanup();
    render(
      <ThreadModelFallbackCard
        threadId="thread-1"
        unavailableModel={{ value: "glm-4", label: "GLM-4" }}
        suggestion={null}
        onUseSuggestion={() => undefined}
      />,
    );
    expect(screen.getByText("Model unavailable")).toBeTruthy();
  });

  it("#499 renders the zeroth-cell notice when nothing is selected", () => {
    render(
      <ThreadModelFallbackCard
        threadId="thread-1"
        unavailableModel={null}
        suggestion={{ value: "glm-5.3", label: "GLM-5.3" }}
        onUseSuggestion={() => undefined}
      />,
    );

    expect(screen.getByText("No model selected")).toBeTruthy();
    expect(
      screen.getByText("This thread has no model selected."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use GLM-5.3" })).toBeTruthy();
  });
});
