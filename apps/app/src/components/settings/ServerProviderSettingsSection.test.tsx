// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { providerProjectionsResponseSchema } from "@/hooks/queries/provider-projection-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ServerProviderSettingsSection } from "./ServerProviderSettingsSection";

const mocks = vi.hoisted(() => ({
  fetchWithAppSurface: vi.fn(),
}));

vi.mock("@/lib/app-surface", () => ({
  fetchWithAppSurface: mocks.fetchWithAppSurface,
}));

afterEach(() => {
  cleanup();
  mocks.fetchWithAppSurface.mockReset();
});

type ProjectionFixture = z.input<typeof providerProjectionsResponseSchema>;

function projectionResponse(): ProjectionFixture {
  return {
    harness: {
      relayMode: "anthropic",
      relayBaseUrl: "https://newapi.example.com",
      relayBaseUrlHost: "newapi.example.com",
      relayKeyPresent: true,
      relayModel: "glm-5.3-anth",
      relayMaxTokens: 8192,
      relayThinking: "disabled",
      machineId: "local",
      executionModel: "glm-5.3-anth",
      executionServiceTier: "default",
      executionReasoningLevel: "none",
      permissionMode: "full",
    },
    webSearch: {
      configured: false,
      decodeError: false,
      chain: [
        { engine: "brave", credentialsRequired: true, credentialsPresent: false },
        { engine: "public", credentialsRequired: false, credentialsPresent: true },
      ],
      timeoutSeconds: 60,
      browserBackedEngines: ["google", "ecosia", "mojeek"],
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe("ServerProviderSettingsSection", () => {
  it("renders the read-only projection with credential gates", async () => {
    mocks.fetchWithAppSurface.mockResolvedValue(jsonResponse(projectionResponse()));
    const { wrapper } = createQueryClientTestHarness();
    render(<ServerProviderSettingsSection />, { wrapper });

    // Relay facts.
    await waitFor(() => {
      expect(screen.getByText("anthropic")).toBeTruthy();
    });
    expect(screen.getByText("newapi.example.com")).toBeTruthy();
    expect(screen.getByText("glm-5.3-anth")).toBeTruthy();
    // Credential gates: presence badges, never values.
    const badges = screen.getAllByText("Not configured");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Configured").length).toBeGreaterThanOrEqual(1);
    // Chain order and the browser-backed exclusion note.
    expect(screen.getByText("Public Web")).toBeTruthy();
    expect(
      screen.getByText(
        "google, ecosia, mojeek — browser-backed, excluded from the server-side provider set",
      ),
    ).toBeTruthy();
    // The "edit goes through deployment env" pointer.
    expect(screen.getByText(/deployment env/)).toBeTruthy();
    // Read-only face: no switch/combobox/textbox anywhere.
    expect(document.querySelector("[role='switch']")).toBeNull();
  });

  it("reports a decode-broken env without a chain", async () => {
    const response = projectionResponse();
    response.webSearch.decodeError = true;
    response.webSearch.chain = [];
    response.webSearch.timeoutSeconds = null;
    mocks.fetchWithAppSurface.mockResolvedValue(jsonResponse(response));
    const { wrapper } = createQueryClientTestHarness();
    render(<ServerProviderSettingsSection />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText(/failed to decode/)).toBeTruthy();
    });
    expect(screen.queryByText("Public Web")).toBeNull();
  });

  it("shows the mock-mode hint when the relay key is absent", async () => {
    const response = projectionResponse();
    response.harness.relayMode = "mock";
    response.harness.relayKeyPresent = false;
    mocks.fetchWithAppSurface.mockResolvedValue(jsonResponse(response));
    const { wrapper } = createQueryClientTestHarness();
    render(<ServerProviderSettingsSection />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("mock")).toBeTruthy();
    });
    expect(screen.getByText(/mock mode/)).toBeTruthy();
  });
});
