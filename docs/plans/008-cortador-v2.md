# Plan — Módulo `cortador-v2` (puerto del motor de corto.com.ar)

## Restricciones

- **No tocar** `src/lib/cutter/*` ni `src/components/tools/cortador/*` (tienen cambios sin commitear).
- Módulo nuevo: datos en `src/lib/cutter2/`, UI en `src/components/tools/cortador-v2/`,
  ruta nueva en `src/app/**`, entrada nueva en `src/lib/tools/registry.ts` (slug `cortador-v2`).
- Artefactos de análisis: `docs/reports/008-corto-reverse-engineering.md`.

## Estado del puerto del motor (headless)

`src/lib/cutter2/engine/` contiene el motor recuperado (32 archivos):

```
analysis/{curvature,MeshAnalyzer}.ts
boolean/BooleanGeometryEngine.ts
core/{geometry,heap,MeshContext,MeshTopology,TaskContext,TriangleBVH,types}.ts
cut/{CapClearance,CurveEmbedder,CutSurfaceGenerator,domainTriangulation,laplace,polygon2d,SplitOperation}.ts
export/ExportManager.ts
import/{ModelImporter,stl,threemf,weld,xml}.ts
joints/JointGenerator.ts
perimeter/{BoundarySuggestionEngine,GeometrySnapping,maxflow,PlaneSection,SurfaceSplineEngine,SurfaceWalker}.ts
selection/SmartSelection.ts
service/EngineService.ts
validation/MeshValidator.ts
```

Cambios ya hechos:

- `core/types.ts` reescrito a mano (faltaba en los source maps): `Vec3`, `BBox`,
  `IndexedMesh`, `PK_VERTEX=0/PK_EDGE=1/PK_FACE=2`, `PathPoint{kind,id,t,b0,b1,b2,x,y,z,seg,pinned}`.
- Mojibake (`Ã©`) corregido re-codificando latin1→utf8 en todos los archivos.
- `BooleanGeometryEngine`: ya no importa `manifold-3d` con import estático; ahora
  `static fromWasm(wasm: ManifoldToplevel)` + `create()` con `await import('manifold-3d')`.
  El `EngineService` acepta `new EngineService(() => getManifoldWasmUrl())`.
- Instalados `delaunator@5.1.0` y `@kninnug/constrainautor@4.1.0` (los usa
  `cut/domainTriangulation.ts`). `fflate`, `manifold-3d`, `three`, `three-mesh-bvh` ya estaban.

Pendiente del motor:

1. Reconstruir `src/lib/cutter2/worker/protocol.ts` (no estaba en el source map).
   Lo importan `EngineService` y `engine.worker.ts`:
   `CutParams, CutPreview, DocumentView, EngineApi, ExportRequest, ExportResult,
   JointPreview, ModelInfo, PerimeterView, PieceGeometry, PieceMeta, PieceRole,
   SelectionData, SuggestionView, SuggestionsResult` + `WorkerRequest/WorkerResponse`.
   Leer `EngineService.ts` (957 líneas) completo para derivar cada forma.
2. `worker/engine.worker.ts` recuperado en `%TEMP%\opencode\corto\recovered2\src\worker`;
   adaptar a nuestro `getManifoldWasmUrl()` (descartar `wasmSource.ts` con `?url`).
3. Wrapper propio `src/lib/cutter2/{client,worker}.ts` y `index.ts`.

## API del `EngineService` (para la UI)

- `init()`, `loadModel(fileName, buffer)` → `{model: ModelInfo, doc: DocumentView}`.
- `analyzeModel({selfIntersections})` → `ModelAnalysis`.
- `undo()`, `redo()`, `setActivePiece(id)`, `orientModel(rotation: number[9])`, `updatePiece(id,{name,color})`.
- `getSelectionData(pieceId)` → `SelectionData` (faceAdj, faceComponent, faceAreas, faceRegion, merges, valleyFace).
- `computePerimeter(pieceId, PerimeterInput & {fixedPathId?})` → `PerimeterView`.
- `fitPerimeterToPlane(pieceId, key)` → `PlaneFitResult`.
- `checkSeparation(pieceId, key|keys)` → `{separates, message?}`.
- `suggestPerimeters(pieceId, selection: Uint8Array)` → `SuggestionsResult`.
- `previewCut(pieceId, keys, CutParams)` → `CutPreview`; `commitCut(previewId,{extracted,remainder},force)`; `discardPreview(id)`.
- `extractComponent(pieceId, component, trim)`.
- `suggestJoint(seamId, profileId)`, `previewJoint(seamId, JointParams)`, `commitJoint(previewId)`, `toleranceProfiles()`.
- `validatePiece(pieceId)`; `exportFiles(ExportRequest)` → `ExportResult`.

Detalle interno útil:

- `DocumentView = {pieces: PieceMeta[], seams: SeamView[], geometries: PieceGeometry[], canUndo, canRedo, activePieceId}`;
  `geometries` solo incluye piezas nuevas (cache `sentGeometry`).
- Estados: `PieceRole` (`'model' | 'extracted' | 'remainder'`), `PieceRecord.downDirection`,
  `SeamRecord = {id, extractedId, remainderId, info: SeamInfo, joint, loop: Float32Array, method, parentName, cutId}`.
- `PieceGeometry = {id, positions: Float32Array, indices: Uint32Array, capMask: Uint8Array}`.
- Historial acotado a 30 pasos; `gc()` libera cachés de piezas muertas.
- `orientModel` rota alrededor del centro de la caja, conserva la altura mínima (z0) y el centro en planta.

## Piezas de motor ya verificadas leyendo el código

- `cut/SplitOperation.ts`: `analyzeLoops` (embed → half-edges → zonas por componentes de caras sin
  cruzar lazos → grafo zonas-lazos → 2-coloreo bipartito), `chooseExtracted` (vota por lado con más
  área seleccionada, o el más chico), `splitByPerimeters` (una tapa por lazo, `depth` traslada la tapa
  y agrega pared lateral, `previousCapMask`, validación + volúmenes, `forceable` si solo hay cruces
  tapa-piel), `buildSeam` (centroide de área, círculo inscripto aproximado por muestreo de interiores,
  `inradius`, `incenter`, `planar` si desvío relativo ≤ 0.08) y mensajes de error/aviso en español.
- `cut/CurveEmbedder.ts`: identifica puntos de camino (vértice/arista/cara), subdivide cada triángulo
  afectado en su plano con `planarFaces` + `triangulatePolygon`, detecta cruces entre lazos, devuelve
  `{mesh, loop, loops, faceOrigin, newVertexStart, touchedFaces}`.
- `core/MeshContext.ts`: `faceAcross`/`mutualAcross` para aristas no-manifold, `surfacePt`, `baryOf`,
  `interpolatedNormal`, `makeVertexPoint/makeEdgePoint/makeFacePoint`, `toSurfacePt`, `commonFace`,
  `facesAround`, `segmentOnEdge`, `samePathPoint`, `pathPointKey` (claves estables para deduplicar puntos).
- `cut/CutSurfaceGenerator.ts`: `generateCap` (planar/curved, CDT, altura armónica, membrana mínima,
  `bulge`, `obstacle`, `forbidDiagonal`) y `fitLoopPlane`.
- `cut/domainTriangulation.ts`: red triangular interior + Delaunator + Constrainautor, clasificación
  topológica del exterior, verificación de aristas de borde.

## UI objetivo (6 pasos, español rioplatense)

1 Cargar modelo · 2 Seleccionar pieza (varita inteligente + pincel + sensibilidad) ·
3 Definir perímetro (sugerir, editar puntos, imán, suavizado, cierre plano/curvo) ·
4 Previsualizar corte (superficie, profundidad, vista explosionada) ·
5 Agregar encastre (tetón / membrana / sin encastre, perfiles de tolerancia) ·
6 Exportar (STL ASCII/bin, 3MF).

Reutilizar patrones del visor existente (`src/components/tools/cortador/cutter-viewer.tsx`) pero en
archivo nuevo; no importarlo desde el módulo viejo si eso obliga a modificarlo.
