import { CLEAR_SENTINEL } from "@agent-model-selector/core";

export { CLEAR_SENTINEL };

export const PROVIDER_ID = "claude-code";
export const PROVIDER_NAME = "Claude Code";

/**
 * Prefix a legacy alias with the synthetic provider used by the core. A
 * provider/model reference is returned unchanged so it keeps its own provider.
 */
export function modelRef(model: string): string {
  if (model.includes("/")) return model;
  return `${PROVIDER_ID}/${model}`;
}

/**
 * Remove the synthetic provider from a reference. Other providers are left
 * untouched so a caller can reject them explicitly.
 */
export function stripModelRef(ref: string): string {
  return ref.startsWith(`${PROVIDER_ID}/`)
    ? ref.slice(PROVIDER_ID.length + 1)
    : ref;
}

export function isInherit(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "inherit";
}

/**
 * Normalize a user-supplied model. Returns null for `inherit`, an empty value
 * or an explicit clear.
 */
export function normalizeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || isInherit(trimmed)) return null;
  if (trimmed === CLEAR_SENTINEL) return null;
  return stripModelRef(trimmed);
}
