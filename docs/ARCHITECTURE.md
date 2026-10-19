# Arquitectura — Tool3D

Documento técnico de referencia. Explica cómo está organizado el código, cómo
fluyen los datos y qué invariantes hay que respetar al extenderlo.

---

## 1. Principios

1. **Modularidad por herramienta**: cada tool tiene su ruta en
   `src/app/tools/<slug>/` y su UI en `src/components/tools/<slug>/`.
2. **Registro central**: `src/lib/tools/registry.ts` es la fuente de verdad del
   catálogo que muestra la home.
3. **Lógica pura separada de UI**: el procesamiento vive en `src/lib/image/*` y
   `src/lib/3d/*`, sin dependencias de React.
4. **Client-only cuando aplica**: librerías pesadas por `dynamic import`.
5. **Sin secretos**: no hay claves API; todo el cómputo es local.
6. **Privacidad**: las imágenes nunca salen del navegador.

---

## 2. Capas

```
┌─────────────────────────────────────────────────────────────┐
│ app/ (rutas y metadata)                                     │
│   layout.tsx · page.tsx · tools/<slug>/page.tsx             │
├─────────────────────────────────────────────────────────────┤
│ components/tools/<slug>/ (UI, estado local, interacción)    │
│   image-tool · editor-canvas · posavasos-tool · model-viewer │
├─────────────────────────────────────────────────────────────┤
│ lib/ (lógica pura, testeable, sin React)                    │
│   image/*  ·  3d/*  ·  tools/registry  ·  utils             │
├─────────────────────────────────────────────────────────────┤
│ Dependencias externas                                       │
│   imagetracerjs · @imgly/background-removal · @jscad/*       │
│   three · jszip · fflate                                    │
└─────────────────────────────────────────────────────────────┘
```

Regla práctica: si una función no toca el DOM ni hooks, va en `lib/`. Si toca
canvas/DOM, puede ir en `lib/` siempre que reciba y devuelva datos explícitos
(por ejemplo `canvas.ts`).

---

## 3. Mapa de módulos

### 3.1 Catálogo

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/lib/tools/registry.ts` | `ToolDefinition`, `TOOL_CATEGORIES`, `TOOLS`, `getTool`, `getAvailableTools` |
| `src/app/page.tsx` | Renderiza la home a partir de `TOOLS`; tool cards con badge Disponible/Próximamente |

`ToolDefinition`:

```ts
interface ToolDefinition {
  slug: string;
  name: string;
  description: string;
  category: "imagen" | "3d" | "utilidades";
  status: "available" | "soon";
  icon: LucideIcon;
  tags: string[];
  features?: string[];
}
```

### 3.2 Shell de UI

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/app/layout.tsx` | Metadata, fuentes Geist, header, main, footer, providers |
| `src/components/providers.tsx` | `ThemeProvider` (next-themes), `TooltipProvider`, `Toaster` |
| `src/components/layout/site-header.tsx` | Marca, navegación (hardcodeada a `/`), GitHub, theme toggle |
| `src/components/layout/site-footer.tsx` | Créditos y link al repo |
| `src/components/layout/theme-toggle.tsx` | Claro/oscuro con `resolvedTheme` |

### 3.3 Imagen — `src/lib/image/*`

| Archivo | Funciones clave | Notas |
|---------|-----------------|-------|
| `canvas.ts` | `createCanvas`, `get2d`, `loadImageFromFile`, `imageFileToCanvas`, `blobToCanvas`, `canvasToBlob`, `extractRegion` | `get2d(canvas, readFrequently)` |
| `background.ts` | `removeBackgroundClient` | Dynamic import de `@imgly/background-removal`; modelo `isnet_fp16`; progreso |
| `trace.ts` | `prepareTraceImageData`, `tracePreparedImage`, `splitSvgByColor`, `filterSvgByColors`, `stripBackgroundPaths`, `estimateColorCount`, `buildColorPalette`, `tracePreparedImage` | Cuantización 4-bit, sentinel magenta, presets y paleta |
| `flood-fill.ts` | `floodFillByColor` | Varita mágica; usa pila `Int32Array`, no recursión |
| `export.ts` | `canvasToBmp`, `canvasToIco` | Encoders propios; ICO = PNG 256×256 dentro de contenedor ICO |
| `download.ts` | `downloadBlob`, `downloadText`, `downloadZip`, `baseName` | ZIP con `jszip` por dynamic import |

#### Pipeline de vectorización

```
File
  → imageFileToCanvas (canvas.ts)
  → downscale a 2048 (image-tool.tsx)
  → ImageData
  → prepareTraceImageData (trace.ts)
       ├─ detecta color de borde (si no hay alpha)
       ├─ construye máscara de fondo por flood fill desde los bordes
       ├─ recorta a bounds de contenido + padding 2 px
       ├─ aplica modo (color/mono/mono-invert/negative/grayscale)
       └─ pinta fondo con sentinel rgb(255,0,255)
  → pixel data listo (siempre alpha = 255)
  → ImageTracer.imagedataToSVG (paleta fija, colorsampling: 0)
  → stripBackgroundPaths (elimina paths del sentinel)
  → splitSvgByColor (agrupa paths por fill)
  → SVG completo y/o capas por color
```

Constantes relevantes (`trace.ts`):

- `BACKGROUND_SENTINEL = { r:255, g:0, b:255 }`
- `CONTENT_PADDING = 2`
- `MERGE_DISTANCE = 40` (fusión de colores casi idénticos)
- bins de color de 4 bits → 4096 cubos
- `MAX_COLOR_DISTANCE = sqrt(3) * 255`

#### Modos de trazado

- `color`: paleta real detectada.
- `mono`: negro sobre sentinel.
- `mono-invert`: sentinel sobre negro (silueta invertida).
- `negative`: invierte canales RGB.
- `grayscale`: luma `0.299R + 0.587G + 0.114B`.

### 3.4 3D — `src/lib/3d/*`

| Archivo | Funciones clave | Notas |
|---------|-----------------|-------|
| `svg.ts` | `svgToDesign`, `mergeBounds` | SVG → `Geom2[]` con `SVGLoader` de three; invierte Y; limpia anillos |
| `geom2-ops.ts` | `areaOf`, `isSolid`, `asCCW`, `unionValidated`, `subtractEach`, `intersect2D` + helpers de clipping (`signedArea`, `outlinePoints`, `clipToConvex`, `clipPolygonToPoints`) | Capa de validación 2D. **Aún no integrada**: ningún archivo la importa |
| `patterns.ts` | `patternToSvg`, `patternPreviewUrl`, `PATTERN_KINDS`, `PATTERN_LABELS` | 15 patrones generados como SVG |
| `mosaic.ts` | `buildMosaicSvg`, `mosaicPreviewUrl`, `TILE_KINDS`, `TILE_LABELS` | 6 layouts; presupuesto de 2000 elementos |
| `coaster.ts` | `buildCoaster`, `DEFAULT_COASTER_SETTINGS`, `colorToRgba`, tipos | Construcción paramétrica; en HEAD usa `mergeSolids` (booleanos 3D) |
| `mesh.ts` | `geom3ToBufferGeometry`, `piecesToMeshes`, `exportStl`, `export3mf`, `rgbaToHex` | Puente JSCAD ↔ three y export |
| `handoff.ts` | `writePosavasosHandoff`, `readPosavasosHandoff`, `parsePosavasosHandoff`, `clearPosavasosHandoff`, `handoffSnapshot` | `sessionStorage` |

#### Pipeline de posavasos

```
Handoff (sessionStorage) o SVG cargado
  → splitSvgByColor (una capa por color)
  → HandoffLayer[] { color, svg }
        │
Settings (CoasterSettings) ──┤
        ▼
buildCoaster(settings, layers)        [coaster.ts]
  ├─ buildBaseGeom2: circle / rect redondeado / polígono regular
  ├─ patternToSvg o buildMosaicSvg (si aplica)
  ├─ svgToDesign por capa → Geom2[]
  ├─ clip / cut (booleanos 3D en HEAD; objetivo: 2D validado)
  ├─ mergeSolids (unión 3D en HEAD; objetivo: 2D + extrusiones)
  └─ colors.colorize
        ▼
CoasterModel { pieces: CoasterPiece[], totalHeightMm, bandMm, ... }
        │
        ├─ piecesToMeshes → ModelViewer (three)
        └─ exportStl / export3mf
```

> **Estado real al cierre de esta documentación**: `coaster.ts` en HEAD todavía
> construye con `mergeSolids` (booleanos 3D). El refactor a 2D + extrusión pura
> está descrito abajo y su capa de validación (`geom2-ops.ts`) existe, pero no
> está conectada. Ver `docs/SESSION.md` §2.

#### Sistema de coordenadas

- SVG entra con Y hacia **abajo**; `svg.ts` invierte a Y hacia **arriba**.
- JSCAD exige contornos **antihorarios** (área positiva); `asCCW` lo garantiza.
- En el visor, la cámara usa `up = (0,0,1)` y el grid se rota para quedar en XY.

#### Modelo de piezas

`CoasterPiece`:

```ts
interface CoasterPiece {
  name: string;
  color: [number, number, number, number]; // RGBA 0..1
  geometry: Geom3;                          // JSCAD
}
```

`buildCoaster` separa:

- `basePieces`: base, piso, anillo, techo, labio.
- `colorPieces`: relleno/relieve de cada capa de color.

Las piezas se **solapan una capa** (`anchorOverlapMm`) para evitar caras
coplanares y regiones flotantes en el slicer.

### 3.5 UI de herramientas

#### Imagen (`image-tool.tsx`, ~2300 líneas)

Estado principal:

- `originalCanvas` (pristine restaurable), `workCanvas` (editable).
- `status: empty | ready | removing`, `version` (fuerza re-render del canvas).
- `traceSettings`, `traceState`, `excludedColors`, `detectedColors`.
- Historial de pincel (`historyRef`, máx. 30) e historial de ajustes
  (`settingsHistoryRef`, debounce 600 ms).
- `cropActive` / `cropRect`, `exportFormat`, `exportQuality`.
- `resizeInput`, `sizeUnit`, `dpi`, borradores de ancho/alto.

Stepper (`@stepperize/react`):

1. `background` — Editar.
2. `vector` — Vector.
3. `convert` — Convertir.

Trazado: `useEffect` con debounce de 400 ms sobre
`JSON.stringify([version, traceSettings])`.

#### Posavasos (`posavasos-tool.tsx`, ~1400 líneas)

- `settings: CoasterSettings`, `built: { key, model, meshes }`.
- `buildKey` incluye settings resueltos + nº de capas + nombre de origen.
- `useEffect` con debounce de 200 ms → `buildCoaster` → `piecesToMeshes`.
- `designKind` se auto-resuelve a `"image"` si llega un handoff y el usuario no
  eligió otro tipo.
- Handoff se lee con `useSyncExternalStore` (`handoffSnapshot`) y se puede
  descartar.
- Paneles colapsables (`openPanels`) y modo expandido (tecla `Esc`).

#### Visor (`model-viewer.tsx`)

- `WebGLRenderer` con fallback de texto si WebGL no está disponible.
- `OrbitControls` con damping; cámara `up = (0,0,1)`.
- `HemisphereLight` + dos `DirectionalLight`.
- `GridHelper` rotado y ocultable.
- Auto-fit por `Box3` cuando cambia el tamaño del modelo.
- Vistas: iso, superior, frontal; zoom por botones; auto-rotación.
- Limpieza explícita de geometrías/materiales en unmount.

---

## 4. Flujo de datos entre herramientas (handoff)

`src/lib/3d/handoff.ts`:

```ts
interface HandoffLayer { color: string; svg: string }
interface PosavasosHandoff {
  name: string;
  width: number;
  height: number;
  layers: HandoffLayer[];
  savedAt: number;
}
const STORAGE_KEY = "tool3d:handoff:posavasos";
```

- La herramienta de imagen llama `writePosavasosHandoff` con las capas visibles.
- Posavasos lee con `readPosavasosHandoff` / `handoffSnapshot`.
- `parsePosavasosHandoff` valida que haya `layers` no vacío.
- `clearPosavasosHandoff` borra el estado al empezar de nuevo.
- Todo va envuelto en `try/catch`: si `sessionStorage` falla, se devuelve
  `null`/`false` sin romper la UI.

Por qué `sessionStorage` y no estado global: sobrevive la navegación entre
rutas, no requiere provider ni serializar canvas, y se limpia al cerrar la
pestaña. No sirve para persistencia entre sesiones.

---

## 5. Invariantes y reglas duras

1. **Booleanos 2D de JSCAD**: siempre validar (`isSolid`, `areaOf`,
   `unionValidated`, `subtractEach`). Nunca confiar en el resultado crudo.
   *(Regla objetivo: `geom2-ops.ts` la implementa, pero `coaster.ts` aún no la usa.)*
2. **Contornos CCW**: `asCCW` antes de cualquier booleano.
3. **Booleanos 3D prohibidos** en la construcción del posavasos: usar 2D +
   `extrudeLinear`. *(Regla objetivo: el `coaster.ts` de HEAD todavía usa
   `mergeSolids`; el refactor está pendiente.)*
4. **Solape de una capa** entre piezas que deben fusionarse.
5. **3MF**: inyectar `pid`/`p1` por triángulo y reescribir `displaycolor`.
6. **SVG limpio**: deduplicar puntos, eliminar colineales, descartar anillos
   con < 3 puntos, invertir Y.
7. **Trazado**: fondo siempre sentinel magenta; recortar a bounds de contenido.
8. **Paleta**: fusionar colores a distancia ≤ 40 antes de rankear.
9. **Límites de seguridad**:
   - `MAX_LOAD_DIMENSION = 2048`
   - `MAX_HISTORY = 30`
   - `MAX_COLORS = 32`
   - `MAX_PATHS = 600`, `MAX_POLYGONS = 1200`
   - `MAX_TILES = 256`, `MAX_SOURCES = 24`, `MOSAIC_ELEMENT_BUDGET = 2000`
   - patrones: tope de 400 filas/columnas
10. **Dynamic imports** para todo lo pesado.

---

## 6. Rendimiento

- Downscale inicial de imágenes a 2048 px.
- Trazado con debounce (400 ms) y reconstrucción 3D con debounce (200 ms).
- Cuantización de color en bins de 4 bits (4096) en vez de mapas gigantes.
- Flood fill iterativo con pilas tipadas (`Int32Array`), sin recursión.
- `willReadFrequently: true` en contextos 2D que se leen.
- Unión 2D validada en una sola operación (y fallback por pieza).
- Límites de paths/polígonos/piezas para acotar el peor caso.
- Librerías pesadas fuera del bundle inicial.

---

## 7. Accesibilidad

- Dropzone con `role="button"`, `tabIndex`, Enter/Espacio.
- Botones con `aria-label`/`title` en el visor y el zoom.
- `aria-pressed` en toggles.
- Keyboard en zoom (`+`, `-`, `0`) y en pantalla completa (`Esc`).
- Labels asociados en inputs de settings.
- Tema claro/oscuro con contraste basado en tokens shadcn.

---

## 8. Manejo de errores

- `toast` (sonner) para errores de usuario (archivo inválido, export fallido,
  SVG sin colores, etc.).
- `try/catch` alrededor de operaciones JSCAD/three/serializers para degradar sin
  romper la UI.
- Fallback de WebGL con mensaje que aclara que la exportación sigue disponible.
- `parsePosavasosHandoff` devuelve `null` ante JSON inválido.
- En `buildCoaster`, una pieza que falla se omite; el modelo en blanco siempre
  tiene una losa base.

---

## 9. Deuda técnica / puntos frágiles

- **Refactor de geometría sin aplicar**: `geom2-ops.ts` está huérfano y
  `coaster.ts` (HEAD) todavía usa booleanos 3D. El working tree perdió la
  reescritura durante la sesión de documentación (ver `docs/SESSION.md` §2).
- `image-tool.tsx` y `posavasos-tool.tsx` son componentes muy grandes; candidatos
  a extracción de hooks y subcomponentes.
- No hay tests.
- No hay validación de tipos en runtime para el handoff más allá de `layers`.
- El header no usa el registry.
- `/tools/llavero` es placeholder pero figura `available`.
- El 3MF depende de detalles del serializer; conviene un test de integración que
  abra el ZIP y valide `pid`/`p1`.
- La regla de ESLint para `<img>` está deshabilitada puntualmente en el preview
  de SVG (`@next/next/no-img-element`).
