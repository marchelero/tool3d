# PRD 004 — Módulo Cortador

## 1. Contexto

La app ya resuelve imagen, posavasos, llavero y texturizado de STL. Falta la
operación previa más común antes de imprimir: **partir un modelo en piezas
imprimibles y volver a unirlas**.

Hoy el usuario que tiene un modelo que no entra en la cama, o que quiere imprimir
por partes con distintos filamentos, depende de Bambu Studio / Orca / Meshmixer.
Esos flujos tienen dos problemas para este proyecto: obligan a subir el archivo a
una app de escritorio o a un servicio, y no garantizan que las piezas resultantes
sean estancas.

El Texturizador ya demostró que la app puede procesar mallas grandes en el
navegador con Web Worker, y `src/lib/3d/threemf.ts` ya escribe 3MF con color por
pieza. Lo que falta es un motor booleano confiable: el ADR-009 documenta que los
booleanos 3D de JSCAD generan T-junctions y mallas no estancas, por eso el
posavasos se construye en 2D + extrusión. Un cortador no puede evitar los
booleanos 3D, así que la decisión de motor es la decisión central de este PRD.

La propuesta es un módulo propio, client-side, con la misma línea visual que el
resto, que garantice por construcción que **solo se exporta geometría
watertight**.

**Nombre propuesto:** `Cortador`
**Slug propuesto:** `cortador`
**Categoría:** 3D

## 2. Objetivo

Permitir que un usuario cargue un STL o un 3MF, repare la malla con un reporte
visible, defina zonas, aplique cortes rectos, curvos o que sigan la forma de la
pieza, agregue encastres, y descargue STL por pieza o un 3MF con colores, con la
garantía de que cada pieza exportada es watertight y abre en Bambu Studio, Orca o
Cura sin reparaciones. Todo el procesamiento ocurre en el navegador, sin backend.

## 3. Usuarios y casos de uso

- Quien tiene un modelo que no entra en la cama y lo necesita en dos o más piezas.
- Quien quiere imprimir una pieza grande por partes y unirlas con encastres.
- Quien quiere separar un modelo multi-material en piezas por color o por cuerpo.
- Quien recibió un STL con agujeros, caras invertidas o polvo y necesita
  repararlo antes de laminar.
- Quien imprime en resina y necesita piezas separadas para orientar cada una.
- Quien no puede o no quiere subir el modelo a un servicio externo.

No es para: modelado o escultura, generación de soportes, laminado/slicing,
nesting automático de la cama ni edición de topología libre.

## 4. Alcance del MVP

El MVP usable mínimo cierra al terminar la Fase 1 (importación, reparación, visor,
cortes rectos/curvos/por forma, varita 3D y exportación). El alcance must completo
de este PRD —incluidos encastres y vista explotada— cierra en la Fase 2.

### 4.1 Importación y diagnóstico (must)

- Cargar **STL binario y ASCII** por botón y por drag & drop.
- Cargar **3MF** con objetos, componentes, transformaciones, unidades y
  materiales/color.
- Normalizar a **mm** y **Z-up**.
- Detección de unidades: en 3MF por el atributo `unit` del modelo; en STL no hay
  unidades, así que se aplica una heurística de bbox plausible y se pide
  confirmación explícita al usuario cuando el resultado cae fuera de rango
  (umbral exacto `TBD — validar con modelos reales de 1 mm a 400 mm`).
- Límites duros: **120 MB** y **~3M triángulos**, con mensaje claro al excederlos.
- Diagnóstico inicial visible: triángulos, caja envolvente en mm, cantidad de
  componentes conexos, bordes abiertos, aristas no manifold, volumen y
  orientación de normales.
- Si el archivo es STL, las funciones que dependen de color se muestran
  deshabilitadas con la explicación "STL no guarda color; subí un 3MF".
- El lector de 3MF usa `3MFLoader` de three como camino principal. La cobertura de
  materiales es parcial: si faltan materiales, transformaciones o componentes, se
  usa un lector propio con `fflate` + `DOMParser` como fallback.
- Nombre, peso del archivo y estado del proyecto siempre visibles.

### 4.2 Reparación por etapas (must)

Cada etapa reporta **métrica antes / después** y queda en un reporte visible. La
reparación nunca es silenciosa: si una etapa no se pudo aplicar, se muestra como
omitida con el motivo.

1. **Weld** por hash cuantizado (misma tolerancia relativa que
   `weldTriangleSoup`).
2. **Limpieza**: borrar degenerados, triángulos duplicados y caras de área cero.
3. **Orientación**: BFS de caras conectadas + signo del volumen para dejar
   normales outward.
4. **Cierre de huecos** por loops de borde: huecos planos se proyectan al plano,
   se resuelven con `clipper-lib` y se triangulan con earcut soportando agujeros;
   huecos no planos se cierran con abanico al centroide y se marcan con
   advertencia.
5. **Aristas no manifold**: se tratan y se reporta cuántas quedaron.
6. **Auto-intersecciones**: detección y reporte; no se corrigen en el MVP.
7. **Separación de componentes** y borrado de polvo por umbral de volumen/caras
   (umbral `TBD — validar con piezas reales`).
8. **Validación final**: 0 bordes abiertos, 0 aristas no manifold, volumen > 0 y
   normales outward.

Regla dura: **si la malla no queda watertight, no se exporta**. Se ofrece remesh
por vóxeles como último recurso o se bloquea la exportación con explicación.

### 4.3 Visor (must)

- Three.js con órbita, zoom, paneo y encuadre automático.
- Vista de sección por clipping plane.
- Selección de caras con resaltado.
- Gizmo de plano con arrastre, rotación, snapping y entrada numérica.
- Slider de vista explotada y aislamiento de pieza.
- Medición de espesor entre dos puntos.
- Grilla y ejes coherentes con Z-up.
- La vista previa usa clipping planes y malla decimada, nunca CSG.

### 4.4 Zonas de corte (must en versión básica)

- **Componentes conexos automáticos**: cada cuerpo se detecta y se puede aislar
  como pieza candidata.
- **Varita 3D (magic wand)**: click en una cara y se selecciona toda la zona
  conectada por similitud, igual que la varita de la herramienta Imagen
  (`floodFillByColor`, atajo W, slider de tolerancia) pero sobre la superficie de
  la malla. La similitud combina color/material (3MF), ángulo diedro, orientación
  de normal y curvatura.
  - Tolerancia ajustable (0–100) y modo **contiguo** o **global**.
  - Sumar con Shift y restar con Alt; expandir/contraer la selección por anillos
    de caras.
  - Overlay translúcido sobre las caras seleccionadas y contorno del borde
    marcado.
  - Acciones: **separar zona** (corta por el borde y cierra con una superficie
    de corte), inspeccionar, asignar color o usar la zona como target de un
    corte.
- **Regiones por color/material** en 3MF: se listan y se pueden usar como semilla
  de la varita; el corte por color volumétrico llega en Fase 3.
- **Selección manual**: click en cara + flood fill por ángulo diedro, por color,
  por componente o por varita.
- Lista de zonas con color, área aproximada y estado.
- Pincel de zonas, sugerencia automática de planos y simetría/concavidad quedan
  fuera del MVP. El lazo sobre la vista se usa en el corte por forma (4.5).

### 4.5 Cortes: rectos, curvos y por forma (must)

- **Recto:** plano infinito con gizmo: arrastrar, rotar y valores numéricos.
- **Curvo 2.5D:** spline dibujada sobre una proyección (XY/XZ/YZ o plano de
  vista actual) que se extruye a través de la pieza; la pared de corte sigue la
  curva. Permite cortes en S, arcos y separaciones no rectas sin modelar una
  superficie 3D.
- **Por forma:** contorno cerrado (silueta detectada, lazo sobre la vista o SVG
  importado) extruido como prisma; separa la pieza siguiendo su forma, no una
  línea recta. Es el modo para "cortar según la silueta" del cascanueces.
- **Superficie libre (P3):** loft entre dos curvas, sweep de un perfil por un
  path, heightfield y corte que sigue la superficie/cresta de la pieza.
- Elección de qué lado se conserva.
- Cortes múltiples en secuencia sobre una pieza, con previsualización del
  resultado acumulado.
- Cada corte genera tapas watertight en las dos piezas resultantes.
- Todo corte se compila a un **sólido cortador cerrado** (plano, prisma curvo,
  prisma de forma o cuchilla de superficie) y se aplica con booleanos de
  manifold. La vista previa dibuja la cinta/curva translúcida, no ejecuta CSG.
- Validación de curvas: auto-intersección, radio mínimo, espesor de cuchilla y
  que el cortador cubra toda la pieza.
- Reordenar y desactivar cortes desde la lista de operaciones.

### 4.6 Encastres (must)

- **Espiga cilíndrica + alojamiento** como default.
- Variante con **chaveta anti-rotación**.
- **Cola de milano** como opción avanzada.
- Colocación automática por cara de corte con estas reglas:
  - inset desde el borde ≥ **1.2 mm**;
  - separación entre encastres ≥ **3× el diámetro**;
  - diámetro ≤ **1/3 del ancho mínimo de la cara**;
  - largo ≤ `min(8 mm, 40 % del espesor de cada lado)`.
- Presets de holgura **0.10 / 0.15 / 0.25 mm** para boquilla 0.4, con chaflán de
  entrada de **0.4 mm**.
- Edición manual de posición y cantidad por cara, respetando las reglas.
- Validación: no perforar el exterior, no chocar con otros cortes ni encastres y
  no generar voladizos no imprimibles.
- **Cupón de tolerancia** exportable con la holgura elegida.
- Imán y snap-fit quedan para fases posteriores.

### 4.7 Exportación (must)

- **STL binario por pieza**, con nombre derivado del original y numeración.
- **3MF** con piezas y colores.
- Layout de impresión con separación configurable entre piezas.
- Reporte de ensamblaje: piezas numeradas, vista explotada y leyenda de encastres.
- Guardar proyecto como **JSON de operaciones** (no la malla) en IndexedDB, para
  retomar sin volver a procesar desde cero.
- Sin uploads: ningún byte del modelo sale del navegador.
- Advertencia y bloqueo si alguna pieza no pasó la validación final.

### 4.8 Undo/redo y determinismo (must)

- Undo/redo sobre la **lista de operaciones**, con regeneración determinística.
- La misma secuencia de operaciones sobre el mismo input produce la misma malla.
- Cache por hash de operaciones para no recalcular lo que no cambió.

### 4.9 Fuera de alcance del MVP

- Cortes por color (relieve/bolsillo y partición volumétrica) — Fase 3.
- Superficies de corte libres: loft, sweep, heightfield y corte que sigue la
  superficie/cresta de la pieza — Fase 3. La curva 2.5D y el corte por forma sí
  entran en el MVP.
- Sugerencia automática de planos, pincel de zonas y lazo de selección de caras
  — Fase 3.
- Imán, snap-fit, simetría y concavidad — fases posteriores.
- Edición libre de malla, escultura y generación de soportes.
- Nesting automático, slicing y estimación de material.
- Backend, cuentas, colaboración y biblioteca remota de modelos.
- Formatos STEP, OBJ, PLY y 3DS.

## 5. Fases

### P0 — Spike del motor (2–3 d)
`manifold-3d` en Web Worker con Next 16: carga del WASM, transferencia de buffers,
un corte de prueba y medición de tiempos. Salida: decisión go/no-go del motor y
del tamaño de bundle.

### P1 — MVP usable (7–9 d)
Import STL + 3MF, diagnóstico, reparación por etapas con reporte, visor con
sección y gizmo, cortes rectos, curvos 2.5D y por forma, simples y múltiples,
varita 3D, export STL por pieza y 3MF. Cierre estimado: **~2.5 semanas de trabajo
efectivo**.

### P2 — Encastres y ensamblaje (4–6 d)
Espiga + alojamiento, chaveta, cola de milano opcional, validación de encastres,
presets de holgura, cupón de tolerancia, vista explotada y reporte de ensamblaje.

### P3 — Color, superficies libres y zonas automáticas (5–9 d)
Cortes por color en dos modos: **relieve/bolsillo** (default, robusto: se
solidifica la región de color hacia adentro y se hace bolsillo o sobre-relieve) y
**partición volumétrica por Voronoi de vóxeles** (avanzado, lento, con pérdida de
detalle). Aclaración de producto: el color en 3MF es **solo de superficie**, no
es un volumen. También: superficies de corte libres (loft entre curvas, sweep de
un perfil por un path, heightfield y corte que sigue la superficie/cresta de la
pieza), corte por región/selección y sugerencia automática de planos por barrido
en X/Y/Z y ejes PCA, puntuando área de sección, cantidad de loops y espesor
mínimo, con planos fantasma aceptables/descartables.

### P4 — Pulido y QA (2–3 d)
Presets, cupón, textos y explicaciones, accesibilidad, documentación
(`docs/ARCHITECTURE.md`, `docs/DECISIONS.md`), pruebas con archivos reales en los
tres laminadores y ajuste de umbrales.

## 6. Arquitectura propuesta

```
src/app/tools/cortador/page.tsx
src/components/tools/cortador/
  cortador-tool.tsx          # estado, stepper, orquestación
  cortador-viewer.tsx        # Three.js: malla, sección, selección, gizmo
  import-dropzone.tsx        # carga + diagnóstico
  repair-report.tsx          # etapas con métricas antes/después
  zone-panel.tsx             # componentes, color 3MF, selección manual
  cut-panel.tsx              # lista de cortes y valores numéricos
  joint-panel.tsx            # encastres, holguras, cupón
  pieces-panel.tsx           # piezas, color, volumen, validación
  export-panel.tsx           # STL/3MF/layout/reporte
src/lib/mesh/                # núcleo compartido con el Texturizador
  types.ts                   # MeshData, Bounds, Diagnostics, Components
  bounds.ts
  weld.ts                    # weldTriangleSoup promovido
  topology.ts                # analyzeMesh, edge maps, loops de borde
  repair.ts                  # orientación, dedupe, limpieza
  holes.ts                   # cierre plano (clipper + earcut) y abanico
  components.ts              # componentes conexos y polvo
  io/stl.ts                  # STL binario/ASCII
  io/threemf-read.ts         # 3MFLoader + fallback fflate/DOMParser
  io/threemf-write.ts        # 3MF por pieza con color (base: build3mf)
  io/export-stl.ts
src/lib/cutter/
  types.ts                   # Operation, Zone, Cut, Joint, Piece
  project.ts                 # JSON de operaciones + IndexedDB
  operations.ts              # lista, undo/redo, hash, cache
  manifold.ts                # puente manifold-3d (WASM)
  cutter-solid.ts            # contrato: todo corte → sólido cerrado
  cut-plane.ts               # plano infinito → operación
  cut-curve.ts               # spline 2.5D → prisma curvo
  cut-shape.ts               # contorno/silueta → prisma de forma
  cut-surface.ts             # loft/sweep/heightfield/follow (P3)
  joints.ts                  # espiga, chaveta, cola de milano, cupón
  layouts.ts                 # layout de impresión
  validate.ts                # watertight, volúmenes, colisiones
  preview.ts                 # clipping, decimación, medición
  worker.ts                  # CSG, reparación, validación
  worker-client.ts           # contrato tipado, progreso, cancelación
```

- Registrar la tool en `src/lib/tools/registry.ts` con slug `cortador`, categoría
  `3d`, estado `available` e icono acorde (por ejemplo `Scissors`).
- `src/lib/mesh/` es la fuente de verdad del núcleo de malla.
  `src/lib/texturizer/subdivide.ts` mantiene re-exports para no romper el
  Texturizador.
- `manifold-3d` se carga con `dynamic import` únicamente dentro del worker
  (ADR-011). Nunca entra al bundle inicial.
- El resultado final sale solo del worker con manifold. `three-bvh-csg` queda
  limitado a preview interno y no puede alimentar la exportación.
- UI: reutilizar `PanelTooltips`, `PanelSection`, `SegmentedControl`, `Slider`,
  `ToggleButton`, `Field`, `Hint`, `GroupLabel` y `@stepperize/react`, igual que
  Imagen y Posavasos.
- Stepper: **Importar → Reparar → Zonas → Cortes → Encastres → Exportar**.

## 7. Requisitos no funcionales

- **Privacidad:** todo el pipeline corre en el navegador; sin uploads, sin
  telemetría del modelo, sin backend.
- **Rendimiento:** split de 1M triángulos < **2 s**, reparación < **5 s**,
  preview < **16 ms** por frame en desktop, con worker dedicado, buffers
  transferibles, progreso por etapa, cancelación real y cache por hash.
- **Memoria:** límites duros de archivo y triángulos, preview decimado y descarte
  de geometrías three al cambiar de pieza.
- **Robustez:** una malla no reparable no rompe la app ni se exporta; se informa
  el bloqueo y se ofrece remesh. Errores de manifold, WASM o ZIP se capturan y se
  muestran como mensaje accionable.
- **Determinismo:** misma entrada + mismas operaciones = misma malla.
- **Accesibilidad:** labels asociados, foco visible, `aria-pressed` en toggles,
  texto alternativo del visor, contraste AA, operación por teclado del stepper y
  del gizmo (valores numéricos como alternativa al arrastre).
- **Compatibilidad:** Chrome, Edge, Firefox y Safari actuales; WebGL2; WASM.
- **Bundle:** manifold y los lectores de 3MF fuera del bundle inicial.
- **Idioma:** UI y mensajes en español; identificadores y APIs en inglés.

## 8. Criterios de aceptación

### AC-001: Importar STL
- **Escenario:** usuario sin proyecto.
- **Acción:** suelta un STL binario válido de 40 MB.
- **Esperado:** se muestra la malla, triángulos, bbox en mm y diagnóstico; se
  puede orbitar; el stepper habilita "Reparar".
- **No debe:** subir el archivo a la red ni recargar la página.
- **Verificación:** prueba manual + Network vacío.

### AC-002: Importar 3MF con partes y color
- **Escenario:** 3MF con dos objetos y materiales.
- **Acción:** suelta el archivo.
- **Esperado:** se listan los objetos/componentes con su color y transformación
  aplicada; el visor respeta unidades y Z-up.
- **No debe:** perder piezas ni aplanar colores a un único material.
- **Verificación:** comparación visual contra Bambu Studio + conteo de objetos.

### AC-003: Diagnóstico inicial
- **Escenario:** malla con 3 agujeros y 2 aristas no manifold.
- **Acción:** cargar el archivo.
- **Esperado:** el diagnóstico reporta bordes abiertos, no manifold, componentes
  y volumen antes de reparar.
- **Verificación:** archivo preparado a mano + reporte en pantalla.

### AC-004: Reparación con reporte
- **Escenario:** malla con agujeros planos y caras invertidas.
- **Acción:** ejecutar reparación completa.
- **Esperado:** cada etapa muestra métrica antes/después; al final 0 bordes
  abiertos, 0 no manifold, volumen > 0 y normales outward.
- **No debe:** aplicar cambios sin reflejarlos en el reporte.
- **Verificación:** reporte visible + reanálisis de la malla resultante.

### AC-005: Reparación que no alcanza
- **Escenario:** malla con auto-intersecciones severas.
- **Acción:** ejecutar reparación.
- **Esperado:** la app indica que no quedó watertight, bloquea la exportación y
  ofrece remesh por vóxeles con su costo.
- **No debe:** exportar ni habilitar "Exportar" en ese estado.
- **Verificación:** intento de exportación bloqueado + mensaje.

### AC-006: Corte recto simple
- **Escenario:** pieza reparada y watertight.
- **Acción:** colocar un plano en Z con valor numérico y aplicar.
- **Esperado:** se generan dos piezas watertight, con tapas, y la suma de
  volúmenes coincide con el original dentro de ±0.5 %.
- **No debe:** dejar caras abiertas en la cara de corte.
- **Verificación:** validación interna + reimportación de cada pieza.

### AC-007: Cortes múltiples
- **Escenario:** pieza con un corte aplicado.
- **Acción:** agregar dos cortes más en secuencia y reordenarlos.
- **Esperado:** la pieza se parte en 4; cada pieza conserva su estado de
  validación; el reorden produce un resultado determinístico.
- **Verificación:** conteo de piezas + repetición con el mismo orden.

### AC-008: Zonas manuales
- **Escenario:** malla con varios cuerpos.
- **Acción:** aislar un componente y seleccionar caras por flood fill de ángulo
  diedro.
- **Esperado:** la zona queda resaltada, se lista y se puede usar como entrada de
  corte.
- **Verificación:** inspección visual + lista de zonas.

### AC-009: Encastre espiga cilíndrica
- **Escenario:** dos piezas con una cara de corte en común.
- **Acción:** agregar encastre automático con holgura 0.15 mm.
- **Esperado:** una pieza tiene espiga, la otra alojamiento; el inset y la
  separación respetan las reglas; ambas siguen watertight.
- **No debe:** perforar el exterior de la pieza.
- **Verificación:** corte en sección + validación watertight de ambas piezas.

### AC-010: Variantes de encastre
- **Escenario:** encastre cilíndrico colocado.
- **Acción:** cambiar a variante con chaveta y luego a cola de milano.
- **Esperado:** la geometría cambia, se mantiene la holgura y la validación pasa.
- **No debe:** dejar la espiga anterior en la malla.
- **Verificación:** inspección visual + volúmenes antes/después.

### AC-011: Validación de encastres
- **Escenario:** cara angosta con dos encastres pedidos.
- **Acción:** intentar colocarlos.
- **Esperado:** la app rechaza o reduce la cantidad explicando qué regla se
  incumple (diámetro vs ancho, separación o voladizo).
- **Verificación:** mensaje por regla + captura.

### AC-012: Bloqueo por malla no watertight
- **Escenario:** pieza con un borde abierto tras los cortes.
- **Acción:** presionar "Exportar".
- **Esperado:** la exportación se bloquea con explicación y la pieza se marca en
  rojo en la lista.
- **No debe:** descargar un archivo parcial o "reparado en silencio".
- **Verificación:** descarga ausente + estado en la lista.

### AC-013: Exportar STL por pieza
- **Escenario:** 3 piezas válidas.
- **Acción:** exportar STL.
- **Esperado:** se descargan 3 STL binarios, numerados, con dimensiones en mm y
  watertight al reimportarlos.
- **No debe:** exportar la malla de preview decimada.
- **Verificación:** reimportación en la app y en Cura.

### AC-014: Exportar 3MF con color
- **Escenario:** proyecto con piezas de distinto color.
- **Acción:** exportar 3MF.
- **Esperado:** el 3MF abre en Bambu Studio / Orca con las piezas separadas y los
  colores correctos, sin reparaciones.
- **No debe:** perder `pid`/`p1` ni mezclar materiales.
- **Verificación:** apertura en ambos slicers + inspección del XML del ZIP.

### AC-015: Archivo inválido
- **Escenario:** usuario con un proyecto abierto.
- **Acción:** suelta un `.txt`, un STL corrupto y un 3MF sin `3dmodel.model`.
- **Esperado:** error claro por caso; el proyecto anterior sigue intacto.
- **No debe:** limpiar el estado ni romper el visor.
- **Verificación:** prueba manual con los tres archivos.

### AC-016: STL sin color
- **Escenario:** STL cargado.
- **Acción:** abrir el panel de cortes por color.
- **Esperado:** la opción aparece deshabilitada con la explicación de subir un 3MF.
- **Verificación:** estado deshabilitado + texto visible.

### AC-017: Rendimiento
- **Escenario:** malla de 1M triángulos, desktop.
- **Acción:** aplicar un corte recto.
- **Esperado:** split < 2 s, reparación < 5 s, preview fluido a 60 fps (≤ 16 ms
  por frame), progreso visible y UI respondiendo.
- **Verificación:** `performance.now()` instrumentado + DevTools.

### AC-018: Progreso y cancelación
- **Escenario:** operación larga en curso.
- **Acción:** presionar "Cancelar".
- **Esperado:** el worker se termina, la UI vuelve al estado anterior y no queda
  malla a medio procesar.
- **Verificación:** observación de workers en DevTools + estado restaurado.

### AC-019: Undo/redo y proyecto
- **Escenario:** proyecto con import, reparación, 2 cortes y 1 encastre.
- **Acción:** deshacer dos veces, rehacer una, recargar la página y reabrir el
  proyecto.
- **Esperado:** el estado coincide con la lista de operaciones; al reabrir se
  regenera la malla desde el JSON de operaciones.
- **No debe:** guardar la malla completa en IndexedDB.
- **Verificación:** comparación de volúmenes y cantidad de operaciones.

### AC-020: Validación del repo
- **Acción:** ejecutar `npx tsc --noEmit`, `npm run lint` y `npm run build`.
- **Esperado:** los tres pasan.
- **Verificación:** salida de consola.

### AC-021: Tests de geometría
- **Escenario:** suite de Vitest configurada.
- **Acción:** ejecutar los tests de `src/lib/cutter` y del núcleo de malla.
- **Esperado:** pasan y cubren, como mínimo, weld, orientación por volumen, cierre
  de huecos planos, validación watertight, corte de un cubo (volúmenes ±0.5 %),
  corte curvo, corte por forma, colocación de encastres y roundtrip de
  lectura/escritura de 3MF.
- **Verificación:** salida de Vitest + cobertura reportada.

### AC-022: Corte curvo 2.5D
- **Escenario:** pieza reparada y watertight.
- **Acción:** dibujar una spline en S sobre la proyección XY, ajustar el lado a
  conservar y aplicar.
- **Esperado:** se generan dos piezas watertight; la pared de corte sigue la
  spline y no queda escalonada; la suma de volúmenes coincide con el original
  dentro de ±0.5 %.
- **No debe:** dejar huecos ni caras invertidas en la pared curva.
- **Verificación:** validación interna + sección del visor + reimportación.

### AC-023: Corte por forma
- **Escenario:** cascanueces importado.
- **Acción:** usar la silueta del contorno o dibujar un lazo cerrado sobre la
  vista y aplicar como prisma de corte.
- **Esperado:** la pieza se separa siguiendo el contorno, con pared vertical
  watertight; el resultado respeta el lado elegido.
- **No debe:** rellenar de más ni cortar fuera del contorno.
- **Verificación:** comparación visual con el contorno + validación watertight.

### AC-024: Corte que sigue la pieza (P3)
- **Escenario:** pieza con una cresta o costura natural.
- **Acción:** elegir "seguir superficie/cresta" y aplicar.
- **Esperado:** la superficie de corte acompaña la forma, ambas piezas quedan
  watertight y sin auto-intersecciones.
- **Verificación:** sección + validación + inspección en slicer.

### AC-025: Curva de corte inválida
- **Escenario:** spline que se auto-intersecta o no atraviesa toda la pieza.
- **Acción:** intentar aplicar el corte.
- **Esperado:** se rechaza con el motivo (auto-intersección, no cubre la pieza,
  radio mínimo) y se sugiere corregir.
- **No debe:** generar piezas abiertas ni bloquear la app.
- **Verificación:** mensaje por caso + validación intacta.

### AC-026: Varita 3D
- **Escenario:** cascanueces con una zona de un color y otra zona con distinta
  orientación.
- **Acción:** activar la varita, click en una cara, ajustar tolerancia y elegir
  contiguo o global.
- **Esperado:** se selecciona toda la zona conectada por similitud, con overlay y
  borde visible; Shift suma y Alt resta; "separar zona" genera una pieza
  watertight cortada por el borde de la selección.
- **No debe:** seleccionar caras aisladas inconexas en modo contiguo ni dejar la
  pieza abierta al separar.
- **Verificación:** comparación visual del overlay + validación watertight de la
  pieza resultante + volúmenes.

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Mallas no reparables | Media | Alto | Remesh por vóxeles como último recurso; bloqueo de exportación con explicación |
| Semántica de color superficial en 3MF | Alta | Medio | Modos explícitos: relieve/bolsillo por default; Voronoi volumétrico marcado como avanzado y con pérdida de detalle |
| Memoria y tiempo en el navegador | Alta | Alto | Worker dedicado, límites de 120 MB / 3M triángulos, LOD, preview decimado, cancelación |
| Calce real de los encastres | Alta | Medio | Presets 0.10/0.15/0.25 mm, chaflán de entrada y cupón de tolerancia exportable |
| Scope creep (color, forma, auto-zonas) | Alta | Medio | MVP congelado hasta cerrar P2; Fase 3 separada y explícita |
| `3MFLoader` con cobertura parcial | Media | Alto | Lector propio con `fflate` + `DOMParser` como fallback y tests de roundtrip |
| WASM de manifold en Next 16 / build estático | Media | Alto | Spike P0 con go/no-go antes de comprometer el resto del plan |
| Regresiones geométricas invisibles | Media | Alto | Vitest acotado al núcleo de malla y cortador (excepción justificada a ADR-014) |
| T-junctions por booleanos | Baja con manifold | Alto | Salida garantizada manifold; prohibido usar `three-bvh-csg` para el resultado final |
| Modelos con unidades ambiguas | Media | Bajo | Detección + confirmación explícita del usuario al importar |
| Cuchilla o superficie de corte auto-intersectada | Media | Alto | Validación de curva, radio mínimo y espesor antes del booleano; AC-025 |
| Borde de zona de varita no cerrado o degenerado | Media | Medio | Rechazo explícito, cierre por superficie de corte y gate watertight; AC-026 |
| Explosión de triángulos en cortes curvos | Media | Medio | Teselado adaptativo, preview decimado y presupuesto por operación |

## 10. Decisiones propuestas

1. **Motor CSG:** `manifold-3d` (WASM, Apache-2.0) dentro de un Web Worker, con
   salida manifold garantizada. `three-bvh-csg` solo como posible preview, nunca
   para el resultado final.
2. **Alcance del MVP:** import STL/3MF, reparación con reporte, visor, cortes
   rectos, curvos 2.5D y por forma, varita 3D, encastres de espiga cilíndrica,
   export STL por pieza + 3MF. Cortes por color, superficies libres (loft/sweep/
   heightfield/seguir pieza) y sugerencia automática de zonas pasan a Fase 3.
3. **3MF primario para color y partes; STL solo geometría.** Si el usuario sube
   STL, las funciones de color se deshabilitan con explicación.
4. **Encastre default:** espiga cilíndrica + alojamiento, con variante con chaveta
   anti-rotación; cola de milano como opción. Imán y snap-fit para fases
   posteriores.
5. **Tests:** adoptar Vitest **solo** para `src/lib/cutter` y el núcleo de malla
   compartido, como excepción acotada a ADR-014. Justificación: las regresiones
   geométricas son invisibles hasta que el archivo falla en el slicer.
6. **Núcleo de malla compartido** en `src/lib/mesh/`; el Texturizador conserva
   re-exports para no duplicar weld/análisis/reparación.
7. **Gate de watertight:** ninguna pieza no validada se puede exportar, ni siquiera
   con confirmación manual.
8. **Preview por clipping, CSG real solo al presionar "Aplicar"**, con progreso y
   cancelación; evita recalcular booleans en cada arrastre.
9. **Proyecto = log de operaciones en JSON sobre IndexedDB**, no la malla. Permite
   undo/redo determinístico y reabrir sin inflar el storage.
10. **Reparación siempre visible y por etapas**, con métricas antes/después; nunca
    silenciosa.
11. **Lector 3MF propio como fallback** del `3MFLoader`, reutilizando el patrón de
    `src/lib/3d/threemf.ts` para escritura.
12. **El color en 3MF se trata como superficie**, no como volumen; cualquier corte
    por color se implementa por solidificación local o por vóxeles, nunca asumiendo
    regiones cerradas.
13. **Sin backend y sin subida de archivos**, coherente con ADR-002.
14. **Varita 3D como mecanismo primario de zonas**, con el mismo patrón de
    interacción que la varita de Imagen: semilla + crecimiento por similitud +
    tolerancia + contiguo/global + sumar/restar + overlay. La separación de la
    zona se resuelve por el borde de la selección, no por una lista de caras.
15. **Todo corte se compila a un sólido cortador cerrado**: plano, prisma de
    curva 2.5D, prisma de forma o cuchilla de superficie. El motor solo aplica
    booleanos de manifold entre la pieza y esos sólidos; no existe un "corte
    abierto". Esto vale también para separar una zona de la varita.
16. **Cortes rectos, curvos 2.5D y por forma entran en el MVP**; loft, sweep,
    heightfield y "seguir la pieza" quedan en P3.
17. **La varita se valida antes de cortar**: la zona debe ser contigua (o global
    explícito), tener un borde cerrado y no degenerar en una selección de una
    sola cara; si no, se avisa y no se corta.

## 11. Métricas de éxito

- Un usuario carga un cascanueces, lo separa en partes watertight con cortes
  rectos, curvos o por forma (o separando una zona con la varita), agrega
  encastres y descarga STL/3MF que abren en Bambu Studio, Orca y Cura **sin
  reparaciones**.
- La suma de volúmenes de las partes coincide con el volumen original dentro de
  **±0.5 %**.
- El 100 % de las piezas exportables pasan la validación final (0 bordes abiertos,
  0 no manifold, volumen > 0).
- Split de 1M triángulos en **< 2 s** y reparación en **< 5 s** en desktop.
- La app sigue siendo **client-side**, sin backend ni subida de archivos.
- Un usuario completa import → export sin instrucciones externas.
- La tasa de exportaciones bloqueadas por malla no reparable es visible y
  explicada, no un fallo silencioso.

## 12. Preguntas abiertas

- Valores exactos de holgura por material/impresora (0.10 / 0.15 / 0.25 son
  presets de partida). `TBD — validar con cupón de tolerancia impreso en PETG,
  PLA y ABS`.
- Resolución de vóxeles por defecto para el remesh. `TBD — validar con piezas de
  50–200 mm y medir tiempo vs pérdida de detalle`.
- Umbral de "polvo" (volumen absoluto vs proporción de la pieza vs cantidad de
  caras). `TBD — validar con modelos reales que traigan esquirlas`.
- Tamaño máximo aceptable de 3MF de entrada y de salida multi-pieza.
  `TBD — validar con proyectos de 10+ objetos en Bambu Studio`.
- Cobertura real del `3MFLoader` de three con archivos Bambu/Orca multicolor.
  `TBD — validar con una muestra de 5 archivos y decidir si el fallback pasa a ser
  el camino principal`.
- Umbral de la heurística de unidades para STL. `TBD — validar con modelos de
  1 mm a 400 mm`.
