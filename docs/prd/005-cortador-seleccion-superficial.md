# PRD 005 — Rediseño de selección y separación del Cortador

## Objetivo

Hacer que separar una parte de una malla se sienta directo y predecible: el usuario
selecciona una zona sobre el modelo, ve la selección resaltada, ajusta cuánto
material se lleva, previsualiza el resultado real y recién entonces lo confirma.
Después puede configurar un encastre compatible y volver a previsualizarlo.

Este documento complementa `docs/prd/004-cortador.md`; no reemplaza importación,
reparación, los cortes rectos/curvos/por forma ni la exportación existente.

## Hallazgo que origina el cambio

La interfaz ofrece seleccionar caras y muestra un control de profundidad, pero la
acción «Separar zona» construye un plano aproximado a partir del borde. No usa el
control de profundidad ni conserva la superficie de las caras elegidas. La salida
puede ser muy distinta del área que el usuario vio resaltada.

## Alcance

- Selección por clic (varita contigua) y pintura con ratón; Shift suma y Alt resta.
- Resaltado inmediato de caras, contorno visible, cantidad de caras y área.
- Corte superficial basado en una copia de las caras seleccionadas, extruida hacia
  el interior por la profundidad indicada. La selección capturada no cambia si el
  usuario sigue editando el modelo.
- Previsualización del resultado geométrico calculado por el worker, con piezas de
  colores distintos, antes de aceptar. Confirmar conserva ese resultado; cancelar
  restaura el estado previo. Una previsualización pendiente no se puede exportar.
- Encastres disponibles para separación superficial: espiga, llave anti-rotación y
  cola de milano, con medidas y holgura editables. Cada cambio invalida la vista
  previa hasta recalcularla. Si el motor no puede construir un encastre válido,
  no aplica geometría parcial y explica el motivo.
- Las mallas siguen procesándose localmente con `manifold-3d`; las piezas finales
  deben pasar el diagnóstico de estanqueidad antes de exportarse.

## Fuera de alcance

- Usar el color 3MF como si describiera un volumen interior. El color solo sirve
  para guiar la selección superficial.
- Escultura, pintura volumétrica, superficies de unión arbitrarias diseñadas a
  mano, reparación automática de auto-intersecciones y cambios al lector/exportador.

## Criterios de aceptación

### AC-001 — Selección visible y editable

- **Escenario:** STL o 3MF reparado está cargado y la varita está activa.
- **Acción:** clicar una cara, ajustar tolerancia, pintar y usar Shift/Alt.
- **Esperado:** el área seleccionada se actualiza sobre la malla y el panel informa
  caras, área aproximada y profundidad; limpiar la selección quita el overlay.
- **No debe:** ejecutar un booleano ni modificar piezas/exportaciones al pintar.
- **Verificación:** prueba manual de interacción + tests de selección de caras.
- **Prioridad:** requerida.

### AC-002 — Separación sigue la superficie seleccionada

- **Escenario:** zona conectada con borde cerrado en una pieza válida.
- **Acción:** elegir profundidad y pedir previsualización.
- **Esperado:** el cortador conserva exactamente las caras seleccionadas como la
  piel exterior de la pieza extraída y desplaza la cara posterior hacia el interior
  según la profundidad; el resto de la malla queda como segunda pieza. Ambas
  piezas son watertight y la suma de volúmenes coincide con el original dentro de
  ±0.5 % (sin encastre).
- **No debe:** sustituir el área por un plano de mejor ajuste, alterar la pieza
  completa ni aceptar una selección sin borde cerrable.
- **Verificación:** tests geométricos con cara plana y parche curvo + inspección
  visual del preview.
- **Prioridad:** requerida.

### AC-003 — Confirmar o cancelar el preview

- **Escenario:** existe una separación superficial pendiente.
- **Acción:** inspeccionar y confirmar o cancelar.
- **Esperado:** confirmar adopta las piezas mostradas sin volver a calcularlas;
  cancelar restaura piezas y operaciones anteriores. Durante el preview la descarga
  queda bloqueada.
- **No debe:** confirmar geometría obsoleta después de cambiar profundidad,
  encastre u otra operación.
- **Verificación:** flujo manual de preview/cancelar/preview/confirmar y revisión
  del estado de exportación.
- **Prioridad:** requerida.

### AC-004 — Encastres configurables y atómicos

- **Escenario:** separación superficial previsualizable.
- **Acción:** elegir espiga, llave o cola de milano y ajustar diámetro, largo,
  holgura y cantidad.
- **Esperado:** el preview muestra ambas piezas con el encastre coincidente y las
  dos piezas siguen watertight; la tolerancia configura el alojamiento. Si no cabe,
  se conserva el preview anterior y se informa qué dimensión impide colocarlo.
- **No debe:** dejar una sola pieza modificada ni exportar una malla inválida.
- **Verificación:** tests de geometría por variante + flujo manual de configuración.
- **Prioridad:** requerida.

### AC-005 — Errores de selección o geometría

- **Escenario:** selección de toda la pieza, borde abierto/ramificado, profundidad
  degenerada o parche que produce una superficie auto-intersectada.
- **Acción:** solicitar preview.
- **Esperado:** se informa una causa accionable, el modelo aceptado no cambia y la
  exportación no recibe resultados parciales.
- **Verificación:** tests de rechazo y revisión manual del estado previo.
- **Prioridad:** requerida.

### AC-006 — Regresión de módulo

- **Escenario:** importación STL/3MF y cortes existentes.
- **Acción:** ejecutar pruebas, TypeScript, lint y build.
- **Esperado:** no hay regresiones en cortes rectos, curvos, por forma, export ni
  gate watertight.
- **Verificación:** `npm test`, `npx tsc --noEmit`, `npm run lint` y `npm run build`.
- **Prioridad:** requerida.
