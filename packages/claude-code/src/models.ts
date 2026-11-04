import {
  CLEAR_SENTINEL,
  type ModelInfo,
  type ProviderInfo,
} from "@agent-model-selector/core";

export { CLEAR_SENTINEL };

export const PROVIDER_ID = "claude-code";
export const PROVIDER_NAME = "Claude Code";
export const ALIASES = ["sonnet", "opus", "haiku", "fable"] as const;

export const PROVIDERS: ProviderInfo[] = [{ id: PROVIDER_ID, name: PROVIDER_NAME }];

/**
 * Prefix a Claude Code model name with the synthetic provider used by the core.
 */
export function modelRef(model: string): string {
  if (model.startsWith(`${PROVIDER_ID}/`)) return model;
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

/**
 * Read the models from settings when the shape is a non-empty array of
 * strings. Any other shape falls back to the aliases.
 */
export function normalizeAvailable(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      const name = entry.trim();
      if (!names.includes(name)) names.push(name);
    }
  }
  return names.length > 0 ? names : undefined;
}

/**
 * The catalog the selector offers: settings' `availableModels` when present,
 * otherwise the stable aliases.
 */
export function listModels(available?: unknown): ModelInfo[] {
  const names = normalizeAvailable(available) ?? [...ALIASES];
  return names.map((name) => ({
    providerID: PROVIDER_ID,
    id: name,
    modelID: name,
    name,
  }));
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

/**
 * Whether a reference names a model this session knows. A full id that is not
 * in the catalog is still accepted.
 */
export function isKnownModel(value: string, models: readonly ModelInfo[]): boolean {
  const raw = normalizeModel(value);
  if (raw === null) return true;
  return models.some((model) => (model.id ?? model.modelID) === raw);
}
