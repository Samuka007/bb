// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { ConfiguredProviderSettingsSection } from "./src/ConfiguredProviderSettingsSection";
import { resetPluginQueryClientForTest } from "./src/plugin-query-client";
import {
  modelApiFamilySchema,
  modelDraftToWire,
  providerApiFamilySchema,
} from "./src/queries/provider-config-queries";

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

// jsdom ships neither the pointer-capture API nor scrollIntoView; Radix's
// Select trigger probes hasPointerCapture on every pointerdown before it
// will open, and its content focuses + scrolls the highlighted item on
// mount. This file installs the no-ops (what a real browser reports for an
// element with no active capture and a no-scroll container).
const elementPrototype = window.Element.prototype as unknown as Record<string, unknown>;
beforeAll(() => {
  elementPrototype.hasPointerCapture ??= () => false;
  elementPrototype.releasePointerCapture ??= () => {};
  elementPrototype.scrollIntoView ??= () => {};
});
afterAll(() => {
  delete elementPrototype.hasPointerCapture;
  delete elementPrototype.releasePointerCapture;
  delete elementPrototype.scrollIntoView;
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

/**
 * Drive a Radix Select in jsdom. The trigger opens on pointerdown (Radix
 * never opens on click); the option then selects through its click path —
 * the item's pointer-type ref never saw a pointerdown, so Radix treats the
 * pointer as touch and handleSelect fires on click. The open popper
 * positions through ResizeObserver, which jsdom lacks.
 */
async function openFamilySelect(ariaLabel: string): Promise<void> {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  fireEvent.pointerDown(screen.getByLabelText(ariaLabel), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  await screen.findByRole("listbox");
}

async function pickFamilySelect(ariaLabel: string, optionLabel: string): Promise<void> {
  await openFamilySelect(ariaLabel);
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

describe("contract api-family vocabulary (#452)", () => {
  it("mirrors the server contract exactly — one source per seat", () => {
    // The model seat: @cap/agent-do relayCatalogModelSchema.api (relayApiValues).
    expect([...modelApiFamilySchema.options]).toEqual([
      "anthropic-messages",
      "openai-responses",
      "openai-completions",
    ]);
    // The provider seat: relayCatalogProviderSchema.api = relay faces + the
    // #362 image-source family.
    expect([...providerApiFamilySchema.options]).toEqual([
      "anthropic-messages",
      "openai-responses",
      "openai-completions",
      "openai-images",
    ]);
  });
});

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
    await pickFamilySelect("Provider api family", "anthropic-messages");
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
    expect(posted.api).toBe("anthropic-messages");
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

  it("offers the provider seat as a dropdown listing all four contract families (#452)", async () => {
    routeMock(({ path }) => {
      if (path === "/api/v1/system/providers") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));

    // The stored contract family rides the trigger caption…
    expect(screen.getByLabelText("Provider api family").textContent).toBe("openai-responses");
    // …and the dropdown is the FULL server vocabulary: the relay chat faces
    // plus the image-source family. "anthropic" — the old datalist's
    // suggestion — is not a contract label and is never offered again.
    await openFamilySelect("Provider api family");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Provider default",
      "anthropic-messages",
      "openai-responses",
      "openai-completions",
      "openai-images",
    ]);
  });

  it("offers the model seat only the relay chat faces (openai-images would 422) (#452)", async () => {
    routeMock(({ path }) => {
      if (path === "/api/v1/system/providers") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));

    // Unset shows the inherit caption; the model seat never offers the
    // image-source family — the server rejects it on model rows, so the old
    // shared free-text list would have recreated the 422.
    expect(screen.getByLabelText("Model 1 api family").textContent).toBe("Inherit provider family");
    await openFamilySelect("Model 1 api family");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Inherit provider family",
      "anthropic-messages",
      "openai-responses",
      "openai-completions",
    ]);
  });

  it("keeps a legacy off-contract family visible and replaceable, never silently rewritten (#452)", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: { providers: [rowFixture({ api: "anthropic" })] },
        };
      }
      if (path === "/api/v1/system/providers/panel-one" && init?.method === "PUT") {
        return { status: 200, body: rowFixture({ api: "anthropic-messages" }) };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));

    // The pre-contract stored value is not hidden behind the placeholder: it
    // rides the caption and stays selectable as an explicit out-of-contract
    // entry.
    expect(screen.getByLabelText("Provider api family").textContent).toBe("anthropic");
    await openFamilySelect("Provider api family");
    const legacyOption = screen.getByRole("option", { name: "Out of contract · anthropic" });
    // Selecting it re-commits the same value (and closes the overlay — while
    // a Radix overlay is open the form beneath is aria-hidden).
    fireEvent.click(legacyOption);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText("Provider api family").textContent).toBe("anthropic");

    // Saving untouched keeps the stored value (no silent rewrite)…
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.some((call) => call.init?.method === "PUT")).toBe(true);
    });
    expect(bodyOf(calls.find((call) => call.init?.method === "PUT")).api).toBe("anthropic");

    // …and picking a contract family replaces it with exactly that label.
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));
    await pickFamilySelect("Provider api family", "anthropic-messages");
    expect(screen.getByLabelText("Provider api family").textContent).toBe("anthropic-messages");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls.filter((call) => call.init?.method === "PUT")).toHaveLength(2);
    });
    expect(bodyOf(calls.filter((call) => call.init?.method === "PUT")[1]).api).toBe(
      "anthropic-messages",
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
            models: [
              {
                id: "discovered-b",
                name: "Discovered B",
                api: "openai-responses",
                reasoning: true,
                input: ["text", "image"],
                contextWindow: 200000,
                maxTokens: 128000,
                cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.12 },
                thinking: { mode: "effort", efforts: ["low", "medium", "high"] },
                metadataSource: "models_dev",
              },
              {
                id: "discovered-c",
                reasoning: null,
                input: null,
                contextWindow: null,
                maxTokens: null,
                cost: null,
                thinking: null,
                metadataSource: "none",
              },
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
    expect(
      bodyOf(calls.find((call) => call.path === "/api/v1/system/providers/discover-models")),
    ).toEqual({
      providerId: "panel-one",
    });
    // Manual row kept; discovered rows appended with their catalog metadata;
    // warning surfaced.
    expect(screen.getByLabelText("Model 1 id")).toHaveProperty("value", "model-a");
    expect(screen.queryByLabelText("Model 1 discovery metadata")).toBeNull();
    expect(screen.getByLabelText("Model 2 id")).toHaveProperty("value", "discovered-b");
    // #447 the enriched row feeds the editor seats, not just id/name.
    expect(screen.getByLabelText("Model 2 context window")).toHaveProperty("value", "200000");
    expect(screen.getByLabelText("Model 2 max tokens")).toHaveProperty("value", "128000");
    // No jest-dom matchers in this suite — checkboxes assert via .checked.
    expect((screen.getByLabelText("Model 2 reasoning capable") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Model 2 ladder low") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Model 2 ladder high") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Model 2 discovery metadata").textContent).toContain(
      "source models_dev",
    );
    expect(screen.getByLabelText("Model 2 discovery metadata").textContent).toContain(
      "cost (in/out/cacheRead/cacheWrite) 0.6 / 2.2 / 0.11 / 0.12",
    );
    // A row no catalog knows renders explicit unknowns — never blank cells.
    expect(screen.getByLabelText("Model 3 id")).toHaveProperty("value", "discovered-c");
    expect(screen.getByLabelText("Model 3 discovery metadata").textContent).toContain(
      "contextWindow unknown",
    );
    expect(screen.getByLabelText("Model 3 discovery metadata").textContent).toContain(
      "reasoning unknown",
    );
    expect(await screen.findByText(/2 new merged/)).toBeTruthy();
    expect(screen.getByText(/1× models\.dev, 0× bundled, 1× no catalog match/)).toBeTruthy();
    expect(screen.getByText(/skipped, never silently dropped/)).toBeTruthy();
  });

  it("#485 an openai-images row edits image seats only and saves image entries", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: {
            providers: [
              rowFixture({
                id: "scitrace-image",
                displayName: "SciTrace Image",
                api: "openai-images",
                baseUrl: "https://images.example.com/v1",
                models: [
                  {
                    id: "gpt-image-2",
                    sizes: ["1024x1024", "1536x1024"],
                    outputFormat: "png",
                    cost: { perImage: 0.04 },
                  },
                ],
              }),
            ],
          },
        };
      }
      if (path === "/api/v1/system/providers/scitrace-image" && init?.method === "PUT") {
        return { status: 200, body: rowFixture({ id: "scitrace-image", api: "openai-images" }) };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit scitrace-image" }));

    // The image seats render…
    expect(screen.getByLabelText("Model 1 id")).toHaveProperty("value", "gpt-image-2");
    expect(screen.getByLabelText("Model 1 sizes")).toHaveProperty("value", "1024x1024, 1536x1024");
    expect(screen.getByLabelText("Model 1 output format").textContent).toBe("png");
    expect(screen.getByLabelText("Model 1 price per image")).toHaveProperty("value", "0.04");
    // …and no chat seat exists on the row at all (not even disabled).
    expect(screen.queryByLabelText("Model 1 context window")).toBeNull();
    expect(screen.queryByLabelText("Model 1 max tokens")).toBeNull();
    expect(screen.queryByLabelText("Model 1 thinking budget")).toBeNull();
    expect(screen.queryByLabelText("Model 1 reasoning capable")).toBeNull();
    expect(screen.queryByLabelText("Model 1 ladder low")).toBeNull();
    expect(screen.queryByLabelText("Model 1 cost input")).toBeNull();
    expect(screen.queryByLabelText("Model 1 api family")).toBeNull();

    fireEvent.change(screen.getByLabelText("Model 1 sizes"), {
      target: { value: "1024x1024, 1536x1024, 1024x1536" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const put = calls.find(
        (call) =>
          call.path === "/api/v1/system/providers/scitrace-image" && call.init?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(bodyOf(put)).toMatchObject({ api: "openai-images" });
      expect(bodyOf(put).models).toEqual([
        {
          id: "gpt-image-2",
          sizes: ["1024x1024", "1536x1024", "1024x1536"],
          outputFormat: "png",
          cost: { perImage: 0.04 },
        },
      ]);
    });
  });

  it("#485 a chat row's discovery refuses image-family entries with the Image Source pointer", async () => {
    routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [rowFixture()] } };
      }
      if (path === "/api/v1/system/providers/discover-models" && init?.method === "POST") {
        return {
          status: 200,
          body: {
            ok: true,
            status: 200,
            latencyMs: 12,
            error: null,
            models: [
              {
                id: "glm-5.3-flash",
                reasoning: null,
                input: null,
                contextWindow: null,
                maxTokens: null,
                cost: null,
                thinking: null,
                metadataSource: "none",
                family: "chat",
              },
              {
                id: "gpt-image-2",
                reasoning: null,
                input: null,
                contextWindow: null,
                maxTokens: null,
                cost: null,
                thinking: null,
                metadataSource: "none",
                family: "image",
              },
            ],
            warnings: [],
          },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));
    fireEvent.click(screen.getByRole("button", { name: "Discover models" }));

    expect(
      await screen.findByText(/Skipped 1 image-generation model\(s\) \(gpt-image-2\)/),
    ).toBeTruthy();
    // Only the chat entry merged; the image id never became a chat model row.
    expect(screen.getByLabelText("Model 2 id")).toHaveProperty("value", "glm-5.3-flash");
    expect(screen.queryByLabelText("Model 3 id")).toBeNull();
    expect(screen.queryByLabelText("Model 2 sizes")).toBeNull();
  });

  it("#485 an image row's discovery merges image drafts and recommends the seat", async () => {
    routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: {
            providers: [
              rowFixture({
                id: "imagey",
                displayName: "Imagey",
                api: "openai-images",
                baseUrl: "https://images.example.com/v1",
                models: [{ id: "gpt-image-2" }],
              }),
            ],
          },
        };
      }
      if (path === "/api/v1/system/providers/discover-models" && init?.method === "POST") {
        return {
          status: 200,
          body: {
            ok: true,
            status: 200,
            latencyMs: 8,
            error: null,
            models: [
              {
                id: "gpt-image-2.5",
                reasoning: null,
                input: null,
                contextWindow: null,
                maxTokens: null,
                cost: null,
                thinking: null,
                metadataSource: "models_dev",
                family: "image",
              },
            ],
            warnings: [],
          },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit imagey" }));
    fireEvent.click(screen.getByRole("button", { name: "Discover models" }));

    // The discovered row lands as an IMAGE draft: id + image seats, zero chat seats.
    expect(await screen.findByLabelText("Model 2 id")).toHaveProperty("value", "gpt-image-2.5");
    expect(screen.getByLabelText("Model 2 sizes")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Model 2 discovery metadata").textContent).toContain(
      "sizes unknown",
    );
    expect(screen.queryByLabelText("Model 2 context window")).toBeNull();
    expect(screen.queryByLabelText("Model 2 reasoning capable")).toBeNull();
    // Seat recommendation for the newly discovered image models.
    expect(
      await screen.findByText(/select this row in Settings → Providers → Image Source/),
    ).toBeTruthy();
  });

  it("#485 an unsaved image row's discovery carries the family hint and edits image seats", async () => {
    const calls = routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return { status: 200, body: { providers: [] } };
      }
      if (path === "/api/v1/system/providers/discover-models" && init?.method === "POST") {
        return {
          status: 200,
          body: { ok: true, status: 200, latencyMs: 5, error: null, models: [], warnings: [] },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Add provider" }));
    fireEvent.change(screen.getByLabelText("Provider id"), { target: { value: "new-image" } });
    fireEvent.change(screen.getByLabelText("Provider base URL"), {
      target: { value: "https://images.example.com/v1" },
    });
    await pickFamilySelect("Provider api family", "openai-images");
    // Switching the family flips the model editor to the image seats.
    expect(screen.queryByLabelText("Model 1 context window")).toBeNull();
    expect(screen.getByLabelText("Model 1 sizes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discover models" }));
    await waitFor(() => {
      const post = calls.find(
        (call) => call.path === "/api/v1/system/providers/discover-models",
      );
      expect(post).toBeDefined();
      expect(bodyOf(post)).toEqual({
        baseUrl: "https://images.example.com/v1",
        api: "openai-images",
      });
    });
  });

  it("#485 switching a row to openai-images converts drafts and drops chat seats with a notice", async () => {
    routeMock(({ path, init }) => {
      if (path === "/api/v1/system/providers" && (init?.method ?? "GET") === "GET") {
        return {
          status: 200,
          body: {
            providers: [
              rowFixture({
                models: [{ id: "model-a", name: "Model A", contextWindow: 8192, reasoning: true }],
              }),
            ],
          },
        };
      }
      return undefined;
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Edit panel-one" }));
    expect(screen.getByLabelText("Model 1 context window")).toHaveProperty("value", "8192");
    await pickFamilySelect("Provider api family", "openai-images");
    expect(screen.queryByLabelText("Model 1 context window")).toBeNull();
    expect(screen.getByLabelText("Model 1 id")).toHaveProperty("value", "model-a");
    expect(screen.getByLabelText("Model 1 sizes")).toBeTruthy();
    expect(screen.getByText(/chat seats \(reasoning\/input\/contextWindow/)).toBeTruthy();
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
