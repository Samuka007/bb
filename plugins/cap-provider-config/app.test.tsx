// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ConfiguredProviderSettingsSection } from "./src/ConfiguredProviderSettingsSection";
import { resetPluginQueryClientForTest } from "./src/plugin-query-client";
import { modelDraftToWire } from "./src/queries/provider-config-queries";

/**
 * #362 the user-face provider panel, delivered as a plugin section (#382):
 * CRUD onto /api/v1/system/providers with the write-only key protocol
 * (edit omits the key unless re-typed; an explicit clear sends null), the
 * /models discovery merge with skip-with-warning notices, the
 * test-connection verdict display, and the per-row thinkingBudgetTokens
 * seat (-1 = budget-off, blank = deployment default).
 *
 * The host fetch carries no app-surface plumbing here — the plugin's
 * queries own it; tests drive `fetch` via vi.stubGlobal.
 */

const app = await loadPluginApp(() => import("./app"));

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

// sonner renders toasts into a portal no test container mounts — assert the
// calls instead (the plugin's only sonner import is the toast object).
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
  const configured = app.settingsSections.find(
    (section: { id: string }) => section.id === "configured",
  );
  if (configured === undefined) {
    throw new Error("the plugin app must register the configured settingsSection");
  }
  // The component supplies its own QueryClientProvider (the plugin bundles
  // its own react-query copy — the host's provider is not inheritable).
  renderSlot(configured, {});
}

describe("ConfiguredProviderSettingsSection", () => {
  it("registers the settingsSection slots in canonical order", () => {
    expect(app.settingsSections.map((section: { id: string }) => section.id)).toEqual([
      "configured",
      "imageSource",
      "server",
    ]);
  });

  it("an empty user-row list shows the Server-section pointer (#434: user rows only)", async () => {
    routeMock(({ path }) => {
      if (path === "/api/v1/system/providers") {
        return { status: 200, body: { providers: [] } };
      }
      return undefined;
    });
    renderSection();
    // #434 point 6: the CRUD face lists ONLY user rows — the deployment's
    // declared catalog is never a fake row here; the empty state points at
    // the read-only Server section instead.
    const emptyState = await screen.findByText(/No user-configured providers yet/);
    expect(emptyState.textContent).toContain("Server section");
  });

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

  it("renders deployment-seed rows read-only beside editable user rows (#388)", async () => {
    routeMock(({ path }) => {
      if (path === "/api/v1/system/providers") {
        return {
          status: 200,
          body: {
            providers: [
              rowFixture({
                id: "omp",
                displayName: "newapi",
                source: "deployment-seed",
                baseUrl: "https://newapi.example.com/v1",
                updatedAt: 0,
              }),
              rowFixture(),
            ],
          },
        };
      }
      return undefined;
    });
    renderSection();

    // The seed row is visible with its provenance badge and read-only note…
    expect(await screen.findByText("deployment-seed")).toBeTruthy();
    expect(screen.getByText(/deployment seed \(read-only\)/)).toBeTruthy();
    // …and offers none of the CRUD affordances (redeploy-managed).
    expect(screen.queryByRole("button", { name: "Test omp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit omp" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove omp" })).toBeNull();
    // The user row keeps every affordance.
    expect(screen.getByRole("button", { name: "Edit panel-one" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove panel-one" })).toBeTruthy();
  });

  it("treats rows without a source seat as user rows (older server tolerance)", async () => {
    routeMock(({ path }) => {
      if (path === "/api/v1/system/providers") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      return undefined;
    });
    renderSection();
    // No source field arrived; the row stays editable rather than vanishing.
    expect(await screen.findByRole("button", { name: "Edit panel-one" })).toBeTruthy();
    expect(screen.queryByText("deployment-seed")).toBeNull();
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
    fireEvent.change(screen.getByLabelText("Model 1 thinking budget"), {
      target: { value: "4096" },
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
        thinkingBudgetTokens: 4096,
      },
    ]);
  });

  it("serializes the budget seats: blank stays absent, -1 sends null", () => {
    const blank = { ...emptyDraft(), id: "m", thinkingBudgetTokens: "" };
    expect("thinkingBudgetTokens" in wireOf(blank)).toBe(false);
    const off = { ...emptyDraft(), thinkingBudgetTokens: "-1", id: "m" };
    expect(wireOf(off).thinkingBudgetTokens).toBeNull();
    const set = { ...emptyDraft(), thinkingBudgetTokens: "4096", id: "m" };
    expect(wireOf(set).thinkingBudgetTokens).toBe(4096);
    expect(() => wireOf({ ...emptyDraft(), thinkingBudgetTokens: "0", id: "m" })).toThrowError(
      /positive integer/,
    );
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
            models: [{ id: "model-a" }, { id: "discovered-b", name: "Discovered B" }],
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
    expect(
      bodyOf(calls.find((call) => call.path === "/api/v1/system/providers/discover-models")),
    ).toEqual({
      providerId: "panel-one",
    });
    // Manual row kept; discovered new row appended; warning surfaced.
    expect(screen.getByLabelText("Model 1 id")).toHaveProperty("value", "model-a");
    expect(screen.getByLabelText("Model 2 id")).toHaveProperty("value", "discovered-b");
    expect(await screen.findByText(/1 new merged/)).toBeTruthy();
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

  it("imports a pasted models.yml fragment and renders per-provider verdicts", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [] } };
      }
      if (path === "/api/v1/system/providers/import-models-yml" && init?.method === "POST") {
        return {
          status: 200,
          body: {
            providers: [
              {
                id: "good-relay",
                verdict: "created",
                status: 201,
                code: "created",
                message: 'provider "good-relay" created with 1 model rows',
                modelCount: 1,
                hasApiKey: true,
                warnings: [],
              },
              {
                id: "doomed",
                verdict: "skipped",
                status: 422,
                code: "unsupported_api",
                message:
                  'provider "doomed": api "azure-openai-responses" has no cloud adaptor yet ' +
                  "— 暂不支持该协议 (supported: anthropic-messages, openai-responses, openai-completions)",
                modelCount: 0,
                hasApiKey: false,
                warnings: [],
              },
            ],
            created: 1,
            skipped: 1,
          },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Import models.yml" }));
    fireEvent.change(screen.getByLabelText("models.yml fragment"), {
      target: {
        value:
          "providers:\n  good-relay:\n    api: openai-responses\n    models:\n      - id: m\n  doomed:\n    api: azure-openai-responses\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.path === "/api/v1/system/providers/import-models-yml" &&
            call.init?.method === "POST",
        ),
      ).toBe(true);
    });
    // The fragment rides ONE POST body, verbatim.
    const posted = bodyOf(
      calls.find((call) => call.path === "/api/v1/system/providers/import-models-yml"),
    );
    expect(typeof posted.yaml).toBe("string");
    expect(posted.yaml).toContain("good-relay");
    // The verdict transcript is the honest per-provider report.
    expect(await screen.findByLabelText("Import verdicts")).toBeTruthy();
    expect(screen.getByText("Created 1 · skipped 1")).toBeTruthy();
    expect(screen.getByText("created (1 models)")).toBeTruthy();
    expect(screen.getByText("skipped 422")).toBeTruthy();
    expect(screen.getByText(/no cloud adaptor yet/)).toBeTruthy();
  });

  it("surfaces a hard import failure (invalid YAML) through the toast path", async () => {
    routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [] } };
      }
      if (path === "/api/v1/system/providers/import-models-yml" && init?.method === "POST") {
        return {
          status: 422,
          body: { code: "import_yaml_invalid", message: "the pasted text is not valid YAML" },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Import models.yml" }));
    fireEvent.change(screen.getByLabelText("models.yml fragment"), {
      target: { value: "providers: [unclosed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("The models.yml import failed", {
        description: "the pasted text is not valid YAML",
      });
    });
    // The failure leaves no verdict transcript behind.
    expect(screen.queryByLabelText("Import verdicts")).toBeNull();
  });
});

// --- draft/wire round-trip helpers for the budget seats ----------------------

function emptyDraft() {
  return {
    id: "",
    name: "",
    description: "",
    api: "",
    reasoning: false,
    inputText: true,
    inputImage: false,
    contextWindow: "",
    maxTokens: "",
    reasoningLevels: [],
    defaultReasoningLevel: "",
    thinkingBudgetTokens: "",
    costInput: "",
    costOutput: "",
    costCacheRead: "",
    costCacheWrite: "",
  };
}

function wireOf(draft: ReturnType<typeof emptyDraft>) {
  return modelDraftToWire(draft);
}
