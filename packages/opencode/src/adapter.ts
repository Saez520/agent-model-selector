import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildAgentModelPatch,
  removeAgentModel,
  type AgentInfo,
  type HostConfig,
} from "@agent-model-selector/core";

/**
 * Resolve the global configuration file using XDG conventions.
 * Returns the first existing file among opencode.jsonc, opencode.json and
 * config.json, or defaults to opencode.json if none exist.
 */
export function resolveGlobalConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  const home = os.homedir();
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const configDir = path.join(xdgConfig, "opencode");

  const candidates = [
    path.join(configDir, "opencode.jsonc"),
    path.join(configDir, "opencode.json"),
    path.join(configDir, "config.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(configDir, "opencode.json");
}

/**
 * Strip a UTF-8 BOM from JSON text.
 */
export function stripJsonBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

/**
 * Atomic write to file: write to tmp, fsync tmp, rename to target, fsync dir.
 * Throws on error; on failure, no partial writes remain.
 */
export function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  const tmpPath = `${filePath}.tmp-${Math.random().toString(16).slice(2)}`;
  let tempFd: number | undefined;
  let dirFd: number | undefined;
  let renameCompleted = false;

  try {
    fs.writeFileSync(tmpPath, content);

    tempFd = fs.openSync(tmpPath, "r+");
    try {
      fs.fsyncSync(tempFd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
    fs.closeSync(tempFd);
    tempFd = undefined;

    fs.renameSync(tmpPath, filePath);
    renameCompleted = true;

    dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally {
    if (typeof tempFd === "number") {
      try {
        fs.closeSync(tempFd);
      } catch {
        // Ignore cleanup failures.
      }
    }
    if (typeof dirFd === "number") {
      try {
        fs.closeSync(dirFd);
      } catch {
        // Ignore cleanup failures.
      }
    }

    if (!renameCompleted) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }
}

/**
 * Read an OpenCode configuration file. Returns an empty object when the file
 * does not exist. Invalid JSON is reported with the file path.
 */
export function readConfig(filePath: string = resolveGlobalConfigFile()): HostConfig {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(stripJsonBom(fs.readFileSync(filePath, "utf8"))) as HostConfig;
  } catch (error) {
    throw new Error(
      `invalid config ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

/**
 * Write an OpenCode configuration file atomically.
 */
export function writeConfig(config: HostConfig, filePath: string = resolveGlobalConfigFile()): void {
  atomicWriteFile(filePath, JSON.stringify(config, null, 2));
}

/**
 * Compose the agent view used by the selector: live agents merged with the
 * explicit overrides from the configuration file.
 */
export function buildAgentConfig(config: HostConfig, agents: AgentInfo[]): HostConfig {
  const entries = Object.fromEntries(
    agents.map((agent) => {
      const name = agent.name ?? agent.id;
      return [
        name,
        {
          ...config.agent?.[name],
          model: agent.model ?? config.agent?.[name]?.model,
        },
      ];
    })
  );
  return { ...config, agent: entries };
}

/**
 * Apply an agent model selection without mutating the input configuration.
 */
export function applyAgentModel(
  config: HostConfig,
  agentName: string,
  modelRef: string,
  variant?: string
): HostConfig {
  const patch = buildAgentModelPatch(agentName, modelRef, variant);
  return {
    ...config,
    agent: {
      ...(config.agent ?? {}),
      [agentName]: {
        ...(config.agent?.[agentName] ?? {}),
        ...patch.agent[agentName],
      },
    },
  };
}

/**
 * Remove an agent model override without mutating the input configuration.
 */
export function clearAgentModel(config: HostConfig, agentName: string): HostConfig {
  return removeAgentModel(config, agentName);
}
