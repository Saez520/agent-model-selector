/// <reference types="bun" />
import { expect, test } from "bun:test";
import { matchAgentKey } from "../packages/claude-code/src/agents";
import type { AgentDefinition } from "../packages/claude-code/src/host";
import { modelKey } from "../packages/claude-code/src/keys";
import { lastObservedSpawn, register } from "../packages/claude-code/hooks/register";

/**
 * G3: the spawn hook must rewrite only the matched agent's spawn, skip
 * fork/resume, survive non-string or empty input and a store read failure.
 * A lookup collision must apply nothing instead of guessing.
 */
test("spawn applies one agent override and never blocks the spawn", async () => {
  const root = "/engine/project";
  const agents = `${root}/.claude/agents`;
  const files = new Map<string, string>([
    [`${agents}/flowtask-planner.md`, "---\nname: FlowTask Planner\n---\n"],
    [`${agents}/flowtask-constructor.md`, "---\nname: FlowTask Constructor\n---\n"],
  ]);
  const directories = new Set([
    "/",
    "/engine",
    root,
    `${root}/.claude`,
    agents,
  ]);

  const fs = {
    async read(path: string) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async list(path: string) {
      if (!directories.has(path)) throw new Error(`ENOENT: ${path}`);
      if (path !== agents) return [];
      return [...files.keys()].map((file) => ({
        name: file.slice(agents.length + 1),
        kind: "file",
      }));
    },
    async exists(path: string) {
      return directories.has(path) || files.has(path);
    },
  };

  const plannerKey = modelKey(root, "flowtask-planner");
  const otherProjectKey = modelKey("/other/project", "flowtask-planner");
  const storeData = new Map<string, unknown>([
    [plannerKey, { model: "haiku" }],
    [otherProjectKey, { model: "fable" }],
  ]);
  let failReads = false;
  const store = {
    async get(key: string) {
      if (failReads) throw new Error("store offline");
      return storeData.get(key);
    },
    async set(key: string, value: unknown) {
      storeData.set(key, value);
    },
    async delete(key: string) {
      storeData.delete(key);
    },
    async keys() {
      return [...storeData.keys()];
    },
  };

  const logs: string[] = [];
  const commands: string[] = [];
  const $ = {
    session: {
      root: async () => root,
      cwd: async () => root,
      model: async () => "claude-sonnet-5-5",
      version: async () => ({ version: "2.1.309", base: "2.1.309" }),
      surfaces: async () => ["terminal"],
    },
    agent: { list: async () => [] },
    store,
    command: {
      list: async () => [],
      register: async (command: { name: string }) => {
        commands.push(command.name);
        return {};
      },
    },
    ui: {
      panes: async () => [],
      log: (message: string) => logs.push(message),
      toast: (message: string) => logs.push(message),
      open: async () => ({}),
      invalidate: () => undefined,
    },
    fs,
    settings: {
      read: async () => ({
        model: "claude-sonnet-5-5",
        availableModels: ["sonnet", "opus", "haiku"],
      }),
    },
    env: {
      get: async () => undefined,
    },
  };

  type Handler = (...args: any[]) => any;
  const handlers = new Map<string, Handler>();
  const on = ((pattern: string, matcherOrHook: any, maybeHook?: any) => {
    const handler =
      typeof matcherOrHook === "function" ? matcherOrHook : maybeHook;
    if (typeof handler !== "function") {
      throw new Error(`no handler for ${pattern}`);
    }
    handlers.set(pattern, handler);
    return { catch: () => undefined };
  }) as any;

  register(on, {} as any);

  const start = handlers.get("session.start");
  expect(start).toBeDefined();
  await start!(
    $,
    { cwd: root, isInteractive: true, surface: "terminal" },
    async (event: any) => event
  );
  expect(commands).toContain("flowtask-model");
  expect(logs).toContain("[flowtask-model] ready (ok)");

  const spawn = handlers.get("agent.spawn");
  expect(spawn).toBeDefined();
  const next = async (event: any) => ({
    model: event.model ?? "invocation",
    agentId: "agent-1",
  });
  const base = {
    tool_use_id: "toolu_test",
    prompt: "Reply OK",
    description: "Test spawn",
    subagentType: "FlowTask Planner",
    provider: { plugin: "project", tier: "user" },
    parentModel: "claude-sonnet-5-5",
    permissionMode: "acceptEdits",
    background: false,
    fork: false,
  };

  const applied = await spawn!($, base, next);
  expect(applied.model).toBe("haiku");
  expect(lastObservedSpawn()).toMatchObject({
    agentKey: "flowtask-planner",
    subagentType: "FlowTask Planner",
    model: "haiku",
  });

  const normalized = await spawn!(
    $,
    { ...base, subagentType: "flowtask-planner" },
    next
  );
  expect(normalized.model).toBe("haiku");

  const suffixed = await spawn!(
    $,
    { ...base, subagentType: "plugin:flowtask-planner" },
    next
  );
  expect(suffixed.model).toBe("haiku");

  const constructor = await spawn!(
    $,
    { ...base, subagentType: "FlowTask Constructor" },
    next
  );
  expect(constructor.model).toBe("invocation");

  const empty = await spawn!($, { ...base, subagentType: "" }, next);
  expect(empty.model).toBe("invocation");

  const nonString = await spawn!($, { ...base, subagentType: 42 }, next);
  expect(nonString.model).toBe("invocation");

  const forked = await spawn!($, { ...base, fork: true }, next);
  expect(forked.model).toBe("invocation");
  expect(
    logs.some((line) => line.includes("fork/resume: model change ignored"))
  ).toBe(true);

  const resumed = await spawn!($, { ...base, resume: true }, next);
  expect(resumed.model).toBe("invocation");

  failReads = true;
  const readFailure = await spawn!($, base, next);
  expect(readFailure.model).toBe("invocation");
  expect(logs.some((line) => line.includes("store read failed"))).toBe(true);
  failReads = false;

  const collisionCatalog: AgentDefinition[] = [
    {
      id: "project:.:FlowTask Planner",
      source: "project",
      scope: ".",
      name: "FlowTask Planner",
      type: "FlowTask Planner",
      file: "/project/flowtask-planner.md",
    },
    {
      id: "user:.:FlowTask Planner",
      source: "user",
      scope: ".",
      name: "FlowTask Planner",
      type: "FlowTask Planner",
      file: "/home/flowtask-planner.md",
    },
  ];
  const collisionLog: string[] = [];
  expect(
    matchAgentKey("FlowTask Planner", collisionCatalog, (message) =>
      collisionLog.push(message)
    )
  ).toBeNull();
  expect(collisionLog.join("\n")).toContain("ambiguous agent match");

  expect(storeData.get(plannerKey)).toEqual({ model: "haiku" });
  expect(storeData.get(otherProjectKey)).toEqual({ model: "fable" });
});
