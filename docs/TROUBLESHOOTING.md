# Problemas resueltos y errores a no repetir — Tool3D

Bitácora de bugs reales encontrados durante el desarrollo, con síntoma, causa,
solución y archivo. Sirve para diagnosticar rápido y para no reintroducir los
mismos errores.

---

## Tabla rápida

| Síntoma | Causa probable | Solución | Archivo |
|---------|----------------|----------|---------|
| `geometry is not closed` al procesar SVG | puntos duplicados/colineales o lados de longitud cero | limpiar anillos, deduplicar, quitar colineales, CCW | `src/lib/3d/svg.ts` |
| El patrón desaparece o el modelo sale vacío | celdas que se tocan → unión degenerada | reducir radio por el gap pedido | `src/lib/3d/patterns.ts` |
| El slicer ignora colores del 3MF | color a nivel objeto, no por triángulo | inyectar `pid`/`p1` por triángulo | `src/lib/3d/mesh.ts` |
| Colores corruptos/negros en 3MF | `colors.rgbToHex` no redondea | reescribir `displaycolor` con hex propio | `src/lib/3d/mesh.ts` |
| Piezas flotantes / capas vacías | caras coplanares y mallas no estancas | solapar una capa + evitar booleanos 3D | `src/lib/3d/coaster.ts` |
| Booleanos 2D devuelven basura sin error | JSCAD falla en silencio | validar área/solidez/contención y CCW | `src/lib/3d/geom2-ops.ts` |
| El trazado arrastra el fondo | fondo no detectado o máscara incompleta | detectar borde + flood fill + sentinel | `src/lib/image/trace.ts` |
| Colores casi iguales generan capas de más | bins sin fusionar | fusionar a distancia ≤ 40 | `src/lib/image/trace.ts` |
| La UI se congela con imágenes grandes | resolución excesiva | downscale a 2048 al cargar | `src/components/tools/image/image-tool.tsx` |
| El primer uso de una herramienta tarda | librería pesada por dynamic import | esperado; mostrar progreso | varios |
| SVG grande no llega a posavasos | límite de `sessionStorage` | avisar y permitir carga manual de SVG | `src/lib/3d/handoff.ts` |
| Posavasos no toma el handoff | JSON inválido o `layers` vacío | `parsePosavasosHandoff` devuelve `null` | `src/lib/3d/handoff.ts` |

---

## 1. JSCAD: `geometry is not closed`

**Síntoma**: al convertir un SVG a geometría, JSCAD lanza
`geometry is not closed` o genera piezas vacías.

**Causa**: `SVGLoader` de three divide curvas y devuelve anillos con puntos
repetidos, vértices colineales y lados de longitud cero. JSCAD no tolera lados
cero.

**Solución** (`src/lib/3d/svg.ts`):
- `cleanRing`: deduplica puntos a distancia ≤ `1e-3`, elimina el cierre
  duplicado y quita colineales.
- Descarta anillos con menos de 3 puntos.
- Invierte Y (SVG hacia abajo → plano hacia arriba).
- Fuerza sentido antihorario con `signedArea`.
- Los huecos se restan con `booleans.subtract` envuelto en `try/catch`.

**Regla**: nunca pasar un anillo crudo de `SVGLoader` a JSCAD.

---

## 2. JSCAD 2D: booleanos que devuelven basura sin lanzar error

**Síntoma**: una unión/resta "funciona" pero produce geometría sin área, con
huecos incorrectos o con el patrón desaparecido.

**Causa**: los booleanos 2D de JSCAD pueden fallar en silencio. Además, si el
contorno no está en CCW, el resultado es inválido.

**Solución** (`src/lib/3d/geom2-ops.ts`):
- `areaOf` con `measureArea` y fallback 0.
- `isSolid`: es `geom2`, tiene ≥ 3 lados y área > `AREA_EPSILON` (0.01).
- `asCCW`: invierte el outline si el área es negativa.
- `unionValidated`: valida que el área no supere la suma, que no sea menor al
  98 % del mayor y que contenga muestras (`containsAll`). Si falla, devuelve
  `merged: false` para usar piezas separadas.
- `subtractEach`: resta de a un contorno, validando que el área baje y no
  colapse (< 2 % del original).
- `intersect2D`: valida ambos operandos y el resultado.

**Regla**: toda operación booleana 2D pasa por `geom2-ops.ts`. No usar
`booleans.*` directamente.

---

## 3. Booleanos 3D → mallas no estancas y colores perdidos

**Síntoma**: el STL/3MF se ve bien en el visor, pero el slicer reporta regiones
flotantes, capas vacías o descarta los colores.

**Causa**: los booleanos 3D de JSCAD dejan T-junctions (mallas no estancas). Los
laminadores interpretan partes como piezas flotantes y no aplican materiales.

**Solución** (`src/lib/3d/coaster.ts`; **pendiente de aplicar**: en HEAD este
archivo todavía usa `mergeSolids` con booleanos 3D):
- Construir todo con **operaciones 2D + `extrudeLinear` puro**.
- Grabar/perforar recortando en 2D y extruyendo el resultado.
- Solapar piezas una capa (`anchorOverlapMm = min(layerHeight, bandMm)`) para
  que se fusionen de verdad y no queden caras coplanares.
- El relleno de color se hunde `recess = min(0.2, bandMm/2)` para evitar
  z-fighting y leerse como grabado.
- Las piezas que fallan se omiten; siempre queda una losa base.

**Regla**: no volver a introducir `booleans.union`/`subtract` en 3D para el
posavasos. Si se necesita otra operación, resolverla en 2D. *(En HEAD todavía
están; el objetivo del refactor es quitarlos.)*

---

## 4. 3MF sin color por pieza

**Síntoma**: el 3MF se abre, pero todo sale de un color o el slicer ignora los
materiales.

**Causa**: el serializer asigna color a nivel de objeto; los slicers esperan
material por triángulo (`pid`/`p1`). Además, `colors.rgbToHex` de JSCAD no
redondea y produce hex corruptos para colores casi enteros.

**Solución** (`src/lib/3d/mesh.ts` → `addTriangleColors`):
1. Descomprimir el 3MF con `fflate.unzipSync`.
2. Localizar `*.3dmodel.model`.
3. Reescribir cada `<base ... displaycolor="...">` con `#RRGGBBAA` en mayúsculas
   generado por `rgbaToHexA`.
4. En cada `<object>`, leer `pindex` y `pid` y agregar `pid`/`p1` a cada
   `<triangle>` que no los tenga.
5. Volver a comprimir con `zipSync({ level: 6 })`.

**Regla**: después de tocar el serializer, abrir el 3MF en un slicer real y
verificar colores y estanqueidad.

---

## 5. El patrón de panal desaparecía

**Síntoma**: con celdas de panal grandes, el patrón no aparecía o la unión
producía geometría inválida.

**Causa**: las celdas se tocaban entre sí; la unión de sólidos que comparten
bordes degenera.

**Solución** (`src/lib/3d/patterns.ts`):
- `gap = min(thickness, pitch * 0.6)`.
- `radius = max(0.4, (pitch - gap) / sqrt(3))`, dejando un hueco real entre
  celdas.
- Límites de 400 filas/columnas.

**Regla**: cualquier patrón que genere celdas contiguas debe dejar separación
física entre ellas.

---

## 6. Fondo residual al vectorizar

**Síntoma**: el SVG conserva el fondo blanco/color o un halo alrededor de la
figura.

**Causa**: el fondo no es transparente y el tracer lo interpreta como un color
más. Recortar solo por alpha no alcanza si la imagen es opaca.

**Solución** (`src/lib/image/trace.ts`):
1. `hasAlphaBackground`: si ≥ 2 % de píxeles son transparentes, ya hay fondo.
2. Si no, `detectBorderColor`: histograma de 4 bits de los bordes; requiere que
   el color dominante sea ≥ 30 % del borde.
3. `buildBackgroundMask`: flood fill desde los bordes con tolerancia; si cubre
   ≥ 99.5 % de lo opaco, se descarta (sería toda la imagen).
4. `computeAlphaBounds`: recorta al contenido + `CONTENT_PADDING = 2`.
5. Se pinta el fondo con el sentinel magenta `rgb(255,0,255)`.
6. `stripBackgroundPaths` elimina los paths de ese color del SVG.

**Regla**: el sentinel magenta es parte del diseño del pipeline. No cambiar el
color sin actualizar `isBackgroundColor` (r > 180, g < 90, b > 180).

---

## 7. Paleta inestable / demasiadas capas

**Síntoma**: colores casi idénticos generan capas separadas y el orden de la
paleta cambia entre ejecuciones.

**Causa**: bins de color sin fusionar y orden inestable.

**Solución** (`src/lib/image/trace.ts`):
- `collectColorBins` acumula por bin de 4 bits y promedia.
- `clusterColorBins` fusiona bins a distancia euclidiana ≤ `MERGE_DISTANCE = 40`
  y recalcula el promedio ponderado.
- Ordena por cantidad de píxeles (descendente) antes de recortar a `count`.
- `numberofcolors` se limita a 32.
- `initialColorCount` arranca en 4 (mínimo 2, máximo detectado).

**Regla**: no rankear sin fusionar antes; el orden debe depender del conteo.

---

## 8. UI congelada con imágenes grandes

**Síntoma**: al cargar una foto de móvil, la app tarda o se traba.

**Causa**: operaciones O(n) sobre millones de píxeles en el hilo principal.

**Solución**:
- `MAX_LOAD_DIMENSION = 2048` y `downscaleCanvas` al cargar.
- Se guarda el original en `fullResRef` y se ofrece "usar resolución completa".
- Trazado con debounce de 400 ms.
- Flood fill iterativo con `Int32Array`.
- `willReadFrequently: true` en contextos que se leen.

**Mejora futura**: mover trazado y flood fill a un Web Worker.

---

## 9. El canvas no se actualizaba tras editar

**Síntoma**: el pincel o el recorte modificaban el canvas lógico pero la vista no
cambiaba.

**Causa**: React no re-renderiza ante mutaciones de un objeto canvas.

**Solución**: patrón `version` numérico + `setVersion(v => v + 1)`.
`EditorCanvas` recibe `version` y vuelve a dibujar el canvas de trabajo en el
`displayCanvas`. El `resetKey` del `ZoomViewport` usa el propio canvas para
reajustar el zoom.

**Regla**: nunca mutar el canvas y esperar un re-render; incrementar `version`.

---

## 10. Undo/redo inconsistente

**Síntoma**: deshacer un trazo restauraba una zona equivocada o se perdía el
historial.

**Causa**: se guardaba el canvas completo o no se recortaba la rama de redo.

**Solución** (`image-tool.tsx` + `editor-canvas.tsx`):
- Cada entrada guarda solo el **rectángulo afectado** (`HistoryEntry` con
  `before`/`after` como `ImageData`).
- El pincel acumula bounds durante el trazo y al soltar extrae la región.
- `handleStroke` recorta el historial a `historyIndex + 1` antes de push.
- `MAX_HISTORY = 30`.
- Los ajustes de vector tienen su propio historial con debounce de 600 ms.

**Regla**: el historial de imagen y el de ajustes son independientes.

---

## 11. Cámara 3D mirando el eje equivocado

**Síntoma**: el modelo se ve de canto o el grid queda vertical.

**Causa**: three usa Y hacia arriba por defecto; el modelo está en el plano XY
con Z hacia arriba (como JSCAD).

**Solución** (`model-viewer.tsx`):
- `camera.up.set(0, 0, 1)`.
- `grid.rotation.x = Math.PI / 2`.
- Vistas: superior en `center.z + distance`, frontal en `center.y - distance`,
  iso combinando ejes.
- Auto-fit con `Box3`, `fov` y distancia `maxDim / 2 / tan(fov/2) * 2.2`.

---

## 12. WebGL no disponible

**Síntoma**: la vista 3D queda en blanco en navegadores sin WebGL.

**Solución** (`model-viewer.tsx`): `new WebGLRenderer(...)` dentro de `try/catch`;
si falla, se muestra un mensaje que aclara que la exportación sigue disponible.
No se rompe la herramienta.

---

## 13. Handoff vacío o inválido

**Síntoma**: posavasos no muestra el diseño enviado desde imagen.

**Causa**: `sessionStorage` vacío, JSON corrupto, cuota excedida o `layers`
vacío.

**Solución** (`handoff.ts`):
- `parsePosavasosHandoff` valida `layers` no vacío y devuelve `null` si falla.
- `writePosavasosHandoff` devuelve `false` si no puede escribir; la UI muestra
  un toast.
- La lectura usa `useSyncExternalStore` con un snapshot seguro.
- Se puede descartar el handoff (`handoffDismissed`) o limpiarlo (`handleNew`).

---

## 14. Tipos faltantes de librerías

**Síntoma**: TypeScript no reconoce `imagetracerjs` ni los serializers de JSCAD.

**Solución**:
- `src/types/imagetracerjs.d.ts`: módulo, `TraceOptions`, `ImageTracerStatic`.
- `src/types/jscad-serializers.d.ts`: `serialize` de STL y 3MF.

**Regla**: si se agrega otra librería sin tipos, declararla en `src/types/` en
vez de usar `any` suelto.

---

## 15. Next 16: tipos de layout

**Síntoma**: el layout no compila con el tipo de `children`/params.

**Solución**: usar el tipo generado `LayoutProps<"/">` (Next 16) y asegurarse de
que `.next/types` esté incluido en `tsconfig.json` (ya lo está).

---

## Checklist antes de tocar geometría o trazado

- [ ] ¿La operación booleana está en `geom2-ops.ts` y validada?
- [ ] ¿Los contornos están en CCW?
- [ ] ¿Las piezas que se fusionan se solapan una capa?
- [ ] ¿Evité booleanos 3D?
- [ ] ¿El patrón deja gap entre celdas?
- [ ] ¿El SVG se limpió (dedupe, colineales, Y invertida)?
- [ ] Si toqué el 3MF, ¿lo abrí en un slicer y verifiqué colores?
- [ ] ¿Respeté los límites de paths/polígonos/piezas?
- [ ] ¿`npm run lint` y `npm run build` pasan?
