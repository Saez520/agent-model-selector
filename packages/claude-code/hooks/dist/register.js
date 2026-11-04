// ../core/src/types.ts
var CLEAR_SENTINEL = "__agent_model_selector_clear__";
// ../core/src/mapping.ts
function buildModelOptions(models, providers = []) {
  const options = [
    {
      title: "(hereda del runner — sin override)",
      value: CLEAR_SENTINEL,
      description: "elimina agent.{name}.model"
    }
  ];
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name ?? provider.id]));
  for (const model of models ?? []) {
    const providerID = model?.providerID;
    const id = model?.id ?? model?.modelID;
    if (typeof providerID !== "string" || !providerID || typeof id !== "string" || !id)
      continue;
    options.push({
      title: model.name ?? model.modelID ?? model.id ?? `${providerID}/${id}`,
      value: `${providerID}/${id}`,
      description: providerNames.get(providerID) ?? providerID
    });
  }
  return options;
}
function readAgentModel(config, agentName) {
  const agent = config?.agent?.[agentName];
  const result = {};
  if (typeof agent?.model === "string") {
    result.model = agent.model;
  } else if (agent?.model && typeof agent.model === "object" && typeof agent.model.providerID === "string" && typeof (agent.model.id ?? agent.model.model) === "string") {
    const ref = agent.model;
    result.model = `${ref.providerID}/${ref.id ?? ref.model}`;
  }
  if (typeof agent?.variant === "string") {
    result.variant = agent.variant;
  } else if (agent?.model && typeof agent.model === "object" && typeof agent.model.variant === "string") {
    result.variant = agent.model.variant;
  }
  return result;
}
function validateMapping(input) {
  const errors = [];
  const mapping = { agents: [] };
  const rawAgents = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray(input.agents) ? input.agents : null;
  if (!rawAgents) {
    errors.push("mapping must be an object with an agents array");
    return { valid: false, errors, mapping };
  }
  const seen = new Set;
  for (const [index, entry] of rawAgents.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`agents[${index}] must be an object`);
      continue;
    }
    const candidate = entry;
    const agent = typeof candidate.agent === "string" ? candidate.agent : "";
    if (agent.trim() === "") {
      errors.push(`agents[${index}].agent is required`);
      continue;
    }
    if (seen.has(agent)) {
      errors.push(`duplicate agent: ${agent}`);
      continue;
    }
    seen.add(agent);
    if (candidate.inherit === true) {
      mapping.agents.push({ agent, inherit: true });
      continue;
    }
    if (typeof candidate.model !== "string" || candidate.model.trim() === "") {
      errors.push(`agent ${agent}: model is required`);
      continue;
    }
    const separator = candidate.model.indexOf("/");
    const providerID = separator > 0 ? candidate.model.slice(0, separator) : "";
    const modelID = separator > 0 ? candidate.model.slice(separator + 1) : "";
    if (!providerID.trim() || !modelID.trim()) {
      errors.push(`agent ${agent}: model must be provider/model`);
      continue;
    }
    if (candidate.variant !== undefined && typeof candidate.variant !== "string") {
      errors.push(`agent ${agent}: variant must be a string`);
      continue;
    }
    mapping.agents.push({
      agent,
      model: candidate.model,
      ...candidate.variant !== undefined ? { variant: candidate.variant } : {}
    });
  }
  return { valid: errors.length === 0, errors, mapping };
}
// src/keys.ts
var MODEL_KEY_PREFIX = "flowtask-model:v1:";
function normalizeRoot(root) {
  if (typeof root !== "string")
    return "";
  let value = root.trim().replace(/\\/g, "/");
  if (value === "")
    return "";
  const isUnc = value.startsWith("//");
  value = value.replace(/\/+/g, "/");
  if (isUnc)
    value = `/${value}`;
  if (/^[A-Za-z]:\/$/.test(value))
    return value;
  if (value.length > 1 && value.endsWith("/"))
    value = value.slice(0, -1);
  return value;
}
function agentKey(name) {
  if (typeof name !== "string")
    return "";
  const folded = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return folded;
}
function modelKey(root, agent) {
  const normalizedRoot = normalizeRoot(root);
  const normalizedAgent = agentKey(agent);
  return `${MODEL_KEY_PREFIX}${encodeURIComponent(normalizedRoot)}:${normalizedAgent}`;
}
function parseModelKey(key) {
  if (typeof key !== "string" || !key.startsWith(MODEL_KEY_PREFIX))
    return null;
  const rest = key.slice(MODEL_KEY_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1)
    return null;
  const encodedRoot = rest.slice(0, separator);
  const keyPart = rest.slice(separator + 1);
  if (keyPart === "")
    return null;
  let root;
  try {
    root = decodeURIComponent(encodedRoot);
  } catch {
    return null;
  }
  return { root: normalizeRoot(root), agentKey: keyPart };
}
function keysForRoot(keys, root) {
  const normalized = normalizeRoot(root);
  return keys.filter((key) => {
    const parsed = parseModelKey(key);
    return parsed !== null && parsed.root === normalized;
  });
}

// src/agents.ts
var MAX_DEPTH = 4;
function joinPath(root, ...parts) {
  const base = normalizeRoot(root);
  const tail = parts.filter((part) => typeof part === "string" && part.trim() !== "").map((part) => part.replace(/^\/+|\/+$/g, "")).filter((part) => part !== "").join("/");
  if (tail === "")
    return base;
  return base.endsWith("/") ? `${base}${tail}` : `${base}/${tail}`;
}
function baseName(path) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}
function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function parseAgentFrontmatter(text) {
  if (typeof text !== "string")
    return { present: false };
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, `
`);
  const lines = normalized.split(`
`);
  let start = -1;
  for (let index = 0;index < lines.length; index += 1) {
    if (lines[index].trim() === "")
      continue;
    if (lines[index].trim() === "---")
      start = index;
    break;
  }
  if (start < 0)
    return { present: false };
  let end = -1;
  for (let index = start + 1;index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end < 0)
    return { present: false };
  const result = { present: true };
  for (let index = start + 1;index < end; index += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[index]);
    if (!match)
      continue;
    const key = match[1].toLowerCase();
    const value = stripQuotes(match[2]);
    if (value === "")
      continue;
    if (key === "name")
      result.name = value;
    else if (key === "description")
      result.description = value;
    else if (key === "model")
      result.model = value;
  }
  return result;
}
async function scanDirectory(fs, directory, source, scope, depth, log) {
  if (depth > MAX_DEPTH)
    return [];
  let entries;
  try {
    entries = await fs.list(directory);
  } catch {
    return [];
  }
  const files = entries.filter((entry) => entry.kind === "file" && !entry.isLink && entry.name.toLowerCase().endsWith(".md")).sort((left, right) => left.name.localeCompare(right.name));
  const definitions = [];
  for (const entry of files) {
    const file = joinPath(directory, entry.name);
    let text;
    try {
      text = await fs.read(file);
    } catch (error) {
      log?.(`skip ${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const frontmatter = parseAgentFrontmatter(text);
    if (!frontmatter.present) {
      log?.(`skip ${file}: no frontmatter`);
      continue;
    }
    const type = (frontmatter.name ?? baseName(entry.name).replace(/\.md$/i, "")).trim();
    if (type === "") {
      log?.(`skip ${file}: empty agent name`);
      continue;
    }
    definitions.push({
      id: `${source}:${scope}:${type}`,
      source,
      scope,
      name: type,
      type,
      file,
      ...frontmatter.description !== undefined ? { description: frontmatter.description } : {},
      ...frontmatter.model !== undefined ? { model: frontmatter.model } : {}
    });
  }
  const directories = entries.filter((entry) => entry.kind === "dir" && !entry.isLink).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of directories) {
    const childScope = scope === "." ? entry.name : `${scope}/${entry.name}`;
    definitions.push(...await scanDirectory(fs, joinPath(directory, entry.name), source, childScope, depth + 1, log));
  }
  return definitions;
}
function dedupeAgents(definitions, log) {
  const byKey = new Map;
  const result = [];
  for (const definition of definitions) {
    const key = agentKey(definition.type);
    if (key === "")
      continue;
    const existing = byKey.get(key);
    if (existing === undefined) {
      const copy = { ...definition };
      byKey.set(key, copy);
      result.push(copy);
      continue;
    }
    existing.shadowedBy = existing.shadowedBy === undefined ? definition.file : `${existing.shadowedBy}, ${definition.file}`;
    log?.(`shadowed ${definition.file} by ${existing.file}`);
  }
  return result;
}
async function discoverAgents(fs, projectRoot, homeDir, options = {}) {
  const definitions = [];
  const projectDirectory = joinPath(projectRoot, ".claude", "agents");
  definitions.push(...await scanDirectory(fs, projectDirectory, "project", ".", 0, options.log));
  if (typeof homeDir === "string" && homeDir.trim() !== "") {
    const userDirectory = joinPath(homeDir, ".claude", "agents");
    definitions.push(...await scanDirectory(fs, userDirectory, "user", ".", 0, options.log));
  } else {
    options.log?.("user agent directory unavailable; project agents only");
  }
  return dedupeAgents(definitions, options.log);
}
function uniqueKey(candidates, log) {
  if (candidates.length === 0)
    return null;
  if (candidates.length === 1)
    return agentKey(candidates[0].type);
  log?.(`ambiguous agent match: ${candidates.map((item) => item.file).join(", ")}`);
  return null;
}
function matchAgentKey(subagentType, catalog2, log) {
  const requested = typeof subagentType === "string" ? subagentType.trim() : "";
  if (requested === "")
    return null;
  const exact = catalog2.filter((definition) => definition.type === requested);
  if (exact.length > 0)
    return uniqueKey(exact, log);
  const normalized = agentKey(requested);
  if (normalized === "")
    return null;
  const byNormalized = catalog2.filter((definition) => agentKey(definition.type) === normalized);
  if (byNormalized.length > 0)
    return uniqueKey(byNormalized, log);
  const separator = requested.lastIndexOf(":");
  if (separator >= 0 && separator < requested.length - 1) {
    const suffix = agentKey(requested.slice(separator + 1));
    if (suffix !== "") {
      const bySuffix = catalog2.filter((definition) => agentKey(definition.type) === suffix);
      if (bySuffix.length > 0)
        return uniqueKey(bySuffix, log);
    }
  }
  return null;
}

// src/models.ts
var PROVIDER_ID = "claude-code";
var PROVIDER_NAME = "Claude Code";
var ALIASES = ["sonnet", "opus", "haiku", "fable"];
var PROVIDERS = [{ id: PROVIDER_ID, name: PROVIDER_NAME }];
function modelRef(model) {
  if (model.startsWith(`${PROVIDER_ID}/`))
    return model;
  return `${PROVIDER_ID}/${model}`;
}
function stripModelRef(ref) {
  return ref.startsWith(`${PROVIDER_ID}/`) ? ref.slice(PROVIDER_ID.length + 1) : ref;
}
function normalizeAvailable(value) {
  if (!Array.isArray(value))
    return;
  const names = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      const name = entry.trim();
      if (!names.includes(name))
        names.push(name);
    }
  }
  return names.length > 0 ? names : undefined;
}
function listModels(available) {
  const names = normalizeAvailable(available) ?? [...ALIASES];
  return names.map((name) => ({
    providerID: PROVIDER_ID,
    id: name,
    modelID: name,
    name
  }));
}
function isInherit(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "inherit";
}
function normalizeModel(value) {
  if (typeof value !== "string")
    return null;
  const trimmed = value.trim();
  if (trimmed === "" || isInherit(trimmed))
    return null;
  if (trimmed === CLEAR_SENTINEL)
    return null;
  return stripModelRef(trimmed);
}

// src/adapter.ts
function readStoredModel(value) {
  if (typeof value === "string" && value.trim() !== "")
    return value.trim();
  if (value && typeof value === "object") {
    const model = value.model;
    if (typeof model === "string" && model.trim() !== "")
      return model.trim();
  }
  return;
}
function sortAgents(agents) {
  const order = {
    project: 0,
    user: 1,
    store: 2
  };
  return agents.sort((left, right) => {
    const bySource = order[left.source] - order[right.source];
    if (bySource !== 0)
      return bySource;
    return left.type.localeCompare(right.type);
  });
}
function createAdapter(host) {
  let cachedAgents = [];
  async function root() {
    return normalizeRoot(await host.projectRoot());
  }
  async function storedByAgent() {
    const projectRoot = await root();
    const keys = await host.store.keys();
    const stored = new Map;
    for (const key of keysForRoot(keys, projectRoot)) {
      const parsed = parseModelKey(key);
      if (parsed === null)
        continue;
      const value = await host.store.get(key).catch(() => {
        return;
      });
      const model = readStoredModel(value);
      if (model !== undefined)
        stored.set(parsed.agentKey, model);
    }
    return stored;
  }
  async function readConfig() {
    const stored = await storedByAgent();
    const agent = {};
    for (const [key, model] of stored) {
      agent[key] = { model: modelRef(model) };
    }
    const sessionModel = await host.sessionModel().catch(() => {
      return;
    });
    return {
      agent,
      ...typeof sessionModel === "string" && sessionModel.trim() !== "" ? { model: sessionModel } : {}
    };
  }
  async function definitions() {
    if (host.agentDefinitions !== undefined) {
      try {
        const provided = await host.agentDefinitions();
        if (provided !== undefined) {
          return dedupeAgents(provided);
        }
      } catch {}
    }
    const projectRoot = await root();
    const home = await host.homeDir?.().catch(() => {
      return;
    });
    return discoverAgents(host.fs, projectRoot, home);
  }
  async function readAgents() {
    const config = await readConfig();
    const stored = await storedByAgent();
    const discovered = await definitions();
    const seen = new Set;
    const agents = [];
    for (const definition of discovered) {
      const key = agentKey(definition.type);
      if (key === "" || seen.has(key))
        continue;
      seen.add(key);
      const override = readAgentModel(config, key).model;
      agents.push({
        key,
        type: definition.type,
        source: definition.source,
        scope: definition.scope,
        id: definition.id,
        file: definition.file,
        ...definition.description !== undefined ? { description: definition.description } : {},
        ...override !== undefined ? { override: stripModelRef(override) } : {},
        ...definition.model !== undefined ? { model: definition.model } : {}
      });
    }
    for (const [key, model] of stored) {
      if (seen.has(key))
        continue;
      seen.add(key);
      agents.push({
        key,
        type: key,
        source: "store",
        scope: ".",
        id: `store:.:${key}`,
        override: model
      });
    }
    cachedAgents = sortAgents(agents);
    return cachedAgents;
  }
  async function setAgentModel(agentName, model) {
    const projectRoot = await root();
    const key = agentKey(agentName);
    if (key === "")
      return;
    const normalized = normalizeModel(model);
    if (normalized === null) {
      await host.store.delete(modelKey(projectRoot, key));
      return;
    }
    await host.store.set(modelKey(projectRoot, key), {
      model: normalized,
      updatedAt: new Date().toISOString()
    });
  }
  async function clearAgentModel(agentName) {
    const projectRoot = await root();
    const key = agentKey(agentName);
    if (key === "")
      return;
    await host.store.delete(modelKey(projectRoot, key));
  }
  async function clearProject() {
    const projectRoot = await root();
    const keys = keysForRoot(await host.store.keys(), projectRoot);
    for (const key of keys) {
      await host.store.delete(key);
    }
    return keys.length;
  }
  async function writeConfig(config) {
    const projectRoot = await root();
    const current = await storedByAgent();
    const desired = new Map;
    for (const [agent, entry] of Object.entries(config.agent ?? {})) {
      const key = agentKey(agent);
      if (key === "")
        continue;
      const model = readAgentModel({ agent: { [agent]: entry } }, agent).model;
      if (typeof model !== "string" || model.trim() === "") {
        desired.set(key, null);
        continue;
      }
      desired.set(key, stripModelRef(model));
    }
    for (const [key, model] of desired) {
      if (model === null) {
        if (current.has(key))
          await host.store.delete(modelKey(projectRoot, key));
        continue;
      }
      if (current.get(key) === model)
        continue;
      await host.store.set(modelKey(projectRoot, key), {
        model,
        updatedAt: new Date().toISOString()
      });
    }
    for (const key of current.keys()) {
      if (!desired.has(key)) {
        await host.store.delete(modelKey(projectRoot, key));
      }
    }
  }
  async function exportMapping() {
    const config = await readConfig();
    const agents = Object.keys(config.agent ?? {}).sort().flatMap((agent) => {
      const model = readAgentModel(config, agent).model;
      if (typeof model !== "string" || model.trim() === "")
        return [];
      return [{ agent: agentKey(agent), model: modelRef(stripModelRef(model)) }];
    });
    return { agents };
  }
  async function importMapping(input) {
    const validation = validateMapping(input);
    if (!validation.valid) {
      return { valid: false, errors: validation.errors, applied: 0 };
    }
    const errors = [];
    const operations = [];
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
        model: stripModelRef(entry.model)
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
        const override = readAgentModel({ agent: { [agent.key]: overrides[agent.key] } }, agent.key).model;
        const model = override ?? (agent.override !== undefined ? modelRef(agent.override) : agent.model !== undefined ? modelRef(agent.model) : undefined);
        return {
          id: agent.id,
          name: agent.type,
          ...model !== undefined ? { model } : {},
          key: agent.key,
          type: agent.type,
          source: agent.source,
          scope: agent.scope,
          ...agent.file !== undefined ? { file: agent.file } : {}
        };
      });
    },
    listProviders() {
      return PROVIDERS;
    },
    async listModels() {
      const available = await host.availableModels().catch(() => {
        return;
      });
      return listModels(available);
    },
    readAgents,
    setAgentModel,
    clearAgentModel,
    clearProject,
    exportMapping,
    importMapping
  };
}

// src/version.ts
var MIN_VERSION = "2.1.287";
var RECOMMENDED_VERSION = "2.1.299";
function versionOf(input) {
  if (typeof input === "string") {
    const trimmed = input.trim().replace(/^v/i, "");
    return trimmed === "" ? undefined : trimmed;
  }
  if (input && typeof input === "object") {
    const candidate = input;
    if (typeof candidate.version === "string" && candidate.version.trim() !== "") {
      return candidate.version.trim().replace(/^v/i, "");
    }
    if (typeof candidate.base === "string" && candidate.base.trim() !== "") {
      return candidate.base.trim().replace(/^v/i, "");
    }
  }
  return;
}
function numericSegments(version) {
  return version.split("-")[0].split(".").map((segment) => {
    const value = Number.parseInt(segment, 10);
    return Number.isFinite(value) ? value : 0;
  });
}
function compareVersions(a, b) {
  const left = numericSegments(a);
  const right = numericSegments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0;index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue)
      return leftValue - rightValue;
  }
  return 0;
}

// src/capabilities.ts
function blocked(reason, version) {
  return {
    status: "blocked",
    reason,
    version,
    minVersion: MIN_VERSION,
    recommendedVersion: RECOMMENDED_VERSION
  };
}
function evaluateGate(versionInput, api = {}) {
  const version = versionOf(versionInput);
  if (version === undefined) {
    return blocked("Claude Code version unavailable", null);
  }
  if (compareVersions(version, MIN_VERSION) < 0) {
    return blocked(`requires Claude Code >= ${MIN_VERSION}`, version);
  }
  const missing = [];
  if (api.agentSpawn === false)
    missing.push("agent.spawn");
  if (api.store === false)
    missing.push("store");
  if (api.command === false)
    missing.push("command");
  if (missing.length > 0) {
    return blocked(`missing ${missing.join(", ")}`, version);
  }
  const warnings = [];
  if (api.ui === false)
    warnings.push("panel unavailable; command mode only");
  if (api.fs === false)
    warnings.push("filesystem unavailable; agent discovery disabled");
  if (api.settingsRead === false) {
    warnings.push("settings.read unavailable; alias catalog in use");
  }
  return {
    status: warnings.length > 0 ? "warn" : "ok",
    reason: warnings.length > 0 ? warnings.join("; ") : "ready",
    version,
    minVersion: MIN_VERSION,
    recommendedVersion: RECOMMENDED_VERSION
  };
}
function panelAvailable(api) {
  return api.ui !== false;
}

// hooks/runtime.ts
function logLine($, text) {
  try {
    $.ui.log(text);
    return;
  } catch {}
  try {
    $.ui.toast(text);
  } catch {}
}

// hooks/commands.ts
var USAGE = "usage: /flowtask-model [list | set <agent-key> <model> | clear <agent-key> | clear --all | export | import <path>]";
function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function valueOf(runtime, agent) {
  if (agent.override !== undefined)
    return `override ${agent.override}`;
  const inherited = agent.model ?? runtime.sessionModel ?? "session";
  return `inherit (${inherited})`;
}
function formatAgent(runtime, agent) {
  return `${agent.key}	${agent.type}	${agent.source}:${agent.scope}	${valueOf(runtime, agent)}`;
}
async function openPanel($, runtime) {
  if (!runtime.isPanelAvailable) {
    return { text: USAGE };
  }
  try {
    await $.ui.open({ id: "flowtask-model", title: "FlowTask Model" });
    return {};
  } catch (error) {
    runtime.log(`[flowtask-model] panel unavailable: ${reasonOf(error)}`);
    return { text: USAGE };
  }
}
async function applyModel($, runtime, agent, picked) {
  const key = agentKey(agent);
  if (key === "")
    return;
  await runtime.adapter.setAgentModel(key, picked);
  await runtime.refresh();
  try {
    $.ui.invalidate("ui.render");
  } catch {}
  const label = picked === CLEAR_SENTINEL ? "inherit" : stripModelRef(picked);
  runtime.log(`[flowtask-model] ${key} -> ${label}`);
}
async function clearModel($, runtime, agent) {
  const key = agentKey(agent);
  if (key === "")
    return;
  await runtime.adapter.clearAgentModel(key);
  await runtime.refresh();
  try {
    $.ui.invalidate("ui.render");
  } catch {}
  runtime.log(`[flowtask-model] ${key} -> inherit`);
}
function parseSet(runtime, rest) {
  const rawKey = rest[0];
  if (rawKey === undefined)
    return { error: USAGE };
  const key = agentKey(rawKey);
  if (key === "")
    return { error: USAGE };
  const rawModel = rest.slice(1).join(" ").trim();
  if (rawModel === "")
    return { error: USAGE };
  if (/\s/.test(rawModel)) {
    return { error: "[flowtask-model] model must be one alias or full id" };
  }
  return { key, model: rawModel };
}
async function handleCommand($, e, runtime) {
  const args = typeof e?.args === "string" ? e.args.trim() : "";
  try {
    if (args === "")
      return await openPanel($, runtime);
    const parts = args.split(/\s+/);
    const verb = (parts[0] ?? "").toLowerCase();
    const rest = parts.slice(1);
    if (verb === "list") {
      const lines = runtime.agents.map((agent) => formatAgent(runtime, agent));
      const text = lines.length > 0 ? lines.join(`
`) : "no agents found; set <agent-key> <model> still works";
      runtime.log(text);
      return { text };
    }
    if (verb === "set") {
      const parsed = parseSet(runtime, rest);
      if ("error" in parsed)
        return { text: parsed.error };
      if (isInherit(parsed.model)) {
        await clearModel($, runtime, parsed.key);
        return { text: `[flowtask-model] ${parsed.key} -> inherit` };
      }
      await applyModel($, runtime, parsed.key, parsed.model);
      return { text: `[flowtask-model] ${parsed.key} -> ${parsed.model}` };
    }
    if (verb === "clear") {
      const target = rest[0];
      if (target === "--all") {
        const count = await runtime.adapter.clearProject();
        await runtime.refresh();
        return { text: `[flowtask-model] cleared ${count} override(s) in ${runtime.root}` };
      }
      if (target === undefined)
        return { text: USAGE };
      const key = agentKey(target);
      if (key === "")
        return { text: USAGE };
      await clearModel($, runtime, key);
      return { text: `[flowtask-model] ${key} -> inherit` };
    }
    if (verb === "export") {
      const mapping2 = await runtime.adapter.exportMapping();
      const text = JSON.stringify(mapping2, null, 2);
      runtime.log(text);
      return { text };
    }
    if (verb === "import") {
      const path = rest.join(" ").trim();
      if (path === "")
        return { text: USAGE };
      const raw = await $.fs.read(path);
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return { text: `[flowtask-model] invalid json: ${reasonOf(error)}` };
      }
      const result = await runtime.adapter.importMapping(parsed);
      await runtime.refresh();
      if (!result.valid) {
        return { text: `[flowtask-model] import rejected:
${result.errors.join(`
`)}` };
      }
      return { text: `[flowtask-model] imported ${result.applied} override(s)` };
    }
    return { text: USAGE };
  } catch (error) {
    const text = `[flowtask-model] ${reasonOf(error)}`;
    logLine($, text);
    return { text };
  }
}
function selectedValue(override) {
  return override === undefined ? CLEAR_SENTINEL : modelRef(override);
}

// hooks/panel.ts
function rowsAvailable(e) {
  const rows = e?.props?.scroll?.bodyRows;
  return typeof rows === "number" && Number.isFinite(rows) ? Math.max(4, Math.floor(rows)) : 14;
}
function currentValue(agent) {
  return selectedValue(agent.override);
}
function optionList(runtime, agent) {
  const options = buildModelOptions(runtime.models, runtime.providers);
  const value = currentValue(agent);
  if (options.some((option) => option.value === value))
    return options;
  if (agent.override === undefined)
    return options;
  return [
    { title: `${agent.override} (current)`, value },
    ...options
  ];
}
function headerText(runtime) {
  const gate = runtime.gate;
  return `session ${runtime.sessionModel ?? "unknown"} · v${runtime.version ?? "unknown"} · ${gate?.status ?? "unknown"}`;
}
async function renderPanel($, e, runtime, next) {
  if (e?.requestId !== "flowtask-model")
    return next(e);
  try {
    const kit = $.ui.resolve(e);
    const Box = kit?.Box;
    const Text = kit?.Text;
    const Button = kit?.Button;
    const Select = kit?.Select;
    if (Box === undefined || Text === undefined)
      return next(e);
    const rows = rowsAvailable(e);
    const visible = runtime.agents.slice(0, Math.max(1, rows - 4));
    const children = [
      h(Text, { key: "title" }, "FlowTask Model"),
      h(Text, { key: "root", dimColor: true }, runtime.root),
      h(Text, { key: "meta", dimColor: true }, headerText(runtime))
    ];
    for (const agent of visible) {
      const row = [
        h(Text, { key: `name:${agent.key}` }, `${agent.type} [${agent.key}]`),
        h(Text, { key: `value:${agent.key}`, dimColor: true }, agent.override !== undefined ? `override ${agent.override}` : `inherit (${agent.model ?? runtime.sessionModel ?? "session"})`)
      ];
      if (Select !== undefined) {
        row.push(h(Select, {
          key: `select:${agent.key}`,
          options: optionList(runtime, agent),
          value: currentValue(agent),
          onSelect: (picked) => {
            applyModel($, runtime, agent.key, picked).catch(() => {
              return;
            });
          }
        }));
      }
      if (Button !== undefined) {
        row.push(h(Button, {
          key: `clear:${agent.key}`,
          label: "Clear",
          onPress: () => {
            clearModel($, runtime, agent.key).catch(() => {
              return;
            });
          }
        }));
      }
      children.push(h(Box, { key: `row:${agent.key}`, flexDirection: "row" }, ...row));
    }
    if (runtime.agents.length > visible.length) {
      children.push(h(Text, { key: "more", dimColor: true }, `… ${runtime.agents.length - visible.length} more; use /flowtask-model list`));
    }
    if (Select === undefined) {
      children.push(h(Text, { key: "hint", dimColor: true }, "use /flowtask-model set <agent-key> <model>"));
    }
    if (Button !== undefined) {
      children.push(h(Button, {
        key: "refresh",
        label: "Refresh",
        onPress: () => {
          runtime.refresh().then(() => {
            try {
              $.ui.invalidate("ui.render");
            } catch {}
          }).catch(() => {
            return;
          });
        }
      }));
    }
    return h(Box, { flexDirection: "column" }, ...children);
  } catch {
    return next(e);
  }
}

// hooks/register.ts
function reasonOf2(error) {
  return error instanceof Error ? error.message : String(error);
}
function hostOf($, fallbackCwd) {
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
        if (typeof home === "string" && home.trim() !== "")
          return home;
      } catch {}
      try {
        const profile = await $.env.get("USERPROFILE");
        if (typeof profile === "string" && profile.trim() !== "")
          return profile;
      } catch {}
      return;
    },
    sessionModel: async () => {
      try {
        const model = await $.session.model();
        return typeof model === "string" && model.trim() !== "" ? model : undefined;
      } catch {
        return;
      }
    },
    store: {
      get: (key) => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: (key) => $.store.delete(key),
      keys: async () => [...await $.store.keys()]
    },
    fs: {
      read: (path) => $.fs.read(path),
      list: (path) => $.fs.list(path),
      exists: (path) => $.fs.exists(path)
    },
    availableModels: async () => {
      try {
        const settings = await $.settings.read();
        const value = settings && typeof settings === "object" ? settings.availableModels : undefined;
        return normalizeAvailable(value);
      } catch {
        return;
      }
    },
    recordLastSpawn: (record) => {
      lastSpawn = record;
    }
  };
}
var runtime = null;
var resumeLogged = false;
var lastSpawn = null;
async function refreshRuntime() {
  const current = runtime;
  if (current === null)
    return;
  try {
    current.agents = await current.adapter.readAgents();
    current.models = await current.adapter.listModels();
    current.providers = await current.adapter.listProviders();
    current.sessionModel = await current.host.sessionModel();
  } catch (error) {
    current.log(`[flowtask-model] refresh failed: ${reasonOf2(error)}`);
  }
}
function register(on, raw) {
  on("session.start", async ($, e, next) => {
    const cwd = typeof e?.cwd === "string" ? e.cwd : "";
    const host = hostOf($, cwd);
    const adapter = createAdapter(host);
    const versionInput = await $.session.version().catch(() => {
      return;
    });
    const version = versionOf(versionInput);
    const api = {};
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
    } catch {}
    runtime = {
      host,
      adapter,
      root,
      sessionModel: undefined,
      version,
      gate,
      agents: [],
      models: listModels(undefined),
      providers: PROVIDERS,
      isPanelAvailable: panelAvailable(api) && hasSurface,
      refresh: refreshRuntime,
      log: (message) => logLine($, message)
    };
    if (gate.status === "blocked") {
      logLine($, `[flowtask-model] disabled: ${gate.reason}; requires Claude Code >= ${MIN_VERSION}`);
      return next(e);
    }
    try {
      await $.command.register({
        name: "flowtask-model",
        description: "View, set or clear the model each agent uses",
        argumentHint: "[list | set <agent-key> <model> | clear <agent-key> | clear --all | export | import <path>]",
        immediate: true
      });
    } catch (error) {
      logLine($, `[flowtask-model] command unavailable: ${reasonOf2(error)}`);
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
    const subagentType = typeof e?.subagentType === "string" ? e.subagentType.trim() : "";
    if (subagentType === "")
      return next(e);
    const resume = e.resume;
    if (e?.fork === true || resume === true) {
      if (!resumeLogged) {
        resumeLogged = true;
        current.log("[flowtask-model] fork/resume: model change ignored");
      }
      return next(e);
    }
    let key = null;
    try {
      key = matchAgentKey(subagentType, current.agents, (message) => current.log(`[flowtask-model] ${message}`));
    } catch (error) {
      current.log(`[flowtask-model] agent match failed: ${reasonOf2(error)}`);
      return next(e);
    }
    if (key === null)
      return next(e);
    let model;
    try {
      const stored = await $.store.get(modelKey(current.root, key));
      model = readStoredModel(stored);
    } catch (error) {
      current.log(`[flowtask-model] store read failed: ${reasonOf2(error)}`);
      return next(e);
    }
    if (model === undefined)
      return next(e);
    try {
      current.log(`[flowtask-model] spawn ${subagentType} -> ${model}`);
      const result = await next({ ...e, model });
      current.host.recordLastSpawn?.({
        agentKey: key,
        subagentType,
        model,
        observedAt: new Date().toISOString()
      });
      return result;
    } catch (error) {
      current.log(`[flowtask-model] spawn rewrite failed: ${reasonOf2(error)}`);
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
    if (current === null)
      return next(e);
    return renderPanel($, e, current, next);
  });
}
function lastObservedSpawn() {
  return lastSpawn;
}
export {
  register,
  lastObservedSpawn
};
