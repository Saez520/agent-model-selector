// tui.tsx
import { Plugin } from "@opencode/plugin/tui";

// ../core/src/types.ts
var CLEAR_SENTINEL = "__agent_model_selector_clear__";

// ../core/src/mapping.ts
function buildAgentOptions(config) {
  const agents = config.agent ?? {};
  const baseModel = config.model;
  return Object.keys(agents).sort().map((name) => {
    const override = readAgentModel(config, name);
    const current = override.model ?? baseModel ?? "(hereda)";
    const description = override.variant ? `${current} (${override.variant})` : current;
    return {
      title: name,
      value: name,
      description
    };
  });
}
function buildModelOptions(models, providers = []) {
  const options = [
    {
      title: "(hereda del runner \u2014 sin override)",
      value: CLEAR_SENTINEL,
      description: "elimina agent.{name}.model"
    }
  ];
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name ?? provider.id]));
  for (const model of models ?? []) {
    const providerID = model?.providerID;
    const id = model?.id ?? model?.modelID;
    if (typeof providerID !== "string" || !providerID || typeof id !== "string" || !id) continue;
    options.push({
      title: model.name ?? model.modelID ?? model.id ?? `${providerID}/${id}`,
      value: `${providerID}/${id}`,
      description: providerNames.get(providerID) ?? providerID
    });
  }
  return options;
}
function detectAgentFamily(name) {
  const dashIdx = name.indexOf("-");
  if (dashIdx <= 0) return null;
  const prefix = name.slice(0, dashIdx).trim();
  if (prefix === "") return null;
  return prefix;
}
function buildAgentSections(config) {
  const allOptions = buildAgentOptions(config);
  const allSection = {
    id: "all",
    label: "All",
    kind: "all",
    items: allOptions
  };
  const familyMap = /* @__PURE__ */ new Map();
  for (const option of allOptions) {
    const family = detectAgentFamily(option.value);
    if (family === null) continue;
    const key = family.toLowerCase();
    const entry = familyMap.get(key);
    if (entry) {
      entry.items.push(option);
    } else {
      familyMap.set(key, { label: family, items: [option] });
    }
  }
  const familySections = [];
  for (const [, entry] of familyMap) {
    if (entry.items.length >= 2) {
      familySections.push({
        id: `family:${entry.label}`,
        label: entry.label,
        kind: "family",
        items: entry.items
      });
    }
  }
  familySections.sort((a, b) => a.label.localeCompare(b.label));
  return [allSection, ...familySections];
}
function buildModelSections(models, providers = []) {
  const allOptions = buildModelOptions(models, providers);
  const allSection = {
    id: "all",
    label: "All",
    kind: "all",
    items: allOptions
  };
  const providerSections = [];
  const groups = /* @__PURE__ */ new Map();
  for (const option of allOptions.slice(1)) {
    const providerID = option.value.split("/")[0];
    groups.set(providerID, [...groups.get(providerID) ?? [], option]);
  }
  for (const [providerID, items] of groups) {
    const providerName = providers.find((provider) => provider.id === providerID)?.name ?? providerID;
    providerSections.push({
      id: `provider:${providerID}`,
      label: providerName,
      kind: "provider",
      items
    });
  }
  providerSections.sort((a, b) => a.label.localeCompare(b.label));
  return [allSection, ...providerSections];
}
function buildVariantOptions(modelRef, models) {
  const separator = modelRef.indexOf("/");
  if (separator <= 0 || separator === modelRef.length - 1) return [];
  const providerId = modelRef.slice(0, separator);
  const modelId = modelRef.slice(separator + 1);
  const model = models.find(
    (item) => item?.providerID === providerId && (item?.id === modelId || item?.modelID === modelId)
  );
  const variants = model?.variants;
  if (!variants || typeof variants !== "object") {
    return [];
  }
  const entries = Array.isArray(variants) ? variants.flatMap((variant) => {
    if (!variant || typeof variant !== "object" || typeof variant.id !== "string" || !variant.id) return [];
    return [[variant.id, variant.settings]];
  }) : Object.entries(variants);
  return entries.map(([name, details]) => {
    const description = details && typeof details === "object" ? Object.entries(details).map(([key, value]) => `${key}: ${String(value)}`).join(", ") : "";
    return { title: name, value: name, description };
  });
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
function removeAgentModel(config, agentName) {
  const cloned = JSON.parse(JSON.stringify(config));
  if (cloned.agent && cloned.agent[agentName]) {
    delete cloned.agent[agentName].model;
    delete cloned.agent[agentName].variant;
  }
  return cloned;
}
function buildAgentModelPatch(agentName, modelRef, variant) {
  const agent = { model: modelRef };
  if (variant !== void 0) agent.variant = variant;
  return {
    agent: {
      [agentName]: agent
    }
  };
}

// src/adapter.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
function resolveGlobalConfigFile(env = process.env) {
  const home = os.homedir();
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const configDir = path.join(xdgConfig, "opencode");
  const candidates = [
    path.join(configDir, "opencode.jsonc"),
    path.join(configDir, "opencode.json"),
    path.join(configDir, "config.json")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(configDir, "opencode.json");
}
function stripJsonBom(text) {
  if (text.charCodeAt(0) === 65279) {
    return text.slice(1);
  }
  return text;
}
function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp-${Math.random().toString(16).slice(2)}`;
  let tempFd;
  let dirFd;
  let renameCompleted = false;
  try {
    fs.writeFileSync(tmpPath, content);
    tempFd = fs.openSync(tmpPath, "r+");
    try {
      fs.fsyncSync(tempFd);
    } catch (error) {
      if (error.code !== "EPERM") throw error;
    }
    fs.closeSync(tempFd);
    tempFd = void 0;
    fs.renameSync(tmpPath, filePath);
    renameCompleted = true;
    dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } catch (error) {
      if (error.code !== "EPERM") throw error;
    }
  } finally {
    if (typeof tempFd === "number") {
      try {
        fs.closeSync(tempFd);
      } catch {
      }
    }
    if (typeof dirFd === "number") {
      try {
        fs.closeSync(dirFd);
      } catch {
      }
    }
    if (!renameCompleted) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
      }
    }
  }
}
function readConfig(filePath = resolveGlobalConfigFile()) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(stripJsonBom(fs.readFileSync(filePath, "utf8")));
  } catch (error) {
    throw new Error(
      `invalid config ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}
function writeConfig(config, filePath = resolveGlobalConfigFile()) {
  atomicWriteFile(filePath, JSON.stringify(config, null, 2));
}
function buildAgentConfig(config, agents) {
  const entries = Object.fromEntries(
    agents.map((agent) => {
      const name = agent.name ?? agent.id;
      return [
        name,
        {
          ...config.agent?.[name],
          model: agent.model ?? config.agent?.[name]?.model
        }
      ];
    })
  );
  return { ...config, agent: entries };
}
function applyAgentModel(config, agentName, modelRef, variant) {
  const patch = buildAgentModelPatch(agentName, modelRef, variant);
  return {
    ...config,
    agent: {
      ...config.agent ?? {},
      [agentName]: {
        ...config.agent?.[agentName] ?? {},
        ...patch.agent[agentName]
      }
    }
  };
}
function clearAgentModel(config, agentName) {
  return removeAgentModel(config, agentName);
}

// tui.tsx
var tui_default = Plugin.define({
  id: "agent-model-selector-opencode",
  setup(context) {
    const location = context.location ?? context.data.location.default();
    const selectSectionItem = async (title, sections) => {
      const sectionOptions = sections.map((section) => ({
        title: section.label,
        value: section.id,
        description: `${section.items.length} opciones`
      }));
      const sectionID = sections.length === 1 ? sections[0].id : await context.ui.dialog.select({
        title: `${title}: secci\xF3n`,
        options: sectionOptions
      });
      const selectedSection = sections.find((section) => section.id === sectionID);
      if (!selectedSection) return void 0;
      return await context.ui.dialog.select({
        title: `${title} \u2014 ${selectedSection.label}`,
        options: selectedSection.items
      });
    };
    const openSelector = async () => {
      try {
        await Promise.all([context.data.location.agent.sync(location), context.data.location.provider.sync(location), context.data.location.model.sync(location)]);
        const agents = context.data.location.agent.list(location) ?? [];
        const providers = context.data.location.provider.list(location) ?? [];
        const models = context.data.location.model.list(location) ?? [];
        const config = readConfig();
        const agentConfig = buildAgentConfig(config, agents);
        const agentName = await selectSectionItem("Select Agent", buildAgentSections(agentConfig));
        if (!agentName) return;
        const modelRef = await selectSectionItem("Modelo", buildModelSections(models, providers));
        if (modelRef === void 0) return;
        if (modelRef === CLEAR_SENTINEL) {
          writeConfig(clearAgentModel(readConfig(), agentName));
          context.ui.toast.show({
            title: "FlowTask Model",
            message: `Override de ${agentName} eliminado`,
            variant: "success"
          });
          return;
        }
        const variants = buildVariantOptions(modelRef, models);
        const variant = variants.length ? await context.ui.dialog.select({
          title: `Variant para ${agentName}`,
          options: variants
        }) : void 0;
        if (variants.length && variant === void 0) return;
        writeConfig(applyAgentModel(readConfig(), agentName, modelRef, variant));
        context.ui.toast.show({
          title: "FlowTask Model",
          message: `${agentName} \u2192 ${modelRef}`,
          variant: "success"
        });
      } catch (error) {
        context.ui.toast.show({
          title: "FlowTask Model",
          message: `Error: ${error instanceof Error ? error.message : "desconocido"}`,
          variant: "error"
        });
      }
    };
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "flowtask.model.open",
        title: "FlowTask: Model per Agent",
        group: "FlowTask",
        bind: "alt+m",
        palette: true,
        slash: {
          name: "flowtask-model"
        },
        run: openSelector
      }],
      bindings: ["flowtask.model.open"]
    }));
  }
});
export {
  tui_default as default
};
