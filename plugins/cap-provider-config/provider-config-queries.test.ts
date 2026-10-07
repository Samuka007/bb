import { describe, expect, it } from "vitest";
import {
  discoveredImageMetaLine,
  discoveredImageModelToDraft,
  discoveredMetaLine,
  type DiscoveredModelEntry,
  discoveredModelToDraft,
  discoveredModelEntrySchema,
  imageModelDraftToWire,
  imageModelWireToDraft,
  imageSourceRowSummary,
  modelFamilyOfApi,
  modelDraftToWire,
  type ProviderConfigRow,
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

/**
 * #485 the image family on the panel side: image drafts carry image
 * semantics only (sizes/outputFormat/per-image price), conversion to and
 * from the wire never smuggles a chat seat, and the family rule is the
 * exact openai-images api seat.
 */
describe("#485 image-family drafts", () => {
  it("maps a discovered entry onto an image draft without chat seats", () => {
    const draft = discoveredImageModelToDraft(enrichedEntry);
    expect(draft).toEqual({
      id: "glm-5.3",
      name: "GLM 5.3",
      description: "",
      sizes: "",
      outputFormat: "",
      costPerImage: "",
      discoveredMeta: { source: "models_dev" },
    });
    expect(draft).not.toHaveProperty("contextWindow");
    expect(draft).not.toHaveProperty("reasoning");
  });

  it("imageModelDraftToWire writes image semantics only and rejects bad seats", () => {
    const wire = imageModelDraftToWire({
      id: "gpt-image-2",
      name: "GPT Image 2",
      description: "",
      sizes: "1024x1024, 1536x1024",
      outputFormat: "png",
      costPerImage: "0.04",
    });
    expect(wire).toEqual({
      id: "gpt-image-2",
      name: "GPT Image 2",
      sizes: ["1024x1024", "1536x1024"],
      outputFormat: "png",
      cost: { perImage: 0.04 },
    });
    expect(wire).not.toHaveProperty("description");
    const base = {
      id: "gpt-image-2",
      name: "",
      description: "",
      sizes: "",
      outputFormat: "",
      costPerImage: "",
    };
    expect(() => imageModelDraftToWire({ ...base, outputFormat: "gif" })).toThrow(
      /png\/jpeg\/webp/,
    );
    expect(() => imageModelDraftToWire({ ...base, costPerImage: "-1" })).toThrow(/non-negative/);
    expect(() => imageModelDraftToWire({ ...base, id: "  " })).toThrow(/needs an id/);
    // An all-blank optional seat set serializes to the bare id row.
    expect(imageModelDraftToWire({ ...base, id: "bare-image" })).toEqual({ id: "bare-image" });
  });

  it("round-trips stored image entries and degrades broken ones to a blank row", () => {
    const draft = imageModelWireToDraft({
      id: "gpt-image-2.5",
      sizes: ["1024x1024"],
      outputFormat: "jpeg",
      cost: { perImage: 0.05 },
    });
    expect(draft).toMatchObject({
      id: "gpt-image-2.5",
      sizes: "1024x1024",
      outputFormat: "jpeg",
      costPerImage: "0.05",
    });
    expect(imageModelWireToDraft({ nope: true }).id).toBe("");
    expect(imageModelWireToDraft("raw-broken-cell").id).toBe("");
  });

  it("discoveredImageMetaLine renders explicit unknowns and tracks edits", () => {
    const draft = discoveredImageModelToDraft({
      id: "gpt-image-2",
      metadataSource: "none",
    });
    expect(discoveredImageMetaLine(draft)).toBe(
      "source none · sizes unknown · format unknown · price unknown",
    );
    draft.sizes = "1024x1024";
    draft.outputFormat = "png";
    draft.costPerImage = "0.04";
    expect(discoveredImageMetaLine(draft)).toBe(
      "source none · sizes 1024x1024 · format png · price 0.04 USD/image",
    );
  });

  it("modelFamilyOfApi splits at the exact openai-images seat", () => {
    expect(modelFamilyOfApi("openai-images")).toBe("image");
    expect(modelFamilyOfApi("anthropic-messages")).toBe("chat");
    expect(modelFamilyOfApi(null)).toBe("chat");
    // An off-contract spelling is not the family seat — chat, fail-closed.
    expect(modelFamilyOfApi("OpenAI-Images")).toBe("chat");
  });

  it("accepts the server family seat on the discover wire (and rejects off-vocabulary values)", () => {
    expect(
      discoveredModelEntrySchema.safeParse({ ...enrichedEntry, family: "image" }).success,
    ).toBe(true);
    expect(
      discoveredModelEntrySchema.safeParse({ ...enrichedEntry, family: "video" }).success,
    ).toBe(false);
    // The older worker (no family seat) stays parseable — chat fallback.
    expect(discoveredModelEntrySchema.safeParse(enrichedEntry).success).toBe(true);
  });

  it("imageSourceRowSummary renders the first model's 产图元信息 honestly", () => {
    const row = (models: unknown[]): ProviderConfigRow => ({
      id: "imagey",
      displayName: "Imagey",
      baseUrl: "https://images.example.com/v1",
      api: "openai-images",
      serviceTier: false,
      models,
      hasApiKey: true,
      status: "ok",
      warnings: [],
      dispatchable: true,
      createdAt: 0,
      updatedAt: 0,
      source: "user",
    });
    expect(
      imageSourceRowSummary(
        row([
          { id: "gpt-image-2", sizes: ["1024x1024", "1536x1024"], outputFormat: "png", cost: { perImage: 0.04 } },
          { id: "gpt-image-2.5" },
        ]),
      ),
    ).toBe("gpt-image-2 · 1024x1024, 1536x1024 · png · 0.04 USD/image · +1 more model row(s)");
    expect(imageSourceRowSummary(row([{ id: "mystery" }]))).toBe(
      "mystery · sizes unknown · format unknown · price unknown",
    );
    expect(imageSourceRowSummary(row(["not-an-entry"]))).toBe(
      "1 model row(s) · 产图元信息 unavailable (repair the row in Configured)",
    );
    expect(imageSourceRowSummary(undefined)).toBeNull();
  });
});
