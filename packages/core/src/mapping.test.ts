import { describe, expect, test } from "bun:test";
import {
  CLEAR_SENTINEL,
  buildAgentModelPatch,
  buildAgentOptions,
  buildAgentSections,
  buildModelOptions,
  buildModelSections,
  buildVariantOptions,
  readAgentModel,
  removeAgentModel,
  validateMapping,
} from "./index";

describe("buildAgentOptions", () => {
  test("empty config", () => {
    expect(buildAgentOptions({})).toEqual([]);
  });

  test("alphabetical order", () => {
    const config = { agent: { zebra: {}, apple: {}, monkey: {} } };
    expect(buildAgentOptions(config).map((option) => option.value)).toEqual([
      "apple",
      "monkey",
      "zebra",
    ]);
  });

  test("description with agent model override", () => {
    const config = {
      agent: { planner: { model: "anthropic/claude-opus" } },
      model: "openai/gpt-4",
    };
    expect(buildAgentOptions(config)).toEqual([
      { title: "planner", value: "planner", description: "anthropic/claude-opus" },
    ]);
  });

  test("includes an explicit variant", () => {
    const result = buildAgentOptions({
      agent: { build: { model: "anthropic/claude-opus", variant: "high" } },
    });
    expect(result[0].description).toBe("anthropic/claude-opus (high)");
  });

  test("description with base model when the agent has no override", () => {
    const config = { agent: { planner: {} }, model: "openai/gpt-4" };
    expect(buildAgentOptions(config)).toEqual([
      { title: "planner", value: "planner", description: "openai/gpt-4" },
    ]);
  });

  test("description with inheritance when no model exists anywhere", () => {
    const config = { agent: { planner: {} } };
    expect(buildAgentOptions(config)).toEqual([
      { title: "planner", value: "planner", description: "(hereda)" },
    ]);
  });
});

describe("buildModelOptions", () => {
  const providers = [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
  ];
  const models = [
    { providerID: "anthropic", id: "claude-opus", name: "Claude Opus" },
    { providerID: "anthropic", id: "claude-sonnet", name: "Claude Sonnet" },
    { providerID: "openai", id: "gpt-4", name: "GPT-4" },
  ];

  test("flattens models and keeps providers without models valid", () => {
    const result = buildModelOptions(models, providers);
    expect(result[0].value).toBe(CLEAR_SENTINEL);
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({
      title: "Claude Opus",
      value: "anthropic/claude-opus",
      description: "Anthropic",
    });
    expect(buildModelSections(models, providers)).toHaveLength(3);
  });

  test("falls back to modelID when id is missing", () => {
    expect(buildModelOptions([{ providerID: "custom", modelID: "fallback-model" }])[1]).toEqual({
      title: "fallback-model",
      value: "custom/fallback-model",
      description: "custom",
    });
  });
});

describe("buildVariantOptions", () => {
  test("resolves variant arrays and skips malformed entries", () => {
    const models = [
      {
        providerID: "openai",
        id: "gpt",
        variants: [
          { id: "fast", settings: { temperature: 0.2 } },
          { id: "deep", settings: { reasoningEffort: "high" } },
          { settings: { ignored: true } },
          null,
        ],
      },
    ];
    expect(buildVariantOptions("openai/gpt", models)).toEqual([
      { title: "fast", value: "fast", description: "temperature: 0.2" },
      { title: "deep", value: "deep", description: "reasoningEffort: high" },
    ]);
  });

  test("returns no options for an invalid reference", () => {
    expect(buildVariantOptions("openai", [])).toEqual([]);
    expect(buildVariantOptions("/gpt", [])).toEqual([]);
    expect(buildVariantOptions("openai/", [])).toEqual([]);
  });
});

describe("readAgentModel", () => {
  test("reads string and object model references", () => {
    expect(
      readAgentModel({ agent: { build: { model: "anthropic/opus", variant: "high" } } }, "build")
    ).toEqual({ model: "anthropic/opus", variant: "high" });
    expect(
      readAgentModel(
        { agent: { build: { model: { id: "opus", providerID: "anthropic", variant: "high" } } } },
        "build"
      )
    ).toEqual({ model: "anthropic/opus", variant: "high" });
    expect(
      readAgentModel(
        { agent: { build: { model: { model: "opus", providerID: "anthropic", variant: "high" } } } },
        "build"
      )
    ).toEqual({ model: "anthropic/opus", variant: "high" });
  });
});

describe("removeAgentModel", () => {
  test("does not mutate input", () => {
    const original = { agent: { planner: { model: "anthropic/claude-opus" } } };
    const cloned = JSON.parse(JSON.stringify(original));
    removeAgentModel(original, "planner");
    expect(original).toEqual(cloned);
  });

  test("removes model and variant fields", () => {
    const config = {
      agent: {
        planner: { model: "anthropic/claude-opus", variant: "high", other: "value" },
      },
    };
    const result = removeAgentModel(config, "planner");
    expect(result.agent?.planner.model).toBeUndefined();
    expect(result.agent?.planner.variant).toBeUndefined();
    expect(result.agent?.planner.other).toBe("value");
  });

  test("preserves an empty agent object after deletion", () => {
    const config = { agent: { planner: { model: "anthropic/claude-opus" } } };
    expect(removeAgentModel(config, "planner").agent?.planner).toEqual({});
  });
});

describe("buildAgentModelPatch", () => {
  test("creates the correct patch structure", () => {
    expect(buildAgentModelPatch("planner", "anthropic/claude-opus")).toEqual({
      agent: { planner: { model: "anthropic/claude-opus" } },
    });
  });

  test("includes variant only when provided", () => {
    expect(buildAgentModelPatch("build", "anthropic/opus", "high")).toEqual({
      agent: { build: { model: "anthropic/opus", variant: "high" } },
    });
    expect(buildAgentModelPatch("build", "anthropic/opus")).toEqual({
      agent: { build: { model: "anthropic/opus" } },
    });
  });
});

describe("buildAgentSections", () => {
  test("All is first and contains all agents", () => {
    const sections = buildAgentSections({ agent: { "team-a": {}, "team-b": {}, other: {} } });
    expect(sections[0].id).toBe("all");
    expect(sections[0].label).toBe("All");
    expect(sections[0].items.length).toBe(3);
  });

  test("family with at least two agents creates a section with original-case label", () => {
    const sections = buildAgentSections({ agent: { "Team-Runner": {}, "team-planner": {} } });
    expect(sections.length).toBe(2);
    expect(sections[1].id).toBe("family:Team");
    expect(sections[1].label).toBe("Team");
    expect(sections[1].kind).toBe("family");
    expect(sections[1].items.length).toBe(2);
  });

  test("family grouping is case-insensitive", () => {
    const sections = buildAgentSections({
      agent: { "team-alpha": {}, "Team-beta": {}, "TEAM-gamma": {} },
    });
    const familySections = sections.filter((section) => section.kind === "family");
    expect(familySections.length).toBe(1);
    expect(familySections[0].items.length).toBe(3);
  });

  test("agent without a dash stays only in All", () => {
    const sections = buildAgentSections({ agent: { lone: {}, "team-a": {}, "team-b": {} } });
    const familySections = sections.filter((section) => section.kind === "family");
    expect(familySections.length).toBe(1);
    expect(familySections[0].items.length).toBe(2);
    expect(sections[0].items.find((item) => item.value === "lone")).toBeDefined();
  });

  test("family with exactly one agent does not create a section", () => {
    const sections = buildAgentSections({ agent: { "team-a": {}, "other-x": {} } });
    expect(sections.length).toBe(1);
    expect(sections[0].id).toBe("all");
  });

  test("empty config returns only All with empty items", () => {
    const sections = buildAgentSections({});
    expect(sections.length).toBe(1);
    expect(sections[0].id).toBe("all");
    expect(sections[0].items).toEqual([]);
  });

  test("family sections are sorted alphabetically", () => {
    const sections = buildAgentSections({
      agent: { "zebra-a": {}, "zebra-b": {}, "alpha-a": {}, "alpha-b": {} },
    });
    expect(sections.length).toBe(3);
    expect(sections[1].label).toBe("alpha");
    expect(sections[2].label).toBe("zebra");
  });
});

describe("buildModelSections", () => {
  const providers = [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
  ];

  test("All includes the clear option and provider sections do not", () => {
    const models = [
      { providerID: "anthropic", id: "opus" },
      { providerID: "openai", id: "gpt4" },
    ];
    const sections = buildModelSections(models, providers);
    expect(sections[0].id).toBe("all");
    expect(sections[0].items[0].value).toBe(CLEAR_SENTINEL);

    const anthropicSection = sections.find((section) => section.id === "provider:anthropic");
    expect(anthropicSection).toBeDefined();
    expect(anthropicSection!.items.every((item) => item.value !== CLEAR_SENTINEL)).toBe(true);
  });

  test("provider sections are sorted alphabetically", () => {
    const models = [
      { providerID: "openai", id: "gpt4" },
      { providerID: "anthropic", id: "opus" },
    ];
    const sections = buildModelSections(models, providers);
    expect(sections[1].label).toBe("Anthropic");
    expect(sections[2].label).toBe("OpenAI");
  });

  test("empty providers returns only All with the clear option", () => {
    const sections = buildModelSections([]);
    expect(sections.length).toBe(1);
    expect(sections[0].id).toBe("all");
    expect(sections[0].items.length).toBe(1);
    expect(sections[0].items[0].value).toBe(CLEAR_SENTINEL);
  });

  test("provider without models does not create a section", () => {
    const sections = buildModelSections(
      [{ providerID: "anthropic", id: "opus" }],
      [...providers, { id: "empty", name: "Empty" }]
    );
    expect(sections.length).toBe(2);
    expect(sections.find((section) => section.id === "provider:empty")).toBeUndefined();
  });
});

describe("validateMapping", () => {
  test("accepts a valid mapping and preserves the agent name", () => {
    const result = validateMapping({
      agents: [{ agent: "Team-Planner", model: "anthropic/claude-opus", variant: "max" }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.mapping.agents).toEqual([
      { agent: "Team-Planner", model: "anthropic/claude-opus", variant: "max" },
    ]);
  });

  test("accepts an inherit entry without a model", () => {
    const result = validateMapping([{ agent: "runner", inherit: true }]);
    expect(result.valid).toBe(true);
    expect(result.mapping.agents).toEqual([{ agent: "runner", inherit: true }]);
  });

  test("rejects a duplicate agent", () => {
    const result = validateMapping([
      { agent: "planner", model: "anthropic/opus" },
      { agent: "planner", model: "openai/gpt" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("duplicate agent: planner");
  });

  test("rejects an empty provider", () => {
    const result = validateMapping({ agents: [{ agent: "planner", model: "/opus" }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("agent planner: model must be provider/model");
  });

  test("rejects a missing model on a non-inherit entry", () => {
    const result = validateMapping({ agents: [{ agent: "planner" }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("agent planner: model is required");
  });

  test("rejects a non-string variant", () => {
    const result = validateMapping({
      agents: [{ agent: "planner", model: "anthropic/opus", variant: 2 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("agent planner: variant must be a string");
  });

  test("does not throw on malformed input", () => {
    expect(() => validateMapping(null)).not.toThrow();
    expect(validateMapping(null).valid).toBe(false);
    expect(validateMapping({ agents: "nope" }).valid).toBe(false);
    expect(validateMapping([null, 3, []]).valid).toBe(false);
  });
});
