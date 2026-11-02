import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { validateMapping } from "../packages/core/src/index";

const presetUrl = new URL("../presets/flowtask.json", import.meta.url);
const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function loadPreset(): unknown {
  return JSON.parse(fs.readFileSync(presetUrl, "utf8"));
}

describe("flowtask preset", () => {
  test("is valid and lists nine agents", () => {
    const result = validateMapping(loadPreset());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.mapping.agents).toHaveLength(9);
    expect(result.mapping.agents.map((entry) => entry.agent)).toEqual([
      "flowtask-ca-writer",
      "flowtask-planner",
      "flowtask-plan-auditor",
      "flowtask-validator",
      "flowtask-graphify-docs-media",
      "flowtask-constructor",
      "flowtask-inspector",
      "flowtask-runner",
      "flowtask-review-orchestrator",
    ]);
  });

  test("preserves agent names and inherited entries", () => {
    const result = validateMapping(loadPreset());
    expect(result.mapping.agents.filter((entry) => entry.inherit === true)).toHaveLength(4);
    expect(result.mapping.agents[0]).toEqual({
      agent: "flowtask-ca-writer",
      model: "opencode-go/muse-spark-1.3-contributor",
      variant: "xhigh",
    });
  });

  test("pins the model and variant of every explicit entry", () => {
    const result = validateMapping(loadPreset());
    expect(result.mapping.agents).toEqual([
      { agent: "flowtask-ca-writer", model: "opencode-go/muse-spark-1.3-contributor", variant: "xhigh" },
      { agent: "flowtask-planner", model: "opencode-go/deepseek-v4.1-flash", variant: "max" },
      { agent: "flowtask-plan-auditor", model: "opencode-go/muse-spark-1.3-contributor", variant: "xhigh" },
      { agent: "flowtask-validator", model: "opencode-go/muse-spark-1.3-contributor", variant: "xhigh" },
      { agent: "flowtask-graphify-docs-media", model: "openai/gpt-5.6-sol", variant: "medium" },
      { agent: "flowtask-constructor", inherit: true },
      { agent: "flowtask-inspector", inherit: true },
      { agent: "flowtask-runner", inherit: true },
      { agent: "flowtask-review-orchestrator", inherit: true },
    ]);
  });

  test("the runtime packages never import the preset", () => {
    const coreDir = path.join(packageRoot, "packages", "core", "src");
    const sources = [
      ...fs
        .readdirSync(coreDir)
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => fs.readFileSync(path.join(coreDir, name), "utf8")),
      fs.readFileSync(path.join(packageRoot, "packages", "opencode", "tui.tsx"), "utf8"),
      fs.readFileSync(path.join(packageRoot, "packages", "opencode", "src", "adapter.ts"), "utf8"),
    ].join("\n");

    expect(sources).not.toMatch(/flowtask\.json/);
    expect(sources).not.toMatch(/presets\//);
  });

  test("rejects an entry without a provider", () => {
    const preset = loadPreset() as { agents: Array<Record<string, unknown>> };
    preset.agents[0] = { agent: preset.agents[0].agent, model: "muse-spark-1.3-contributor" };
    const result = validateMapping(preset);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "agent flowtask-ca-writer: model must be provider/model"
    );
  });
});
