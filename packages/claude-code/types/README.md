# Tipos de Claude Code

`claude-code.d.ts` es una copia literal de la declaración publicada por Claude
Code para sus Mods (hooks modules). El paquete no la edita: se reemplaza cuando
se sube el piso de versión.

## Procedencia

| Dato | Valor |
| --- | --- |
| Fuente | `https://raw.githubusercontent.com/anthropics/claude-code/v2.1.309/mods/types/claude-code.d.ts` |
| Versión observada del binario | `2.1.309 (Claude Code)` |
| Tag de la fuente | `v2.1.309` |
| SHA-256 | `e51e637fbbebb2a6a49c4bdc3860a251c2ca2295884822dff0f4c3e3ec802163` |
| Bytes | `517451` |
| Líneas | `13440` |
| Fecha de captura | `2026-11-04` |

El encabezado del archivo dice `Written by Claude Code 2.1.277`: es el texto que
publica el release y no se corrige a mano. Las superficies usadas por el paquete
(`agent.spawn`, `$.store`, `$.session.version`, `$.command`, `$.ui`, `$.fs`,
`$.settings.read`) se contrastaron contra el binario `2.1.309` en el spike de
viabilidad; el detalle está en `COMPATIBILITY.md`.

## Cómo regenerarlo

1. Instalar el binario objetivo y ejecutar `claude --version`.
2. Probar `/plugin-types` dentro de una sesión con un plugin cargado por
   `--plugin-dir`. Si el comando escribe `.claude/types/claude-code.d.ts`,
   copiarlo tal cual.
3. Si `/plugin-types` no está disponible, descargar el archivo del tag exacto
   (`v<versión>`) y verificar el SHA-256 contra el archivo versionado.
4. Actualizar esta tabla, `COMPATIBILITY.md` y el piso de
   `src/capabilities.ts` si cambió la superficie.
