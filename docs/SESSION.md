# Sesión / continuidad — Tool3D

> Snapshot para retomar el trabajo sin repetir contexto. Última actualización:
> **2026-10-18**. El directorio `docs/sessions/` estaba vacío; este archivo es el
> punto de partida de la memoria de sesión.

---

## 1. Dónde estamos

- Proyecto funcional: home + herramienta de imagen + posavasos 3D.
- `npm run lint` ✅ y `npm run build` ✅ (verificado en esta sesión sobre HEAD +
  la documentación nueva).
- Build estático de 5 rutas: `/`, `/_not-found`, `/tools/image`,
  `/tools/llavero`, `/tools/posavasos`.
- Sin tests automatizados.

---

## 2. Estado de Git

```
Branch: main (remoto origin/main)
HEAD: 099c5f4  feat: add coaster and mosaic 3D modeling tools with JSCAD integration
Commits totales: 16
Rango de fechas: 2026-10-17 → 2026-10-18
```

### ⚠️ Cambios perdidos durante la sesión

Al **inicio** de esta sesión el working tree tenía:

```text
 M src/lib/3d/coaster.ts     # reescritura: 2D ops + extrusiones puras, sin booleanos 3D
 D tmp-mosaic.mjs            # script de scratch eliminado
?? src/lib/3d/geom2-ops.ts   # nuevo: validación de booleanos 2D de JSCAD
```

Ese refactor **ya no está aplicado**: al momento de cerrar la documentación,
`git status` muestra el working tree igual a HEAD y `src/lib/3d/coaster.ts`
volvió a la versión con `mergeSolids` (booleanos 3D). `tmp-mosaic.mjs` reapareció.
No hay `git stash` ni commits nuevos; no se pudo determinar qué revirtió esos
archivos. Además, `geom2-ops.ts` cambió durante la sesión (de 142 a 251+ líneas,
con helpers de clipping nuevos), lo que sugiere **edición concurrente o
sincronización externa**. **Antes de continuar, verificar `git status`,
`git diff` y el tamaño/hash de los archivos.**

Estado actual real:

```text
 M docs/PROJECT.md
?? README.md
?? docs/ARCHITECTURE.md
?? docs/DECISIONS.md
?? docs/SESSION.md
?? docs/TROUBLESHOOTING.md
?? src/lib/3d/geom2-ops.ts   # huérfano: no lo importa nadie
```

`geom2-ops.ts` (8 KB) está **sin integrar**: ningún archivo de `src/` lo importa.
Es la base del refactor pendiente descrito en ADR-009. `npm run build` pasa
porque no se importa.

**Qué se intentó y por qué**: reemplazar la construcción con uniones 3D
(`mergeSolids`) por operaciones 2D validadas + extrusión pura, para evitar mallas
no estancas que hacían que los slicers ignoraran los colores del 3MF. Ver ADR-009
y `docs/TROUBLESHOOTING.md` §3.

**No se commiteó nada** (regla: solo con pedido explícito del usuario).

---

## 3. Historia de commits (resumen cronológico)

1. `37eaf5d` — scaffold Tool3D + herramientas de imagen.
2. `552cb58` — quitar fondo residual y recortar el SVG trazado.
3. `390d72b` — varita mágica + controles de zoom del preview.
4. `e83174d` — componentes de imagen (fondo + vectorización).
5. `328600b` — transformaciones, detección real de colores y export multi-formato.
6. `91772cd` — paleta anidada estable y menos colores por defecto.
7. `ea843ca` — stepper, unidades de tamaño y panel de edición compacto.
8. `a3bbd71` — limpieza de UI y reorganización del panel vector.
9. `79848f6` — fusionar colores casi idénticos antes de rankear la paleta.
10. `d0b3010` — estilos vectoriales, controles de calidad y panel reorganizado.
11. `13ca259` — paso Convertir, paleta consciente del fondo y undo de vector.
12. `d5a1890` — módulos de llavero con imagen y posavasos.
13. `de0f9f0` — posavasos 3D: settings paramétricos, extrusión de SVG por capas y export.
14. `eada820` — utilidades de malla 3D, generadores de patrones y componente de posavasos.
15. `73301f0` — generación de posavasos, render de patrones y UI.
16. `099c5f4` — posavasos + mosaico + integración JSCAD (HEAD actual).

---

## 4. Lo que se hizo en esta sesión (documentación)

Se creó/actualizó:

- `README.md` — visión general, stack, setup, estructura, herramientas, flujo,
  reglas, cómo agregar tools, limitaciones.
- `docs/ARCHITECTURE.md` — capas, módulos, pipelines, invariantes, performance,
  accesibilidad, deuda técnica.
- `docs/DECISIONS.md` — 14 ADRs (framework, client-side, UI, registry, tracer,
  fondo, JSCAD, three, 2D vs 3D, handoff, dynamic imports, 3MF, downscale, tests).
- `docs/TROUBLESHOOTING.md` — 15 problemas reales con causa/solución/archivo +
  checklist.
- `docs/SESSION.md` — este archivo.
- `docs/PROJECT.md` — actualizado al estado real (Next 16, herramientas
  disponibles, roadmap).

Verificación ejecutada (sobre el estado actual, con HEAD + docs):

```bash
npm run lint    # OK
npm run build   # OK (Next.js 16.4.2, Turbopack, 5 rutas)
```

---

## 5. Próximos pasos sugeridos (en orden)

1. **Recuperar/reaplicar el refactor de geometría** antes que nada: el working
   tree perdió `coaster.ts` (2D ops) y la eliminación de `tmp-mosaic.mjs`.
   `src/lib/3d/geom2-ops.ts` quedó huérfano. Hay que:
   - reescribir `coaster.ts` para importar `geom2-ops.ts` (sin `mergeSolids`),
   - borrar `tmp-mosaic.mjs`,
   - verificar `git diff` y commitear cuando el usuario lo autorice.
   Mensaje sugerido: `refactor(3d): validate 2D booleans and avoid non-manifold 3D ops`.
2. **Alinear `/tools/llavero`**: el registry lo marca `available` pero la página
   es un placeholder. Opciones:
   - cambiar `status` a `"soon"`, o
   - implementar el módulo (tamaño, agujero de anilla, relieve, export).
3. **Conectar header con el registry** o documentar que la navegación es fija.
4. **Tests** (deuda principal):
   - Vitest para `src/lib/image/trace.ts` (paleta, split, sentinel).
   - Vitest para `src/lib/3d/geom2-ops.ts` (validación y CCW).
   - Test de integración que abra un 3MF exportado y verifique `pid`/`p1`.
5. **Validar el 3MF en un slicer real** (PrusaSlicer/Orca/Bambu) tras el
   refactor; es el punto más frágil.
6. **Mover trazado/flood fill a un Web Worker** si se necesita trabajar a
   resolución completa con fluidez.
7. **Actualizar los checkboxes del PRD** (`docs/prd/001-toolkit-imagen.md`):
   la fase 1 está implementada pero las casillas siguen `[ ]`.
8. **Persistencia opcional** (IndexedDB) para no perder el trabajo al recargar.
9. **Implementar `generate-3d`** (siluetas → STL/3MF) reutilizando `svg.ts`,
   `geom2-ops.ts` y `mesh.ts`.

---

## 6. Trampas conocidas al retomar

- El `coaster.ts` de HEAD **todavía usa booleanos 3D** (`mergeSolids`), aunque la
  dirección correcta es el refactor 2D de `geom2-ops.ts`. No asumir que el
  refactor está aplicado: verificar el working tree.
- No usar booleanos 3D de JSCAD en el posavasos → mallas no estancas.
- No usar `booleans.*` 2D directamente → validar con `geom2-ops.ts`.
- No confiar en el color por objeto del 3MF → `addTriangleColors`.
- No tocar `BACKGROUND_SENTINEL` sin actualizar `isBackgroundColor`.
- No mutar canvas sin incrementar `version`.
- `next.config.ts` depende de Turbopack para el CSS; no cambiar el loader sin
  probar `build`.
- La UI está en español; mantener el idioma y los mensajes.

---

## 7. Cómo retomar en 60 segundos

```bash
git status
git log --oneline -5
npm install        # si hace falta
npm run lint
npm run build
npm run dev
```

Luego leer, en este orden:

1. `README.md` (qué es y cómo correr).
2. `docs/ARCHITECTURE.md` (cómo está armado).
3. `docs/TROUBLESHOOTING.md` (qué no romper).
4. Este archivo (qué falta).

---

## 8. Posavasos: malla estanca (2026-10-18, sin commit)

Estado: `src/lib/3d/region.ts` (nuevo) y `src/lib/3d/coaster.ts`, `src/lib/3d/svg.ts`
modificados. `npm run lint` limpio y `npm run build` OK (5 rutas estáticas).
HEAD sigue en `099c5f4`; nada commiteado.

Qué se descubrió (medido, no supuesto):

- Los booleanos 2D de JSCAD (`booleans.union/subtract`) devuelven geometría sin
  cerrar con SVGs vectorizados (`geometry is not closed at vertex`) o la degradan a
  nada; el emparejado de aristas de `geom2.create` no resuelve solapes. Descartados
  para el corte de la base.
- Los `transforms.*` de JSCAD son perezosos: leer `.sides`/`.vertices` sin mediar una
  medición devuelve las coordenadas sin transformar. Por eso `place`, `liftSolid` y
  los recorridos de anillos escriben/mueven los vértices a mano.
- `extrusions.extrudeLinear` de JSCAD deja tapas abiertas con contornos cóncavos y/o
  varios huecos → no se usa para las piezas del posavasos.

Solución implementada:

- `region.ts` extruye a mano: earcut de three para las tapas y, sobre todo,
  **paredes construidas desde las aristas de borde de las tapas** (las que aparecen
  una sola vez), así la malla es watertight aunque earcut descarte puntos colineales.
- Booleano propio por rasterizado (`RASTER_MM = 0.05`, `RASTER_SIMPLIFY_MM = 0.08`,
  `rasterDifference`/`rasterFill`, relleno non-zero por scanline + trazado de
  contornos + Douglas-Peucker) para restar/llenar regiones con huecos que se cruzan.
- `coaster.ts` usa el camino raster cuando hay 4+ huecos o 5+ anillos por celda.

Verificación (arnés Node con el SVG real de la araña, 3 capas):

- `through` 55 piezas, `engrave` 100, `raise` 45 → **0 aristas abiertas y 0 caras
  repetidas** en todas; corte correcto (7927.80 → 4670.69 mm²).

Siguiente: re-exportar STL/3MF desde la app y comprobarlos en el laminador (los
archivos anteriores siguen roto). Pendiente valorar si el modo Huecos debe dividir la
base en islas (55 piezas) o avisar al usuario.


---

## 9. Cortador (2026-10-24, sin commit)

Estado: P0 y P1 completos; P2 parcial. Ruta /tools/cortador disponible en el
registry. 
px tsc --noEmit, 
pm run lint, 
pm test (26 tests) y

pm run build pasan; tambien el build estatico con GITHUB_PAGES=1 + basePath.

Implementado:

- src/lib/mesh/*: nucleo compartido de weld, topologia, huecos y reparacion;
  el Texturizador lo reutiliza via re-exports.
- src/lib/cutter/*: loaders STL/3MF con unidades y color por triangulo, worker
  manifold, cortes recto/curvo/forma/region, varita 3D, colocacion por sombra y
  clic, encastres espiga/chaveta con cantidad y holgura, sugerencia automatica de
  planos, undo/redo, proyecto en IndexedDB, export STL/3MF y reporte.
- WASM en public/wasm/manifold.wasm; funciona con output: "export".
- Verificado en navegador con CDP: cortes rectos/curvos/forma, varita, sombra,
  encastre, undo/redo, guardar/abrir y sugerencia, sin excepciones.

Pendiente: cola de milano, chaflan/cupon de tolerancia, preview decimado,
separacion volumetrica por color, superficies libres y validacion dura de curvas.
HEAD sin commit; scripts temporales de CDP eliminados.

Siguiente: definir si se cierra P2/P3 o se commitea el MVP actual.

### 9.1 Interaccion directa con el mouse (2026-10-24)

Pedido del usuario: poder trabajar los cortes sobre el modelo 3D con el mouse,
mover las piezas y que pintar la zona no sea click por click.

Implementado en `cutter-viewer.tsx` y `cortador-tool.tsx`:

- Arrastrar un plano azul en el visor mueve el corte en tiempo real; al soltar
  queda fijado. La colocacion por sombra/clic sigue disponible.
- Ondas y formas entran en modo colocacion al agregarlas; un clic sobre la pieza
  fija la altura de la onda o el centro X/Y de la forma. Cada tarjeta tiene su
  boton de puntero para volver a ubicarlas.
- Modo «Mover» en la lista de piezas: arrastrar una pieza la desplaza en el
  plano de camara; «Ubicar» restablece las posiciones.
- Varita: pointerdown + arrastre pinta y acumula caras de la misma zona; Shift
  agrega otra zona y Alt resta. `zoneFromFaces` reconstruye borde, area, normal
  y eje desde el conjunto pintado.
- El visor bloquea la orbita mientras pinta, mueve una pieza o arrastra un
  plano, y restaura los controles al soltar.

Verificado con CDP: plano colocado (-15.4 mm) y arrastrado (8.9 mm), forma
estrella ubicada por clic, pieza movida, zona pintada de 46 caras y cortes
posteriores con 2-4 piezas, sin excepciones. `tsc`, lint, 26 tests y build
pasan.

### 9.2 Gizmo Orca y separación automática de formas (2026-10-24)

Pedido del usuario: manejar el corte como en OrcaSlicer (posicionar y girar con
el mouse y aplicar con un botón) y separar formas unidas sin medir nada.

Implementado:

- Plano con gizmo: el cuerpo se arrastra para desplazarlo y el aro ámbar (o
  Shift al arrastrar) lo inclina alrededor de su centro. Admite cualquier
  orientación, no solo X/Y/Z. Un panel flotante muestra el plano activo, el
  desplazamiento y la inclinación, con «Aplicar corte».
- `planeRange` proyecta la caja sobre la normal para que los sliders funcionen
  también con planos inclinados; al inclinar, el eje dominante se actualiza.
- `seams.ts`: detecta uniones cóncavas (diedro ≥ 32° y concavidad negativa),
  agrupa las aristas en bucles cerrados, ajusta un plano por Newell y valida
  cada candidato partiendo la malla. Si no hay uniones, cae en `suggestCuts`.
- Botón «Separar formas automáticamente» en Zonas: agrega los planos detectados
  y corta al instante, con vista explotada.

Calibración del signo de concavidad: en el cubo convexo el detector devuelve 0
uniones; en la unión esfera r10 + cilindro r5×30 encuentra 1 unión y parte en
2 piezas watertight (4.11 + 1.67 cm³) en 118 ms. Verificado en navegador con CDP
sin excepciones. `tsc`, lint, 26 tests y build pasan. Sin commit.

### 9.3 Layout, varita y objetos separables (2026-10-24)

Tres problemas reportados con un 3MF de esqueleto (1.782.566 triángulos, 24 MB):

- **Layout:** el Cortador no tenía contenedor propio. Ahora usa
  `mx-auto max-w-7xl px-4 py-8`, el nombre del archivo se trunca y el panel
  lateral es sticky con scroll independiente (`overflow-y-auto`,
  `max-h-[calc(100vh-6rem)]`). Verificado a 1920×1080: sin overflow horizontal.
- **Varita:** el 3MF no tenía materiales; el loader inventaba `#cbd5e1` y
  mostraba «Color 3MF». Ahora los colores faltantes quedan en `null`, se avisa
  que no hay materiales y no se ofrece separar por color. La varita usa
  crecimiento por ángulo local entre caras vecinas (no contra la cara semilla),
  así recorre superficies curvas. Para selecciones enormes (>50k caras) dibuja
  solo el borde; si la selección es toda la cáscara no dibuja overlay.
- **Rendimiento:** caché CSR de normales/adyacencia, caché de regiones por
  color/tolerancia y caché del resultado dominante. En el esqueleto, clics
  repetidos bajaron de ~7-10 s a ~2,6 s de pared medidos con CDP (incluye
  overhead del harness); el primer clic incluye compilación/caché.
- **Objetos:** botón «Separar objetos» que usa `Manifold.decompose()` y una
  operación `components` del proyecto. En el esqueleto devuelve 1 cáscara real
  (los 3 componentes del diagnóstico son cáscaras menores), así que avisa que es
  una sola pieza. Para modelos con cáscaras independientes separa sin cortar.
- **Límite honesto:** ese esqueleto es una sola superficie continua sin color;
  no hay información geométrica para aislar «el zapato» semánticamente. Para eso
  quedan el gizmo manual tipo Orca y la separación automática por uniones
  cóncavas.

Verificado: `tsc`, lint y build pasan; 29 tests (mesh 8, split 10, zones 6,
seams 2, suggest 2, report 1). Sin commit.

### 9.4 Vista previa antes de cortar (2026-10-24)

Antes, elegir una zona o detectar uniones ejecutaba el corte de inmediato y
podían aparecer piezas de volumen cero. Ahora el flujo es en dos pasos:

- Seleccionar una zona, activar la varita, sugerir cortes, separar formas o
  separar objetos **solo agrega operaciones pendientes**. Las piezas actuales no
  cambian y la zona queda resaltada en el visor.
- Aparece un panel flotante con «Aplicar cortes (N)»; recién ahí corre el worker
  y se separan las piezas.
- Los planos agregados quedan visibles y se pueden mover o inclinar antes de
  aplicar. Después de aplicar, cada pieza usa un color distinto.
- `runCuts` descarta fragmentos con volumen <= 1e-4 mm³; si no queda ninguna
  pieza válida, muestra un error y conserva el estado anterior.
- Los volúmenes pequeños se muestran con decimales (ya no aparecen como 0).

Verificado en navegador con el modelo esfera+cilindro: antes de aplicar había 1
pieza; al pulsar Aplicar quedaron 2 piezas (4.11 + 1.67 cm³), sin volúmenes en
cero y sin excepciones. `tsc`, lint, 29 tests y build pasan. Sin commit.

### 9.5 Previews de cortes curvos, por forma y por zona (2026-10-24)

Antes solo se dibujaban los planos; las ondas, formas y zonas se cortaban sin
referencia visual. Ahora el visor dibuja cada corte pendiente:

- Ondas: línea violeta con la trayectoria sinusoidal real sobre la pieza.
- Formas: contorno violeta del cortante en la cara superior.
- Zonas: contorno de cada anillo a la profundidad del corte.
- El corte activo se resalta en ámbar; los previews usan depthTest desactivado
  y renderOrder 5 para verse sobre el modelo.

El flujo de vista previa no cambió: los cortes quedan pendientes y recién se
ejecutan con «Aplicar cortes». `tsc`, lint, 34 tests y build pasan. Sin commit.
