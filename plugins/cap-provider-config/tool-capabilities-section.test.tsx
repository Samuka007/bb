// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { resetPluginQueryClientForTest } from "./src/plugin-query-client";

/**
 * #502 the Tool Capabilities section: the three #150 gates render as live
 * switches over the D1 `tool_capabilities` seat; every flip writes the WHOLE
 * seat via PUT /system/tool-capabilities (no tri-state merge), the absent
 * row is the all-off omp posture, and a failed write reports the server
 * verdict instead of moving the switch. The tests mount the REGISTERED slot
 * — the exact shape production mounts (#387 precedent).
 */

const app = await loadPluginApp(() => import("./app"));

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
  vi.unstubAllGlobals();
  resetPluginQueryClientForTest();
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

interface Call {
  path: string;
  init?: RequestInit;
}

function routeMock(routes: (call: Call) => { status: number; body: unknown } | undefined): Call[] {
  const calls: Call[] = [];
  mocks.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const call = { path, init };
    calls.push(call);
    const route = routes(call);
    if (route === undefined) {
      throw new Error(`unexpected fetch: ${String(init?.method ?? "GET")} ${path}`);
    }
    return Promise.resolve(jsonResponse(route.body, route.status));
  });
  vi.stubGlobal("fetch", mocks.fetch);
  return calls;
}

function seatFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configured: false,
    externalThinking: false,
    contextNotes: false,
    checkpoint: false,
    ...overrides,
  };
}

function renderSection(): void {
  const section = app.settingsSections.find(
    (entry: { id: string }) => entry.id === "toolCapabilities",
  );
  if (section === undefined) {
    throw new Error("the plugin app must register the toolCapabilities settingsSection");
  }
  renderSlot(section, {});
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;
}

function switchState(name: string): string | null {
  return screen.getByLabelText(name).getAttribute("aria-checked");
}

describe("ToolCapabilitiesSettingsSection", () => {
  it("registers a toolCapabilities settingsSection slot on the plugin app", () => {
    expect(
      app.settingsSections.some((section: { id: string }) => section.id === "toolCapabilities"),
    ).toBe(true);
  });

  it("an absent row renders the all-off omp posture with the no-row badge", async () => {
    routeMock(() => ({ status: 200, body: seatFixture() }));
    renderSection();
    expect(await screen.findByText("No row — all off (omp defaults)")).toBeTruthy();
    expect(switchState("Enable think")).toBe("false");
    expect(switchState("Enable context_notes + new_context")).toBe("false");
    expect(switchState("Enable checkpoint + rewind")).toBe("false");
  });

  it("renders the stored gates and flips the whole seat on a toggle", async () => {
    let seat = seatFixture({
      configured: true,
      externalThinking: true,
      contextNotes: false,
      checkpoint: true,
    });
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/tool-capabilities") && call.init?.method === "PUT") {
        const body = bodyOf(call);
        seat = { ...seat, ...body };
        return { status: 200, body: seat };
      }
      return { status: 200, body: seat };
    });
    renderSection();
    expect(await screen.findByText("Stored in D1")).toBeTruthy();
    expect(switchState("Enable think")).toBe("true");
    expect(switchState("Enable checkpoint + rewind")).toBe("true");

    // Enable context notes: the PUT carries ALL three gates (the whole-seat
    // replace), not just the flipped one.
    fireEvent.click(screen.getByLabelText("Enable context_notes + new_context"));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const put = calls.find(
      (call) => call.path.endsWith("/system/tool-capabilities") && call.init?.method === "PUT",
    );
    expect(put).toBeDefined();
    expect(bodyOf(put)).toEqual({
      externalThinking: true,
      contextNotes: true,
      checkpoint: true,
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Context notes enabled.",
      expect.objectContaining({
        description: "Hot-applied on the next turn — no redeploy.",
      }),
    );
    expect(switchState("Enable context_notes + new_context")).toBe("true");
  });

  it("disabling one gate keeps the other stored gates (whole-seat replace, not clear-all)", async () => {
    let seat = seatFixture({
      configured: true,
      externalThinking: true,
      contextNotes: true,
      checkpoint: false,
    });
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/tool-capabilities") && call.init?.method === "PUT") {
        seat = { ...seat, ...bodyOf(call) };
        return { status: 200, body: seat };
      }
      return { status: 200, body: seat };
    });
    renderSection();
    expect(await screen.findByText("Stored in D1")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Enable think"));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const put = calls.find(
      (call) => call.path.endsWith("/system/tool-capabilities") && call.init?.method === "PUT",
    );
    expect(bodyOf(put)).toEqual({
      externalThinking: false,
      contextNotes: true,
      checkpoint: false,
    });
  });

  it("surfaces the server's refusal instead of moving the switch", async () => {
    const seat = seatFixture({ configured: true });
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/tool-capabilities") && call.init?.method === "PUT") {
        return {
          status: 422,
          body: { code: "validation_failed", message: "expected a strict gate triple" },
        };
      }
      return { status: 200, body: seat };
    });
    renderSection();
    expect(await screen.findByText("Stored in D1")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Enable think"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Updating the tool gates failed",
        expect.objectContaining({
          description: expect.stringContaining("strict gate triple"),
        }),
      );
    });
    // The stored truth is re-read; the switch never moved.
    await waitFor(() => {
      expect(screen.getByText("expected a strict gate triple")).toBeTruthy();
    });
    expect(switchState("Enable think")).toBe("false");
    const puts = calls.filter(
      (call) => call.path.endsWith("/system/tool-capabilities") && call.init?.method === "PUT",
    );
    expect(puts).toHaveLength(1);
  });
});
