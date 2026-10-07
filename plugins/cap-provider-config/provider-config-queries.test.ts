import { describe, expect, it } from "vitest";
import {
  discoveredMetaLine,
  type DiscoveredModelEntry,
  discoveredModelToDraft,
  discoveredModelEntrySchema,
  modelDraftToWire,
} from "./src/queries/provider-config-queries";

/**
 * #447 the panel side of discover enrichment: a discovered entry becomes an
 * editor draft that feeds every catalog seat the panel owns (contextWindow /
 * maxTokens / reasoning / thinking ladder / cost), keeps its provenance for
 * the display face, and never leaks the display seats into the write face.
 */

const enrichedEntry: DiscoveredModelEntry = {
  id: "glm-5.3",
  name: "GLM 5.3",
  api: "anthropic",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 128000,
  cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.12 },
  thinking: { mode: "effort", efforts: ["minimal", "low", "medium", "high", "xhigh"] },
  metadataSource: "models_dev",
};

describe("discoveredModelToDraft", () => {
  it("maps every catalog seat the editor owns, panel ladder members included", () => {
    const draft = discoveredModelToDraft(enrichedEntry);
    expect(draft.id).toBe("glm-5.3");
    expect(draft.name).toBe("GLM 5.3");
    expect(draft.api).toBe("anthropic");
    expect(draft.reasoning).toBe(true);
    expect(draft.inputText).toBe(true);
    expect(draft.inputImage).toBe(true);
    expect(draft.contextWindow).toBe("200000");
    expect(draft.maxTokens).toBe("128000");
    // Panel ladder members map onto the checkbox seats; "minimal" (omp-only
    // rung, off the panel vocabulary) stays display-only.
    expect(draft.reasoningLevels).toEqual(["low", "medium", "high", "xhigh"]);
    expect(draft.defaultReasoningLevel).toBe("");
    expect(draft.thinkingBudgetTokens).toBe("");
    expect(draft.costInput).toBe("0.6");
    expect(draft.costOutput).toBe("2.2");
    expect(draft.costCacheRead).toBe("0.11");
    expect(draft.costCacheWrite).toBe("0.12");
    expect(draft.discoveredMeta).toEqual({
      source: "models_dev",
      reasoning: true,
      input: ["text", "image"],
      thinkingEfforts: ["minimal", "low", "medium", "high", "xhigh"],
    });
  });

  it("keeps unknown seats blank and provenance explicit (no catalog knows the id)", () => {
    const draft = discoveredModelToDraft({
      id: "private-model",
      reasoning: null,
      input: null,
      contextWindow: null,
      maxTokens: null,
      cost: null,
      thinking: null,
      metadataSource: "none",
    });
    expect(draft.name).toBe("");
    expect(draft.contextWindow).toBe("");
    expect(draft.maxTokens).toBe("");
    expect(draft.reasoning).toBe(false);
    expect(draft.reasoningLevels).toEqual([]);
    expect(draft.costInput).toBe("");
    expect(draft.discoveredMeta).toEqual({
      source: "none",
      reasoning: null,
      input: null,
      thinkingEfforts: null,
    });
  });

  it("marks the no-host fallback rows unavailable", () => {
    const draft = discoveredModelToDraft({ id: "bare-row", metadataSource: "unavailable" });
    expect(draft.discoveredMeta?.source).toBe("unavailable");
    expect(draft.discoveredMeta?.reasoning).toBeNull();
  });
});

describe("discoveredMetaLine", () => {
  it("renders known values verbatim, never an empty cell", () => {
    const line = discoveredMetaLine(discoveredModelToDraft(enrichedEntry));
    expect(line).toBe(
      "source models_dev · contextWindow 200000 · maxTokens 128000 · reasoning yes · " +
        "thinking minimal / low / medium / high / xhigh · input text+image · " +
        "cost (in/out/cacheRead/cacheWrite) 0.6 / 2.2 / 0.11 / 0.12",
    );
  });

  it("renders explicit unknowns for looked-and-missed seats", () => {
    const line = discoveredMetaLine(
      discoveredModelToDraft({
        id: "private-model",
        reasoning: null,
        input: null,
        contextWindow: null,
        maxTokens: null,
        cost: null,
        thinking: null,
        metadataSource: "none",
      }),
    );
    expect(line).toBe(
      "source none · contextWindow unknown · maxTokens unknown · reasoning unknown · " +
        "thinking unknown · input unknown · cost (in/out/cacheRead/cacheWrite) unknown",
    );
  });

  it("renders a known non-reasoning row as no thinking, not unknown", () => {
    const line = discoveredMetaLine(
      discoveredModelToDraft({
        id: "plain-model",
        reasoning: false,
        input: ["text"],
        contextWindow: 8192,
        maxTokens: 4096,
        cost: null,
        thinking: null,
        metadataSource: "bundled",
      }),
    );
    expect(line).toContain("reasoning no");
    expect(line).toContain("thinking no");
    expect(line).toContain("input text");
    expect(line).toContain("cost (in/out/cacheRead/cacheWrite) unknown");
  });

  it("tracks live draft edits (an emptied seat reads unknown again)", () => {
    const draft = discoveredModelToDraft(enrichedEntry);
    draft.contextWindow = "";
    expect(discoveredMetaLine(draft)).toContain("contextWindow unknown");
  });
});

describe("discover wire and write faces", () => {
  it("parses the enriched wire row and the bare fallback row", () => {
    expect(discoveredModelEntrySchema.safeParse(enrichedEntry).success).toBe(true);
    expect(
      discoveredModelEntrySchema.safeParse({ id: "bare-row", metadataSource: "unavailable" })
        .success,
    ).toBe(true);
    expect(discoveredModelEntrySchema.safeParse({ id: "x" }).success).toBe(false);
  });

  it("modelDraftToWire drops the display seats (stored catalog rejects them)", () => {
    const wire = modelDraftToWire(discoveredModelToDraft(enrichedEntry));
    expect(wire).not.toHaveProperty("discoveredMeta");
    expect(wire).not.toHaveProperty("metadataSource");
    expect(wire).not.toHaveProperty("thinking");
    expect(wire).toMatchObject({
      id: "glm-5.3",
      name: "GLM 5.3",
      api: "anthropic",
      reasoning: true,
      contextWindow: 200000,
      maxTokens: 128000,
      reasoningLevels: ["low", "medium", "high", "xhigh"],
      cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0.12 },
    });
  });
});
