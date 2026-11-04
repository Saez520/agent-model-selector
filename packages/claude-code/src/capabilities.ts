import {
  MIN_VERSION,
  RECOMMENDED_VERSION,
  compareVersions,
  versionOf,
} from "./version";

export interface GateApi {
  agentSpawn?: boolean;
  store?: boolean;
  command?: boolean;
  ui?: boolean;
  fs?: boolean;
  settingsRead?: boolean;
}

export type GateStatus = "ok" | "warn" | "blocked";

export interface GateResult {
  status: GateStatus;
  reason: string;
  version: string | null;
  minVersion: string;
  recommendedVersion: string;
}

export const CAPABILITIES = {
  agentModelOverride: true,
  effortOverride: false,
  persistence: "mod-store",
  panel: "surface-dependent",
  discovery: "plugin+agents-dirs",
  minVersion: MIN_VERSION,
  recommendedVersion: RECOMMENDED_VERSION,
} as const;

function blocked(reason: string, version: string | null): GateResult {
  return {
    status: "blocked",
    reason,
    version,
    minVersion: MIN_VERSION,
    recommendedVersion: RECOMMENDED_VERSION,
  };
}

/**
 * Decide whether the plugin can run on the engine the session reports.
 *
 * A version below the floor or a missing required surface blocks every hook.
 * A missing panel, filesystem or `settings.read` only degrades the experience.
 */
export function evaluateGate(versionInput: unknown, api: GateApi = {}): GateResult {
  const version = versionOf(versionInput);
  if (version === undefined) {
    return blocked("Claude Code version unavailable", null);
  }

  if (compareVersions(version, MIN_VERSION) < 0) {
    return blocked(`requires Claude Code >= ${MIN_VERSION}`, version);
  }

  const missing: string[] = [];
  if (api.agentSpawn === false) missing.push("agent.spawn");
  if (api.store === false) missing.push("store");
  if (api.command === false) missing.push("command");
  if (missing.length > 0) {
    return blocked(`missing ${missing.join(", ")}`, version);
  }

  const warnings: string[] = [];
  if (api.ui === false) warnings.push("panel unavailable; command mode only");
  if (api.fs === false) warnings.push("filesystem unavailable; agent discovery disabled");
  if (api.settingsRead === false) {
    warnings.push("settings.read unavailable; alias catalog in use");
  }

  return {
    status: warnings.length > 0 ? "warn" : "ok",
    reason: warnings.length > 0 ? warnings.join("; ") : "ready",
    version,
    minVersion: MIN_VERSION,
    recommendedVersion: RECOMMENDED_VERSION,
  };
}

/**
 * Whether a pane can be opened. The concrete surface still decides which
 * elements it draws.
 */
export function panelAvailable(api: GateApi): boolean {
  return api.ui !== false;
}

/**
 * Label a model without claiming an observation the engine did not provide.
 */
export function effectiveModelLabel(
  observed?: unknown,
  requested?: unknown
): string {
  if (typeof observed === "string" && observed.trim() !== "") {
    return observed.trim();
  }
  if (typeof requested === "string" && requested.trim() !== "") {
    return `${requested.trim()} (requested)`;
  }
  return "inherit";
}
