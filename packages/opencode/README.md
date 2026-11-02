# agent-model-selector-opencode

Adapter de OpenCode del proyecto `agent-model-selector`. Expone el comando
`/flowtask-model`, el keybinding `alt+m` y la selección agrupada por familia de
agentes y por proveedor de modelos.

## Uso

El paquete se instala copiando `dist/`, `package.json` y este README dentro de
los plugins de OpenCode. El entrypoint es `dist/tui.js` y el registro se hace en
`.opencode/cli.json`.

El adapter lee y escribe la configuración global de OpenCode
(`$XDG_CONFIG_HOME/opencode/opencode.json` o `~/.config/opencode/opencode.json`)
y solo modifica `agent.{nombre}.model` y `agent.{nombre}.variant` cuando el
usuario elige un modelo. La opción de herencia elimina esos dos campos y deja el
resto de la entrada intacto.

## Build

```bash
bun run build
```

`dist/tui.js` se versiona para permitir la instalación sin compilar.
