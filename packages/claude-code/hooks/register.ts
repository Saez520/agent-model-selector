import type { EngineInterface, On, PluginOptions } from "claude-code";
import { createAdapter, readStoredModel } from "../src/adapter";
import { matchAgentKey } from "../src/agents";
import {
  evaluateGate,
  panelAvailable,
  type GateApi,
} from "../src/capabilities";
import type { ClaudeCodeHost, SpawnRecord } from "../src/host";
import { modelKey, normalizeRoot } from "../src/keys";
import { PROVIDERS, listModels as modelsFromAvailable, normalizeAvailable } from "../src/models";
import { MIN_VERSION, versionOf } from "../src/version";
import { handleCommand } from "./commands";
import { renderPanel } from "./panel";
import { logLine, type Runtime } from "./runtime";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bind the engine surface. Every call is spelled `$.noun.event(...)` here so
 * the engine can read what the module uses before it runs.
 */
function hostOf($: EngineInterface, fallbackCwd: string): ClaudeCodeHost {
  return {
    projectRoot: async () => {
      try {
        return normalizeRoot(await $.session.root());
      } catch {
        return normalizeRoot(fallbackCwd);
      }
    },
    homeDir: async () => {
      try {
        const home = await $.env.get("HOME");
        if (typeof home === "string" && home.trim() !== "") return home;
      } catch {
        // Fall back to the Windows variable.
      }
      try {
        const profile = await $.env.get("USERPROFILE");
        if (typeof profile === "string" && profile.trim() !== "") return profile;
      } catch {
        // No user home on this surface.
      }
      return undefined;
    },
    sessionModel: async () => {
      try {
        const model = await $.session.model();
        return typeof model === "string" && model.trim() !== "" ? model : undefined;
      } catch {
        return undefined;
      }
    },
    store: {
      get: (key) => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: (key) => $.store.delete(key),
      keys: async () => [...(await $.store.keys())],
    },
    fs: {
      read: (path) => $.fs.read(path),
      list: (path) => $.fs.list(path),
      exists: (path) => $.fs.exists(path),
    },
    availableModels: async () => {
      try {
        const settings = await $.settings.read();
        const value =
          settings && typeof settings === "object"
            ? (settings as Record<string, unknown>).availableModels
            : undefined;
        return normalizeAvailable(value);
      } catch {
        return undefined;
      }
    },
    recordLastSpawn: (record) => {
      lastSpawn = record;
    },
  };
}

let runtime: Runtime | null = null;
let resumeLogged = false;
let lastSpawn: SpawnRecord | null = null;

async function refreshRuntime(): Promise<void> {
  const current = runtime;
  if (current === null) return;
  try {
    current.agents = await current.adapter.readAgents();
    current.models = await current.adapter.listModels();
    current.providers = await current.adapter.listProviders();
    current.sessionModel = await current.host.sessionModel();
  } catch (error) {
    current.log(`[flowtask-model] refresh failed: ${reasonOf(error)}`);
  }
}

/**
 * Register the Mod. `session.start` binds the engine, decides the gate and
 * declares `/flowtask-model`; the remaining hooks read that binding.
 */
export function register(on: On, raw: PluginOptions): void {
  void raw;

  on("session.start", async ($, e, next) => {
    const cwd = typeof e?.cwd === "string" ? e.cwd : "";
    const host = hostOf($, cwd);
    const adapter = createAdapter(host);
    const versionInput = await $.session.version().catch(() => undefined);
    const version = versionOf(versionInput);

    const api: GateApi = {};
    try {
      await $.agent.list();
      api.agentSpawn = true;
    } catch {
      api.agentSpawn = false;
    }
    try {
      await $.store.keys();
      api.store = true;
    } catch {
      api.store = false;
    }
    try {
      await $.command.list();
      api.command = true;
    } catch {
      api.command = false;
    }
    try {
      await $.ui.panes();
      api.ui = true;
    } catch {
      api.ui = false;
    }
    try {
      await $.fs.exists(".");
      api.fs = true;
    } catch {
      api.fs = false;
    }
    try {
      await $.settings.read();
      api.settingsRead = true;
    } catch {
      api.settingsRead = false;
    }

    const gate = evaluateGate(versionInput, api);
    const root = await host.projectRoot().catch(() => normalizeRoot(cwd));

    let hasSurface = e?.isInteractive === true;
    try {
      const surfaces = await $.session.surfaces();
      hasSurface = hasSurface || surfaces.length > 0;
    } catch {
      // Older engines do not expose the surface roster; isInteractive decides.
    }

    runtime = {
      host,
      adapter,
      root,
      sessionModel: undefined,
      version,
      gate,
      agents: [],
      models: modelsFromAvailable(undefined),
      providers: PROVIDERS,
      isPanelAvailable: panelAvailable(api) && hasSurface,
      refresh: refreshRuntime,
      log: (message) => logLine($, message),
    };

    if (gate.status === "blocked") {
      logLine(
        $,
        `[flowtask-model] disabled: ${gate.reason}; requires Claude Code >= ${MIN_VERSION}`
      );
      return next(e);
    }

    try {
      await $.command.register({
        name: "flowtask-model",
        description: "View, set or clear the model each agent uses",
        argumentHint:
          "[list | set <agent-key> <model> | clear <agent-key> | clear --all | export | import <path>]",
        immediate: true,
      });
    } catch (error) {
      logLine($, `[flowtask-model] command unavailable: ${reasonOf(error)}`);
    }

    await refreshRuntime();
    logLine($, `[flowtask-model] ready (${gate.status})`);
    return next(e);
  });

  on("agent.spawn", async ($, e, next) => {
    const current = runtime;
    if (current === null || current.gate === null || current.gate.status === "blocked") {
      return next(e);
    }

    const subagentType =
      typeof e?.subagentType === "string" ? e.subagentType.trim() : "";
    if (subagentType === "") return next(e);

    const resume = (e as { resume?: unknown }).resume;
    if (e?.fork === true || resume === true) {
      if (!resumeLogged) {
        resumeLogged = true;
        current.log("[flowtask-model] fork/resume: model change ignored");
      }
      return next(e);
    }

    let key: string | null = null;
    try {
      key = matchAgentKey(subagentType, current.agents, (message) =>
        current.log(`[flowtask-model] ${message}`)
      );
    } catch (error) {
      current.log(`[flowtask-model] agent match failed: ${reasonOf(error)}`);
      return next(e);
    }
    if (key === null) return next(e);

    let model: string | undefined;
    try {
      const stored = await $.store.get(modelKey(current.root, key));
      model = readStoredModel(stored);
    } catch (error) {
      current.log(`[flowtask-model] store read failed: ${reasonOf(error)}`);
      return next(e);
    }
    if (model === undefined) return next(e);

    try {
      current.log(`[flowtask-model] spawn ${subagentType} -> ${model}`);
      const result = await next({ ...e, model });
      current.host.recordLastSpawn?.({
        agentKey: key,
        subagentType,
        model,
        observedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      current.log(`[flowtask-model] spawn rewrite failed: ${reasonOf(error)}`);
      return { model };
    }
  }).catch((_$, e, next) => next(e));

  on("command.run", { command: "flowtask-model" }, async ($, e) => {
    const current = runtime;
    if (current === null) {
      return { text: "[flowtask-model] not ready" };
    }
    return handleCommand($, e, current);
  });

  on("ui.render", { component: "Pane" }, async ($, e, next) => {
    const current = runtime;
    if (current === null) return next(e);
    return renderPanel($, e, current, next);
  });
}

/**
 * The last spawn the Mod observed, for diagnostics and tests.
 */
export function lastObservedSpawn(): SpawnRecord | null {
  return lastSpawn;
}
