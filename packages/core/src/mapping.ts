import {
  CLEAR_SENTINEL,
  type AgentEntry,
  type HostConfig,
  type Mapping,
  type MappingValidation,
  type ModelInfo,
  type ProviderInfo,
  type Section,
  type SelectOption,
} from "./types";

/**
 * Build agent options sorted alphabetically with current model description.
 */
export function buildAgentOptions(config: HostConfig): SelectOption<string>[] {
  const agents = config.agent ?? {};
  const baseModel = config.model;

  return Object.keys(agents)
    .sort()
    .map((name) => {
      const override = readAgentModel(config, name);
      const current = override.model ?? baseModel ?? "(hereda)";
      const description = override.variant
        ? `${current} (${override.variant})`
        : current;
      return {
        title: name,
        value: name,
        description,
      };
    });
}

/**
 * Build model options from providers (flattened) + prepend the clear option.
 */
export function buildModelOptions(
  models: ModelInfo[],
  providers: ProviderInfo[] = []
): SelectOption<string>[] {
  const options: SelectOption<string>[] = [
    {
      title: "(hereda del runner — sin override)",
      value: CLEAR_SENTINEL,
      description: "elimina agent.{name}.model",
    },
  ];

  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name ?? provider.id]));
  for (const model of models ?? []) {
    const providerID = model?.providerID;
    const id = model?.id ?? model?.modelID;
    if (typeof providerID !== "string" || !providerID || typeof id !== "string" || !id) continue;
    options.push({
      title: model.name ?? model.modelID ?? model.id ?? `${providerID}/${id}`,
      value: `${providerID}/${id}`,
      description: providerNames.get(providerID) ?? providerID,
    });
  }

  return options;
}

/**
 * Detect the family prefix of an agent name (segment before the first dash).
 * Returns null if the name has no dash or the prefix is empty/whitespace.
 * Case-preserving: returns the prefix exactly as it appears.
 */
function detectAgentFamily(name: string): string | null {
  const dashIdx = name.indexOf("-");
  if (dashIdx <= 0) return null;
  const prefix = name.slice(0, dashIdx).trim();
  if (prefix === "") return null;
  return prefix;
}

/**
 * Build grouped sections for agent selection.
 * Always returns an "all" section first, followed by family sections
 * (only families with >= 2 agents), sorted alphabetically by label.
 */
export function buildAgentSections(config: HostConfig): Section<string>[] {
  const allOptions = buildAgentOptions(config);

  const allSection: Section<string> = {
    id: "all",
    label: "All",
    kind: "all",
    items: allOptions,
  };

  const familyMap = new Map<
    string,
    { label: string; items: SelectOption<string>[] }
  >();

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

  const familySections: Section<string>[] = [];
  for (const [, entry] of familyMap) {
    if (entry.items.length >= 2) {
      familySections.push({
        id: `family:${entry.label}`,
        label: entry.label,
        kind: "family",
        items: entry.items,
      });
    }
  }

  familySections.sort((a, b) => a.label.localeCompare(b.label));

  return [allSection, ...familySections];
}

/**
 * Build grouped sections for model selection.
 * Always returns an "all" section first (includes the clear option),
 * followed by provider sections sorted alphabetically by provider name.
 */
export function buildModelSections(
  models: ModelInfo[],
  providers: ProviderInfo[] = []
): Section<string>[] {
  const allOptions = buildModelOptions(models, providers);

  const allSection: Section<string> = {
    id: "all",
    label: "All",
    kind: "all",
    items: allOptions,
  };

  const providerSections: Section<string>[] = [];

  const groups = new Map<string, SelectOption<string>[]>();
  for (const option of allOptions.slice(1)) {
    const providerID = option.value.split("/")[0];
    groups.set(providerID, [...(groups.get(providerID) ?? []), option]);
  }
  for (const [providerID, items] of groups) {
    const providerName = providers.find((provider) => provider.id === providerID)?.name ?? providerID;

    providerSections.push({
      id: `provider:${providerID}`,
      label: providerName,
      kind: "provider",
      items,
    });
  }

  providerSections.sort((a, b) => a.label.localeCompare(b.label));

  return [allSection, ...providerSections];
}

/**
 * Build variant options for a provider/model reference.
 */
export function buildVariantOptions(
  modelRef: string,
  models: ModelInfo[]
): SelectOption<string>[] {
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

  const entries: [string, unknown][] = Array.isArray(variants)
    ? variants.flatMap((variant) => {
        if (!variant || typeof variant !== "object" || typeof variant.id !== "string" || !variant.id) return [];
        return [[variant.id, variant.settings] as [string, unknown]];
      })
    : Object.entries(variants);

  return entries.map(([name, details]) => {
    const description =
      details && typeof details === "object"
        ? Object.entries(details)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(", ")
        : "";
    return { title: name, value: name, description };
  });
}

/**
 * Read the explicit model and variant override for an agent.
 */
export function readAgentModel(
  config: HostConfig,
  agentName: string
): { model?: string; variant?: string } {
  const agent = config?.agent?.[agentName] as AgentEntry | undefined;
  const result: { model?: string; variant?: string } = {};
  if (typeof agent?.model === "string") {
    result.model = agent.model;
  } else if (
    agent?.model &&
    typeof agent.model === "object" &&
    typeof (agent.model as { providerID?: unknown }).providerID === "string" &&
    typeof ((agent.model as { id?: unknown }).id ?? (agent.model as { model?: unknown }).model) === "string"
  ) {
    const ref = agent.model as { providerID: string; id?: string; model?: string };
    result.model = `${ref.providerID}/${ref.id ?? ref.model}`;
  }
  if (typeof agent?.variant === "string") {
    result.variant = agent.variant;
  } else if (
    agent?.model &&
    typeof agent.model === "object" &&
    typeof (agent.model as { variant?: unknown }).variant === "string"
  ) {
    result.variant = (agent.model as { variant: string }).variant;
  }
  return result;
}

/**
 * Deep clone config and remove agent[agentName].model and variant fields.
 * Does not mutate the original config.
 * If agent[agentName] becomes empty after removal, it is preserved (not deleted).
 */
export function removeAgentModel(config: HostConfig, agentName: string): HostConfig {
  const cloned = JSON.parse(JSON.stringify(config)) as HostConfig;
  if (cloned.agent && cloned.agent[agentName]) {
    delete cloned.agent[agentName].model;
    delete cloned.agent[agentName].variant;
  }
  return cloned;
}

/**
 * Build the config patch for setting an agent's model.
 */
export function buildAgentModelPatch(
  agentName: string,
  modelRef: string,
  variant?: string
): { agent: Record<string, { model: string; variant?: string }> } {
  const agent: { model: string; variant?: string } = { model: modelRef };
  if (variant !== undefined) agent.variant = variant;
  return {
    agent: {
      [agentName]: agent,
    },
  };
}

/**
 * Validate a portable mapping. Accepts either a `Mapping` object or a bare
 * array of entries. Never throws: invalid input is reported as `valid: false`.
 */
export function validateMapping(input: unknown): MappingValidation {
  const errors: string[] = [];
  const mapping: Mapping = { agents: [] };
  const rawAgents: unknown = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { agents?: unknown }).agents)
      ? (input as { agents: unknown[] }).agents
      : null;

  if (!rawAgents) {
    errors.push("mapping must be an object with an agents array");
    return { valid: false, errors, mapping };
  }

  const seen = new Set<string>();
  for (const [index, entry] of (rawAgents as unknown[]).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`agents[${index}] must be an object`);
      continue;
    }

    const candidate = entry as Record<string, unknown>;
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
      ...(candidate.variant !== undefined ? { variant: candidate.variant as string } : {}),
    });
  }

  return { valid: errors.length === 0, errors, mapping };
}
