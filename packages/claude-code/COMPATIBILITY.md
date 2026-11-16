# Compatibilidad con Claude Code

El paquete se apoya en la API pública de Claude Code Mods (un plugin cuyo
comportamiento vive en un hooks module `register(on, options)`). Este documento
fija las decisiones que dependen de esa API y las observaciones que las
sostienen.

## Versión

| Constante | Valor | Motivo |
| --- | --- | --- |
| `MIN_VERSION` | `2.1.287` | primera versión con Mods públicos y `agent.spawn` |
| `RECOMMENDED_VERSION` | `2.1.309` | resumen estable, discovery del gateway y alias preservados verificados |
| `SETTINGS_READ_VERSION` | `2.1.304` | lectura del perfil (`env`) y del helper de credencial |

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

El catálogo no es una lista fija: se obtiene del gateway que el motor ya usa en
cada apertura del pane y en cada reintento.

- **Fuente**: `GET {ANTHROPIC_BASE_URL}/v1/models`, con
  `ANTHROPIC_API_BASE_URL` como alternativa. La respuesta no se guarda.
- **Credencial**: si `settings.apiKeyHelper` existe, se ejecuta con
  `process.run` y su salida se envía como `x-api-key`. Si la ejecución no está
  disponible o falla, se lee el archivo del helper. Sin credencial la consulta se
  intenta igual; un `401` o `403` activa el fallback. La key nunca se registra ni
  se persiste.
- **Forma**: la respuesta puede ser un array o un objeto con `data`, `models` o
  `items`. El provider sale de `provider`/`providerName`/`owned_by` o del prefijo
  de la referencia; el target sale de `target_model`/`targetModel` o de la
  referencia completa (`id` o `display_name`). Las entradas sin provider se
  omiten y los targets duplicados se deduplican.
- **Regla de soporte**: se leen los targets `ANTHROPIC_MODEL`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL` y
  `ANTHROPIC_DEFAULT_OPUS_MODEL`. Se normaliza (minúsculas, sin `[1m]`, sin
  `(1M context)`, espacios colapsados) y solo se ofrece el modelo cuyo target
  coincide con `sonnet` o `haiku`. El target de `opus` se excluye porque el motor
  lo sustituye por el modelo principal. Los modelos sin target preservado se
  ocultan.
- **Conversión**: la elección se guarda como el alias corto `sonnet` o `haiku`;
  el router lo resuelve al proveedor y modelo reales del perfil. El pane muestra
  el target actual al lado del valor guardado. Para la vía de calidad, si el
  target principal no coincide con `sonnet`, se guarda el selector principal.
- **Fallback**: si el gateway no responde, la credencial falla, la respuesta es
  inválida o no hay modelos soportados, el catálogo contiene solo la vía de
  calidad; el pane muestra un aviso con `Reintentar` y el comando `list`
  antepone el aviso. No se lee un cache ni se escribe la lista en `$.store`.
- **Herencia**: sin override, el Mod no escribe ningún modelo y `agent.spawn`
  devuelve `next(e)`; el subagente hereda la conversación en curso. Quitar la
  elección vuelve a ese estado.

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

Con `Select`, cada fila de agente muestra el nombre, el valor actual, un selector
por sección de proveedor y el botón Clear. La sección `All` no se dibuja. Un
agente sin override muestra `hereda (calidad: <modelo principal>)`. Si el
catálogo no cargó, el pane muestra el aviso y el botón `Reintentar`; sin error,
el botón es `Refrescar`.

Sin `Select`, el pane muestra las claves, el texto de comando y un botón de
refresco; no se inventa un control. En `-p`, Agent SDK o cloud no se dibuja
nada: el comando sigue funcionando y el listado va a `$.ui.log` (o a
`$.ui.toast` si el primero falta). No se promete dibujo en esas superficies.

No hay API de keybinding global. El comando se registra con
`$.command.register({ name, description, argumentHint, immediate: true })`.

## Distribución

La raíz del repositorio publica el marketplace `agent-model-selector`; su
entrada `flowtask-model` apunta a `./packages/claude-code`, de modo que el ref
instalable es `flowtask-model@agent-model-selector`. El manifest declara
`destinations: ["claude-code"]` y la versión del plugin iguala el tag de
release.

La copia y el registro en el runtime de usuario pertenecen al gestor de plugins
de Claude Code, no a este paquete: ningún archivo se copia al proyecto y retirar
el checkout del repositorio no afecta lo instalado. Para desarrollo se carga el
paquete local con `claude --plugin-dir <ruta>` y se valida con
`claude plugin validate <ruta>`. El instalador de OpenCode descarta esta entrada
antes de copiar o registrar, de modo que la presencia del paquete no altera
OpenCode.

## Límites conocidos

- El store no es atómico entre sesiones: dos sesiones que escriben la misma clave
  se pisan. El Mod escribe una sola clave por acción.
- `agent.spawn` no permite fijar `effort`; la versión 1 sólo selecciona modelo.
- El modelo efectivo puede diferir del pedido si el engine sustituye el target.
  La regla de soporte oculta los targets que no se preservan; el pane muestra el
  target del catálogo y la verdad del modelo efectivo queda en el transcript del
  subagente.
- La credencial del proveedor económico vive en el perfil y la usa el gateway. El
  Mod no la lee, no la registra y no la persiste.
- Un `agent.spawn` que falla en el Mod sigue su curso: los hooks capturan el
  error, lo registran como `[flowtask-model] ...` y devuelven `next(e)`.
