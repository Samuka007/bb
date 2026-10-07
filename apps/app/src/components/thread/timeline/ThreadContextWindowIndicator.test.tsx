// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { ThreadContextWindowIndicator } from "./ThreadContextWindowIndicator";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const USAGE: ThreadContextWindowUsage = {
  usedTokens: 75_000,
  modelContextWindow: 200_000,
  estimated: false,
};

describe("ThreadContextWindowIndicator", () => {
  it("renders without a Compact action when compactAction is absent", () => {
    render(<ThreadContextWindowIndicator usage={USAGE} defaultOpen />);

    expect(screen.queryByRole("button", { name: "Compact context" })).toBeNull();
  });

  it("renders the Compact action inside the usage popover when provided", () => {
    render(
      <ThreadContextWindowIndicator
        usage={USAGE}
        defaultOpen
        compactAction={{ onCompact: vi.fn(), pending: false }}
      />,
    );

    expect(screen.getByRole("button", { name: "Compact context" })).toBeTruthy();
  });

  it("invokes onCompact once when the Compact action is clicked", () => {
    const onCompact = vi.fn();
    render(
      <ThreadContextWindowIndicator
        usage={USAGE}
        defaultOpen
        compactAction={{ onCompact, pending: false }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compact context" }));

    expect(onCompact).toHaveBeenCalledTimes(1);
  });

  it("disables the Compact action and shows Compacting… while pending", () => {
    const onCompact = vi.fn();
    render(
      <ThreadContextWindowIndicator
        usage={USAGE}
        defaultOpen
        compactAction={{ onCompact, pending: true }}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Compact context",
    }) as HTMLButtonElement;
    expect(button.textContent).toBe("Compacting…");
    expect(button.disabled).toBe(true);

    fireEvent.click(button);
    expect(onCompact).not.toHaveBeenCalled();
  });
});
