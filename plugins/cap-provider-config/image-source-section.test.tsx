// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { resetPluginQueryClientForTest } from "./src/plugin-query-client";

/**
 * #448 the Image Source section: the radio lists the dispatchable
 * api=openai-images candidates, the seat write rides PUT
 * /system/image-source, the empty state points at the Configured section,
 * and a failed write reports the server verdict instead of moving the
 * selection. The tests mount the REGISTERED slot — the exact shape
 * production mounts (#387 precedent).
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
  return { providerId: null, candidates: [], ...overrides };
}

function rowFixture(id: string, displayName: string): Record<string, unknown> {
  return {
    id,
    displayName,
    baseUrl: "https://images.example.com/v1",
    api: "openai-images",
    serviceTier: false,
    models: [{ id: "image-model" }],
    hasApiKey: true,
    status: "ok",
    warnings: [],
    dispatchable: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

function renderSection(): void {
  const section = app.settingsSections.find((entry: { id: string }) => entry.id === "imageSource");
  if (section === undefined) {
    throw new Error("the plugin app must register the imageSource settingsSection");
  }
  renderSlot(section, {});
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;
}

describe("ImageSourceSettingsSection", () => {
  it("registers an imageSource settingsSection slot on the plugin app", () => {
    expect(
      app.settingsSections.some((section: { id: string }) => section.id === "imageSource"),
    ).toBe(true);
  });

  it("shows the not-configured empty state with the Configured-section pointer", async () => {
    routeMock(() => ({ status: 200, body: seatFixture() }));
    renderSection();
    expect(await screen.findByText("Not configured")).toBeTruthy();
    expect(screen.getByText(/Configured section/)).toBeTruthy();
  });

  it("lists candidates as a radio, switches the seat, and toasts the hot-apply", async () => {
    let seat = seatFixture({ candidates: ["imagey", "imagey-2"] });
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/providers")) {
        return {
          status: 200,
          body: {
            providers: [rowFixture("imagey", "Imagey"), rowFixture("imagey-2", "Imagey Two")],
          },
        };
      }
      if (call.path.endsWith("/system/image-source") && call.init?.method === "PUT") {
        seat = { ...seat, providerId: bodyOf(call).providerId };
        return { status: 200, body: seat };
      }
      return { status: 200, body: seat };
    });
    renderSection();
    expect(await screen.findByText("Imagey (imagey)")).toBeTruthy();
    expect(screen.getByText("Imagey Two (imagey-2)")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Imagey (imagey)"));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const put = calls.find(
      (call) => call.path.endsWith("/system/image-source") && call.init?.method === "PUT",
    );
    expect(put).toBeDefined();
    expect(bodyOf(put)).toEqual({ providerId: "imagey" });
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining("imagey"),
      expect.objectContaining({ description: "Hot-applied — no redeploy." }),
    );
  });

  it("offers the None option that clears the seat (the only not-configured state)", async () => {
    let seat = seatFixture({ providerId: "imagey", candidates: ["imagey"] });
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/providers")) {
        return { status: 200, body: { providers: [rowFixture("imagey", "Imagey")] } };
      }
      if (call.path.endsWith("/system/image-source") && call.init?.method === "PUT") {
        seat = { ...seat, providerId: bodyOf(call).providerId };
        return { status: 200, body: seat };
      }
      return { status: 200, body: seat };
    });
    renderSection();
    expect(await screen.findByText("imagey")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("None — generate_image unavailable"));
    await waitFor(() => {
      const put = calls.find(
        (call) => call.path.endsWith("/system/image-source") && call.init?.method === "PUT",
      );
      expect(bodyOf(put)).toEqual({ providerId: null });
    });
  });

  it("surfaces the server's named refusal instead of moving the selection", async () => {
    const seat = seatFixture({ providerId: "imagey", candidates: ["imagey", "texty"] });
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/providers")) {
        return {
          status: 200,
          body: { providers: [rowFixture("imagey", "Imagey"), rowFixture("texty", "Texty")] },
        };
      }
      if (call.path.endsWith("/system/image-source") && call.init?.method === "PUT") {
        return {
          status: 422,
          body: { code: "not_an_image_source", message: 'provider "texty" declares api "anthropic-messages"' },
        };
      }
      return { status: 200, body: seat };
    });
    renderSection();
    expect(await screen.findByText("Texty (texty)")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Texty (texty)"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Setting the image source failed",
        expect.objectContaining({ description: expect.stringContaining("anthropic-messages") }),
      );
    });
    // No successful PUT verdict: the radio selection never moved.
    const puts = calls.filter(
      (call) => call.path.endsWith("/system/image-source") && call.init?.method === "PUT",
    );
    expect(puts).toHaveLength(1);
  });
});
