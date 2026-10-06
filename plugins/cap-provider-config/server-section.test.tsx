// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { providerProjectionsResponseSchema } from "./src/queries/provider-projection-queries";
import { ServerProviderSettingsSection } from "./src/ServerProviderSettingsSection";

/**
 * #266 the read-only Server projection, migrated into the plugin (#382):
 * renders the deployment-env projection facts (relay harness + web_search
 * chain) with credential-gate badges — presence only, never values — and no
 * write controls anywhere on the face. The plugin bundles its own
 * react-query copy (the SDK runtime-shims react but not react-query), so
 * tests supply a plain QueryClientProvider the way the slot-facing section
 * does.
 */

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  mocks.fetch.mockReset();
  vi.unstubAllGlobals();
});

function renderSection(): void {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServerProviderSettingsSection />
    </QueryClientProvider>,
  );
}

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

function mockOnce(body: ProjectionFixture): void {
  mocks.fetch.mockResolvedValue(jsonResponse(body));
  vi.stubGlobal("fetch", mocks.fetch);
}

describe("ServerProviderSettingsSection", () => {
  it("registers a server settingsSection slot on the plugin app", () => {
    expect(
      app.settingsSections.some((section: { id: string }) => section.id === "server"),
    ).toBe(true);
  });

  it("renders the read-only projection with credential gates", async () => {
    mockOnce(projectionResponse());
    renderSection();

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
    mockOnce(response);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/failed to decode/)).toBeTruthy();
    });
    expect(screen.queryByText("Public Web")).toBeNull();
  });

  it("shows the mock-mode hint when the relay key is absent", async () => {
    const response = projectionResponse();
    response.harness.relayMode = "mock";
    response.harness.relayKeyPresent = false;
    mockOnce(response);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText("mock")).toBeTruthy();
    });
    expect(screen.getByText(/mock mode/)).toBeTruthy();
  });
});