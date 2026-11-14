export interface HostFsEntry {
  name: string;
  kind: string;
  size?: number;
  isLink?: boolean;
}

export interface HostFs {
  read(path: string): Promise<string>;
  list(path: string): Promise<readonly HostFsEntry[]>;
  exists(path: string): Promise<boolean>;
}

export interface HostStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export interface HostSettings {
  read(): Promise<Readonly<Record<string, unknown>>>;
}

export interface HostHttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HostHttpResponse {
  status: number;
  ok?: boolean;
  headers?: Record<string, string>;
  text: string;
}

export interface HostProcessInit {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface HostProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface HostHttp {
  fetch(url: string, init?: HostHttpInit): Promise<HostHttpResponse>;
}

export interface HostProcess {
  run(
    argv: readonly string[],
    init?: HostProcessInit
  ): Promise<HostProcessResult>;
}

export interface AgentDefinition {
  id: string;
  source: "project" | "user";
  scope: string;
  name: string;
  type: string;
  file: string;
  model?: string;
  description?: string;
  shadowedBy?: string;
}

export interface SpawnRecord {
  agentKey: string;
  subagentType: string;
  model: string;
  observedAt: string;
}

/**
 * The engine surface the package needs, isolated from `$` so the adapter,
 * discovery and command layers can be exercised without an engine.
 */
export interface ClaudeCodeHost {
  projectRoot(): Promise<string>;
  homeDir?(): Promise<string | undefined>;
  sessionModel(): Promise<string | undefined>;
  store: HostStore;
  fs: HostFs;
  agentDefinitions?(): Promise<readonly AgentDefinition[] | undefined>;
  settings?: HostSettings;
  httpFetch?: HostHttp["fetch"];
  processRun?: HostProcess["run"];
  recordLastSpawn?(record: SpawnRecord): void;
}

/**
 * One row of the selector: a discovered agent or a stored override whose
 * definition is no longer present.
 */
export interface RuntimeAgent {
  key: string;
  type: string;
  source: "project" | "user" | "store";
  scope: string;
  id: string;
  file?: string;
  /** The model written in the agent definition, if any. */
  model?: string;
  /** The stored override for this project and agent, if any. */
  override?: string;
  description?: string;
}
