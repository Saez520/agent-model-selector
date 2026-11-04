import { agentKey } from "./keys";
import { normalizeRoot } from "./keys";
import type { AgentDefinition, HostFs } from "./host";

export interface AgentFrontmatter {
  present: boolean;
  name?: string;
  description?: string;
  model?: string;
}

const MAX_DEPTH = 4;

export function joinPath(root: string, ...parts: string[]): string {
  const base = normalizeRoot(root);
  const tail = parts
    .filter((part) => typeof part === "string" && part.trim() !== "")
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part !== "")
    .join("/");
  if (tail === "") return base;
  return base.endsWith("/") ? `${base}${tail}` : `${base}/${tail}`;
}

export function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Read `name`, `description` and `model` from an agent definition. A missing
 * or unterminated frontmatter block yields an empty object; the caller falls
 * back to the file name.
 */
export function parseAgentFrontmatter(text: unknown): AgentFrontmatter {
  if (typeof text !== "string") return { present: false };
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === "") continue;
    if (lines[index].trim() === "---") start = index;
    break;
  }
  if (start < 0) return { present: false };

  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end < 0) return { present: false };

  const result: AgentFrontmatter = { present: true };
  for (let index = start + 1; index < end; index += 1) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = stripQuotes(match[2]);
    if (value === "") continue;
    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "model") result.model = value;
  }
  return result;
}

export interface DiscoverOptions {
  log?: (message: string) => void;
}

async function scanDirectory(
  fs: HostFs,
  directory: string,
  source: "project" | "user",
  scope: string,
  depth: number,
  log?: (message: string) => void
): Promise<AgentDefinition[]> {
  if (depth > MAX_DEPTH) return [];

  let entries: readonly { name: string; kind: string; isLink?: boolean }[];
  try {
    entries = await fs.list(directory);
  } catch {
    return [];
  }

  const files = entries
    .filter(
      (entry) =>
        entry.kind === "file" &&
        !entry.isLink &&
        entry.name.toLowerCase().endsWith(".md")
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const definitions: AgentDefinition[] = [];
  for (const entry of files) {
    const file = joinPath(directory, entry.name);
    let text: string;
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
      ...(frontmatter.description !== undefined
        ? { description: frontmatter.description }
        : {}),
      ...(frontmatter.model !== undefined ? { model: frontmatter.model } : {}),
    });
  }

  const directories = entries
    .filter((entry) => entry.kind === "dir" && !entry.isLink)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of directories) {
    const childScope = scope === "." ? entry.name : `${scope}/${entry.name}`;
    definitions.push(
      ...(await scanDirectory(
        fs,
        joinPath(directory, entry.name),
        source,
        childScope,
        depth + 1,
        log
      ))
    );
  }

  return definitions;
}

/**
 * Keep the first definition for each normalized agent key, project before
 * user, and record which file was shadowed.
 */
export function dedupeAgents(
  definitions: readonly AgentDefinition[],
  log?: (message: string) => void
): AgentDefinition[] {
  const byKey = new Map<string, AgentDefinition>();
  const result: AgentDefinition[] = [];

  for (const definition of definitions) {
    const key = agentKey(definition.type);
    if (key === "") continue;
    const existing = byKey.get(key);
    if (existing === undefined) {
      const copy: AgentDefinition = { ...definition };
      byKey.set(key, copy);
      result.push(copy);
      continue;
    }
    existing.shadowedBy =
      existing.shadowedBy === undefined
        ? definition.file
        : `${existing.shadowedBy}, ${definition.file}`;
    log?.(`shadowed ${definition.file} by ${existing.file}`);
  }

  return result;
}

/**
 * Discover agent definitions from the project and the user directories. A
 * missing directory, a broken file or an unreadable entry never throws.
 */
export async function discoverAgents(
  fs: HostFs,
  projectRoot: string,
  homeDir?: string,
  options: DiscoverOptions = {}
): Promise<AgentDefinition[]> {
  const definitions: AgentDefinition[] = [];
  const projectDirectory = joinPath(projectRoot, ".claude", "agents");
  definitions.push(
    ...(await scanDirectory(fs, projectDirectory, "project", ".", 0, options.log))
  );

  if (typeof homeDir === "string" && homeDir.trim() !== "") {
    const userDirectory = joinPath(homeDir, ".claude", "agents");
    definitions.push(
      ...(await scanDirectory(fs, userDirectory, "user", ".", 0, options.log))
    );
  } else {
    options.log?.("user agent directory unavailable; project agents only");
  }

  return dedupeAgents(definitions, options.log);
}

function uniqueKey<T extends { type: string; file?: string }>(
  candidates: readonly T[],
  log?: (message: string) => void
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return agentKey(candidates[0].type);
  log?.(`ambiguous agent match: ${candidates.map((item) => item.file).join(", ")}`);
  return null;
}

/**
 * Resolve the agent key for a spawn. Exact `type` first, then the normalized
 * key, then the suffix after the last `:` (plugin agents). An ambiguous match
 * applies nothing.
 */
export function matchAgentKey<T extends { type: string; file?: string }>(
  subagentType: unknown,
  catalog: readonly T[],
  log?: (message: string) => void
): string | null {
  const requested = typeof subagentType === "string" ? subagentType.trim() : "";
  if (requested === "") return null;

  const exact = catalog.filter((definition) => definition.type === requested);
  if (exact.length > 0) return uniqueKey(exact, log);

  const normalized = agentKey(requested);
  if (normalized === "") return null;

  const byNormalized = catalog.filter(
    (definition) => agentKey(definition.type) === normalized
  );
  if (byNormalized.length > 0) return uniqueKey(byNormalized, log);

  const separator = requested.lastIndexOf(":");
  if (separator >= 0 && separator < requested.length - 1) {
    const suffix = agentKey(requested.slice(separator + 1));
    if (suffix !== "") {
      const bySuffix = catalog.filter(
        (definition) => agentKey(definition.type) === suffix
      );
      if (bySuffix.length > 0) return uniqueKey(bySuffix, log);
    }
  }

  return null;
}
