// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PendingInteraction,
  ProviderPendingInteraction,
} from "@bb/domain";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    mutateAsync: vi.fn().mockResolvedValue(null),
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useStopThread: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));
vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMarkThreadRead: () => ({ mutate: vi.fn() }),
}));
// Route context: the shell only renders the source-thread NavLink when
// sourceThread is set, and none of these fixtures set it.
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    NavLink: () => null,
  };
});

function approvalInteraction(
  overrides: Partial<ProviderPendingInteraction> = {},
): PendingInteraction {
  return {
    id: "pi_test",
    threadId: "thr_test",
    turnId: "turn_test",
    providerId: "codex",
    providerThreadId: "provider-thread-test",
    providerRequestId: "request-test",
    status: "pending",
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item_cmd",
        command: "git push origin main",
        cwd: "/repo",
        actions: [],
        sessionGrant: null,
      },
      reason: "Run a command that updates the remote",
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
    },
    ...overrides,
  };
}

function userQuestionInteraction(): ProviderPendingInteraction {
  return {
    id: "pi_question_test",
    threadId: "thr_test",
    turnId: "turn_test",
    providerId: "codex",
    providerThreadId: "provider-thread-test",
    providerRequestId: "request-test",
    status: "pending",
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Continue?",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadPendingInteractionBanner stop affordance", () => {
  it("keeps the approval card free of a stop entry when no stop handler is given", () => {
    render(
      <ThreadPendingInteractionBanner
        interaction={approvalInteraction()}
        threadId="thr_test"
      />,
    );

    expect(screen.queryByRole("button", { name: "Stop run" })).toBeNull();
  });

  it("shows a stop entry on the approval card and wires it to the given handler", () => {
    const onStop = vi.fn();
    render(
      <ThreadPendingInteractionBanner
        interaction={approvalInteraction()}
        threadId="thr_test"
        onStop={onStop}
      />,
    );

    const stop = screen.getByRole("button", { name: "Stop run" });
    // The decisions and the stop escape hatch share the footer, so both stay
    // visible; the stop entry must not shadow them.
    expect(screen.getByRole("button", { name: /Allow once/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Deny/i })).not.toBeNull();

    fireEvent.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("disables the stop entry while a stop request is in flight and labels the progress", () => {
    render(
      <ThreadPendingInteractionBanner
        interaction={approvalInteraction()}
        threadId="thr_test"
        onStop={vi.fn()}
        isStopRequested
      />,
    );

    const stop = screen.getByRole("button", { name: "Stopping run..." });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables the stop entry while a resolution is in flight", () => {
    render(
      <ThreadPendingInteractionBanner
        interaction={approvalInteraction({ status: "resolving" })}
        threadId="thr_test"
        onStop={vi.fn()}
        isStopDisabled
      />,
    );

    const stop = screen.getByRole("button", { name: "Stop run" });
    expect((stop as HTMLButtonElement).disabled).toBe(true);
  });

  it("carries exactly one stop entry for a question by relabeling the form's stop control while a request is in flight", () => {
    render(
      <ThreadPendingInteractionBanner
        interaction={userQuestionInteraction()}
        threadId="thr_test"
        onStop={vi.fn()}
        isStopRequested
      />,
    );

    // Exactly one cancel control: the form's own action row, not a second
    // shell-level entry.
    const stops = screen.getAllByRole("button", { name: "Stopping run..." });
    expect(stops).toHaveLength(1);
    expect((stops[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Stop run" })).toBeNull();
  });

  it("keeps the question form's stop entry enabled for a live stop handler", () => {
    const onStop = vi.fn();
    render(
      <ThreadPendingInteractionBanner
        interaction={userQuestionInteraction()}
        threadId="thr_test"
        onStop={onStop}
      />,
    );

    const stop = screen.getByRole("button", { name: "Stop run" });
    fireEvent.click(stop);
    expect(onStop).not.toHaveBeenCalled();
  });
});