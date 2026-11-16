# agent-model-selector-claude-code

Mod de Claude Code que elige el modelo de cada agente por proyecto. Reutiliza el
mapping, la validación y el contrato de adapter del core; no modifica el adapter
de OpenCode ni escribe configuración de OpenCode.

## Qué hace

- `/flowtask-model` abre un pane con una fila por agente: nombre, modelo actual,
  un selector por proveedor y el botón Clear.
- La oferta de modelos se lee viva del gateway configurado en la sesión, agrupada
  por proveedor, en cada apertura y en cada reintento.
- Solo se ofrecen los modelos cuyo target coincide con un tier que el motor
  preserva en subagentes (`sonnet` o `haiku`). La elección se guarda como el alias
  corto y el router la resuelve al proveedor y modelo reales del perfil.
- Si el gateway no responde, la credencial falla o la respuesta no es válida, el
  pane muestra la vía de calidad con un aviso y la opción de reintentar.
- `list`, `set`, `clear`, `clear --all`, `export` e `import` funcionan sin pane,
  incluso en `claude -p`.
- Un override se aplica cuando el agente arranca: el hook `agent.spawn` reescribe
  el modelo del spawn, sin negarlo.
- Limpiar el override devuelve el agente a su herencia (frontmatter o modelo de
  la sesión). Sin override, el subagente hereda la conversación en curso.
- La persistencia vive en `$.store`, con una clave por proyecto y agente:
  `flowtask-model:v1:<raíz codificada>:<agent-key>`.

Los overrides de un proyecto no se ven desde otro. El estado se conserva entre
sesiones y recargas del plugin. La oferta de modelos no se cachea ni se escribe
en el store.

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

`set` acepta un alias (`sonnet`, `haiku`), un id completo o `inherit`. El valor
`provider/model` que muestra el selector también se acepta: se resuelve al alias
del tier cuando el modelo está soportado y se rechaza sin escribir cuando no lo
está. `inherit` equivale a limpiar el override.

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

## Instalación

El repositorio publica el marketplace `agent-model-selector`; el plugin se
instala desde ahí con el gestor de Claude Code:

```bash
claude plugin marketplace add Saez520/agent-model-selector
claude plugin install flowtask-model@agent-model-selector
```

Requiere Claude Code `2.1.287` o superior; la versión recomendada es `2.1.309`.
La copia y el registro los hace el gestor en su store de usuario, así que el
checkout del repositorio no se necesita después de instalar.

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

- Piso: Claude Code `2.1.287`. Recomendado: `2.1.309`.
- El catálogo vivo usa `settings.read` para el perfil y el helper de credencial,
  `http.fetch` para el discovery y `process.run` para ejecutar el helper. Sin
  `settings.read` el catálogo no puede cargar y queda la vía de calidad.
- El gateway debe exponer `GET {ANTHROPIC_BASE_URL}/v1/models`. Si no responde,
  la credencial falla o la respuesta no es válida, se muestra la vía de calidad
  con aviso y reintento.
- Solo se muestran los modelos cuyo target coincide con `sonnet` o `haiku`. El
  target de `opus` y los modelos sin target preservado se ocultan porque el motor
  los sustituye o no los garantiza.
- La credencial del proveedor vive en el perfil y la usa el gateway. El Mod no
  lee la key del proveedor, no la registra y no la persiste.
- El panel depende de la superficie. Terminal, desktop y VS Code tienen
  `Select`; mobile no, y el pane muestra la forma de comando.
- En `-p`, Agent SDK, cloud o WSL sin plugins no se dibuja nada. El comando sigue
  operando y el texto de respuesta queda disponible.
- No hay keybinding global: el comando es la entrada.
- Un fork o un resume no cambia el modelo; el Mod lo ignora y lo registra.
- `agent.spawn` no permite fijar `effort`: la versión 1 sólo selecciona modelo.
- Si el engine aplica otra política, el valor efectivo puede diferir del pedido.
  El panel muestra el target del catálogo; la verdad del modelo efectivo está en
  el transcript del subagente.

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
