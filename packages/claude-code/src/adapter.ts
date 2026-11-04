import {
  readAgentModel,
  validateMapping,
  type AgentInfo,
  type HostConfig,
  type Mapping,
  type ModelInfo,
  type ProviderInfo,
  type TargetAdapter,
} from "@agent-model-selector/core";
import { dedupeAgents, discoverAgents } from "./agents";
import type { AgentDefinition, ClaudeCodeHost, RuntimeAgent } from "./host";
import { agentKey, keysForRoot, modelKey, normalizeRoot, parseModelKey } from "./keys";
import {
  PROVIDER_ID,
  PROVIDERS,
  listModels as modelsFromAvailable,
  modelRef,
  normalizeModel,
  stripModelRef,
} from "./models";

export interface ImportResult {
  valid: boolean;
  errors: string[];
  applied: number;
}

export interface ClaudeCodeAdapter extends TargetAdapter<HostConfig> {
  readonly id: string;
  readConfig(): Promise<HostConfig>;
  writeConfig(config: HostConfig): Promise<void>;
  listAgents(config: HostConfig): AgentInfo[];
  listProviders(): ProviderInfo[];
  listModels(): Promise<ModelInfo[]>;
  readAgents(): Promise<RuntimeAgent[]>;
  setAgentModel(agentName: string, model: string): Promise<void>;
  clearAgentModel(agentName: string): Promise<void>;
  clearProject(): Promise<number>;
  exportMapping(): Promise<Mapping>;
  importMapping(input: unknown): Promise<ImportResult>;
}

export function readStoredModel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (value && typeof value === "object") {
    const model = (value as { model?: unknown }).model;
    if (typeof model === "string" && model.trim() !== "") return model.trim();
  }
  return undefined;
}

function sortAgents(agents: RuntimeAgent[]): RuntimeAgent[] {
  const order: Record<RuntimeAgent["source"], number> = {
    project: 0,
    user: 1,
    store: 2,
  };
  return agents.sort((left, right) => {
    const bySource = order[left.source] - order[right.source];
    if (bySource !== 0) return bySource;
    return left.type.localeCompare(right.type);
  });
}

/**
 * Build the adapter against the injected host. Every read and write is scoped
 * to the current project root; no other root is enumerated or modified.
 */
export function createAdapter(host: ClaudeCodeHost): ClaudeCodeAdapter {
  let cachedAgents: RuntimeAgent[] = [];

  async function root(): Promise<string> {
    return normalizeRoot(await host.projectRoot());
  }

  async function storedByAgent(): Promise<Map<string, string>> {
    const projectRoot = await root();
    const keys = await host.store.keys();
    const stored = new Map<string, string>();
    for (const key of keysForRoot(keys, projectRoot)) {
      const parsed = parseModelKey(key);
      if (parsed === null) continue;
      const value = await host.store.get(key).catch(() => undefined);
      const model = readStoredModel(value);
      if (model !== undefined) stored.set(parsed.agentKey, model);
    }
    return stored;
  }

  async function readConfig(): Promise<HostConfig> {
    const stored = await storedByAgent();
    const agent: Record<string, { model: string }> = {};
    for (const [key, model] of stored) {
      agent[key] = { model: modelRef(model) };
    }
    const sessionModel = await host.sessionModel().catch(() => undefined);
    return {
      agent,
      ...(typeof sessionModel === "string" && sessionModel.trim() !== ""
        ? { model: sessionModel }
        : {}),
    };
  }

  async function definitions(): Promise<AgentDefinition[]> {
    if (host.agentDefinitions !== undefined) {
      try {
        const provided = await host.agentDefinitions();
        if (provided !== undefined) {
          return dedupeAgents(provided);
        }
      } catch {
        // Fall through to the directory scan.
      }
    }
    const projectRoot = await root();
    const home = await host.homeDir?.().catch(() => undefined);
    return discoverAgents(host.fs, projectRoot, home);
  }

  async function readAgents(): Promise<RuntimeAgent[]> {
    const config = await readConfig();
    const stored = await storedByAgent();
    const discovered = await definitions();
    const seen = new Set<string>();
    const agents: RuntimeAgent[] = [];

    for (const definition of discovered) {
      const key = agentKey(definition.type);
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      const override = readAgentModel(config, key).model;
      agents.push({
        key,
        type: definition.type,
        source: definition.source,
        scope: definition.scope,
        id: definition.id,
        file: definition.file,
        ...(definition.description !== undefined
          ? { description: definition.description }
          : {}),
        ...(override !== undefined
          ? { override: stripModelRef(override) }
          : {}),
        ...(definition.model !== undefined ? { model: definition.model } : {}),
      });
    }

    for (const [key, model] of stored) {
      if (seen.has(key)) continue;
      seen.add(key);
      agents.push({
        key,
        type: key,
        source: "store",
        scope: ".",
        id: `store:.:${key}`,
        override: model,
      });
    }

    cachedAgents = sortAgents(agents);
    return cachedAgents;
  }

  async function setAgentModel(agentName: string, model: string): Promise<void> {
    const projectRoot = await root();
    const key = agentKey(agentName);
    if (key === "") return;
    const normalized = normalizeModel(model);
    if (normalized === null) {
      await host.store.delete(modelKey(projectRoot, key));
      return;
    }
    await host.store.set(modelKey(projectRoot, key), {
      model: normalized,
      updatedAt: new Date().toISOString(),
    });
  }

  async function clearAgentModel(agentName: string): Promise<void> {
    const projectRoot = await root();
    const key = agentKey(agentName);
    if (key === "") return;
    await host.store.delete(modelKey(projectRoot, key));
  }

  async function clearProject(): Promise<number> {
    const projectRoot = await root();
    const keys = keysForRoot(await host.store.keys(), projectRoot);
    for (const key of keys) {
      await host.store.delete(key);
    }
    return keys.length;
  }

  async function writeConfig(config: HostConfig): Promise<void> {
    const projectRoot = await root();
    const current = await storedByAgent();
    const desired = new Map<string, string | null>();

    for (const [agent, entry] of Object.entries(config.agent ?? {})) {
      const key = agentKey(agent);
      if (key === "") continue;
      const model = readAgentModel({ agent: { [agent]: entry } }, agent).model;
      if (typeof model !== "string" || model.trim() === "") {
        desired.set(key, null);
        continue;
      }
      desired.set(key, stripModelRef(model));
    }

    for (const [key, model] of desired) {
      if (model === null) {
        if (current.has(key)) await host.store.delete(modelKey(projectRoot, key));
        continue;
      }
      if (current.get(key) === model) continue;
      await host.store.set(modelKey(projectRoot, key), {
        model,
        updatedAt: new Date().toISOString(),
      });
    }

    for (const key of current.keys()) {
      if (!desired.has(key)) {
        await host.store.delete(modelKey(projectRoot, key));
      }
    }
  }

  async function exportMapping(): Promise<Mapping> {
    const config = await readConfig();
    const agents = Object.keys(config.agent ?? {})
      .sort()
      .flatMap((agent) => {
        const model = readAgentModel(config, agent).model;
        if (typeof model !== "string" || model.trim() === "") return [];
        return [{ agent: agentKey(agent), model: modelRef(stripModelRef(model)) }];
      });
    return { agents };
  }

  async function importMapping(input: unknown): Promise<ImportResult> {
    const validation = validateMapping(input);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors, applied: 0 };
    }

    const errors: string[] = [];
    const operations: { agent: string; model: string | null }[] = [];
    for (const entry of validation.mapping.agents) {
      if (entry.inherit === true || entry.model === undefined) {
        operations.push({ agent: entry.agent, model: null });
        continue;
      }
      if (!entry.model.startsWith(`${PROVIDER_ID}/`)) {
        errors.push(`agent ${entry.agent}: model must use ${PROVIDER_ID}/<model>`);
        continue;
      }
      operations.push({
        agent: entry.agent,
        model: stripModelRef(entry.model),
      });
    }

    if (errors.length > 0) {
      return { valid: false, errors, applied: 0 };
    }

    for (const operation of operations) {
      if (operation.model === null) {
        await clearAgentModel(operation.agent);
      } else {
        await setAgentModel(operation.agent, operation.model);
      }
    }
    return { valid: true, errors: [], applied: operations.length };
  }

  return {
    id: PROVIDER_ID,
    readConfig,
    writeConfig,
    listAgents(config) {
      const overrides = config.agent ?? {};
      return cachedAgents.map((agent) => {
        const override = readAgentModel(
          { agent: { [agent.key]: overrides[agent.key] } },
          agent.key
        ).model;
        const model =
          override ??
          (agent.override !== undefined
            ? modelRef(agent.override)
            : agent.model !== undefined
              ? modelRef(agent.model)
              : undefined);
        return {
          id: agent.id,
          name: agent.type,
          ...(model !== undefined ? { model } : {}),
          key: agent.key,
          type: agent.type,
          source: agent.source,
          scope: agent.scope,
          ...(agent.file !== undefined ? { file: agent.file } : {}),
        };
      });
    },
    listProviders() {
      return PROVIDERS;
    },
    async listModels() {
      const available = await host.availableModels().catch(() => undefined);
      return modelsFromAvailable(available);
    },
    readAgents,
    setAgentModel,
    clearAgentModel,
    clearProject,
    exportMapping,
    importMapping,
  };
}
