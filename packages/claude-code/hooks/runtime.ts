import type { ModelInfo, ProviderInfo } from "@agent-model-selector/core";
import type { ClaudeCodeAdapter } from "../src/adapter";
import type { CatalogError, CatalogModel } from "../src/catalog";
import type { GateResult } from "../src/capabilities";
import type { ClaudeCodeHost, RuntimeAgent } from "../src/host";

/**
 * The state the hooks share. It is rebuilt at `session.start`; a write refreshes
 * the catalog and the overrides without re-reading another project.
 */
export interface Runtime {
  host: ClaudeCodeHost;
  adapter: ClaudeCodeAdapter;
  root: string;
  sessionModel?: string;
  version?: string;
  gate: GateResult | null;
  agents: RuntimeAgent[];
  models: ModelInfo[];
  providers: ProviderInfo[];
  mainModel?: CatalogModel;
  catalogError?: CatalogError;
  isPanelAvailable: boolean;
  refresh(): Promise<void>;
  refreshCatalog(): Promise<void>;
  selectionValue(selection: string): string;
  log(message: string): void;
}

/**
 * Show a line in the transcript, or in the notification bar when the surface
 * has no transcript log.
 */
export function logLine($: any, text: string): void {
  try {
    $.ui.log(text);
    return;
  } catch {
    // Log is unavailable on this surface; try the toast.
  }
  try {
    $.ui.toast(text);
  } catch {
    // Nothing draws in this surface; the command answer still carries the text.
  }
}
