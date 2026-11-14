/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createAdapter } from "../packages/claude-code/src/adapter";
import type { ClaudeCodeHost, HostStore } from "../packages/claude-code/src/host";
import { modelKey } from "../packages/claude-code/src/keys";

const ROOT = "/tmp/catalog project";
const SONNET_TARGET = "Claude Code API/claude-sonnet-5-5";
const HAIKU_TARGET = "OpenCode Go/glm-5.3-flash";

const PROFILE = {
  env: {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:3456",
    ANTHROPIC_MODEL: "Claude Code API/claude-sonnet-5-5[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "Claude Code API/claude-sonnet-5-5[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "OpenCode Go/glm-5.3-flash[1m]",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "OpenCode Go/glm-5.3[1m]",
  },
  apiKeyHelper: "/opt/ccr/api-key",
};

const GATEWAY = {
  object: "list",
  data: [
    {
      id: SONNET_TARGET,
      owned_by: "Claude Code API",
      display_name: "Claude Sonnet 5.5",
    },
    {
      id: HAIKU_TARGET,
      owned_by: "OpenCode Go",
      display_name: "GLM-5.3-Flash",
    },
    {
      id: "OpenCode Go/glm-5.3",
      owned_by: "OpenCode Go",
      display_name: "GLM-5.3",
    },
    {
      id: "OpenCode Go/deepseek-v4.1-flash",
      owned_by: "OpenCode Go",
      display_name: "DeepSeek V4.1 Flash",
    },
  ],
};

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

function catalogHost(
  store: HostStore,
  options: { fail?: boolean } = {}
): ClaudeCodeHost {
  return {
    projectRoot: async () => ROOT,
    sessionModel: async () => "claude-sonnet-5-5",
    store,
    fs: {
      read: async (path) => {
        throw new Error(`ENOENT: ${path}`);
      },
      list: async () => [],
      exists: async () => false,
    },
    settings: { read: async () => PROFILE },
    httpFetch: async () => {
      if (options.fail === true) {
        throw new Error("gateway request timed out");
      }
      return { status: 200, text: JSON.stringify(GATEWAY) };
    },
    processRun: async () => ({ exitCode: 0, stdout: "test-key\n", stderr: "" }),
  };
}

// gap: G2 — refs provider/model persistidas crudas, targets mostrados mal o imports parciales
test("catalog references persist as short tiers and imports stay atomic", async () => {
  const { store, data } = memoryStore();
  const adapter = createAdapter(catalogHost(store));

  expect(
    (await adapter.listModels()).map((model) => [model.target, model.selection])
  ).toEqual([
    [SONNET_TARGET, "sonnet"],
    [HAIKU_TARGET, "haiku"],
  ]);
  expect(adapter.listProviders().map((provider) => provider.id)).toEqual([
    "Claude Code API",
    "OpenCode Go",
  ]);
  expect(adapter.mainModel()?.target).toBe(SONNET_TARGET);
  expect(adapter.catalogError()).toBeUndefined();
  expect(adapter.selectionValue("haiku")).toBe(HAIKU_TARGET);
  expect(adapter.selectionValue("sonnet")).toBe(SONNET_TARGET);
  expect(adapter.selectionValue("legacy-alias")).toBe("claude-code/legacy-alias");

  await adapter.setAgentModel("FlowTask Planner", HAIKU_TARGET);
  await adapter.setAgentModel(
    "FlowTask Constructor",
    "Claude Code API/claude-sonnet-5-5[1m]"
  );
  await adapter.setAgentModel("FlowTask Runner", "sonnet");
  const plannerKey = modelKey(ROOT, "flowtask-planner");
  const constructorKey = modelKey(ROOT, "flowtask-constructor");
  const runnerKey = modelKey(ROOT, "flowtask-runner");
  expect(data.get(plannerKey)).toMatchObject({ model: "haiku" });
  expect(data.get(constructorKey)).toMatchObject({ model: "sonnet" });
  expect(data.get(runnerKey)).toMatchObject({ model: "sonnet" });
  expect(data.get(plannerKey)).not.toMatchObject({ model: HAIKU_TARGET });

  expect((await adapter.readConfig()).agent).toEqual({
    "flowtask-constructor": { model: "claude-code/sonnet" },
    "flowtask-planner": { model: "claude-code/haiku" },
    "flowtask-runner": { model: "claude-code/sonnet" },
  });
  expect(await adapter.exportMapping()).toEqual({
    agents: [
      { agent: "flowtask-constructor", model: "claude-code/sonnet" },
      { agent: "flowtask-planner", model: "claude-code/haiku" },
      { agent: "flowtask-runner", model: "claude-code/sonnet" },
    ],
  });

  const before = new Map(data);
  await expect(
    adapter.setAgentModel("FlowTask Tester", "OpenCode Go/deepseek-v4.1-flash")
  ).rejects.toThrow("unsupported model");
  await expect(
    adapter.setAgentModel("FlowTask Logger", "Other/provider-model")
  ).rejects.toThrow("unsupported model");
  expect(new Map(data)).toEqual(before);

  const imported = await adapter.importMapping({
    agents: [
      { agent: "flowtask-planner", model: HAIKU_TARGET },
      { agent: "flowtask-constructor", model: "Claude Code API/claude-sonnet-5-5" },
      { agent: "flowtask-tester", inherit: true },
    ],
  });
  expect(imported).toEqual({ valid: true, errors: [], applied: 3 });
  expect(data.get(plannerKey)).toMatchObject({ model: "haiku" });
  expect(data.get(constructorKey)).toMatchObject({ model: "sonnet" });
  expect(data.has(modelKey(ROOT, "flowtask-tester"))).toBe(false);

  const snapshot = Object.fromEntries(data);
  const rejected = await adapter.importMapping({
    agents: [
      { agent: "flowtask-logger", model: HAIKU_TARGET },
      { agent: "flowtask-tester", model: "OpenCode Go/deepseek-v4.1-flash" },
    ],
  });
  expect(rejected.valid).toBe(false);
  expect(rejected.applied).toBe(0);
  expect(rejected.errors).toEqual([
    "agent flowtask-tester: unsupported model OpenCode Go/deepseek-v4.1-flash",
  ]);
  expect(Object.fromEntries(data)).toEqual(snapshot);
  expect(data.has(modelKey(ROOT, "flowtask-logger"))).toBe(false);

  const { store: fallbackStore, data: fallbackData } = memoryStore({
    [plannerKey]: { model: "haiku" },
  });
  const fallback = createAdapter(catalogHost(fallbackStore, { fail: true }));
  expect((await fallback.listModels()).map((model) => model.target)).toEqual([
    SONNET_TARGET,
  ]);
  expect(fallback.catalogError()?.kind).toBe("unreachable");
  await expect(
    fallback.setAgentModel("flowtask-constructor", HAIKU_TARGET)
  ).rejects.toThrow("unsupported model");
  expect(fallbackData.has(constructorKey)).toBe(false);
  expect(await fallback.exportMapping()).toEqual({
    agents: [{ agent: "flowtask-planner", model: "claude-code/haiku" }],
  });
});
