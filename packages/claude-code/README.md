# agent-model-selector-claude-code

Mod de Claude Code que elige el modelo de cada agente por proyecto. Reutiliza el
mapping, la validación y el contrato de adapter del core; no modifica el adapter
de OpenCode ni escribe configuración de OpenCode.

## Qué hace

- `/flowtask-model` abre un pane con una fila por agente: modelo actual, selector
  y botón Clear.
- `list`, `set`, `clear`, `clear --all`, `export` e `import` funcionan sin pane,
  incluso en `claude -p`.
- Un override se aplica cuando el agente arranca: el hook `agent.spawn` reescribe
  el modelo del spawn, sin negarlo.
- Limpiar el override devuelve el agente a su herencia (frontmatter o modelo de
  la sesión).
- La persistencia vive en `$.store`, con una clave por proyecto y agente:
  `flowtask-model:v1:<raíz codificada>:<agent-key>`.

Los overrides de un proyecto no se ven desde otro. El estado se conserva entre
sesiones y recargas del plugin.

## Uso

```text
/flowtask-model
/flowtask-model list
/flowtask-model set flowtask-planner sonnet
/flowtask-model set flowtask-constructor claude-sonnet-5-5
/flowtask-model clear flowtask-planner
/flowtask-model clear --all
/flowtask-model export
/flowtask-model import backup.json
```

`set` acepta un alias (`sonnet`, `opus`, `haiku`, `fable`), un id completo o
`inherit`. `inherit` equivale a limpiar el override.

`export` produce un mapping portable:

```json
{
  "agents": [
    { "agent": "flowtask-planner", "model": "claude-code/sonnet" }
  ]
}
```

`import` valida el mapping con el core antes de escribir. Un mapping inválido no
deja escrituras parciales.

## Carga en desarrollo

```bash
claude --plugin-dir /ruta/a/packages/claude-code
```

El plugin también se puede validar sin abrir una sesión:

```bash
claude plugin validate /ruta/a/packages/claude-code
```

`claude plugin test` ejecuta los `*.test.ts` del paquete en un entorno como el de
los hooks. El kit `claude-code/testing` permite responder `$.store` en memoria
(`mock.store(on)`) y montar el pane en cada superficie.

## Requisitos y límites

- Piso: Claude Code `2.1.287`. Recomendado: `2.1.299`.
- `settings.read` (`2.1.304` o superior) agrega `availableModels` al catálogo;
  sin esa superficie se usan los aliases.
- El panel depende de la superficie. Terminal, desktop y VS Code tienen
  `Select`; mobile no, y el pane muestra la forma de comando.
- En `-p`, Agent SDK, cloud o WSL sin plugins no se dibuja nada. El comando sigue
  operando y el texto de respuesta queda disponible.
- No hay keybinding global: el comando es la entrada.
- Un fork o un resume no cambia el modelo; el Mod lo ignora y lo registra.
- `agent.spawn` no permite fijar `effort`: la versión 1 sólo selecciona modelo.
- Si el engine aplica `availableModels` u otra política, el valor efectivo puede
  diferir del pedido. El panel etiqueta el pedido como `requested` cuando no hay
  una observación del engine.

## Persistencia y rollback

Para revertir un proyecto:

```text
/flowtask-model clear --all
```

Después se remueve o desactiva el plugin. El comando deja de existir y OpenCode
sigue igual: el paquete no escribe en `.opencode`, `opencode.json` ni en la
configuración global de OpenCode.

## Desarrollo

```bash
bun install
bun run typecheck
bun run build
bun test
```

`hooks/dist/register.js` se versiona. CI reconstruye el bundle y falla si difiere
del commit. El bundle no importa `node:` ni el core en runtime: el core queda
incluido en el build.

La API del engine y las decisiones de compatibilidad están documentadas en
[`COMPATIBILITY.md`](./COMPATIBILITY.md). Los tipos se copian en
[`types/`](./types/README.md).
