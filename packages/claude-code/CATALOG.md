# Catálogo de modelos del selector

Informe de la fuente viva del catálogo para el Mod de Claude Code. No contiene
credenciales ni valores de configuración secretos.

## Fuente

El catálogo se obtiene del gateway que el motor ya usa, en cada apertura del
selector y en cada reintento:

- URL base: `settings.env.ANTHROPIC_BASE_URL`; si falta,
  `settings.env.ANTHROPIC_API_BASE_URL`.
- Ruta: `GET {base}/v1/models` con `anthropic-version: 2023-06-01`.
- Credencial: si `settings.apiKeyHelper` es un string no vacío, se ejecuta el
  helper y su salida se envía como `x-api-key`. Si la ejecución no está
  disponible o falla, se lee el archivo del helper y se extrae el literal
  entrecomillado. La credencial vive solo en memoria: no se registra ni se
  persiste.
- Sin credencial la consulta se intenta igual; un `401` o `403` produce el
  fallback a la vía de calidad.
- Tiempo máximo: 5 segundos. Un timeout produce el mismo fallback que una caída.
- La respuesta no se guarda: no hay cache ni lista fija.

Medición ejecutada con el perfil activo:

| Caso | Resultado |
| --- | --- |
| `GET /v1/models` con la credencial del helper | `200`, `content-type: application/json; charset=utf-8` |
| `GET /v1/models` sin `x-api-key` | `401` |
| Respuesta | `{ "object": "list", "data": [ ... ] }` con 9 entradas |

Campos observados por entrada:

| Campo | Ejemplo | Uso |
| --- | --- | --- |
| `id` | `OpenCode Go/glm-5.3-flash` | referencia completa proveedor/modelo |
| `owned_by` | `OpenCode Go` | proveedor de la entrada |
| `display_name` | `GLM-5.3-Flash` | etiqueta legible, sin proveedor |
| `object`, `created`, `type` | `model`, `0`, `model` | metadatos del protocolo |

No hay `target_model` ni `targetModel` en la respuesta viva. El proveedor y el
modelo viajan en `id` y en `owned_by`; `display_name` es solo la etiqueta
legible. El cache del motor (`gateway-models.json`) usa otra forma
(`display_name` con el proveedor incluido) y está desactualizado; el producto no
lo lee.

## Perfil activo

Valores del perfil en el momento de la medición:

| Variable | Valor |
| --- | --- |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:3456` |
| `ANTHROPIC_MODEL` | `Claude Code API/claude-sonnet-5-5[1m]` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `Claude Code API/claude-sonnet-5-5[1m]` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `OpenCode Go/glm-5.3-flash[1m]` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `OpenCode Go/glm-5.3[1m]` |
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` | `1` |
| `CLAUDE_CODE_SUBAGENT_MODEL` | `OpenCode Go/glm-5.3-flash` |

`apiKeyHelper` apunta al helper del perfil; su contenido no se reproduce aquí.

El perfil todavía declara `CLAUDE_CODE_SUBAGENT_MODEL`. Mientras esa variable
exista, un subagente sin override no hereda la conversación: recibe el modelo
barato. La herencia de calidad exige quitarla del perfil y regenerar el entorno,
paso que se coordina fuera del repositorio.

## Testigos

Observaciones ejecutadas con Claude Code 2.1.309 y el Mod cargado. La verdad es
`message.model` en el transcript del subagente y el uso registrado por el
gateway; el aviso `unrecognized_model` aparece incluso cuando el modelo efectivo
es correcto y no se usa como discriminador.

| Testigo | Valor pedido | `message.model` | Gateway | Veredicto |
| --- | --- | --- | --- | --- |
| Alias `sonnet` | `claude-code/sonnet` | `claude-sonnet-5-5` | `Claude Code API/claude-sonnet-5-5`, 200 | efectivo |
| Alias `haiku` | `claude-code/haiku` | `glm-5.3-flash` | `OpenCode Go/glm-5.3-flash`, 200 | efectivo |
| Alias `opus` | `claude-code/opus` | `claude-sonnet-5-5` | `claude-sonnet-5-5`, 200; sin llamada a `glm-5.3` | sustituido |
| Modelo fuerte sin alias | `OpenCode Go/glm-5.3` | `claude-sonnet-5-5` | `claude-sonnet-5-5`, 200 | sustituido |

Referencias de los transcripts:

- `~/.claude-mix/projects/-Users-saez-Proyects-FlowTask/3740765e-6e3a-4667-8967-9429b13cae7a/subagents/agent-a214906a1df712e3a.jsonl`
  (sonnet).
- `~/.claude-mix/projects/-Users-saez-Proyects-FlowTask/7df3a750-6ada-4699-b1e4-ba99f3f13c90/subagents/agent-ac68ed7d5dcca5f2e.jsonl`
  (haiku).
- `~/.claude-mix/projects/-Users-saez-Proyects-FlowTask/9d4181b1-969b-49e7-bd90-d5eabbef1b74/subagents/agent-a9eaf0375a8a635e0.jsonl`
  (opus).
- `~/.claude-mix/projects/-Users-saez-Proyects-FlowTask/de2badad-23fb-41e4-9d82-89cdc0727fe0/subagents/agent-a5989d84e872cc61b.jsonl`
  (modelo fuerte sin alias).

La credencial directa del proveedor económico ya fue validada (`GET` de uso con
`200`) y el uso del gateway confirma llamadas efectivas al proveedor para el
modelo flash. Esta pasada no leyó la key del proveedor: el Mod no posee ni
registra esa credencial, y la comparación se apoya en esa evidencia ejecutada.

## Regla de soporte

El selector ofrece un modelo del gateway solo si su referencia normalizada
coincide con el target de un tier que el motor preserva en `agent.spawn`:

1. Se leen del perfil activo los targets `main`, `sonnet`, `haiku` y `opus`.
2. Se normaliza cada referencia: minúsculas, sin sufijo entre corchetes (`[1m]`),
   sin sufijo `(1M context)`, espacios colapsados; el proveedor es el segmento
   anterior a la primera barra y el modelo el resto.
3. Se ofrece la entrada cuyo target coincide con `sonnet` o con `haiku`.
4. El target de `opus` se excluye siempre: el motor lo sustituye por el modelo
   principal y no llega al proveedor.
5. Las entradas sin target preservado se ocultan; no se prometen como
   funcionales.
6. Dos entradas con el mismo target se deduplican y se prefiere `sonnet`.

Con el perfil activo, la oferta resultante es:

| Entrada | Tier | Se muestra |
| --- | --- | --- |
| `Claude Code API/claude-sonnet-5-5` | `sonnet` | sí |
| `OpenCode Go/glm-5.3-flash` | `haiku` | sí |
| `OpenCode Go/glm-5.3` | `opus` (excluido) | no |
| `OpenCode Go/deepseek-v4.1-flash` | sin target preservado | no |
| `OpenCode Go/minimax-m3` | sin target preservado | no |
| `OpenCode Go/claude-haiku-5-5` | sin target preservado | no |
| `Claude Code API/claude-sonnet-5` | sin target preservado | no |
| `Claude Code API/claude-opus-5-5` | sin target preservado | no |
| `Claude Code API/claude-haiku-5-5` | sin target preservado | no |

La vía de calidad (el modelo principal) siempre está presente: si el gateway no
la devuelve, se sintetiza con el proveedor y el selector del perfil. Ante fallo,
timeout, credencial inválida, respuesta inválida o ausencia de modelos
soportados, el catálogo contiene solo la vía de calidad y el panel muestra el
aviso con la opción de reintentar.

## Veredicto

**PASS.**

- El gateway responde `200` con la oferta del proveedor económico y exige la
  credencial del perfil (`401` sin ella).
- La credencial se resuelve por `apiKeyHelper`; el Mod no lee ni persiste la key
  del proveedor.
- `sonnet` y `haiku` son efectivos en `agent.spawn`; `opus` y el modelo fuerte
  sin alias se sustituyen por el modelo principal.
- La respuesta viva usa `id`/`owned_by`/`display_name`; la implementación
  acepta esa forma y la forma con proveedor dentro de `display_name`, y oculta
  cualquier entrada sin target preservado.
- No hay lista fija ni cache del catálogo.
