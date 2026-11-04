# Compatibilidad con Claude Code

El paquete se apoya en la API pública de Claude Code Mods (un plugin cuyo
comportamiento vive en un hooks module `register(on, options)`). Este documento
fija las decisiones que dependen de esa API y las observaciones que las
sostienen.

## Versión

| Constante | Valor | Motivo |
| --- | --- | --- |
| `MIN_VERSION` | `2.1.287` | primera versión con Mods públicos y `agent.spawn` |
| `RECOMMENDED_VERSION` | `2.1.299` | resume estable y panel en VS Code |
| `SETTINGS_READ_VERSION` | `2.1.304` | lectura de `availableModels` como mejora opcional |

`$.session.version()` no devuelve un string: resuelve
`{ version, base?, builtAt? }`. El gate lee `version` y compara por segmentos.
Si el valor no se puede interpretar, el Mod queda bloqueado con un aviso de una
línea y no registra hooks.

## Persistencia

`$.store` existe y persiste entre sesiones y recargas del plugin. Es un
almacén por usuario y plugin (no por proyecto): cada clave incorpora la raíz del
proyecto. La clave es
`flowtask-model:v1:<raíz codificada>:<agent-key>` y el valor es
`{ "model": "<modelo>", "updatedAt": "<ISO-8601>" }`.

- La raíz se normaliza (barras invertidas a `/`, sin barra final, sin `//`) y se
  codifica con `encodeURIComponent` para que no introduzca `:`.
- Limpiar borra la clave. Si una versión futura no expusiera `delete`, se
  escribiría `{ "model": null }`; el lector trata ambos como “sin override”.
- `claude plugin test` permite responder `$.store` en memoria con
  `mock.store(on)`; no se necesita una sesión real para cubrir la persistencia.
- El store real no se toca durante el desarrollo: el spike y las pruebas usan
  `CLAUDE_CONFIG_DIR` temporal.

## Descubrimiento de agentes

No hay una API para listar definiciones de agentes: `$.agent.list()` sólo lista
los agentes lanzados en la sesión. El catálogo se construye leyendo:

- `<raíz del proyecto>/.claude/agents`, con subcarpetas hasta profundidad 4;
- `<home>/.claude/agents`, con la misma profundidad.

Cada definición se identifica como `{source}:{scope}:{name}` (`project` o
`user`; `scope` es la ruta relativa al directorio de agentes, `.` en la raíz).
El `type` conserva el `name` del frontmatter o, si falta, el nombre del archivo.

La precedencia es proyecto sobre usuario. Dentro del proyecto el orden es
lexicográfico y un `agent-key` duplicado se resuelve por la primera definición;
la sombra se registra en el log. Un archivo sin frontmatter, con frontmatter
inválido o un enlace roto se omite sin lanzar.

`agent.spawn` entrega `e.subagentType` con el nombre resuelto de la definición
(`FlowTask Planner`, no `flowtask-planner`). El matcher prueba primero el `type`
exacto, después el `agent-key` normalizado y por último el sufijo tras el último
`:`; más de una coincidencia no aplica ningún override y lo registra.

## Catálogo de modelos

El catálogo base son los aliases `sonnet`, `opus`, `haiku` y `fable`. Si
`$.settings.read()` expone `availableModels` como un array no vacío de strings,
ese array reemplaza a los aliases. Un shape distinto se ignora. El Mod nunca
inventa el catálogo desde OpenCode ni desde otro runtime.

`inherit` no es un modelo: es la ausencia de override y se representa con la
opción de limpieza del core.

## Evento `agent.spawn`

Campos observados en `2.1.309`:

```json
{
  "tool_use_id": "toolu_...",
  "prompt": "...",
  "description": "...",
  "subagentType": "FlowTask Planner",
  "provider": { "plugin": "project", "tier": "user" },
  "parentModel": "claude-sonnet-5-5",
  "permissionMode": "acceptEdits",
  "background": false,
  "fork": false
}
```

- `model` está ausente cuando la invocación no lo fija.
- El flag de fork es `fork: boolean`. **No existe `resume` en
  `AgentSpawnInput`.** El engine ignora el modelo en un fork; el Mod se salta el
  evento y lo registra. Si una versión futura enviara `resume: true`, también se
  salta.
- Un fork no permite cambiar el modelo: no se presenta como aplicado.
- `$.agent.spawn` del mismo Mod no pasa por su propio hook `agent.spawn`.
- `$.agent.list()` es de sesión, no un catálogo de definiciones.

## Panel y superficies

`$.ui.open({ id, title })` abre un pane y `ui.render` con
`{ component: "Pane" }` dibuja su cuerpo. `$.ui.resolve(e)` entrega la tabla de
elementos de la superficie:

| Superficie | `Select` | `Input` | `Button` |
| --- | --- | --- | --- |
| terminal | sí | sí | sí |
| desktop | sí | sí | sí |
| vscode | sí | sí | sí |
| mobile | no | no | sí |

Sin `Select`, el pane muestra las claves, el texto de comando y un botón de
refresco; no se inventa un control. En `-p`, Agent SDK o cloud no se dibuja
nada: el comando sigue funcionando y el listado va a `$.ui.log` (o a
`$.ui.toast` si el primero falta). No se promete dibujo en esas superficies.

No hay API de keybinding global. El comando se registra con
`$.command.register({ name, description, argumentHint, immediate: true })`.

## Distribución

El plugin se carga en desarrollo con `claude --plugin-dir <ruta>` y se valida con
`claude plugin validate <ruta>`. El manifest declara `destinations:
["claude-code"]`; el instalador de OpenCode descarta esa entrada antes de copiar
o registrar, de modo que la presencia del paquete no altera OpenCode. La copia y
el registro en el runtime de usuario pertenecen al mecanismo de instalación de
plugins de Claude Code, no a este paquete.

## Límites conocidos

- El store no es atómico entre sesiones: dos sesiones que escriben la misma clave
  se pisan. El Mod escribe una sola clave por acción.
- `agent.spawn` no permite fijar `effort`; la versión 1 sólo selecciona modelo.
- El modelo efectivo puede diferir del pedido si el engine aplica
  `availableModels` u otra política. El panel etiqueta el valor pedido como
  `requested` cuando no hay un valor observado.
- Un `agent.spawn` que falla en el Mod sigue su curso: los hooks capturan el
  error, lo registran como `[flowtask-model] ...` y devuelven `next(e)`.
