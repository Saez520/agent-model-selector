import { CLEAR_SENTINEL, isInherit, stripModelRef } from "../src/models";
import { agentKey } from "../src/keys";
import type { Runtime } from "./runtime";
import { logLine } from "./runtime";

export const USAGE = "usage: /flowtask-model [list | set <agent-key> <model> | clear <agent-key> | clear --all | export | import <path>]";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function valueOf(runtime: Runtime, agent: Runtime["agents"][number]): string {
  if (agent.override !== undefined) {
    return `override ${runtime.selectionValue(agent.override)}`;
  }
  const inherited = runtime.mainModel?.target ?? runtime.sessionModel ?? "session";
  return `inherit (${inherited})`;
}

function formatAgent(runtime: Runtime, agent: Runtime["agents"][number]): string {
  return `${agent.key}\t${agent.type}\t${agent.source}:${agent.scope}\t${valueOf(runtime, agent)}`;
}

async function openPanel($: any, runtime: Runtime): Promise<{ text?: string }> {
  await runtime.refreshCatalog();
  if (!runtime.isPanelAvailable) {
    return { text: USAGE };
  }
  try {
    await $.ui.open({ id: "flowtask-model", title: "FlowTask Model" });
    return {};
  } catch (error) {
    runtime.log(`[flowtask-model] panel unavailable: ${reasonOf(error)}`);
    return { text: USAGE };
  }
}

async function applyModel(
  $: any,
  runtime: Runtime,
  agent: string,
  picked: string
): Promise<void> {
  const key = agentKey(agent);
  if (key === "") return;
  await runtime.adapter.setAgentModel(key, picked);
  await runtime.refresh();
  try {
    $.ui.invalidate("ui.render");
  } catch {
    // The pane is not open; the store still changed.
  }
  const label = picked === CLEAR_SENTINEL ? "inherit" : stripModelRef(picked);
  runtime.log(`[flowtask-model] ${key} -> ${label}`);
}

async function clearModel($: any, runtime: Runtime, agent: string): Promise<void> {
  const key = agentKey(agent);
  if (key === "") return;
  await runtime.adapter.clearAgentModel(key);
  await runtime.refresh();
  try {
    $.ui.invalidate("ui.render");
  } catch {
    // The pane is not open; the store still changed.
  }
  runtime.log(`[flowtask-model] ${key} -> inherit`);
}

export { applyModel, clearModel };

function parseSet(
  runtime: Runtime,
  rest: readonly string[]
): { key: string; model: string } | { error: string } {
  const rawKey = rest[0];
  if (rawKey === undefined) return { error: USAGE };
  const key = agentKey(rawKey);
  if (key === "") return { error: USAGE };
  const rawModel = rest.slice(1).join(" ").trim();
  if (rawModel === "") return { error: USAGE };
  if (/\s/.test(rawModel)) {
    return { error: "[flowtask-model] model must be one alias or full id" };
  }
  return { key, model: rawModel };
}

/**
 * Serve `/flowtask-model`. The same parser backs the pane: every action works
 * without a drawing surface.
 */
export async function handleCommand(
  $: any,
  e: any,
  runtime: Runtime
): Promise<{ text?: string }> {
  const args = typeof e?.args === "string" ? e.args.trim() : "";

  try {
    if (args === "") return await openPanel($, runtime);

    const parts = args.split(/\s+/);
    const verb = (parts[0] ?? "").toLowerCase();
    const rest = parts.slice(1);

    if (verb === "list") {
      const lines = runtime.agents.map((agent) => formatAgent(runtime, agent));
      const body =
        lines.length > 0
          ? lines.join("\n")
          : "no agents found; set <agent-key> <model> still works";
      const text =
        runtime.catalogError !== undefined
          ? `${runtime.catalogError.message}\n${body}`
          : body;
      runtime.log(text);
      return { text };
    }

    if (verb === "set") {
      const parsed = parseSet(runtime, rest);
      if ("error" in parsed) return { text: parsed.error };
      if (isInherit(parsed.model)) {
        await clearModel($, runtime, parsed.key);
        return { text: `[flowtask-model] ${parsed.key} -> inherit` };
      }
      await applyModel($, runtime, parsed.key, parsed.model);
      return { text: `[flowtask-model] ${parsed.key} -> ${parsed.model}` };
    }

    if (verb === "clear") {
      const target = rest[0];
      if (target === "--all") {
        const count = await runtime.adapter.clearProject();
        await runtime.refresh();
        return { text: `[flowtask-model] cleared ${count} override(s) in ${runtime.root}` };
      }
      if (target === undefined) return { text: USAGE };
      const key = agentKey(target);
      if (key === "") return { text: USAGE };
      await clearModel($, runtime, key);
      return { text: `[flowtask-model] ${key} -> inherit` };
    }

    if (verb === "export") {
      const mapping = await runtime.adapter.exportMapping();
      const text = JSON.stringify(mapping, null, 2);
      runtime.log(text);
      return { text };
    }

    if (verb === "import") {
      const path = rest.join(" ").trim();
      if (path === "") return { text: USAGE };
      const raw = await $.fs.read(path);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return { text: `[flowtask-model] invalid json: ${reasonOf(error)}` };
      }
      const result = await runtime.adapter.importMapping(parsed);
      await runtime.refresh();
      if (!result.valid) {
        return { text: `[flowtask-model] import rejected:\n${result.errors.join("\n")}` };
      }
      return { text: `[flowtask-model] imported ${result.applied} override(s)` };
    }

    return { text: USAGE };
  } catch (error) {
    const text = `[flowtask-model] ${reasonOf(error)}`;
    logLine($, text);
    return { text };
  }
}
