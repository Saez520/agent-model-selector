import type { ModelInfo, ProviderInfo } from "./types";

/**
 * Split a provider/model reference. Returns null when the reference is not
 * exactly `provider/model`.
 */
export function parseModelRef(modelRef: string): { providerID: string; id: string } | null {
  if (typeof modelRef !== "string") return null;
  const separator = modelRef.indexOf("/");
  if (separator <= 0 || separator === modelRef.length - 1) return null;
  return {
    providerID: modelRef.slice(0, separator),
    id: modelRef.slice(separator + 1),
  };
}

/**
 * Compose a provider/model reference.
 */
export function formatModelRef(providerID: string, modelID: string): string {
  if (!providerID || !modelID) {
    throw new Error("providerID and modelID are required");
  }
  return `${providerID}/${modelID}`;
}

/**
 * Read-only catalog contract supplied by a host runtime.
 */
export interface ModelCatalog {
  listProviders(): ProviderInfo[] | Promise<ProviderInfo[]>;
  listModels(): ModelInfo[] | Promise<ModelInfo[]>;
}
