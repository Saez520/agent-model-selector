import { describe, expect, test } from "bun:test";
import { formatModelRef, parseModelRef } from "./index";

describe("parseModelRef", () => {
  test("splits provider and model", () => {
    expect(parseModelRef("anthropic/claude-opus")).toEqual({
      providerID: "anthropic",
      id: "claude-opus",
    });
    expect(parseModelRef("openrouter/vendor/model")).toEqual({
      providerID: "openrouter",
      id: "vendor/model",
    });
  });

  test("returns null for invalid references", () => {
    expect(parseModelRef("anthropic")).toBeNull();
    expect(parseModelRef("/model")).toBeNull();
    expect(parseModelRef("provider/")).toBeNull();
    expect(parseModelRef("")).toBeNull();
  });
});

describe("formatModelRef", () => {
  test("composes a reference", () => {
    expect(formatModelRef("anthropic", "claude-opus")).toBe("anthropic/claude-opus");
  });

  test("rejects empty parts", () => {
    expect(() => formatModelRef("", "model")).toThrow();
    expect(() => formatModelRef("provider", "")).toThrow();
  });
});
