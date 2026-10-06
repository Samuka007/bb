// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ConfiguredProviderSettingsSection } from "./ConfiguredProviderSettingsSection";

/**
 * #362 the user-face provider panel: CRUD onto /api/v1/system/providers with
 * the write-only key protocol (edit omits the key unless re-typed; an
 * explicit clear sends null), the /models discovery merge with
 * skip-with-warning notices, and the test-connection verdict display.
 */

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
  mocks.fetchWithAppSurface.mockImplementation((path: string, init?: RequestInit) => {
    calls.push({ path, init });
    const route = routes({ path, init });
    if (route === undefined) {
      throw new Error(`unexpected fetch: ${String(init?.method ?? "GET")} ${path}`);
    }
    return Promise.resolve(jsonResponse(route.body, route.status));
  });
  return calls;
}

function rowFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "panel-one",
    displayName: "Panel One",
    baseUrl: "https://up.example.com/v1",
    api: "openai-responses",
    serviceTier: false,
    models: [{ id: "model-a", name: "Model A", input: ["text"] }],
    hasApiKey: true,
    status: "ok",
    warnings: [],
    dispatchable: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;
}

function renderSection(): void {
  const { wrapper } = createQueryClientTestHarness();
  render(
    <ConfiguredProviderSettingsSection />,
    { wrapper },
  );
}

describe("ConfiguredProviderSettingsSection", () => {
  it("lists configured rows with key presence and warning transcripts", async () => {
    routeMock(({ path }) => {
      if (path === "/api/v1/system/providers") {
        return {
          status: 200,
          body: {
            providers: [
              rowFixture(),
              rowFixture({
                id: "broken-row",
                displayName: "Broken",
                status: "warning",
                hasApiKey: false,
                models: ['{"id": "half'],
                warnings: [
                  'provider config "broken-row": models is not valid JSON — skipped (row kept, never silently deleted)',
                ],
              }),
            ],
          },
        };
      }
      return undefined;
    });
    renderSection();

    expect(await screen.findByText("Panel One")).toBeTruthy();
    expect(screen.getByText("Key configured")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText(/models is not valid JSON/)).toBeTruthy();
    expect(screen.getByText("No key (mock)")).toBeTruthy();
  });

  it("creates a provider with the full model directory in one POST", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [] } };
      }
      if (path === "/api/v1/system/providers" && init?.method === "POST") {
        return { status: 201, body: rowFixture({ id: "my-provider" }) };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));

    fireEvent.change(screen.getByLabelText("Provider id"), {
      target: { value: "my-provider" },
    });
    fireEvent.change(screen.getByLabelText("Provider display name"), {
      target: { value: "My Provider" },
    });
    fireEvent.change(screen.getByLabelText("Provider base URL"), {
      target: { value: "https://up.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("Provider api family"), {
      target: { value: "anthropic" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-create-362" },
    });
    const model = screen.getByLabelText("Model 1");
    expect(model).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Model 1 id"), { target: { value: "glm-x" } });
    fireEvent.change(screen.getByLabelText("Model 1 display name"), {
      target: { value: "GLM X" },
    });
    fireEvent.change(screen.getByLabelText("Model 1 context window"), {
      target: { value: "200000" },
    });
    fireEvent.change(screen.getByLabelText("Model 1 max tokens"), {
      target: { value: "8192" },
    });
    fireEvent.click(screen.getByLabelText("Model 1 image input"));
    fireEvent.click(screen.getByLabelText("Model 1 ladder high"));
    fireEvent.change(screen.getByLabelText("Model 1 default reasoning level"), {
      target: { value: "high" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create provider" }));
    await waitFor(() => {
      expect(calls.some((call) => call.init?.method === "POST")).toBe(true);
    });
    const posted = bodyOf(calls.find((call) => call.init?.method === "POST"));
    expect(posted.id).toBe("my-provider");
    expect(posted.displayName).toBe("My Provider");
    expect(posted.baseUrl).toBe("https://up.example.com/v1");
    expect(posted.api).toBe("anthropic");
    expect(posted.apiKey).toBe("sk-create-362");
    expect(posted.models).toEqual([
      {
        id: "glm-x",
        name: "GLM X",
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 8192,
        reasoningLevels: ["high"],
        defaultReasoningLevel: "high",
      },
    ]);
  });

  it("edits with the omission-preserving key protocol (omit, set, clear)", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      if (path === "/api/v1/system/providers/panel-one" && init?.method === "PUT") {
        return { status: 200, body: rowFixture({ displayName: "Renamed" }) };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));

    // Omission: saving without touching the key sends NO apiKey seat.
    fireEvent.change(screen.getByLabelText("Provider display name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.some((call) => call.init?.method === "PUT")).toBe(true);
    });
    const first = bodyOf(calls.find((call) => call.init?.method === "PUT"));
    expect(first.displayName).toBe("Renamed");
    expect("apiKey" in first).toBe(false);
    // The stored models ride along unchanged.
    expect(first.models).toEqual([{ id: "model-a", name: "Model A", input: ["text"] }]);

    // Re-typing a key sets it; the explicit clear checkbox sends null.
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-rotate-362" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.init?.method === "PUT")).toHaveLength(2);
    });
    expect(bodyOf(calls.filter((call) => call.init?.method === "PUT")[1]).apiKey).toBe(
      "sk-rotate-362",
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));
    fireEvent.click(screen.getByLabelText("Clear stored API key"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.init?.method === "PUT")).toHaveLength(3);
    });
    expect(bodyOf(calls.filter((call) => call.init?.method === "PUT")[2]).apiKey).toBeNull();
  });

  it("merges discovered models with skip-with-warning notices, manual rows kept", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      if (path === "/api/v1/system/providers/discover-models" && init?.method === "POST") {
        return {
          status: 200,
          body: {
            ok: true,
            status: 200,
            latencyMs: 42,
            error: null,
            models: [
              { id: "model-a" },
              { id: "discovered-b", name: "Discovered B" },
            ],
            warnings: [
              "discovered entry without a usable string id — skipped, never silently dropped",
            ],
          },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));
    fireEvent.click(screen.getByRole("button", { name: "Discover models" }));

    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/v1/system/providers/discover-models" &&
            call.init?.method === "POST",
        ),
      ).toBe(true);
    });
    // Saved-row discovery: providerId anchor, no key material in the body.
    expect(bodyOf(calls.find((call) => call.path === "/api/v1/system/providers/discover-models"))).toEqual({
      providerId: "panel-one",
    });
    // Manual row kept; discovered new row appended; warning surfaced.
    expect(screen.getByLabelText("Model 1 id")).toHaveProperty("value", "model-a");
    expect(screen.getByLabelText("Model 2 id")).toHaveProperty("value", "discovered-b");
    expect(
      await screen.findByText(/1 new merged/),
    ).toBeTruthy();
    expect(screen.getByText(/skipped, never silently dropped/)).toBeTruthy();
  });

  it("shows the test-connection verdict inline", async () => {
    routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      if (path === "/api/v1/system/providers/panel-one/test" && init?.method === "POST") {
        return { status: 200, body: { ok: true, status: 200, latencyMs: 123, error: null } };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Test panel-one" }));
    expect(await screen.findByText("Reachable (123 ms)")).toBeTruthy();
  });

  it("removes a provider through the confirm dialog", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      if (path === "/api/v1/system/providers/panel-one" && init?.method === "DELETE") {
        return { status: 200, body: { ok: true } };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Remove panel-one" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((call) => call.init?.method === "DELETE")).toBe(true);
    });
  });
});
