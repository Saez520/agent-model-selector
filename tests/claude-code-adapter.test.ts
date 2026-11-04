/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createAdapter } from "../packages/claude-code/src/adapter";
import type { ClaudeCodeHost, HostStore } from "../packages/claude-code/src/host";
import { modelKey } from "../packages/claude-code/src/keys";

const PROJECT_A = "/tmp/project alpha";
const PROJECT_B = "/tmp/project beta";

function memoryStore(initial: Record<string, unknown> = {}): {
  store: HostStore;
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    store: {
      async get(key) {
        return data.get(key);
      },
      async set(key, value) {
        data.set(key, value);
      },
      async delete(key) {
        data.delete(key);
      },
      async keys() {
        return [...data.keys()];
      },
    },
  };
}

function hostFor(root: string, store: HostStore): ClaudeCodeHost {
  return {
    projectRoot: async () => root,
    sessionModel: async () => "claude-sonnet-5-5",
    availableModels: async () => undefined,
    store,
    fs: {
      read: async () => {
        throw new Error("the adapter test host does not read agent files");
      },
      list: async () => [],
      exists: async () => false,
    },
  };
}

/**
 * G1: the adapter must apply the synthetic `claude-code/` provider, write only
 * the keys that differ for the current project, delete cleared keys without
 * touching another project and reject invalid imports before writing.
 */
test("adapter scopes overrides to one project and applies them through the core", async () => {
  const plannerA = modelKey(PROJECT_A, "flowtask-planner");
  const constructorA = modelKey(PROJECT_A, "flowtask-constructor");
  const plannerB = modelKey(PROJECT_B, "flowtask-planner");
  const foreign = "another-plugin:v1:key";

  const { store, data } = memoryStore({
    [plannerA]: { model: "opus", updatedAt: "2026-11-04T00:00:00.000Z" },
    [constructorA]: { model: "haiku" },
    [plannerB]: { model: "fable" },
    [foreign]: { model: "sonnet" },
  });
  const adapter = createAdapter(hostFor(PROJECT_A, store));

  expect(await adapter.readConfig()).toEqual({
    model: "claude-sonnet-5-5",
    agent: {
      "flowtask-planner": { model: "claude-code/opus" },
      "flowtask-constructor": { model: "claude-code/haiku" },
    },
  });

  // A diff write sets the requested agent and deletes the agent that left the
  // configuration, while the other project and foreign keys stay untouched.
  await adapter.writeConfig({
    agent: { "FlowTask Planner": { model: "claude-code/sonnet" } },
  });
  expect(data.get(plannerA)).toMatchObject({ model: "sonnet" });
  expect(data.has(constructorA)).toBe(false);
  expect(data.get(plannerB)).toEqual({ model: "fable" });
  expect(data.get(foreign)).toEqual({ model: "sonnet" });
  expect(await adapter.exportMapping()).toEqual({
    agents: [{ agent: "flowtask-planner", model: "claude-code/sonnet" }],
  });

  // Invalid mappings are reported with the core errors and produce no writes.
  const before = Object.fromEntries(data);
  const invalid = await adapter.importMapping({
    agents: [{ agent: "flowtask-planner", model: "without-provider" }],
  });
  expect(invalid.valid).toBe(false);
  expect(invalid.applied).toBe(0);
  expect(invalid.errors).toContain(
    "agent flowtask-planner: model must be provider/model"
  );
  expect(Object.fromEntries(data)).toEqual(before);

  // A valid mapping with a foreign provider is also rejected atomically.
  const foreignProvider = await adapter.importMapping({
    agents: [{ agent: "flowtask-planner", model: "opencode/opus" }],
  });
  expect(foreignProvider.valid).toBe(false);
  expect(foreignProvider.applied).toBe(0);
  expect(foreignProvider.errors).toContain(
    "agent flowtask-planner: model must use claude-code/<model>"
  );
  expect(Object.fromEntries(data)).toEqual(before);

  // A valid mapping sets one agent and clears another; `inherit` is a delete.
  const imported = await adapter.importMapping({
    agents: [
      { agent: "flowtask-planner", model: "claude-code/fable" },
      { agent: "flowtask-constructor", inherit: true },
    ],
  });
  expect(imported).toEqual({ valid: true, errors: [], applied: 2 });
  expect(data.get(plannerA)).toMatchObject({ model: "fable" });
  expect(data.has(constructorA)).toBe(false);
  expect(data.get(plannerB)).toEqual({ model: "fable" });

  await adapter.clearAgentModel("FlowTask Planner");
  expect(data.has(plannerA)).toBe(false);
  expect(data.get(plannerB)).toEqual({ model: "fable" });
  expect(await adapter.readConfig()).toEqual({
    model: "claude-sonnet-5-5",
    agent: {},
  });

  await adapter.setAgentModel("flowtask-planner", "haiku");
  await adapter.setAgentModel("flowtask-constructor", "opus");
  expect(await adapter.clearProject()).toBe(2);
  expect(await adapter.readConfig()).toEqual({
    model: "claude-sonnet-5-5",
    agent: {},
  });
  expect(data.get(plannerB)).toEqual({ model: "fable" });
  expect(data.get(foreign)).toEqual({ model: "sonnet" });
});
