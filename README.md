# agent-model-selector

Selector de modelos por agente para distintos runtimes de agentes. El núcleo es
agnóstico: no importa FlowTask, OpenCode ni ningún host concreto. Cada runtime
vive en su propio paquete y comparte el mapping, la validación y los tipos del
core.

## Estructura

```text
packages/
  core/      tipos, mapping, validación y contrato de adapter
  opencode/  adapter y TUI para OpenCode
presets/
  flowtask.json  preset opcional de referencia (data-only)
```

## Uso en OpenCode

El paquete `agent-model-selector-opencode` expone el comando `/flowtask-model` y
el keybinding `alt+m`. Instalado como plugin de OpenCode, permite elegir el
modelo y la variante de cualquier agente, o eliminar el override para que el
agente herede el modelo del runner.

El adapter lee y escribe únicamente la configuración global de OpenCode:

- `$XDG_CONFIG_HOME/opencode/opencode.json`
- `~/.config/opencode/opencode.json` cuando `XDG_CONFIG_HOME` no está definido

Solo modifica `agent.{nombre}.model` y `agent.{nombre}.variant`. El resto de la
configuración se conserva sin cambios.

## Preset

`presets/flowtask.json` documenta los modelos de referencia de los agentes de
FlowTask. Es un dato opcional: no se aplica automáticamente y el adapter no lo
importa. Los nombres de agente se conservan tal como están escritos.

## Desarrollo

Requisitos: Bun y Node.js 22 o superior.

```bash
bun install --frozen-lockfile
bun test
bun run build
bun run typecheck
```

`packages/opencode/dist/tui.js` se versiona para permitir la instalación sin
compilar. CI reconstruye el paquete y falla si `dist` difiere del commit.

## CI

`.github/workflows/ci.yml` instala dependencias, corre los tests, compila y
verifica que `dist` esté actualizado.
