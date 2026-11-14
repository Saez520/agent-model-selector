import type { ModelInfo, ProviderInfo } from "@agent-model-selector/core";
import type { ClaudeCodeHost } from "./host";
import { PROVIDER_NAME } from "./models";

export interface CatalogTarget {
  /** Provider segment before the first slash; empty when the target has none. */
  provider: string;
  /** Model segment after the first slash, or the whole target when it has none. */
  model: string;
  /** Target with the provider and model, as read from the profile or the gateway. */
  ref: string;
  /** Case-insensitive form used to compare targets. */
  normalized: string;
}

export interface CatalogProfile {
  main?: CatalogTarget;
  sonnet?: CatalogTarget;
  haiku?: CatalogTarget;
  opus?: CatalogTarget;
}

export type CatalogErrorKind =
  | "unconfigured"
  | "unreachable"
  | "credential"
  | "invalid_response"
  | "no_supported";

export interface CatalogError {
  kind: CatalogErrorKind;
  /** Operator-facing reason; safe to show in the panel and the command list. */
  message: string;
}

export interface CatalogModel extends ModelInfo {
  providerID: string;
  id: string;
  name: string;
  /** Provider/model reference the selector shows as the current value. */
  target: string;
  /** Short value written to the store: the preserved tier or the main selector. */
  selection: string;
}

export interface CatalogResult {
  models: CatalogModel[];
  providers: ProviderInfo[];
  mainModel?: CatalogModel;
  error?: CatalogError;
}

export type CatalogDeps = Pick<ClaudeCodeHost, "fs" | "httpFetch" | "processRun">;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/**
 * Remove the context markers the gateway appends to a target and collapse
 * whitespace so two spellings of the same model compare equal.
 */
export function normalizeReference(value: string): string {
  return value
    .replace(/\s*\[[^\]]*\]\s*$/g, "")
    .replace(/\s*\(1m context\)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanReference(value: string): string {
  return value
    .replace(/\s*\[[^\]]*\]\s*$/g, "")
    .replace(/\s*\(1m context\)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function targetOf(value: string, fallbackProvider?: string): CatalogTarget | undefined {
  const clean = cleanReference(value);
  if (clean === "") return undefined;
  const separator = clean.indexOf("/");
  if (separator > 0 && separator < clean.length - 1) {
    const provider = clean.slice(0, separator).trim();
    const model = clean.slice(separator + 1).trim();
    if (provider === "" || model === "") return undefined;
    const ref = `${provider}/${model}`;
    return { provider, model, ref, normalized: normalizeReference(ref) };
  }
  const model = clean;
  const provider = fallbackProvider?.trim() ?? "";
  const ref = provider === "" ? model : `${provider}/${model}`;
  return { provider, model, ref, normalized: normalizeReference(ref) };
}

/**
 * Read the active profile targets. The main model falls back to the settings
 * model and then to the session model; the tier targets have no fallback.
 */
export function parseProfile(settings: unknown, sessionModel?: string): CatalogProfile {
  const root = asRecord(settings) ?? {};
  const env = asRecord(root.env) ?? {};
  const mainValue =
    firstString(env.ANTHROPIC_MODEL) ??
    firstString(root.model) ??
    firstString(sessionModel);
  const sonnet = firstString(env.ANTHROPIC_DEFAULT_SONNET_MODEL);
  const haiku = firstString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL);
  const opus = firstString(env.ANTHROPIC_DEFAULT_OPUS_MODEL);
  return {
    ...(mainValue !== undefined ? { main: targetOf(mainValue) } : {}),
    ...(sonnet !== undefined ? { sonnet: targetOf(sonnet) } : {}),
    ...(haiku !== undefined ? { haiku: targetOf(haiku) } : {}),
    ...(opus !== undefined ? { opus: targetOf(opus) } : {}),
  };
}

function gatewayEntries(input: unknown): unknown[] | undefined {
  if (Array.isArray(input)) return input;
  const root = asRecord(input);
  if (!root) return undefined;
  for (const key of ["data", "models", "items"]) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

function labelFor(target: CatalogTarget, display?: string): string {
  if (display === undefined) return target.model;
  const clean = cleanReference(display);
  if (clean === "") return target.model;
  const separator = clean.indexOf("/");
  if (separator > 0) {
    const provider = clean.slice(0, separator).trim().toLowerCase();
    const model = clean.slice(separator + 1).trim();
    if (provider === target.provider.toLowerCase() && model !== "") return model;
  }
  return clean;
}

/**
 * Read the gateway response in every shape the router has used: a bare array,
 * `{ data }`, `{ models }` or `{ items }`. Entries without a provider are
 * skipped because the selector groups by provider.
 */
export function parseGatewayModels(input: unknown): CatalogModel[] {
  const entries = gatewayEntries(input);
  if (entries === undefined) return [];

  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;

    const idValue = firstString(
      record.id,
      record.model_id,
      record.modelId,
      record.slug
    );
    const providerValue = firstString(
      record.provider,
      record.providerName,
      record.owned_by,
      record.ownedBy,
      record.provider_id,
      record.providerId
    );
    const targetValue = firstString(record.target_model, record.targetModel);
    const displayValue = firstString(
      record.display_name,
      record.displayName,
      record.name
    );

    let target: CatalogTarget | undefined;
    if (targetValue !== undefined) {
      target = targetOf(targetValue, targetValue.includes("/") ? undefined : providerValue);
    } else if (displayValue !== undefined && displayValue.includes("/")) {
      target = targetOf(displayValue);
    } else if (displayValue !== undefined && idValue !== undefined && idValue.includes("/")) {
      target = targetOf(idValue);
    } else if (displayValue !== undefined && providerValue !== undefined) {
      target = targetOf(displayValue, providerValue);
    } else if (idValue !== undefined) {
      target = targetOf(idValue, providerValue);
    }

    if (target === undefined || target.provider === "") continue;
    if (seen.has(target.normalized)) continue;
    seen.add(target.normalized);

    models.push({
      providerID: target.provider,
      id: target.model,
      name: labelFor(target, displayValue),
      target: target.ref,
      selection: "",
    });
  }
  return models;
}

/**
 * Keep the models whose target matches a tier the engine preserves in
 * `agent.spawn` (`sonnet` and `haiku`). The opus target is never offered
 * because the engine substitutes it with the main model.
 */
export function selectSupportedModels(
  models: readonly CatalogModel[],
  profile: CatalogProfile
): CatalogModel[] {
  const selections = new Map<string, string>();
  if (profile.sonnet !== undefined) {
    selections.set(profile.sonnet.normalized, "sonnet");
  }
  if (profile.haiku !== undefined && !selections.has(profile.haiku.normalized)) {
    selections.set(profile.haiku.normalized, "haiku");
  }

  const supported: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const normalized = normalizeReference(model.target);
    const selection = selections.get(normalized);
    if (selection === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    supported.push({ ...model, selection });
  }
  return supported;
}

function qualitySelection(profile: CatalogProfile, main: CatalogTarget): string {
  if (profile.sonnet !== undefined && main.normalized === profile.sonnet.normalized) {
    return "sonnet";
  }
  if (profile.haiku !== undefined && main.normalized === profile.haiku.normalized) {
    return "haiku";
  }
  return main.model;
}

function qualityModel(profile: CatalogProfile): CatalogModel | undefined {
  const main = profile.main;
  if (main === undefined) return undefined;
  const providerID = main.provider === "" ? PROVIDER_NAME : main.provider;
  const target = main.provider === "" ? `${providerID}/${main.model}` : main.ref;
  return {
    providerID,
    id: main.model,
    name: main.model,
    target,
    selection: qualitySelection(profile, main),
  };
}

function providersOf(models: readonly CatalogModel[]): ProviderInfo[] {
  const providers = new Map<string, ProviderInfo>();
  for (const model of models) {
    if (!providers.has(model.providerID)) {
      providers.set(model.providerID, {
        id: model.providerID,
        name: model.providerID,
      });
    }
  }
  return [...providers.values()];
}

/**
 * Build the result that always carries the quality route. The main model is
 * synthesized only when the offered models do not already include it.
 */
export function qualityResult(
  profile: CatalogProfile,
  models: readonly CatalogModel[] = [],
  error?: CatalogError
): CatalogResult {
  const merged = models.map((model) => ({ ...model }));
  const main = qualityModel(profile);
  if (
    main !== undefined &&
    !merged.some(
      (model) => normalizeReference(model.target) === normalizeReference(main.target)
    )
  ) {
    merged.push(main);
  }
  const mainModel =
    main === undefined
      ? undefined
      : merged.find(
          (model) => normalizeReference(model.target) === normalizeReference(main.target)
        );
  return {
    models: merged,
    providers: providersOf(merged),
    ...(mainModel !== undefined ? { mainModel } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function errorOf(kind: CatalogErrorKind, message: string): CatalogError {
  return { kind, message };
}

function failure(profile: CatalogProfile, error: CatalogError): CatalogResult {
  return qualityResult(profile, [], error);
}

/**
 * Read the gateway credential from the helper. The value stays in memory and
 * is never logged or persisted. A missing helper or a failing run leaves the
 * request unauthenticated, which the gateway answers with a credential error.
 */
export async function readApiKey(
  settings: unknown,
  host: CatalogDeps
): Promise<string | undefined> {
  const root = asRecord(settings) ?? {};
  const helper = firstString(root.apiKeyHelper);
  if (helper === undefined) return undefined;

  if (host.processRun !== undefined) {
    try {
      const result = await host.processRun([helper], { timeoutMs: 5000 });
      if (result.exitCode === 0) {
        const value = result.stdout.trim();
        if (value !== "") return value;
      }
    } catch {
      // Fall back to reading the helper file.
    }
  }

  try {
    const raw = await host.fs.read(helper);
    const literals = [...raw.matchAll(/['"`]([^'"`\r\n]+)['"`]/g)]
      .map((match) => match[1].trim())
      .filter(
        (value) =>
          value !== "" && !value.startsWith("$") && !value.includes("%s")
      );
    const value = literals.at(-1);
    if (value !== undefined) return value;
  } catch {
    // No readable helper; the request goes out without a credential.
  }
  return undefined;
}

/**
 * Query the gateway and build the live catalog. Any failure returns the
 * quality route plus a catalog error; the function never throws and never
 * stores the response.
 */
export async function loadCatalog(
  settings: unknown,
  host: CatalogDeps,
  sessionModel?: string
): Promise<CatalogResult> {
  const profile = parseProfile(settings, sessionModel);
  const root = asRecord(settings) ?? {};
  const env = asRecord(root.env) ?? {};
  const base = firstString(env.ANTHROPIC_BASE_URL, env.ANTHROPIC_API_BASE_URL);

  if (base === undefined) {
    return failure(
      profile,
      errorOf(
        "unconfigured",
        "the model gateway address is not configured; showing the quality route"
      )
    );
  }
  if (host.httpFetch === undefined) {
    return failure(
      profile,
      errorOf(
        "unconfigured",
        "the model gateway is unavailable on this surface; showing the quality route"
      )
    );
  }

  const key = await readApiKey(settings, host);
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
  };
  if (key !== undefined) headers["x-api-key"] = key;

  let response;
  try {
    response = await host.httpFetch(`${base.replace(/\/+$/, "")}/v1/models`, {
      method: "GET",
      headers,
    });
  } catch {
    return failure(
      profile,
      errorOf(
        "unreachable",
        "the model gateway is unreachable; showing the quality route"
      )
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failure(
      profile,
      errorOf(
        "credential",
        "the model gateway rejected the credential; showing the quality route"
      )
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return failure(
      profile,
      errorOf(
        "unreachable",
        `the model gateway responded with status ${response.status}; showing the quality route`
      )
    );
  }
  if (typeof response.text !== "string") {
    return failure(
      profile,
      errorOf(
        "invalid_response",
        "the model gateway returned an invalid model list; showing the quality route"
      )
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return failure(
      profile,
      errorOf(
        "invalid_response",
        "the model gateway returned an invalid model list; showing the quality route"
      )
    );
  }

  const entries = gatewayEntries(parsed);
  if (entries === undefined) {
    return failure(
      profile,
      errorOf(
        "invalid_response",
        "the model gateway returned an invalid model list; showing the quality route"
      )
    );
  }
  if (entries.length === 0) {
    return failure(
      profile,
      errorOf(
        "no_supported",
        "the model gateway offers no supported model; showing the quality route"
      )
    );
  }

  const supported = selectSupportedModels(parseGatewayModels(parsed), profile);
  if (supported.length === 0) {
    return failure(
      profile,
      errorOf(
        "no_supported",
        "the model gateway offers no supported model; showing the quality route"
      )
    );
  }

  return qualityResult(profile, supported);
}

/**
 * Find an offered model by its provider/model reference. The comparison uses
 * the same normalization as the support rule.
 */
export function findCatalogModel(
  models: readonly CatalogModel[],
  reference: string
): CatalogModel | undefined {
  const normalized = normalizeReference(reference);
  return models.find(
    (model) => normalizeReference(model.target) === normalized
  );
}
