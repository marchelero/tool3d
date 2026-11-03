# Informe de implementación — PRD 005

**Fecha:** 2026-10-25  
**Alcance:** selección y separación superficial del cortador STL/3MF.

## Resultado

La separación de zonas ahora se calcula a partir de una copia serializable de las
caras seleccionadas, no de un plano aproximado. El worker construye una pieza
cerrada extruyendo la selección hacia el interior, preserva su piel exterior y
valida las piezas resultantes con Manifold. El preview permite confirmar el
resultado calculado o cancelar y restaurar el estado anterior.

Se añadieron encastres configurables de espiga, llave anti-rotación y cola de
milano, con diámetro, longitud, holgura y cantidad. Cada cambio vuelve a calcular
el preview; una geometría inválida no sustituye las piezas visibles ni se habilita
para exportación.

## Cambios principales

- `src/lib/cutter/zones.ts`: captura compacta y validación del parche superficial.
- `src/lib/cutter/types.ts` y `prepare.ts`: operación superficial serializable para
  el worker.
- `src/lib/cutter/split.ts`: shell cerrada, extracción por profundidad, encastres y
  validaciones de topología y volumen.
- `src/components/tools/cortador/cortador-tool.tsx`: preview confirmable/cancelable,
  configuración de encastres y bloqueo de exportación durante cambios pendientes.
- `src/lib/cutter/report.ts`: información del encastre superficial en el informe.
- Tests de `zones`, `split` y `report` para selección, geometría plana/curva,
  integridad de piezas y variantes de encastre.

## Verificación ejecutada

| Comando | Resultado |
| --- | --- |
| `npm test` | Correcto: 6 archivos, 45 tests aprobados |
| `npx tsc --noEmit` | Correcto |
| `npm run lint` | Correcto |
| `npm run build` | Correcto: compilación Next.js 16.4.2 y generación estática |
| `git diff --check` | Correcto; Git solo avisó sobre normalización LF/CRLF |

La inspección visual manual del flujo interactivo queda pendiente; los tests
geométricos y las verificaciones de build no sustituyen esa revisión en navegador.

## Limitaciones conocidas

- El encastre se orienta usando el marco medio de la selección. En parches muy
  curvos o estrechos, Manifold puede rechazar la boolean; se conserva el estado
  aceptado y se informa el error para ajustar selección o medidas.
- La separación requiere un contorno cerrado y una profundidad que genere una
  shell válida. Selecciones completas, bordes ramificados y geometría degenerada
  se rechazan explícitamente.
