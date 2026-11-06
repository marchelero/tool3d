# PRD 010 — Cortador v2: pruebas de modelos y cortes inteligentes

## Estado

**Decisiones de producto confirmadas; ejecución en curso por fases.** Validación
real de corte/export sigue abierta y la fase de pintura espera un 3MF que conserve
la asignación por cara.

## Objetivo

Probar Cortador v2 con los nueve STL proporcionados y priorizar mejoras de
rendimiento a partir de mediciones reales. Después, ampliar el flujo para restaurar
sesiones, definir varios cortes en una operación y proponer cortes automáticos por
geometría y/o por pintura/material 3MF, con revisión antes de aplicarlos.

## Contexto técnico verificado

- La carpeta indicada contiene nueve STL binarios, 298,697,056 bytes en total y
  5,973,926 triángulos según los contadores binarios de sus encabezados. El mayor
  archivo es `obj_4_squirtle mini.stl` (71,792,184 bytes; 1,435,842 triángulos).
- La carpeta incluye ahora `paint_2_Charmander mini.3mf` (4,253,218 bytes).
  STL no codifica colores/materiales de superficie de forma interoperable.
- Prueba local de lectura: los nueve STL importan sin warnings y conservan sus
  conteos de triángulos; importación directa tomó 0.21–2.18 s. La suma de RSS por
  proceso después de importar fue aproximadamente 155–454 MB.
- Análisis local con el motor: los nueve modelos son una componente cada uno,
  cerrados y `cuttable`; no reportan bordes abiertos, aristas no-manifold, normales
  inconsistentes ni caras degeneradas. Los seis modelos bajo 800k triángulos sí
  revisaron autointersecciones y encontraron: Pikachu 85, Charmander 6, Snorlax 12,
  Charizard 0 (y dos vértices de contacto), Mewtwo 10 y Eevee 2. Bulbasaur,
  Squirtle y Gengar no revisaron autointersecciones por el límite del analizador
  para mallas de más de 800k triángulos. Análisis: 1.7–6.2 s por proceso.
- Inventario de entrada (todos `cuttable=true`; ningún original fue escrito):

  | Archivo | Bytes | Triángulos | Autointersecciones |
  | --- | ---: | ---: | --- |
  | `obj_1_Pikachu mini.stl` | 10,586,884 | 211,736 | 85; 16 vértices de contacto |
  | `obj_2_Charmander mini.stl` | 15,154,584 | 303,090 | 6 |
  | `obj_3_Mini Bulbasaur.stl` | 70,841,684 | 1,416,832 | No revisadas (>800k) |
  | `obj_4_squirtle mini.stl` | 71,792,184 | 1,435,842 | No revisadas (>800k) |
  | `obj_5_Snorlax mini.stl` | 13,449,084 | 268,980 | 12 |
  | `obj_6_charizard mini.stl` | 14,599,784 | 291,994 | 0; 2 vértices de contacto |
  | `obj_7_Gengar mini.stl` | 70,522,784 | 1,410,454 | No revisadas (>800k) |
  | `obj_8_Mewtwo mini.stl` | 17,446,384 | 348,926 | 10 |
  | `obj_9_Eevee.stl` | 14,303,684 | 286,072 | 2 |

- Prueba del 3MF añadido: `importModel` lo acepta como una malla de 303,090
  triángulos, sin warnings. Sus archivos `.model` no tienen `<basematerials>`,
  `<colorgroup>`, grupos de textura ni referencias de propiedad/color por cara
  (`pid`/`p1`/`p2`/`p3`). El paquete contiene colores de filamentos/configuración,
  pero no se encontró codificación de pintura por cara que el cortador pueda
  segmentar. Hay que confirmar que sea el archivo de pintura esperado o aportar
  uno que preserve esa asignación.
- Una prueba exploratoria sobre Charmander STL seleccionando la mitad superior
  necesitó 0.71 s para `getSelectionData` y 26.18 s para `suggestPerimeters`; de
  tres candidatos, uno generó un perímetro autointersectado y dos perímetros
  válidos. Un smoke de integración vía Vitest completó corte real en 50.38 s: el
  candidato ajustado se rechazó, el candidato suave pasó validación, produjo dos
  piezas y ambas se exportaron/reimportaron como STL cerrados. El 3MF exportado
  contiene tres objetos (dos meshes y el assembly con dos referencias a
  componentes) y conserva el total de triángulos; el importador actual aplana el
  assembly a una malla conectada. Esto valida el paquete de salida, no que el
  parser preserve identidad de objetos. Solo Charmander completó corte/export;
  falta la matriz de los otros ocho modelos. La prueba directa desde Node CJS
  falló al resolver `manifold-3d` (ESM sin entrada CJS), así que los flujos reales
  se validan mediante Vitest/Vite o navegador.
- `src/lib/cutter2/engine/import/ModelImporter.ts` reduce la importación a una
  malla indexada y nombres/advertencias. `parse3MF` devuelve soup de triángulos,
  conteo, nombres y warnings; el parser no conserva atributos de material/color
  por triángulo (por ejemplo, asignaciones `pid`/`pindex`). Por tanto, hoy el
  Cortador no puede derivar cortes de pintura 3MF.
- El cómputo debe seguir client-side/en Web Worker. La extensión de pintura puede
  requerir ampliar el importador/protocolo v2; ese cambio debe aislarse y probarse,
  sin afectar Cortador v1.

## Alcance propuesto, por fases

### Fase 1 — Corpus y línea base

- Abrir/importar y analizar los nueve STL, registrar warnings, triángulos,
  componentes, estado de corte y tiempos/memoria disponibles.
- Ejecutar un flujo de corte y exportación en cada modelo que resulte cortable;
  registrar causas cuando no lo sea.
- Mantener los archivos originales de solo lectura. Optimizar solo los cuellos de
  botella que identifiquen las mediciones.

### Fase 2 — Robustez y regresión

- Automatizar E2E representativo: importación, selección, perímetro, corte y
  exportación; añadir fixtures derivadas/minimizadas, no copias mutables del corpus.
- Dar progreso, cancelación efectiva y errores accionables a operaciones largas;
  verificar que cancelar o fallar no deje geometría/estado parcial.

### Fase 3 — Sesiones

- Guardar y recuperar localmente la configuración y el progreso del proyecto.
- Guardar el archivo fuente completo como `Blob` en IndexedDB y recuperar sesión
  sin reseleccionar. Manejar cuota agotada, denegación y errores de persistencia;
  conservar el proyecto en memoria y el último guardado válido.

### Fase 4 — Varios cortes y partes

- Permitir configurar y previsualizar varios cortes sobre la pieza activa antes de
  ejecutar el lote.
- Mostrar el resultado como partes independientes, nombrables y exportables; en
  caso de fallo de un corte, no aplicar parcialmente el lote.
- Conservar deshacer/rehacer y validar que las piezas exportadas sean cerradas y
  watertight según las garantías actuales.

### Fase 5 — Cortes sugeridos automáticamente

- Proponer ubicaciones geométricas candidatas con evidencia/confianza y preview;
  permitir editar o descartar cada candidato antes de cortar.
- Si hay pintura 3MF, conservar las etiquetas/materiales por triángulo y ofrecer
  candidatos vinculados a sus fronteras, según la semántica que confirme el
  usuario. No inferir que cada cambio de color siempre debe ser un corte.
- Requiere un fixture 3MF pintado que represente el flujo real del usuario.

## Criterios de aceptación

### AC-001 — Corpus sin modificar

- **Escenario:** se ejecutan pruebas con los nueve archivos de la carpeta indicada.
- **Acción:** importar y analizar cada archivo y probar corte/exportación cuando la
  malla sea cortable.
- **Esperado:** se entrega una tabla por archivo con estado, conteos, warnings,
  tiempos y resultado del flujo; los casos no cortables tienen una causa observable.
- **No debe:** escribir, renombrar, convertir o borrar los originales.
- **Verificación:** comparación de metadata antes/después y reporte reproducible.
- **Prioridad:** requerida.

### AC-002 — Rendimiento basado en evidencia

- **Escenario:** el corpus y escenarios representativos tienen línea base.
- **Acción:** perfilar importación, análisis, selección/pincel, corte y exportación.
- **Esperado:** cada optimización incluye medición antes/después en el mismo
  entorno y mantiene el resultado geométrico dentro de las validaciones existentes.
- **No debe:** introducir complejidad en rutas que no sean cuellos de botella
  medidos.
- **Verificación:** informe benchmark reproducible y tests de regresión.
- **Prioridad:** requerida.

### AC-003 — Operaciones largas cancelables

- **Escenario:** se ejecuta una operación pesada sobre un modelo grande.
- **Acción:** observar progreso y cancelarla.
- **Esperado:** el progreso identifica etapa/avance, la cancelación termina el
  trabajo y la pieza/documento queda en el último estado consistente.
- **No debe:** bloquear permanentemente la UI ni dejar resultados parciales.
- **Verificación:** integración worker/UI y test E2E de cancelación.
- **Prioridad:** requerida.

### AC-004 — Recuperar sesión

- **Escenario:** hay un proyecto con fuente, selecciones y parámetros guardados.
- **Acción:** recargar la página y recuperar el proyecto.
- **Esperado:** se recupera el mismo estado según la política de archivo fuente
  confirmada: archivo fuente completo y estado del proyecto tras recargar.
- **No debe:** enviar mallas o datos del usuario a un servidor.
- **Verificación:** prueba de persistencia/reload en navegador y manejo de cuota.
- **Prioridad:** requerida.

### AC-005 — Lote de cortes atómico

- **Escenario:** el usuario configuró dos o más cortes válidos en una pieza.
- **Acción:** previsualizar y aplicar el lote.
- **Esperado:** se obtienen piezas separadas, identificables y exportables; la
  operación es deshacible.
- **No debe:** publicar un lote parcial si un paso falla ni exportar partes inválidas.
- **Verificación:** tests de geometría del lote, rollback y exportación STL/3MF.
- **Prioridad:** requerida.

### AC-006 — Sugerir cortes geométricos

- **Escenario:** pieza cargada que contiene rasgos/cuellos detectables.
- **Acción:** solicitar detección automática.
- **Esperado:** se muestra una lista de candidatos con preview y motivo/confianza;
  el usuario elige cuáles aplicar.
- **No debe:** ejecutar cortes sin confirmación explícita ni afirmar un candidato
  como seguro si no pasa validación geométrica.
- **Verificación:** fixtures con cuello, componentes separados, falso positivo y
  casos sin candidato.
- **Prioridad:** requerida.

### AC-007 — Cortes guiados por pintura 3MF

- **Escenario:** se importa un fixture 3MF cuya pintura/material por triángulo sea
  compatible con la semántica acordada (el fixture actual aún no demuestra esa
  codificación).
- **Acción:** solicitar detección de cortes por pintura.
- **Esperado:** la segmentación y los candidatos reflejan las fronteras etiquetadas;
  el material/color se conserva en las piezas/exportación donde el formato lo
  permita.
- **No debe:** fingir que un STL tiene pintura ni descartar etiquetas sin avisar.
- **Verificación:** fixture 3MF de referencia, comparación de etiquetas antes y
  después de cortar y test de round-trip de exportación.
- **Prioridad:** requerida; bloqueada hasta recibir y caracterizar el fixture 3MF
  con pintura por cara.

### AC-008 — Controles visibles en perímetros pequeños

- **Escenario:** se define un perímetro corto (por ejemplo, menor a 10 mm) con
  varios puntos de control.
- **Acción:** se visualiza y edita el perímetro en el visor 3D.
- **Esperado:** cada punto conserva un tamaño en pantalla legible y contraste
  suficiente, y se puede seleccionar dentro de un radio interactivo de al menos
  18 px CSS.
- **No debe:** cambiar el número/posición de controles ni permitir seleccionar
  puntos proyectados fuera del frustum.
- **Verificación:** tests del cálculo de picking/visibilidad y recorrido visual de
  un perímetro corto en navegador.
- **Prioridad:** requerida.

### AC-009 — Barra de visor común entre Cortador v2 y Posavasos

- **Escenario:** se abre un modelo en el visor de Cortador v2 o Posavasos.
- **Acción:** se usan controles estándar de cámara/visualización y se expande el
  visor.
- **Esperado:** ambos visores presentan la misma barra vertical derecha con
  centrar, presets de vista, zoom, cuadrícula, alambre y expandir/restaurar; los
  estados activos y nombres accesibles son consistentes.
- **No debe:** unificar los renderers ni alterar acciones particulares: pincel y
  perímetros del Cortador, colocación de anilla de Posavasos. No se modifica
  Llavero ni Cortador v1.
- **Verificación:** pruebas de los callbacks compartidos, teclado Escape para
  restaurar el visor y recorrido en ambas rutas.
- **Prioridad:** requerida.

## Restricciones y no objetivos

- No modificar ni reemplazar los STL originales.
- No modificar Cortador v1: `src/lib/cutter/**` y
  `src/components/tools/cortador/**`.
- No hacer cambios globales que afecten Llavero. Los cambios a Posavasos se limitan
  a la barra común y expansión del visor cubiertas por AC-009.
- No asumir que se puede conservar toda representación propietaria/texture-paint
  de 3MF; se soportará explícitamente la semántica validada por fixtures.
- No ejecutar cortes automáticos irreversibles sin preview y confirmación.
- Sin backend, nube ni nuevas dependencias salvo justificación y aprobación.

## Riesgos

- El parser 3MF v2 actual descarta las asignaciones de material/color; el soporte de
  pintura exige cambiar una frontera protegida del motor o crear un adaptador
  compatible. Confirmar viabilidad y aislamiento antes de implementarlo.
- El corpus suma casi seis millones de triángulos. Tiempo y memoria varían por
  hardware/navegador; el reporte debe registrar el entorno y no fijar garantías
  universales a partir de una sola máquina.
- Una frontera de color puede representar decoración/filamento y no una unión
  mecánica. La sugerencia debe ser revisable.

## Decisiones confirmadas y bloqueo externo

- La pintura/material 3MF es una pista: proponer límites de color/material como
  candidatos para revisión; no dividir automáticamente cada región.
- La detección automática presenta candidatos con motivo/confianza y preview. Solo
  se aplica el corte o lote después de selección y confirmación explícita.
- La sesión guarda el archivo fuente completo localmente en IndexedDB y restaura
  tras recargar; cuota/denegación/fallo deben informarse sin perder el proyecto
  activo ni el último guardado válido.
- El usuario reexportará y aportará un 3MF que conserve la pintura por cara. El
  archivo actual `paint_2_Charmander mini.3mf` no demuestra esa semántica; AC-007 y
  cualquier cambio de parser para pintura esperan el nuevo fixture.
