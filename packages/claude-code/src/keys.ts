export const MODEL_KEY_PREFIX = "flowtask-model:v1:";

/**
 * Normalize a project root so the same directory always produces the same
 * store prefix: forward slashes, no duplicate separators and no trailing
 * separator (except a Windows drive root).
 */
export function normalizeRoot(root: unknown): string {
  if (typeof root !== "string") return "";
  let value = root.trim().replace(/\\/g, "/");
  if (value === "") return "";

  const isUnc = value.startsWith("//");
  value = value.replace(/\/+/g, "/");
  if (isUnc) value = `/${value}`;

  if (/^[A-Za-z]:\/$/.test(value)) return value;
  if (value.length > 1 && value.endsWith("/")) value = value.slice(0, -1);
  return value;
}

/**
 * Stable key for an agent inside a project. Display names keep their spelling;
 * only this key folds case and separators.
 */
export function agentKey(name: unknown): string {
  if (typeof name !== "string") return "";
  const folded = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return folded;
}

/**
 * Store key for one agent override in one project.
 */
export function modelKey(root: unknown, agent: unknown): string {
  const normalizedRoot = normalizeRoot(root);
  const normalizedAgent = agentKey(agent);
  return `${MODEL_KEY_PREFIX}${encodeURIComponent(normalizedRoot)}:${normalizedAgent}`;
}

export interface ParsedModelKey {
  root: string;
  agentKey: string;
}

/**
 * Parse a store key. Returns null for a key that is not ours or cannot be
 * decoded.
 */
export function parseModelKey(key: unknown): ParsedModelKey | null {
  if (typeof key !== "string" || !key.startsWith(MODEL_KEY_PREFIX)) return null;
  const rest = key.slice(MODEL_KEY_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) return null;
  const encodedRoot = rest.slice(0, separator);
  const keyPart = rest.slice(separator + 1);
  if (keyPart === "") return null;
  let root: string;
  try {
    root = decodeURIComponent(encodedRoot);
  } catch {
    return null;
  }
  return { root: normalizeRoot(root), agentKey: keyPart };
}

/**
 * Whether a store key belongs to a project root.
 */
export function isKeyForRoot(key: unknown, root: unknown): boolean {
  const parsed = parseModelKey(key);
  return parsed !== null && parsed.root === normalizeRoot(root);
}

/**
 * Every key of the project, in the store's insertion order.
 */
export function keysForRoot(keys: readonly string[], root: unknown): string[] {
  const normalized = normalizeRoot(root);
  return keys.filter((key) => {
    const parsed = parseModelKey(key);
    return parsed !== null && parsed.root === normalized;
  });
}
