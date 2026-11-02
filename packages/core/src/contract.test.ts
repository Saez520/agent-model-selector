import { describe, expect, test } from "bun:test";
import {
  readAgentModel,
  removeAgentModel,
  type AgentEntry,
  type AgentInfo,
  type HostConfig,
  type Mapping,
  type ModelRef,
  type TargetAdapter,
} from "./index";

describe("public types", () => {
  test("are usable by a host-agnostic consumer", () => {
    const ref: ModelRef = { providerID: "anthropic", id: "claude-opus", variant: "high" };
    const entry: AgentEntry = { model: `${ref.providerID}/${ref.id}`, variant: ref.variant };
    const mapping: Mapping = { agents: [{ agent: "planner", model: entry.model as string }] };

    expect(mapping.agents).toHaveLength(1);
    expect(entry.variant).toBe("high");
  });
});

describe("TargetAdapter contract", () => {
  test("is implementable without importing a concrete host", async () => {
    const adapter = {
      id: "fixture",
      readConfig: () => ({ agent: { planner: { model: "anthropic/opus" } } }),
      writeConfig: (_config: HostConfig) => {},
      listAgents: (config: HostConfig): AgentInfo[] =>
        Object.entries(config.agent ?? {}).map(([id, agent]) => ({ id, model: agent.model })),
      listProviders: async () => [{ id: "anthropic", name: "Anthropic" }],
      listModels: () => [{ providerID: "anthropic", id: "opus" }],
    } satisfies TargetAdapter;

    expect(adapter.id).toBe("fixture");
    expect(adapter.listAgents(adapter.readConfig())).toEqual([
      { id: "planner", model: "anthropic/opus" },
    ]);
    expect(await adapter.listProviders()).toHaveLength(1);
    expect(adapter.listModels()).toHaveLength(1);
    expect(() => adapter.writeConfig({})).not.toThrow();
  });
});

describe("missing agents", () => {
  test("readAgentModel returns an empty override for an unknown agent", () => {
    expect(readAgentModel({ agent: { planner: {} } }, "missing")).toEqual({});
    expect(readAgentModel({}, "missing")).toEqual({});
  });

  test("removeAgentModel is a no-op for an unknown agent", () => {
    const config = {
      model: "openai/gpt-4",
      agent: { planner: { model: "anthropic/opus", variant: "high" } },
    };
    const result = removeAgentModel(config, "missing");
    expect(result).toEqual(config);
    expect(result).not.toBe(config);
  });
});
