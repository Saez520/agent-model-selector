import { buildModelSections } from "@agent-model-selector/core";
import { CLEAR_SENTINEL } from "../src/models";
import type { RuntimeAgent } from "../src/host";
import type { Runtime } from "./runtime";
import { applyModel, clearModel } from "./commands";

function rowsAvailable(e: any): number {
  const rows = e?.props?.scroll?.bodyRows;
  return typeof rows === "number" && Number.isFinite(rows)
    ? Math.max(4, Math.floor(rows))
    : 14;
}

function currentValue(runtime: Runtime, agent: RuntimeAgent): string {
  return agent.override !== undefined
    ? runtime.selectionValue(agent.override)
    : CLEAR_SENTINEL;
}

function qualityLabel(runtime: Runtime): string {
  return runtime.mainModel?.target ?? runtime.sessionModel ?? "session";
}

function headerText(runtime: Runtime): string {
  const gate = runtime.gate;
  return `session ${runtime.sessionModel ?? "unknown"} · v${runtime.version ?? "unknown"} · ${gate?.status ?? "unknown"}`;
}

/**
 * Draw the selector pane. The surface decides which elements it has; without
 * `Select` the pane lists the command form instead of inventing a control.
 */
export async function renderPanel(
  $: any,
  e: any,
  runtime: Runtime,
  next: (event: any) => any
): Promise<any> {
  if (e?.requestId !== "flowtask-model") return next(e);

  try {
    const kit = $.ui.resolve(e) as any;
    const Box = kit?.Box;
    const Text = kit?.Text;
    const Button = kit?.Button;
    const Select = kit?.Select;

    if (Box === undefined || Text === undefined) return next(e);

    const rows = rowsAvailable(e);
    const visible = runtime.agents.slice(0, Math.max(1, rows - 5));
    const sections = buildModelSections(runtime.models, runtime.providers).filter(
      (section) => section.kind !== "all"
    );
    const children: unknown[] = [
      h(Text, { key: "title" }, "FlowTask Model"),
      h(Text, { key: "root", dimColor: true }, runtime.root),
      h(Text, { key: "meta", dimColor: true }, headerText(runtime)),
    ];

    if (runtime.catalogError !== undefined) {
      children.push(
        h(Text, { key: "catalog-error" }, runtime.catalogError.message)
      );
    }

    for (const agent of visible) {
      const value = currentValue(runtime, agent);
      const row: unknown[] = [
        h(
          Box,
          { key: `label:${agent.key}`, flexDirection: "column" },
          h(Text, { key: `name:${agent.key}` }, `${agent.type} [${agent.key}]`),
          h(
            Text,
            { key: `value:${agent.key}`, dimColor: true },
            agent.override !== undefined
              ? `override ${runtime.selectionValue(agent.override)}`
              : `hereda (calidad: ${qualityLabel(runtime)})`
          )
        ),
      ];

      if (Select !== undefined) {
        for (const section of sections) {
          const selected = section.items.some(
            (option) => option.value === value
          )
            ? { value }
            : {};
          row.push(
            h(Select, {
              key: `select:${agent.key}:${section.id}`,
              label: section.label,
              options: section.items,
              ...selected,
              onSelect: (picked: string) => {
                void applyModel($, runtime, agent.key, picked).catch(
                  () => undefined
                );
              },
            })
          );
        }
      }

      if (Button !== undefined) {
        row.push(
          h(Button, {
            key: `clear:${agent.key}`,
            label: "Clear",
            onPress: () => {
              void clearModel($, runtime, agent.key).catch(() => undefined);
            },
          })
        );
      }

      children.push(h(Box, { key: `row:${agent.key}`, flexDirection: "row" }, ...row));
    }

    if (runtime.agents.length > visible.length) {
      children.push(
        h(
          Text,
          { key: "more", dimColor: true },
          `… ${runtime.agents.length - visible.length} more; use /flowtask-model list`
        )
      );
    }

    if (Select === undefined) {
      children.push(
        h(
          Text,
          { key: "hint", dimColor: true },
          "use /flowtask-model set <agent-key> <model>"
        )
      );
    }

    if (Button !== undefined) {
      children.push(
        h(Button, {
          key: "refresh",
          label: runtime.catalogError !== undefined ? "Reintentar" : "Refrescar",
          onPress: () => {
            void runtime
              .refreshCatalog()
              .then(() => {
                try {
                  $.ui.invalidate("ui.render");
                } catch {
                  // The pane closed between the read and the repaint.
                }
              })
              .catch(() => undefined);
          },
        })
      );
    }

    return h(Box, { flexDirection: "column" }, ...children);
  } catch {
    return next(e);
  }
}
