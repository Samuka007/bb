// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadResponse } from "@bb/server-contract";
import type { PaneContent } from "@/lib/split-layout";
import { sdk } from "@/lib/sdk";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import SplitWorkspaceRoute from "./SplitWorkspaceRoute";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { get: vi.fn() } },
}));

vi.mock("./thread-detail/SplitThreadArea", () => ({
  SplitThreadArea: ({ routeContent }: { routeContent: PaneContent }) => (
    <output data-testid="route-content">{JSON.stringify(routeContent)}</output>
  ),
}));

vi.mock("./RootComposeView", () => ({
  LegacyProjectComposeRedirect: () => <div>legacy redirect</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function threadRow(id: string, projectId: string): ThreadResponse {
  return {
    id,
    projectId,
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    activeBackgroundAgentCount: 0,
    canSpawnChild: true,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

function renderRoute(entry: string, seededThreads: readonly ThreadResponse[]) {
  const { queryClient, wrapper: Wrapper } = createQueryClientTestHarness();
  for (const thread of seededThreads) {
    queryClient.setQueryData(threadQueryKey(thread.id), thread);
  }
  render(
    <Wrapper>
      <MemoryRouter initialEntries={[entry]}>
        <LocationProbe />
        <Routes>
          <Route path="*" element={<SplitWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>
    </Wrapper>,
  );
  return queryClient;
}

function currentLocation(): string {
  return screen.getByTestId("location").textContent ?? "";
}

function currentRouteContent(): PaneContent {
  return JSON.parse(
    screen.getByTestId("route-content").textContent ?? "null",
  ) as PaneContent;
}

describe("SplitWorkspaceRoute projectless thread URL", () => {
  it("redirects a standard-project thread to its canonical project-scoped URL", async () => {
    renderRoute("/threads/thr_std?message=12#event-1", [
      threadRow("thr_std", "proj_std"),
    ]);

    await waitFor(() =>
      expect(currentLocation()).toBe(
        "/projects/proj_std/threads/thr_std?message=12#event-1",
      ),
    );
    expect(currentRouteContent()).toEqual({
      kind: "thread",
      projectId: "proj_std",
      threadId: "thr_std",
    });
    // The canonicalization reads the thread cache only; the page's own
    // bootstrap owns the fetch (#479 request economy).
    expect(sdk.threads.get).not.toHaveBeenCalled();
  });

  it("redirects when the thread row lands after mount", async () => {
    const queryClient = renderRoute("/threads/thr_std", []);
    // Before the row is known the URL form is left alone — the page's own
    // loading surface owns this frame.
    expect(currentLocation()).toBe("/threads/thr_std");
    expect(currentRouteContent()).toEqual({
      kind: "thread",
      projectId: "proj_personal",
      threadId: "thr_std",
    });

    act(() => {
      queryClient.setQueryData(
        threadQueryKey("thr_std"),
        threadRow("thr_std", "proj_std"),
      );
    });

    await waitFor(() =>
      expect(currentLocation()).toBe("/projects/proj_std/threads/thr_std"),
    );
  });

  it("keeps the projectless URL for a personal-project thread", () => {
    renderRoute("/threads/thr_personal", [
      threadRow("thr_personal", "proj_personal"),
    ]);

    expect(currentLocation()).toBe("/threads/thr_personal");
    expect(currentRouteContent()).toEqual({
      kind: "thread",
      projectId: "proj_personal",
      threadId: "thr_personal",
    });
  });

  it("leaves a canonical project-scoped URL untouched", () => {
    renderRoute("/projects/proj_std/threads/thr_std", [
      threadRow("thr_std", "proj_std"),
    ]);

    expect(currentLocation()).toBe("/projects/proj_std/threads/thr_std");
    expect(currentRouteContent()).toEqual({
      kind: "thread",
      projectId: "proj_std",
      threadId: "thr_std",
    });
  });
});
