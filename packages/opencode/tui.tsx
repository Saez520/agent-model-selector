import { Plugin } from "@opencode/plugin/tui";
import {
  buildAgentSections,
  buildModelSections,
  buildVariantOptions,
  CLEAR_SENTINEL,
} from "@agent-model-selector/core";
import {
  applyAgentModel,
  buildAgentConfig,
  clearAgentModel,
  readConfig,
  writeConfig,
} from "./src/adapter";

export default Plugin.define({
  id: "agent-model-selector-opencode",
  setup(context) {
    const location = context.location ?? context.data.location.default();

    const selectSectionItem = async <T extends string>(
      title: string,
      sections: ReturnType<typeof buildAgentSections> | ReturnType<typeof buildModelSections>
    ): Promise<T | undefined> => {
      const sectionOptions = sections.map((section) => ({
        title: section.label,
        value: section.id,
        description: `${section.items.length} opciones`,
      }));
      const sectionID =
        sections.length === 1
          ? sections[0].id
          : await context.ui.dialog.select({ title: `${title}: sección`, options: sectionOptions });
      const selectedSection = sections.find((section) => section.id === sectionID);
      if (!selectedSection) return undefined;
      return (await context.ui.dialog.select({
        title: `${title} — ${selectedSection.label}`,
        options: selectedSection.items,
      })) as T | undefined;
    };

    const openSelector = async () => {
      try {
        await Promise.all([
          context.data.location.agent.sync(location),
          context.data.location.provider.sync(location),
          context.data.location.model.sync(location),
        ]);
        const agents = context.data.location.agent.list(location) ?? [];
        const providers = context.data.location.provider.list(location) ?? [];
        const models = context.data.location.model.list(location) ?? [];
        const config = readConfig();
        const agentConfig = buildAgentConfig(config, agents);
        const agentName = await selectSectionItem<string>(
          "Select Agent",
          buildAgentSections(agentConfig)
        );
        if (!agentName) return;

        const modelRef = await selectSectionItem<string>(
          "Modelo",
          buildModelSections(models, providers)
        );
        if (modelRef === undefined) return;
        if (modelRef === CLEAR_SENTINEL) {
          writeConfig(clearAgentModel(readConfig(), agentName));
          context.ui.toast.show({
            title: "FlowTask Model",
            message: `Override de ${agentName} eliminado`,
            variant: "success",
          });
          return;
        }

        const variants = buildVariantOptions(modelRef, models);
        const variant = variants.length
          ? await context.ui.dialog.select({ title: `Variant para ${agentName}`, options: variants })
          : undefined;
        if (variants.length && variant === undefined) return;

        writeConfig(applyAgentModel(readConfig(), agentName, modelRef, variant));
        context.ui.toast.show({
          title: "FlowTask Model",
          message: `${agentName} → ${modelRef}`,
          variant: "success",
        });
      } catch (error) {
        context.ui.toast.show({
          title: "FlowTask Model",
          message: `Error: ${error instanceof Error ? error.message : "desconocido"}`,
          variant: "error",
        });
      }
    };

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "flowtask.model.open",
          title: "FlowTask: Model per Agent",
          group: "FlowTask",
          bind: "alt+m",
          palette: true,
          slash: { name: "flowtask-model" },
          run: openSelector,
        },
      ],
      bindings: ["flowtask.model.open"],
    }));
  },
});
