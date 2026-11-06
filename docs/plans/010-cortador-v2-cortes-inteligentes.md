---
prd: docs/prds/010-cortador-v2-cortes-inteligentes.md
status: IN-PROGRESS
created: 2026-11-03_1759
---

# Plan de implementación: Cortador v2 — cortes inteligentes

## Overview

Extender Cortador v2 con recuperación local de proyectos, lotes de cortes atómicos y sugerencias geométricas/de pintura que siempre se previsualizan y requieren confirmación explícita. El trabajo seguirá client-side, mantendrá los originales de solo lectura y no tocará Cortador v1. La implementación queda condicionada a validar el flujo corte/export en un modelo real y, para pintura, a recibir un 3MF que realmente preserve la asignación por cara.

## Requisitos y decisiones confirmadas

- Las fronteras entre colores/materiales son **pistas**: proponer cortes y dejar que el usuario los revise; no dividir automáticamente cada región.
- La detección automática muestra candidatos con motivo/confianza y preview. Nunca se aplica un corte sin selección y confirmación explícita.
- La sesión conserva localmente el archivo fuente completo y lo restaura tras recargar sin pedir reselección; manejar denegación, cuota agotada, espacio insuficiente y fallo de escritura sin perder el proyecto activo.
- El usuario reexportará un 3MF con pintura real. `paint_2_Charmander mini.3mf` no contiene color por cara y **no es fixture válido** para probar esa función.
- Se mantienen las mediciones disponibles (no sustituirlas por estimaciones ni optimizar antes de perfilar): importación de los 9 STL, 0.21–2.18 s sin warnings; análisis, 1.7–6.2 s, todos `cuttable`; autointersección omitida en Bulbasaur, Squirtle y Gengar (>800k triángulos); Charmander STL (303,090 triángulos), `getSelectionData` 0.71 s y `suggestPerimeters` 26.18 s, con 3 candidatos (2 perímetros válidos y 1 autointersectado).
- El intento de automatizar `EngineService` desde Node CJS falló porque `manifold-3d` es ESM. No usar Node CJS. El smoke de Charmander vía Vitest/Vite pasó antes y después de la refactorización asíncrona. El primer smoke post-refactor detectó progreso .99→.98; al elevar el checkpoint de preparación del servicio a .995, el re-run pasó con 1,191,243 eventos monótonos y alcanzó commit/export STL/3MF. Falta comprobar la cancelación real desde la UI/worker.

## Arquitectura y archivos afectados previstos

- `src/components/tools/cortador-v2/cortador-v2-tool.tsx`: orquestación del flujo, candidatos, confirmaciones, recuperación/guardado y estados de error.
- `src/components/tools/shared/model-viewer-toolbar.tsx` (nuevo): presentación de controles estándar mediante callbacks, sin estado ni lógica de Three.js.
- `src/components/tools/posavasos/model-viewer.tsx` y `posavasos-tool.tsx`: adaptador de la barra compartida y comportamiento de expansión, preservando colocación de anilla.
- `src/lib/cutter2/worker/protocol.ts`, `src/lib/cutter2/worker/engine.worker.ts` y `src/lib/cutter2/client.ts`: solo si la operación nueva necesita nuevos tipos/métodos de worker; mantener mensajes y transferencias tipados.
- `src/lib/cutter2/engine/import/threemf.ts`, `src/lib/cutter2/engine/import/ModelImporter.ts`, `src/lib/cutter2/engine/core/types.ts` y/o `src/lib/cutter2/engine/service/EngineService.ts`: **zona protegida, condicional**. Solo plantear modificación para transportar color/material por triángulo si el 3MF de referencia confirma el formato y una prueba demuestra que un adaptador externo no basta.
- Nuevos módulos puros para persistencia/versionado de sesión, coordinación de cortes por lote y detección de fronteras de color, bajo `src/lib/cutter2/` (nombres finales se fijan durante implementación); cubrirlos con pruebas Vitest.
- `src/lib/cutter2/pipeline.test.ts` y tests nuevos junto a los módulos: TDD de geometría, persistencia y fallos/rollback.
- `src/components/tools/cortador-v2/` y el conjunto E2E existente: revisión de UX/accesibilidad e integración de navegador.
- `docs/reports/` y `docs/audits/`: benchmark/reporte reproducible y auditoría final según el flujo de trabajo del repositorio.

## DAG de ejecución

Las aristas `A → B` indican dependencia. Los nodos sin arista entre sí pueden ejecutarse en paralelo. `G` es gate de salida, no una promesa de superar los bloqueos de datos actuales.

```yaml
nodes:
  A: { tarea: "Preparar línea base, inventario y verificación de solo lectura", size: M, entrega: "reporte de corpus y entorno" }
  B: { tarea: "Validar corte/export real con Vitest/Vite o navegador", size: L, entrega: "resultado reproducible en modelo real" }
  T: { tarea: "Auditar y cerrar progreso/cancelación efectiva", size: M, entrega: "operaciones largas cancelables sin estado parcial" }
  C: { tarea: "Definir contrato y pruebas de persistencia/recuperación local", size: M, entrega: "casos TDD para Blob, estados y cuota" }
  D: { tarea: "Implementar guardado/restauración transaccional de sesión", size: L, entrega: "recarga restaura fuente y proyecto o informa recuperación" }
  E: { tarea: "Añadir y probar coordinación atómica de varios cortes", size: L, entrega: "lote con preview, commit/rollback y undo" }
  F: { tarea: "Añadir candidatos geométricos con preview y confirmación", size: L, entrega: "candidatos revisables; nada se aplica solo" }
  V: { tarea: "Compartir barra estándar de visor entre Cortador v2 y Posavasos", size: M, entrega: "zoom/vistas/grid/alambre/expandir consistentes, motores separados" }
  P: { tarea: "Obtener y caracterizar fixture 3MF realmente pintado", size: S, entrega: "fixture con mapping documentado", bloqueado_por: "archivo del usuario" }
  Q: { tarea: "Diseñar parser/adaptador para atributos de color por triángulo", size: M, entrega: "decisión de frontera y pruebas del mapping", bloqueado_por: P }
  R: { tarea: "Proponer fronteras de pintura como candidatos revisables", size: L, entrega: "candidatos ligados a etiquetas con preview/confirmación", bloqueado_por: Q }
  S: { tarea: "Validar round-trip color y corte/export en fixture pintado", size: M, entrega: "comparación de etiquetas antes/después", bloqueado_por: R }
  G: { tarea: "Regresión integral, reporte y auditoría de alcance", size: M, entrega: "checklist AC y bloqueos remanentes" }
edges:
  - [A, B]
  - [B, T]
  - [A, C]
  - [B, E]
  - [B, F]
  - [A, V]
  - [C, D]
  - [E, G]
  - [D, G]
  - [F, G]
  - [V, G]
  - [P, Q]
  - [Q, R]
  - [R, S]
  - [S, G]
  - [B, G]
  - [T, G]
critical_path: [A, B, E, G]
parallel_lanes:
  - [C, P]
   - [D, E, F, V]
  - [Q, E, F]
```

`P` está bloqueado hasta que el usuario entregue el 3MF; `B` no se considera completado hasta verificar corte **y** export reales. Se puede entregar persistencia y flujo geométrico sin `P`, pero no declarar completos AC-007 ni el alcance integral de pintura.

## Fases e implementación

### Fase 0 — Evidencia y gates de validación

1. **Congelar el corpus de entrada** (`C:\Users\Marcelo\Downloads\Pokemon+mini+Toys_stls`, nueve STL)
   - Acción: registrar nombres, tamaños, hashes y metadatos antes de probar; usar archivos como solo lectura. No copiar versiones modificadas al corpus.
   - Por qué: asegurar AC-001 y detectar cualquier modificación accidental.
   - Dependencias: ninguna. DAG `A`.
   - Riesgo: medio (el corpus no necesariamente está dentro del repo); documentar ubicación/entorno sin incorporar binarios grandes.
   - Verificación: comparar hash/metadata antes y después.

2. **Consolidar línea base ya medida** (`docs/reports/`)
   - Acción: registrar las métricas listadas arriba con entorno, navegador/proceso y alcance; señalar el límite de autointersección para los 3 modelos >800k triángulos. No reemplazar datos sin reproducir entorno y procedimiento.
   - Por qué: las optimizaciones deben responder a un cuello de botella evidenciado; `suggestPerimeters` (26.18 s) merece perfilado, pero aún no justifica una optimización concreta.
   - Dependencias: ninguna; DAG `A`.
   - Riesgo: medio; los tiempos dependen de hardware.
   - Verificación: reporte reproducible con condiciones y advertencias.

3. **Cerrar la validación representativa de corte/export real** (`src/lib/cutter2/pipeline.test.ts`, tests Vitest y navegador)
   - Acción: prueba de integración Vitest sobre geometría sintética más smoke real Charmander, cubriendo carga, selección, candidatos, perímetro, preview, commit y export STL/3MF. No automatizar `EngineService` desde Node CJS: `manifold-3d` es ESM y ese enfoque ya falló.
    - Resultado: Charmander completó corte en 50.38 s. Se rechazó el perímetro ajustado; el suave pasó separación y preview, se confirmó y generó dos piezas. Ambos STL reimportaron cerrados/cortables sin bordes abiertos. El 3MF contiene dos objetos mesh y assembly con dos component refs, nombres y el mismo total de triángulos; el parser de entrada actual aplana el assembly a una componente conectada.
    - Revalidación post-refactor cooperativo: smoke Vitest/Vite 1/1 pasó en 83.88 s. Conservó los 303,090 triángulos fuente, las 106,061 caras seleccionadas, dos candidatos geométricos y una frontera de selección; generó preview válido, hizo commit de dos piezas, exportó y reimportó dos STL y un 3MF con el mismo total de triángulos. El progreso fue monótono con menos de 1,000 notificaciones, frente a 1,191,243 antes del throttling.
   - Pendiente separado: ejecutar la matriz de corte/export en los otros ocho STL y registrar resultados/costos; AC-001 no se cierra con este caso representativo.
   - Por qué: demostrar una ruta real antes de diseñar lote y sesiones, sin extrapolar a todo el corpus.
   - Dependencias: inventario y línea base (`A`). DAG `B`.
   - Riesgo: alto, por duración/memoria de mallas reales y compatibilidad WASM/browser. Si falla, registrar causa y mantener el gate abierto.
   - Verificación: artefactos exportados válidos, watertight según validaciones actuales, sin mutar originales; reporte por archivo y causas de pruebas no ejecutadas.

4. **Auditar progreso, cancelación y estado consistente** (`src/lib/cutter2/client.ts`, `src/lib/cutter2/worker/protocol.ts`, `src/lib/cutter2/worker/engine.worker.ts`, UI v2; motor solo con necesidad registrada)
    - Acción: escribir pruebas de worker/UI para una operación larga; comprobar que el progreso identifica etapa/avance, cancelar detiene el trabajo y que cancelación/fallo no publica geometría parcial. Reutilizar los mecanismos existentes cuando alcancen; cambiar únicamente el punto que las pruebas demuestren incompleto. MaxFlow, curvatura y BoundarySuggestionEngine ceden cooperativamente; los eventos de progreso se limitan sin dejar de revisar cancelación. Falta E2E del click de cancelar y consistencia de estado.
   - Por qué: cumplir AC-003 y evitar que una operación pesada deje el documento fuera de sincronía.
   - Dependencias: smoke de corte/export real completado en Charmander (`B`); DAG `T`.
   - Riesgo: alto si una operación WASM no puede interrumpirse cooperativamente; medir y reportar el límite en vez de mostrar una cancelación falsa.
     - Verificación TDD: unit tests de cancelación en MaxFlow/curvatura/BoundarySuggestionEngine, progreso monótono limitado y no-publicación en cancelación pasan. Falta E2E cancelando desde el botón UI con un modelo pesado y comprobando estado.

4a. **Mantener controles de perímetro pequeños visibles y seleccionables** (`src/components/tools/cortador-v2/viewer.tsx`, helper/tests de picking)
    - Acción: dibujar marcadores con tamaño fijo en pantalla y mayor contraste; filtrar puntos proyectados fuera del frustum y usar un radio de picking de 18 px CSS.
    - Por qué: el reporte del usuario mostró 11 puntos ilegibles sobre un perímetro de 7,9 mm.
     - Verificación: tests unitarios de marcador, nearest-hit y clipping; inspección visual en navegador cuando la pestaña esté disponible.

4b. **Unificar barra estándar de visor en Cortador v2 y Posavasos** (`src/components/tools/shared/model-viewer-toolbar.tsx`, adaptadores de ambos visores)
     - Acción: compartir una barra vertical derecha por callbacks para cámara, zoom, cuadrícula, alambre y expansión/restauración; añadir control de zoom/expansión al Cortador. Mapear presets comunes en ambos renderers y conservar presets/controles extra como extensiones.
     - Por qué: el usuario eligió una barra común para que ambos visores y sus acciones estándar no se perciban como herramientas diferentes.
     - No debe: fusionar renderers, ciclo de render ni interacciones de dominio; mantener pincel/perímetros y anilla sin cambios. No tocar Llavero.
      - Resultado: tests de callbacks/ARIA y presets Z-up pasan; en navegador ambas rutas exponen la barra, expanden a viewport completo y Escape restaura. No se capturó screenshot post-cambio.
      - Verificación pendiente: recorrido visual de zoom/presets/cuadrícula/alambre en ambas herramientas.

**Entregable de fase:** baseline/limitaciones y smoke reproducible de corte+export real completados en Charmander. Los checkpoints y progreso monótono limitado de sugerencias, incluida curvatura, pasan unit tests y smoke real; `T` sigue abierto hasta verificar cancelación desde worker/UI y estado consistente. No optimizar ni construir el lote hasta cerrar `T`.

#### Justificación acotada para la zona protegida (AC-003)

- Evidencia reproducible: `suggestPerimeters` tardó 26.18 s en Charmander; en
  `EngineService.suggestPerimeters` solo hay un `task.checkpoint` previo y luego
  se ejecuta síncronamente `BoundarySuggestionEngine.suggestPerimeters`. Esa
  función construye tres problemas de corte mínimo (`suave`, `inner`, `outer`)
  y llama a `MaxFlow.solve` sin puntos de cesión. En ese intervalo el worker no
  puede despachar el mensaje `cancel`.
- Alternativas consideradas: dejar el único checkpoint no cumple cancelación;
  terminar/recrear el worker pierde el `EngineService` y su documento actual;
  agregar solo checkpoints antes/después sigue bloqueando durante el trabajo.
- Decisión seleccionada: introducir checkpoints cooperativos y progreso acotado en
  las pasadas de sugerencias y MaxFlow, sin cambiar costes, selección de lados,
  candidatos ni geometría. Pasos de algoritmo síncronos restantes se deben medir;
  si alguno sigue bloqueando significativamente, se registra como limitación o
  se añade punto de cesión en el mismo alcance mínimo.
- Hallazgo adicional de revisión: `BoundarySuggestionEngine` llama a
  `computeCurvature` entre checkpoints. El cálculo síncrono recorre aristas y
  vértices, con hasta 150 iteraciones de suavizado para dos campos, por lo que
  también puede bloquear el mensaje `cancel`. Resolverlo sin cambiar firmas de
  consumidores síncronos: conservar `computeCurvature` síncrona y crear una ruta
  cooperativa compartiendo el mismo iterador de pasos; usar esa ruta solo desde
  `BoundarySuggestionEngine`. El progreso se publicará al cambiar de fase o tras
  avance significativo; checkpoints sin mensaje seguirán cediendo y comprobando
  cancelación. No se cachearán resultados parciales.
- Hallazgo MEDIUM adicional: `EngineService.getSelectionData` realiza también
  `computeCurvature(ctx)` síncrono entre checkpoints .1 y .5; al entrar al paso 2
  no se podía cancelar ni se mostraba botón, y el progreso quedaba detenido cerca
  de 10%. Además, la ruta cancelable `suggestPerimeters` llama a
  `selectedComponents`, `fillHoles` y `extractLoops` síncronos sobre caras,
  halfedges y BFS antes/después de MaxFlow. Checkpoints solo alrededor de esos
  helpers no permiten al worker procesar cancelación dentro de sus recorridos.
- Alternativas consideradas para la nueva evidencia: no hacer cancelable
  `getSelectionData` incumple el contrato de operaciones largas; abortar/recrear el
  worker pierde el documento; convertir todos los consumidores síncronos de
  `computeCurvature` y helpers afecta APIs fuera del flujo; checkpoints solo antes
  y después no interrumpen la fase. Decisión: usar la variante cooperativa de
  curvatura también en `getSelectionData`, habilitar su cancelación UI y añadir
  variantes cooperativas para los helpers recorridos desde `suggestPerimeters`,
  preservando las firmas síncronas para otros callers. La ruta de `segmentMesh`
  se ampliará solo si la prueba/medición muestra que sigue bloqueando tras consumir
  la curvatura cacheada.
- Alternativas consideradas para curvatura: dejarla síncrona incumple
  cancelación en mallas grandes; volver async todos los consumidores amplía la
  superficie innecesariamente; duplicar ambos algoritmos arriesga deriva
  numérica. La ruta compartida conserva el cálculo numérico y la cache actual.
- Contrato específico: en contextos independientes, arrays de la variante
  cooperativa idénticos a la síncrona; cancelar durante una pasada de más de 512
  aristas lanza `CancelledError` sin cache parcial; progreso monótono con
  notificaciones acotadas.
- Contrato TDD: una tarea cancelada durante el cálculo termina con
  `CancelledError`, no publica candidatos/resultados parciales y conserva el
  documento previo; una tarea completa devuelve los mismos candidatos y orden
  que antes, con progreso monótono que termina en 1. La cancelación durante
  `getSelectionData` no publica datos de selección parciales; recorridos largos de
  regiones/lazos ceden al event loop y mantienen acotadas las notificaciones.
- Archivos previstos en la excepción: `src/lib/cutter2/engine/perimeter/BoundarySuggestionEngine.ts`,
  `src/lib/cutter2/engine/perimeter/maxflow.ts`,
  `src/lib/cutter2/engine/service/EngineService.ts` y
  `src/lib/cutter2/engine/analysis/curvature.ts` (solo la ruta cooperativa compartida),
  `src/components/tools/cortador-v2/cortador-v2-tool.tsx` para habilitar cancelación
  de selección; `SmartSelection.ts` queda condicional a evidencia de bloqueo durante
  segmentación cacheada. Se mantiene intacto Cortador v1 y se cubrirá con pruebas
  de cancelación durante selección/regiones/lazos, ausencia de resultados parciales,
  igualdad numérica/progreso acotado y el smoke Charmander ya validado.

### Fase 1 — Sesiones locales recuperables

5. **Escribir contratos y pruebas fallidas primero** (`src/lib/cutter2/session/*.test.ts` y módulo nuevo)
   - Acción: fijar esquema versionado del proyecto (fuente Blob, nombre/formato/hash, estado del documento, selecciones, parámetros y metadatos mínimos), migración y estados de recuperación. Especificar cuota, almacenamiento denegado, blob corrupto/ausente y versión incompatible.
   - Por qué: recuperar el archivo completo sin reselección no puede depender de `File` en memoria.
   - Dependencias: contrato de estado serializable con UI; DAG `C`, paralelo con recepción de fixture `P`.
   - Riesgo: alto por límites variables y serialización de proyectos grandes.
   - TDD/verificación: pruebas rojas para CRUD, reload lógico, upgrade, persistencia del blob y errores de cuota; fake IndexedDB en unit tests.

6. **Implementar persistencia local transaccional** (`src/lib/cutter2/session/` nuevo; `src/components/tools/cortador-v2/cortador-v2-tool.tsx`)
   - Acción: persistir fuente completa en IndexedDB; guardar solo estados consistentes. Anticipar tamaño cuando sea posible; manejar cuota/`QuotaExceededError`, denegación y fallo transaccional con mensaje accionable; conservar el último guardado válido. Restaurar en orden: verificar registro/blob → recrear proyecto → rehidratar estado. Si hay incompatibilidad/corrupción, ofrecer recuperación segura sin bloquear nueva importación.
   - Por qué: cumplir la decisión del usuario preservando privacidad y evitando restauraciones parciales.
   - Dependencias: contrato/tests `C`; en paralelo con `E` una vez acordado estado persistible.
   - Riesgo: alto. No prometer almacenamiento ilimitado; si falla, mantener el proyecto en memoria e informar, sin borrar el último guardado ni degradar a solo parámetros.
   - Verificación: TDD de escritura atómica, recarga, blob grande, cuota, almacenamiento denegado, corrupción y rollback; E2E recargando y comprobando que no se pide reselección tras guardado exitoso.

**Entregable de fase:** proyecto recuperable con archivo local completo y fallos de cuota explícitos.

### Fase 2 — Varios cortes atómicos

7. **Definir operaciones y casos TDD para lote** (`src/lib/cutter2/batch/*.test.ts` o junto a `pipeline.test.ts`)
   - Acción: probar dos cortes, preview de conjunto, fallo intermedio, cancelación, rollback, nombres, undo/redo y validez de piezas/export.
   - Por qué: ningún corte del lote debe quedar publicado si otro falla.
   - Dependencias: `B`; DAG `E`.
   - Riesgo: alto si commits actuales mutan documento por corte.
   - Verificación: comparar documento antes/después; demostrar rollback integral con pruebas inicialmente fallidas.

8. **Implementar previsualización y commit/rollback del lote** (`src/components/tools/cortador-v2/cortador-v2-tool.tsx`, coordinador nuevo bajo `src/lib/cutter2/`; protocolo solo si hace falta)
   - Acción: configurar/revisar todos los cortes, validar previews antes de aplicar, confirmar explícitamente el lote y publicar partes identificables/exportables. Fallos o cancelación descartan previews y conservan el último estado consistente.
   - Por qué: AC-005, sin resultado parcial y con undo/redo.
   - Dependencias: TDD de lote y gate `B`.
   - Riesgo: alto; evitar desincronización entre rollback UI/worker/documento.
   - Verificación: pipeline Vitest, pruebas worker/UI y E2E con lote exitoso y fallo forzado; confirmar ausencia de cambios parciales.

**Entregable de fase:** lote revisable, atómico, deshacible y exportable.

### Fase 3 — Detección geométrica revisable

9. **Definir fixtures y tests de ranking/validación** (`src/lib/cutter2/suggestions/*.test.ts`, fixtures sintéticas minimizadas)
   - Acción: cubrir cuello detectable, componentes separadas, falso positivo, sin candidato, candidato no válido/autointersectado, motivo/confianza y selección parcial.
   - Por qué: distinguir candidato de corte seguro y evitar falsos positivos silenciosos.
   - Dependencias: `B`; DAG `F`.
   - Riesgo: alto por variabilidad topológica; fixtures pequeñas, sin duplicar/mutar corpus.
   - Verificación: TDD de resultado, filtrado de inválidos y determinismo.

10. **Presentar candidatos con preview y confirmación** (`src/components/tools/cortador-v2/cortador-v2-tool.tsx`, módulo puro nuevo `src/lib/cutter2/suggestions/`)
   - Acción: mostrar candidatos con origen, motivo/confianza, validez y preview; permitir editar, elegir y descartar. Solo tras confirmación explícita enviar al flujo de corte/lote. Mostrar progreso, cancelación y errores accionables.
   - Por qué: AC-006 y decisión confirmada de no aplicar automáticamente.
   - Dependencias: fixtures (`F`); integración con lote después de `E`.
   - Riesgo: alto por coste de análisis; perfilar con Vitest/browser usando las mediciones existentes antes de optimizar.
   - Verificación: E2E: detectar → preview; descartar → no corta; confirmar → corta; cancelar/cerrar → documento intacto.

**Entregable de fase:** candidatos geométricos informativos y revisables, sin aplicación implícita.

### Fase 4 — Pintura 3MF (bloqueada por fixture)

11. **Recibir y caracterizar el 3MF pintado correcto** (`fixtures` de prueba privadas o minimizadas; documentación del fixture)
    - Acción: el usuario reexporta un 3MF que conserve pintura real; inspeccionar estructura, grupos de color/material, atributos por triángulo (`pid`/`pindex` u otra representación) y consistencia de malla. No usar `paint_2_Charmander mini.3mf`: se verificó que no expone color por cara.
    - Por qué: parser/mapping no se pueden diseñar ni aceptar sin archivo de referencia.
    - Dependencias: entrega del usuario. DAG `P`.
    - Riesgo: alto; pintura podría usar extensión propietaria/textura no cubierta.
    - Verificación: fixture cotejable con asignación por cara de la fuente; documentar semántica y limitaciones.

12. **Resolver frontera y contrato de atributos de pintura** (`src/lib/cutter2/engine/import/threemf.ts`, `ModelImporter.ts`, `engine/core/types.ts`, `worker/protocol.ts` si se justifica; registrar decisión)
    - Acción: antes de tocar `src/lib/cutter2/engine/**`, dejar constancia de por qué un adaptador externo no basta, archivos/campos afectados, contrato de etiquetas por triángulo y preservación en transformaciones/cortes/export. Probar primero parser con fixture. Cambiar solo lo requerido; sin refactor lateral ni regenerar motor.
    - Por qué: `parse3MF` devuelve soup de triángulos, nombres y warnings y hoy pierde propiedades por cara; la PRD justifica ampliar parser/protocolo para preservar semántica.
    - Dependencias: fixture y evidencia (`P`); DAG `Q`.
    - Riesgo: alto; formatos distintos, pérdida de etiquetas, transferencias de buffers y regresión.
    - Verificación: TDD con grupos/materiales, triángulos sin etiqueta, referencias inválidas, transformaciones/instancias y round-trip; Cortador v1 intacto. Si el formato requiere dependencia/cambio fuera de alcance, detener y escalar.

13. **Generar sugerencias en fronteras de color/material** (`src/lib/cutter2/` detector/adaptador, worker/UI v2 donde corresponda)
    - Acción: detectar regiones vecinas de etiquetas distintas y producir candidatos con preview/explicación del color/material. Tratar color como pista, no unión mecánica; validar geometría y permitir elegir/descartar.
    - Por qué: cumplir decisión de producto sin transformar cada cambio de color en corte.
    - Dependencias: mapping validado (`Q`), candidatos/preview (`F`) y lote (`E`). DAG `R`.
    - Riesgo: alto por color sin conectividad, múltiples fronteras, etiquetas ausentes, malla no manifold y fronteras que no separan volumen.
    - Verificación: fixture pintado → candidato → preview → confirmación explícita; no-op informado si no es cortable.

14. **Probar conservación en corte/export 3MF** (tests import/export de cutter2 y `src/lib/cutter2/pipeline.test.ts`)
    - Acción: comparar etiquetas antes/después y en round-trip; verificar que STL se informa sin pintura en vez de atribuir etiquetas inexistentes.
    - Por qué: no perder ni inventar información de color.
    - Dependencias: `R`; DAG `S`.
    - Riesgo: alto; exportador actual podría no conservar la propiedad documentada.
    - Verificación: parser→corte→export→reimport y comparación de geometría/etiquetas; bloquear salida si se pierde semántica.

**Entregable de fase:** cortes por pintura para la codificación validada por fixture. No se cierra sin el 3MF real.

### Fase 5 — Regresión, evidencia y salida

15. **Ejecutar matriz AC y cerrar reporte/auditoría** (`docs/reports/`, `docs/audits/`, tests/E2E)
    - Acción: ejecutar corpus de nueve modelos en solo lectura; tests unitarios de sesión, lote, sugerencias y parser; Vitest; E2E con reload, cancelación, elección de candidato, lote y export; flujo de pintura cuando exista fixture. Registrar estado, conteos, warnings, tiempos disponibles, entorno y causas de fallo/no ejecución.
    - Por qué: separar lo entregado de lo bloqueado con evidencia reutilizable.
    - Dependencias: `A`–`F`; `S` para AC-007. DAG `G`.
    - Riesgo: alto por memoria/tiempo; no ocultar autointersección omitida en modelos grandes.
    - Verificación: Vitest, lint, `npx tsc --noEmit`, build y recorrido en navegador según scripts existentes; tabla por modelo y auditoría del diff.

16. **Optimizar únicamente cuello medido** (solo archivos del módulo identificado por perfil)
    - Acción: perfilar selección, `suggestPerimeters`, corte y export; optimizar un cuello por vez con before/after en el mismo entorno y validación geométrica. Los 26.18 s de `suggestPerimeters` justifican perfilar, no una estrategia de optimización anticipada.
    - Por qué: AC-002 prohíbe complejidad especulativa.
    - Dependencias: baseline y flujo real probado (`A`, `B`); DAG `G`/trabajo posterior.
    - Riesgo: medio/alto, posible cambio geométrico.
    - Verificación: benchmark reproducible y tests con validez/watertight conforme a garantías actuales.

## Estrategia TDD y pruebas

- Por tarea: prueba de contrato que falle → confirmar fallo esperado → cambio mínimo → prueba objetivo → suite afectada → refactor. No empezar por UI sin contrato de worker/persistencia/lote.
- **Unitarias (Vitest):** persistencia versionada (Blob, transacciones, cuota, denegación, corrupción, migración); atomicidad/rollback; candidatos válidos/invalidos/descartados/sin resultado; parser 3MF con atributos por triángulo cuando haya fixture; no atribuir pintura a STL.
- **Integración:** `src/lib/cutter2/pipeline.test.ts` y nuevos tests carga→análisis→selección→preview→commit→undo/redo→export. Usar fixtures sintéticas/minimizadas; no modificar ni copiar como mutable los originales.
- **Worker/browser:** transferencias de buffers, cancelación efectiva y estado consistente. Validar con Vitest/Vite o navegador, nunca Node CJS directo; revisar progreso/errores.
- **E2E navegador:** reload restaura modelo sin reselección; almacenamiento lleno/denegado; sugerir sin aplicar; descartar/confirmar; lote exitoso y rollback; corte/export de Charmander real; pintura solo con fixture pintado.
- **Aislamiento:** confirmar que `src/lib/cutter/**`, `src/components/tools/cortador/**` y Llavero no cambian; Posavasos solo cambia en el alcance AC-009.
- **Salida:** Vitest, lint, TypeScript, build y E2E disponible. Registrar las pruebas no ejecutadas con causa; no afirmar corte/export real ni AC-007 si no se verificaron.

## Restricciones no negociables

- Este artefacto es un plan; no implementar código como parte de su creación.
- Originales del corpus de solo lectura: no escribir, convertir, renombrar ni borrar; usar fixtures derivadas/minimizadas.
- Cortador v1 intacto: no modificar `src/lib/cutter/**` ni `src/components/tools/cortador/**`.
- No alterar Llavero ni otras herramientas; Posavasos puede cambiar únicamente para implementar AC-009, según autorización del usuario. No añadir dependencias/servicios sin justificar y aprobar el alcance.
- Todo procesamiento y persistencia local en navegador; no transmitir archivos a servidor/nube.
- No modificar `src/lib/cutter2/engine/**` sin registrar previamente necesidad exacta, archivos, motivo, contrato, alternativas, tests y riesgos. La PRD justifica conceptualmente ampliar parser/protocolo para pintura, pero el cambio concreto espera el nuevo 3MF y mapping probado.
- Nunca ejecutar cortes sugeridos sin preview y confirmación explícita. Color/material es solo evidencia revisable.
- No declarar autointersección comprobada en Bulbasaur, Squirtle o Gengar; el análisis actual la omite por el límite de >800k triángulos.
- No optimizar especulativamente. El corte/export representativo Charmander está validado; perfilar `suggestPerimeters` antes de optimizaciones adicionales y mantener pendientes los otros ocho STL.

## Riesgos y mitigaciones

- **No llega 3MF con pintura por cara o usa extensión no soportada.** Mantener fase bloqueada; acordar soporte explícito, no inferir colores ni declarar AC-007 cumplido.
- **Almacenamiento local insuficiente.** IndexedDB transaccional, manejo de errores y conservación del último guardado válido; explicar el límite y no degradar silenciosamente a guardar parámetros.
- **Corte/export real falla o no termina en modelos grandes.** Mantener `B` abierto; registrar causa/progreso/memoria y no declarar validación completa; crear repro mínimo antes de modificar motor.
- **Cambios parser/protocolo alteran malla o export.** Aislamiento v2, fixture primero, round-trip de etiquetas, revisión del diff y no-regresión v1.
- **Candidato geométrico/de color inválido o costoso.** Mostrar evidencia/confianza, filtrar inválidos/no separables, permitir progreso/cancelación, preview/confirmación; el rechazo no muta documento.
- **Benchmarks no generalizan.** Registrar hardware/navegador/versiones; medir antes/después en igual entorno y no prometer rendimiento universal.

## Criterios de éxito y bloqueos

- [ ] Corpus de 9 STL importado/analizado y corte/export ejecutados donde viable, con tabla reproducible y hashes inalterados (AC-001).
- [ ] Toda optimización tiene benchmark pareado y pruebas geométricas (AC-002).
- [ ] Operaciones largas notifican progreso, se cancelan y preservan estado consistente (AC-003).
- [ ] Sesión restaura fuente Blob y estado sin reselección; cuota/límites se informan y no se descarta silenciosamente el último guardado (AC-004).
- [ ] Lotes previsualizables, atómicos, deshacibles y exportan partes válidas (AC-005).
- [ ] Candidatos geométricos con preview/razón/confianza; solo se aplican tras confirmación explícita (AC-006).
- [ ] Candidatos por pintura reflejan fronteras etiquetadas y conservan etiquetas en formato soportado (AC-007).
- [x] Cortador v2 y Posavasos comparten barra estándar y expansión, sin unificar motores ni interacciones de dominio (AC-009).
- [ ] Cortador v1, originales y herramientas ajenas a v2 permanecen sin cambios.

**Bloqueos restantes:** (1) el usuario debe reexportar/aportar un 3MF que exponga pintura por cara, requerido antes de decidir parser y probar AC-007; (2) la matriz de corte/export de los otros ocho STL sigue pendiente aunque los dos smoke de Charmander validan el gate representativo `B`; (3) falta un E2E de cancelación por worker/UI y confirmación de que cancelar mantiene el estado consistente. AC-009 se verificó mediante tests de callbacks y recorrido en browser de ambas rutas (barra, expansión y Escape); no se capturó screenshot ni se inspeccionó visualmente cada acción. `paint_2_Charmander mini.3mf` no resuelve el primer bloqueo. El plan está en progreso; el alcance total no se declarará completo hasta resolver los gates abiertos.
