/// <reference types="bun" />
import { expect, test } from "bun:test";
import { CLEAR_SENTINEL } from "../packages/claude-code/src/models";
import type { CatalogError, CatalogModel } from "../packages/claude-code/src/catalog";
import type { ClaudeCodeAdapter } from "../packages/claude-code/src/adapter";
import type { ClaudeCodeHost, RuntimeAgent } from "../packages/claude-code/src/host";
import { renderPanel } from "../packages/claude-code/hooks/panel";
import type { Runtime } from "../packages/claude-code/hooks/runtime";

const ROOT = "/tmp/panel project";
const SONNET_TARGET = "Claude Code API/claude-sonnet-5-5";
const HAIKU_TARGET = "OpenCode Go/glm-5.3-flash";

interface UiNode {
  type: string;
  props: Record<string, any>;
  children: unknown[];
}

function createElement(
  type: string,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): UiNode {
  return { type, props: props ?? {}, children };
}

(globalThis as any).h = createElement;

function walk(node: unknown, out: UiNode[] = []): UiNode[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return out;
  }
  if (node === null || typeof node !== "object") return out;
  const current = node as UiNode;
  out.push(current);
  for (const child of current.children) walk(child, out);
  return out;
}

function allText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(allText).join("");
  if (node === null || typeof node !== "object") return "";
  return (node as UiNode).children.map(allText).join("");
}

const MAIN_MODEL: CatalogModel = {
  providerID: "Claude Code API",
  id: "claude-sonnet-5-5",
  name: "Claude Sonnet 5.5",
  target: SONNET_TARGET,
  selection: "sonnet",
};

const MODELS: CatalogModel[] = [
  MAIN_MODEL,
  {
    providerID: "OpenCode Go",
    id: "glm-5.3-flash",
    name: "GLM-5.3-Flash",
    target: HAIKU_TARGET,
    selection: "haiku",
  },
];

const PROVIDERS = [
  { id: "Claude Code API", name: "Claude Code API" },
  { id: "OpenCode Go", name: "OpenCode Go" },
];

const AGENTS: RuntimeAgent[] = [
  {
    key: "flowtask-planner",
    type: "FlowTask Planner",
    source: "project",
    scope: ".",
    id: "project:.:FlowTask Planner",
    override: "haiku",
  },
  {
    key: "flowtask-constructor",
    type: "FlowTask Constructor",
    source: "project",
    scope: ".",
    id: "project:.:FlowTask Constructor",
  },
];

const SELECT_KIT = {
  Box: "Box",
  Text: "Text",
  Button: "Button",
  Select: "Select",
};
const TEXT_KIT = { Box: "Box", Text: "Text", Button: "Button" };

const UNREACHABLE: CatalogError = {
  kind: "unreachable",
  message: "the model gateway is unreachable; showing the quality route",
};

function makeRuntime(): Runtime {
  const selections: Record<string, string> = {
    sonnet: SONNET_TARGET,
    haiku: HAIKU_TARGET,
  };
  const runtime = {
    host: {} as ClaudeCodeHost,
    adapter: {} as ClaudeCodeAdapter,
    root: ROOT,
    sessionModel: "claude-sonnet-5-5",
    version: "2.1.309",
    gate: { status: "ok" } as any,
    agents: AGENTS,
    models: MODELS,
    providers: PROVIDERS,
    mainModel: MAIN_MODEL,
    catalogError: undefined,
    isPanelAvailable: true,
    refresh: async () => undefined,
    refreshCatalog: async () => undefined,
    selectionValue: (selection: string) =>
      selections[selection] ?? `claude-code/${selection}`,
    log: () => undefined,
  };
  return runtime as unknown as Runtime;
}

async function render(
  runtime: Runtime,
  kit: Record<string, unknown>
): Promise<{
  nodes: UiNode[];
  invalidated: string[];
  nextCalls: unknown[];
}> {
  const invalidated: string[] = [];
  const nextCalls: unknown[] = [];
  const $ = {
    ui: {
      resolve: () => kit,
      invalidate: (id: string) => invalidated.push(id),
      log: () => undefined,
      toast: () => undefined,
      panes: async () => [],
      open: async () => ({}),
    },
  };
  const event = { requestId: "flowtask-model", props: { scroll: { bodyRows: 30 } } };
  const tree = await renderPanel($, event, runtime, (nextEvent: unknown) => {
    nextCalls.push(nextEvent);
    return nextEvent;
  });
  return { nodes: walk(tree), invalidated, nextCalls };
}

// gap: G3 — falta una sección por proveedor, el aviso no se dibuja o Reintentar no refresca
test("the panel groups models by provider, warns on fallback and retries discovery", async () => {
  const runtime = makeRuntime();
  const first = await render(runtime, SELECT_KIT);
  expect(first.nextCalls).toHaveLength(0);

  const selects = first.nodes.filter((node) => node.type === "Select");
  expect(selects.map((node) => node.props.label)).toEqual([
    "Claude Code API",
    "OpenCode Go",
    "Claude Code API",
    "OpenCode Go",
  ]);
  expect(selects.every((node) => node.props.label !== "All")).toBe(true);
  expect(selects.map((node) => node.props.key)).toEqual([
    "select:flowtask-planner:provider:Claude Code API",
    "select:flowtask-planner:provider:OpenCode Go",
    "select:flowtask-constructor:provider:Claude Code API",
    "select:flowtask-constructor:provider:OpenCode Go",
  ]);
  expect(
    selects[0]?.props.options.map((option: any) => option.value)
  ).toEqual([SONNET_TARGET]);
  expect(
    selects[1]?.props.options.map((option: any) => option.value)
  ).toEqual([HAIKU_TARGET]);
  expect(
    selects.every((node) =>
      node.props.options.every(
        (option: any) => option.value !== CLEAR_SENTINEL
      )
    )
  ).toBe(true);
  expect(selects[1]?.props.value).toBe(HAIKU_TARGET);
  expect(selects[0]?.props.value).toBeUndefined();
  expect(selects[2]?.props.value).toBeUndefined();

  const firstTexts = first.nodes
    .filter((node) => node.type === "Text")
    .map((node) => allText(node));
  expect(firstTexts).toContain("FlowTask Model");
  expect(firstTexts).toContain(ROOT);
  expect(firstTexts).toContain("override OpenCode Go/glm-5.3-flash");
  expect(firstTexts).toContain(
    "hereda (calidad: Claude Code API/claude-sonnet-5-5)"
  );
  expect(
    firstTexts.some((text) => text.includes("the model gateway is unreachable"))
  ).toBe(false);

  const firstButtons = first.nodes.filter((node) => node.type === "Button");
  expect(firstButtons.map((node) => node.props.label)).toEqual([
    "Clear",
    "Clear",
    "Refrescar",
  ]);

  let refreshes = 0;
  runtime.models = [MAIN_MODEL];
  runtime.providers = [PROVIDERS[0]!];
  runtime.catalogError = UNREACHABLE;
  runtime.refreshCatalog = async () => {
    refreshes += 1;
    runtime.models = MODELS;
    runtime.providers = PROVIDERS;
    runtime.catalogError = undefined;
  };

  const fallback = await render(runtime, SELECT_KIT);
  const fallbackSelects = fallback.nodes.filter(
    (node) => node.type === "Select"
  );
  expect(fallbackSelects.map((node) => node.props.label)).toEqual([
    "Claude Code API",
    "Claude Code API",
  ]);
  const fallbackTexts = fallback.nodes
    .filter((node) => node.type === "Text")
    .map((node) => allText(node));
  expect(fallbackTexts).toContain(UNREACHABLE.message);
  const retry = fallback.nodes.find(
    (node) => node.type === "Button" && node.props.key === "refresh"
  );
  expect(retry?.props.label).toBe("Reintentar");
  retry?.props.onPress();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(refreshes).toBe(1);
  expect(fallback.invalidated).toContain("ui.render");

  const recovered = await render(runtime, SELECT_KIT);
  const recoveredSelects = recovered.nodes.filter(
    (node) => node.type === "Select"
  );
  expect(recoveredSelects.map((node) => node.props.label)).toEqual([
    "Claude Code API",
    "OpenCode Go",
    "Claude Code API",
    "OpenCode Go",
  ]);
  const recoveredTexts = recovered.nodes
    .filter((node) => node.type === "Text")
    .map((node) => allText(node));
  expect(
    recoveredTexts.some((text) => text.includes("the model gateway is unreachable"))
  ).toBe(false);
  expect(
    recovered.nodes.find(
      (node) => node.type === "Button" && node.props.key === "refresh"
    )?.props.label
  ).toBe("Refrescar");

  const textOnly = await render(makeRuntime(), TEXT_KIT);
  expect(textOnly.nodes.filter((node) => node.type === "Select")).toHaveLength(0);
  expect(
    textOnly.nodes
      .filter((node) => node.type === "Text")
      .map((node) => allText(node))
  ).toContain("use /flowtask-model set <agent-key> <model>");

  const passed = await renderPanel(
    { ui: { resolve: () => SELECT_KIT } } as any,
    { requestId: "other" } as any,
    makeRuntime(),
    (event) => event
  );
  expect(passed).toEqual({ requestId: "other" });
});
