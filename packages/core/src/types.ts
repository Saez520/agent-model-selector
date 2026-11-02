export const CLEAR_SENTINEL = "__agent_model_selector_clear__";

/**
 * Kind of section in a grouped selector.
 */
export type SectionKind = "all" | "family" | "provider";

/**
 * A selectable option in a grouped selector.
 */
export interface SelectOption<V = string> {
  title: string;
  value: V;
  description?: string;
}

/**
 * A section of options for the grouped selector.
 * `V` is the value type of the options (string for agents, string for models).
 */
export interface Section<V = string> {
  id: string;
  label: string;
  kind: SectionKind;
  items: SelectOption<V>[];
}

/**
 * A provider/model reference as persisted by host configuration files.
 */
export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

/**
 * Agent override as stored in a host configuration file.
 */
export interface AgentEntry {
  model?:
    | string
    | ModelRef
    | { providerID?: string; id?: string; model?: string; variant?: string };
  variant?: string;
  [key: string]: unknown;
}

/**
 * Host configuration shape shared by adapters. Adapters may extend it.
 */
export interface HostConfig {
  agent?: Record<string, AgentEntry>;
  model?: string;
  [key: string]: unknown;
}

/**
 * Agent information supplied by a host runtime.
 */
export interface AgentInfo {
  id: string;
  name?: string;
  model?:
    | string
    | ModelRef
    | { providerID?: string; id?: string; model?: string; variant?: string };
  [key: string]: unknown;
}

/**
 * Provider information supplied by a host runtime.
 */
export interface ProviderInfo {
  id: string;
  name?: string;
  [key: string]: unknown;
}

/**
 * Model information supplied by a host runtime.
 */
export interface ModelInfo {
  providerID: string;
  id?: string;
  modelID?: string;
  name?: string;
  variants?: unknown;
  [key: string]: unknown;
}

/**
 * A single agent-to-model assignment inside a mapping.
 */
export interface MappingEntry {
  agent: string;
  model?: string;
  variant?: string;
  inherit?: boolean;
}

/**
 * A portable agent-to-model mapping. It is data only: it does not read or write
 * host configuration by itself.
 */
export interface Mapping {
  agents: MappingEntry[];
}

/**
 * Result of validating a mapping. `mapping` is the normalized copy; its agent
 * names are preserved verbatim.
 */
export interface MappingValidation {
  valid: boolean;
  errors: string[];
  mapping: Mapping;
}

/**
 * Contract implemented by host adapters (for example an editor runtime or a
 * CLI runtime). The core never imports a concrete host.
 */
export interface TargetAdapter<Config = HostConfig> {
  readonly id: string;
  readConfig(): Config | Promise<Config>;
  writeConfig(config: Config): void | Promise<void>;
  listAgents(config: Config): AgentInfo[];
  listProviders(): ProviderInfo[] | Promise<ProviderInfo[]>;
  listModels(): ModelInfo[] | Promise<ModelInfo[]>;
}
