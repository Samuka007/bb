// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { providerProjectionsResponseSchema } from "./src/queries/provider-projection-queries";
import { ServerProviderSettingsSection } from "./src/ServerProviderSettingsSection";
import { resetPluginQueryClientForTest } from "./src/plugin-query-client";

/**
 * #266 the Server projection, migrated into the plugin (#382), upgraded by
 * #449: the relay harness stays a read-only projection while the web_search
 * engine chain is EDITABLE — the D1 `web_search` row behind GET/PUT
 * /system/web-search is the sole 正本 (the AGENT_DO_WEB_SEARCH env path is
 * deleted). The tests mount the REGISTERED slot — the exact shape production
 * mounts (#387 precedent) — with a route table covering BOTH faces, and
 * exercise the write paths: reorder, toggle, write-only credentials, and
 * the failed-write verdict.
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
  // The sections share the module-singleton client (one per page load); a
  // stale fixture from a previous case would mask the next case's mock.
  resetPluginQueryClientForTest();
});

interface Call {
  path: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
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

function renderSection(): void {
  const server = app.settingsSections.find(
    (section: { id: string }) => section.id === "server",
  );
  if (server === undefined) {
    throw new Error("the plugin app must register the server settingsSection");
  }
  renderSlot(server, {});
}

type ProjectionFixture = z.input<typeof providerProjectionsResponseSchema>;

function projectionResponse(): ProjectionFixture {
  return {
    webSearch: {
      configured: true,
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

/** The editable face fixture (#449 GET /system/web-search). */
function webSearchFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    configured: true,
    decodeError: false,
    chain: [
      { engine: "brave", credentialsRequired: true, credentialsPresent: false },
      { engine: "public", credentialsRequired: false, credentialsPresent: true },
    ],
    timeoutSeconds: 60,
    browserBackedEngines: ["google", "ecosia", "mojeek"],
    availableEngines: ["brave", "exa", "duckduckgo", "searxng", "startpage", "public"],
    engines: {
      brave: { hasApiKey: false },
      exa: { hasApiKey: false },
      searxng: {
        endpoint: null,
        categories: null,
        language: null,
        safesearch: null,
        hasToken: false,
        hasBasicAuth: false,
      },
    },
    ...overrides,
  };
}

/** Both GET faces answer; PUTs mutate the in-memory seat like the server. */
function dualFaceMock(seat: Record<string, unknown>): { calls: Call[]; seat: Record<string, unknown> } {
  const state = { seat };
  const calls = routeMock((call) => {
    if (call.path.endsWith("/system/web-search") && call.init?.method === "PUT") {
      const body = JSON.parse(String(call.init.body ?? "{}")) as {
        chain?: string[];
        engines?: Record<string, { apiKey?: string | null }>;
      };
      const next = { ...state.seat };
      // A chain write replaces the order; the response still carries the
      // gate-projection row shape (the server re-reads the stored truth).
      if (body.chain !== undefined) {
        next.chain = body.chain.map((engine) => ({
          engine,
          credentialsRequired: false,
          credentialsPresent: true,
        }));
      }
      // Key writes fold into per-engine presence (the server's tri-state
      // merge + hasApiKey projection): string sets, null clears, absent
      // keeps. Unrelated engines ride through untouched.
      if (body.engines !== undefined) {
        const prior = (next.engines ?? {}) as Record<string, { hasApiKey?: boolean }>;
        const engines = { ...prior };
        for (const engine of ["brave", "exa"] as const) {
          const write = body.engines[engine];
          if (write === undefined) continue;
          engines[engine] = {
            ...prior[engine],
            hasApiKey: typeof write.apiKey === "string" && write.apiKey !== "",
          };
        }
        next.engines = engines;
      }
      state.seat = next;
      return { status: 200, body: state.seat };
    }
    if (call.path.endsWith("/system/web-search")) {
      return { status: 200, body: state.seat };
    }
    if (call.path.endsWith("/system/provider-projections")) {
      return { status: 200, body: projectionResponse() };
    }
    return undefined;
  });
  return { calls, seat: state.seat };
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;
}

describe("ServerProviderSettingsSection", () => {
  it("registers a server settingsSection slot on the plugin app", () => {
    expect(
      app.settingsSections.some((section: { id: string }) => section.id === "server"),
    ).toBe(true);
  });

  // #387 regression: the staging SPA mounted this section with no
  // QueryClientProvider above it (the host's provider is not inheritable),
  // the useQuery inside threw "No QueryClient set", and the per-slot error
  // boundary disabled the section for the session. The slot-facing export
  // must therefore mount bare — no test-side wrapper — and still render.
  it("mounts bare with no test-side QueryClientProvider (#387)", async () => {
    dualFaceMock(webSearchFixture());
    render(<ServerProviderSettingsSection />);

    await waitFor(() => {
      expect(screen.getByLabelText("Include brave in the chain")).toBeTruthy();
    });
  });

  it("renders the editable chain editor (#500: no legacy relay block)", async () => {
    dualFaceMock(webSearchFixture());
    renderSection();

    // #500: the legacy deployment-channel block is deleted — nothing relay
    // renders; the editable chain is the whole section.
    expect(screen.queryByText("Deployment relay channel")).toBeNull();
    expect(screen.queryByText("Relay mode")).toBeNull();
    await screen.findByLabelText("Include brave in the chain", {}, { timeout: 3_000 });
    // The editable chain: every available engine has a toggle; in-chain
    // engines show their position and reorder controls.
    expect(screen.getByLabelText("Include brave in the chain")).toBeTruthy();
    expect(screen.getByLabelText("Include Public Web in the chain")).toBeTruthy();
    expect(screen.getByLabelText("Include duckduckgo in the chain")).toBeTruthy();
    expect(screen.getByLabelText("Move brave up")).toBeTruthy();
    expect(screen.getByLabelText("Move brave down")).toBeTruthy();
    // Credential gates render as badges — presence, never values.
    expect(screen.getAllByText("Not configured").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Configured").length).toBeGreaterThanOrEqual(1);
    // The browser-backed exclusion note and the write-only key rows
    // (brave + exa — the keyed-engine pattern).
    expect(
      screen.getByText(
        "google, ecosia, mojeek — browser-backed, excluded from the server-side provider set",
      ),
    ).toBeTruthy();
    expect(screen.getAllByPlaceholderText("Type a key")).toHaveLength(2);
  });

  it("reorders the chain with a full ordered-chain PUT", async () => {
    const { calls } = dualFaceMock(webSearchFixture());
    renderSection();
    await screen.findByLabelText("Move brave down", {}, { timeout: 3_000 });

    fireEvent.click(screen.getByLabelText("Move brave down"));
    // The PUT fires synchronously with the FULL ordered chain (order IS the
    // payload); the success toast rides the same write() as every other
    // control (asserted on the image-source section's write path).
    let put: Call | undefined;
    await waitFor(() => {
      put = calls.find(
        (call) => call.path.endsWith("/system/web-search") && call.init?.method === "PUT",
      );
      expect(put).toBeDefined();
    });
    expect(bodyOf(put)).toEqual({ chain: ["public", "brave"] });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("moved"),
        expect.objectContaining({ description: expect.stringContaining("Hot-applied") }),
      );
    });
  });

  it("appends an engine to the chain when toggled on", async () => {
    const { calls } = dualFaceMock(webSearchFixture());
    renderSection();
    await screen.findByLabelText("Include duckduckgo in the chain", {}, { timeout: 3_000 });

    fireEvent.click(screen.getByLabelText("Include duckduckgo in the chain"));
    await waitFor(() => {
      const put = calls.find(
        (call) => call.path.endsWith("/system/web-search") && call.init?.method === "PUT",
      );
      expect(bodyOf(put)).toEqual({ chain: ["brave", "public", "duckduckgo"] });
    });
  });

  it("writes the brave and exa keys write-only and clears exa with ✕", async () => {
    const { calls } = dualFaceMock(webSearchFixture());
    renderSection();
    await screen.findAllByPlaceholderText("Type a key", {}, { timeout: 3_000 });

    // Two keyed-engine rows now share the write-only pattern; document order
    // puts the brave row first, the exa row second.
    const inputs = screen.getAllByPlaceholderText("Type a key") as HTMLInputElement[];
    const input = inputs[0]!;
    fireEvent.change(input, { target: { value: "brv-secret-449" } });
    // The face has several Save buttons (brave key, SearXNG endpoint, auth);
    // the brave row's is the first.
    fireEvent.click(screen.getAllByText("Save")[0]!);
    await waitFor(() => {
      const put = calls.find(
        (call) => call.path.endsWith("/system/web-search") && call.init?.method === "PUT",
      );
      expect(bodyOf(put)).toEqual({ engines: { brave: { apiKey: "brv-secret-449" } } });
    });
    // The typed value never renders back (write-only discipline).
    expect(document.body.textContent).not.toContain("brv-secret-449");

    // The exa row writes its own engine scope only.
    const exaInput = inputs[1]!;
    fireEvent.change(exaInput, { target: { value: "exa-secret-539" } });
    fireEvent.click(screen.getAllByText("Save")[1]!);
    await waitFor(() => {
      const put = calls.filter(
        (call) => call.path.endsWith("/system/web-search") && call.init?.method === "PUT",
      )[1];
      expect(bodyOf(put)).toEqual({ engines: { exa: { apiKey: "exa-secret-539" } } });
    });
    expect(document.body.textContent).not.toContain("exa-secret-539");

    // ✕ clears with the tri-state null payload, scoped to exa.
    // The refetch flips exa's presence badge first — the ✕ enables on it.
    await waitFor(() => {
      const clear = screen.getAllByText("✕")[1] as HTMLButtonElement;
      expect(clear.disabled).toBe(false);
    });
    fireEvent.click(screen.getAllByText("✕")[1]!);
    await waitFor(() => {
      const put = calls.filter(
        (call) => call.path.endsWith("/system/web-search") && call.init?.method === "PUT",
      )[2];
      expect(bodyOf(put)).toEqual({ engines: { exa: { apiKey: null } } });
    });
  });

  it("surfaces the server's refusal instead of moving local state", async () => {
    const calls = routeMock((call) => {
      if (call.path.endsWith("/system/web-search") && call.init?.method === "PUT") {
        return {
          status: 422,
          body: {
            code: "validation_failed",
            message:
              'web_search edge policy: engine "google" is browser-backed and is excluded from the DO-local provider set.',
          },
        };
      }
      if (call.path.endsWith("/system/web-search")) {
        return { status: 200, body: webSearchFixture() };
      }
      if (call.path.endsWith("/system/provider-projections")) {
        return { status: 200, body: projectionResponse() };
      }
      return undefined;
    });
    renderSection();
    await screen.findByLabelText("Move brave down", {}, { timeout: 3_000 });

    fireEvent.click(screen.getByLabelText("Move brave down"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Saving the web search configuration failed",
        expect.objectContaining({
          description: expect.stringContaining("browser-backed"),
        }),
      );
    });
    expect(calls.filter((call) => call.init?.method === "PUT")).toHaveLength(1);
  });

  it("reports a decode-broken seat without editors", async () => {
    // The wire face NEVER carries engines:null — a broken row still serves
    // the zero-detail object (the loud decodeError banner rides beside it).
    dualFaceMock(
      webSearchFixture({
        decodeError: true,
        chain: [],
        timeoutSeconds: null,
        engines: {
          brave: { hasApiKey: false },
          exa: { hasApiKey: false },
          searxng: {
            endpoint: null,
            categories: null,
            language: null,
            safesearch: null,
            hasToken: false,
            hasBasicAuth: false,
          },
        },
      }),
    );
    renderSection();

    await screen.findByText(/failed to decode/, {}, { timeout: 3_000 });
    // No chain, no editors.
    expect(screen.queryByText("Public Web")).toBeNull();
    expect(screen.queryByLabelText("Include brave in the chain")).toBeNull();
  });

  // #538 regression: the rows used to render in the server's alphabetical
  // `availableEngines` vocabulary order while the per-row labels said
  // "Chain position 3 / 1 / 2" — the chain read scrambled. In-chain rows
  // must follow chain position; not-in-chain rows trail in vocabulary order.
  it("renders chain rows in position order, not-in-chain rows after (#538)", async () => {
    // The user's screenshot shape: chain [searxng, public, duckduckgo]
    // against the server vocabulary [brave, exa, duckduckgo, searxng,
    // startpage, public].
    dualFaceMock(
      webSearchFixture({
        chain: [
          { engine: "searxng", credentialsRequired: false, credentialsPresent: true },
          { engine: "public", credentialsRequired: false, credentialsPresent: true },
          { engine: "duckduckgo", credentialsRequired: false, credentialsPresent: true },
        ],
      }),
    );
    renderSection();
    await screen.findByLabelText("Include searxng in the chain", {}, { timeout: 3_000 });

    // Document order of the include toggles IS the rendered row order.
    const renderedOrder = screen
      .getAllByLabelText(/^Include .+ in the chain$/)
      .map((toggle) => toggle.getAttribute("aria-label"));
    expect(renderedOrder).toEqual([
      "Include searxng in the chain",
      "Include Public Web in the chain",
      "Include duckduckgo in the chain",
      "Include brave in the chain",
      "Include exa in the chain",
      "Include startpage in the chain",
    ]);
    // The position copy now agrees with the row order.
    expect(screen.getByText("Chain position 1 — credential-free engine.")).toBeTruthy();
    expect(screen.getByText("Chain position 2 — credential-free engine.")).toBeTruthy();
    expect(screen.getByText("Chain position 3 — credential-free engine.")).toBeTruthy();
    expect(screen.getAllByText("Not in the chain — toggle on to append it last.")).toHaveLength(3);
    // Reorder affordances agree too: position 1 cannot move up, the last
    // chain row cannot move down.
    expect((screen.getByLabelText("Move searxng up") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText("Move duckduckgo down") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("Move searxng down") as HTMLButtonElement).disabled).toBe(false);
  });

  // #538 regression: the credentials row packed a badge + three inputs +
  // two buttons into the side-by-side control column (`shrink-0`), which
  // squeezed the `min-w-0` label column down to word-at-a-time. The row is
  // stacked now: label above, wrap-friendly full-width controls below.
  it("stacks the SearXNG credentials row so the label keeps its width (#538)", async () => {
    dualFaceMock(webSearchFixture());
    renderSection();
    await screen.findAllByPlaceholderText("Type a key", {}, { timeout: 3_000 });

    const credentialsLabel = screen.getByText("SearXNG credentials");
    const credentialsRow = credentialsLabel.closest("div.flex-col");
    expect(credentialsRow).toBeTruthy();
    // Stacked: no side-by-side split at sm+ (the split is what starved the
    // label column via its shrink-0 control side).
    expect(credentialsRow!.className).not.toContain("sm:flex-row");
    // The three inputs share ONE wrap-friendly control row.
    const controls = screen.getByPlaceholderText("Token").parentElement!;
    expect(controls.className).toContain("flex-wrap");
    expect(screen.getByPlaceholderText("Basic user").parentElement).toBe(controls);
    expect(screen.getByPlaceholderText("Basic password").parentElement).toBe(controls);
    // Contrast pin: single-field rows (Brave) keep the side-by-side split.
    const braveRow = screen.getByText("Brave API key").closest("div.flex-col");
    expect(braveRow!.className).toContain("sm:flex-row");
  });

  // #500: the legacy deployment-channel block and its #484 env gate are
  // deleted with the env scalars they projected — the "renders the editable
  // chain editor" case above pins that no relay UI exists at all.
});
