# Report 008 — Ingeniería inversa de corto.com.ar «STL Color Splitter 2.0»

## Objetivo

Documentar el comportamiento y los algoritmos de la app https://corto.com.ar/app/
para reimplementar su cortador de STL/3MF como módulo nuevo de Tool3D
(`cortador-v2`), sin tocar el módulo `cortador` existente.

## Método

- Chrome headless con CDP en `127.0.0.1:9222`, perfil temporal, `--enable-unsafe-swiftshader`.
- Bundle `/app/assets/index-BrQJKbJf.js` + worker `/app/assets/engine.worker-DRU9dN3p.js`.
- Ambos publican **source maps con `sourcesContent` completo**: se recuperó el código
  original del hilo principal (21 archivos `src/app`, `src/viewer`, `src/worker`) y del
  motor (31 archivos `src/engine`). Copias de trabajo en
  `%TEMP%\opencode\corto\recovered` y `...\recovered2`.
- UI relevada por `Runtime.evaluate` (`document.body.innerText`) navegando el asistente
  con el modelo de ejemplo «Papá Noel».
- Stack del sitio: React 19, three.js r186, three-mesh-bvh 0.9.x, manifold-3d,
  fflate, Vite. Idéntico al stack de Tool3D.

## Flujo de UI (asistente de 6 pasos)

1. **Cargar modelo** — STL binario/ASCII y 3MF (incluye Bambu Studio). Botones de
   ejemplo: Papá Noel nariz fusionada / independiente / 3MF. Panel de propiedades:
   archivo, formato, dimensiones, triángulos, volumen, componentes, «Estado de la malla»
   y diagnóstico técnico.
2. **Seleccionar pieza** — «Varita inteligente»: detecta la región bajo el cursor
   siguiendo límites naturales. Modos pincel agregar/quitar, sensibilidad
   (fina↔amplia), botones Ajustar / Expandir / Contraer / Invertir / Limpiar /
   Deshacer / Rehacer. Atajos: clic elige región, `Ctrl+clic` suma otra parte al mismo
   corte, `Alt+clic` quita región. El paso 1 incluye orientación: anillos X/Y/Z
   (rojo/verde/azul) de a 5° (Shift 15°), «Apoyar una cara sobre la cama»,
   restablecer, aplicar orientación.
3. **Definir perímetro** — a partir de la selección, «Sugerir borde». El editor
   muestra puntos de control arrastrables; doble clic sobre la curva agrega punto;
   «Imán a bordes naturales» (0..1) y «Suavizado de curva» (0..1); «Descartá tus
   ajustes y volvé al borde sugerido». Métodos de cierre conmutables: **Cierre plano**
   (reemplaza el perímetro por la sección plana más cercana e informa cuánto se
   desplaza, `${o} perímetros ajustados al plano: se desplazaron como máximo ${s} mm`)
   y **Cierre curvo** (membrana de área mínima que sigue el contorno). Diagnóstico de
   perímetro: cruces/autointersección (`${n} triángulos (marcas rojas)`), borde
   abierto, componente distinto, «el perímetro está cerrado y separa la pieza en dos».
4. **Previsualizar corte** — «Superficie de corte»: cara posterior plana (se imprime
   apoyada) o curvada hacia una de las piezas; «Profundidad del corte» (handle en el
   centro del corte, arrastrable); «Vista explosionada»; validación de piezas
   (cerradas, manifold, sin autointersecciones); «Deshacer corte o encastre».
5. **Agregar encastre** — «Sin encastre», tetón circular (diámetro, profundidad,
   holgura radial, holgura de fondo), cola de milano, membrana mínima para uniones
   orgánicas, «deslizante solo si el corte atraviesa toda la pieza», «arista media».
   Perfiles de tolerancia guardables en el navegador. «Generando el encastre con
   booleanas». Validación: «El encastre es válido: no hay interferencias y la pieza
   entra en línea recta»; si no cabe, «No hay lugar para un encastre» + motivo.
   Flujo por partes cuando hay varias: «Estás en la parte N/M; al aplicar el encastre
   o seguir sin él, pasás a la siguiente».
6. **Exportar** — STL ASCII o binario y 3MF; «Piezas a exportar»; se informa
   `${files} archivo(s) exportados, ${skipped} pieza(s) fuera por no ser válidas`;
   los cortes inválidos no se exportan.

## Arquitectura del motor (worker separado, misma interfaz que Tool3D)

`EngineClient` (main) ↔ `engine.worker.ts` ↔ `EngineService` (45 KB, API tipada con
progreso/cancelación). Módulos:

| Módulo | Rol |
| --- | --- |
| `core/MeshContext` | topología, normales, BVH, cachés de análisis; `faceAcross`/`mutualAcross` para aristas no-manifold |
| `core/MeshTopology` | half-edges, twin (-1 borde, -2 no-manifold), edgeValence/edgeFlipped, componentes |
| `core/TriangleBVH` | raycast/aceleración |
| `core/geometry` | bbox, normales/áreas, longitud media de arista, cruces 2D |
| `core/heap` | MinHeap con `lastKey` |
| `import/stl`+`threemf`+`weld`+`xml` | lectura STL bin/ASCII, 3MF (colores incluidos), soldado |
| `analysis/curvature` | tensor de curvatura de Taubin por vértice, kmin/H, campo `valley` 0..1 |
| `analysis/MeshAnalyzer` | diagnóstico de malla (bordes, no-manifold, normales, degeneradas, componentes, autointersecciones BVH) |
| `selection/SmartSelection` | watershed jerárquico por concavidad + fusión por saliencia |
| `perimeter/BoundarySuggestionEngine` | sugerencias de perímetro por corte mínimo en el grafo dual (max-flow) |
| `perimeter/maxflow` | Dinic con capacidades reales |
| `perimeter/SurfaceSplineEngine` | spline Catmull-Rom centrípeta proyectada + imán + suavizado + validación |
| `perimeter/SurfaceWalker` | caminos exactos sobre caras (cruce de aristas) |
| `perimeter/GeometrySnapping` | ajuste a vértices/aristas, magnetPath, cleanupPath, straightenPath |
| `perimeter/PlaneSection` | intersección exacta malla-plano con perturbación simbólica |
| `cut/CurveEmbedder` | incrusta el perímetro en la malla (split de triángulos) |
| `cut/CutSurfaceGenerator` | tapa plana (Newell + CDT + altura armónica) o curvada (membrana mínima Pinkall–Polthier) |
| `cut/SplitOperation` | ensambla A/B, tapa, validación y volúmenes |
| `cut/CapClearance` | recorte de tapa contra la malla (obstáculo) |
| `cut/domainTriangulation` / `polygon2d` / `laplace` | CDT + simple-polygon + Laplace cotangente |
| `joints/JointGenerator` | tetón, cola de milano, membrana |
| `boolean/BooleanGeometryEngine` | booleanas manifold-3d |
| `validation/MeshValidator` | watertight/manifold/volumen |
| `export/ExportManager` | STL ASCII/bin y 3MF |

## Algoritmos clave (para reimplementar)

### Curvatura (`computeCurvature(ctx, scaleRel = 0.012)`)
Tensor por vértice M = Σ w·κ·T·Tᵀ con κ = ((n_b−n_a)·(p_b−p_a))/|p_b−p_a|², w = |e|.
Eigenvalores (e1≥e2) sobre base tangente → Taubin κmin = 3e2 − e1.
Suavizado laplaciano `iters = clamp(round((scale/avgEdge)²), 1, 150)` con
`next = 0.5·cur + 0.5·vecinosPromedio`. `reference = 0.25/scale`,
`valley = 1 − exp(−1.5·max(0, −kmin/reference))`; por cara promedio de sus vértices.

### Varita inteligente (`segmentMesh`)
1. Altitud por cara = max(valley promedio, pliegue cóncavo): para cada vecina con
   dot < 0.985 (~10°), si su baricentro está del lado positivo de la normal,
   `crease = min(1, (1−dot)·3)`.
2. Marcadores: componentes de caras con altitud < threshold (0.06 → 0.12 → 0.2, primer
   nivel que dé regiones), descartando < 0.04 % del área total.
3. Watershed: MinHeap por altitud, propaga etiquetas; costo de avance
   `max(alt[g], 0.999·alt[f])`.
4. Fusión jerárquica por saliencia de frontera: costo = Σ(l·max(alt)) / Σl; las
   regiones < 0.2 % del área se absorben primero (costo negativo). Se guardan las
   fusiones ordenadas → el nivel de sensibilidad solo recorre `merges` con union-find
   (`regionsAtLevel`), sin recalcular geometría.

### Sugerencia de perímetro (`suggestPerimeters`)
- Partes seleccionadas (componentes por aristas), se descartan < 1 % de la mayor,
  máximo `MAX_REGIONS = 16`; se rellenan agujeros pequeños (< 25 % del área
  seleccionada) si están rodeados por aristas normales; si la selección cubre el
  99.9 % de una pieza → mensaje «extraela sin cortar».
- Si el borde de la selección ya sigue un valle (valle medio > 0.5) la banda se
  angosta: `tight = clamp((prior−0.5)/0.3)`, `fIn = 0.6−0.45·tight`,
  `fOut = 0.85−0.6·tight`, `Wb = max(4·avgEdge, fIn·rR)`, `Wout = max(5·avgEdge, fOut·rR)`
  con `rR = sqrt(área/π)`.
- Distancia geodésica con signo al borde (Dijkstra desde vértices mixtos in/out),
  limitada por zona.
- Roles por cara: fuente (núcleo, `mx < −Wb`), sumidero (exterior, `mn > Wout`),
  banda (resto); garantiza al menos una fuente por parte y un sumidero por componente
  exterior.
- Corte mínimo (Dinic) en el grafo dual de la banda con costos por arista
  `len · (eps + (1−valleyEdge)²)`, `eps = 0.04`, aristas fuente/sumidero con `BIG = 1e18`.
- Lazos: frontera de cadena de las caras del lado fuente (`extractLoops`), con
  corrección de pellizcos (hasta 30 rondas sumando las caras alrededor del vértice) y
  suma neta en aristas no-manifold.
- Confiabilidad: `meanValley ≥ 0.12`; `confidence = clamp((meanValley−0.08)/0.4)`.
- Alternativas: corte «ajustado» (banda interna, costo `0.3 + |kmin|/ref + 0.3·valley`)
  y «amplio» (banda externa); se aceptan si `0.45 < largo/main < 1.7` y la distancia
  media entre lazos `< 0.75·rR` y `> max(2.5·avgEdge, 0.06·rRef)`.
- Sugerencia `seleccion` = borde exacto de la selección (fallback explícito).
- Puntos de control: `K = clamp(round(L/(4·avgEdge)), 6, 12)` equiespaciados por
  longitud; el camino entre controles queda fijo (`locked`).

### Editor de perímetro (`SurfaceSplineEngine.compute`)
Anchors = triángulo + baricéntricas. Por tramo: Catmull-Rom centrípeta
(Barry–Goldman, extremos reflejados) muestreada a ~1.2·avgEdge, proyectada localmente
(`projectLocal` con radio 2 y 10 pasos) y recorrida sobre la malla (`walkSurface`
radio 6; fallback `shortestPathFallback`). Si el proyectado se aleja
`> max(0.35·cuerda, 3·avgEdge)` se usa cuerda directa. Con imán > 0 se llama
`magnetPath` con guía spline y campo `valley`. Suavizado laplaciano con pasos fijos
(`iters = round(2 + 38·amount²)`, α = 0.5) reproyectado a la superficie, evitando
saltos a caras con normal opuesta (dot < −0.2). Luego `snapPath` → `straightenPath` →
`cleanupPath` → renumber. Validación: componente única, tramos, mínimos, repetición de
puntos, cruces por triángulo en coordenadas baricéntricas, tamaño mínimo y cruce de
aristas abiertas/no-manifold.

### Cierre plano vs curvo (`generateCap`)
- Centroide ponderado por longitud y normal de Newell; proyección (u,v) ortonormal.
- Si el contorno se pliega visto desde la normal media, se busca la dirección simple
  más cercana: inclinaciones 4°…45° × 24 azimuts, prefiriendo la de mayor margen de
  vecinos simples; se informa `tiltDeg`.
- Planaridad: desviación máx/RMS y `relative = maxDev/radioEquivalente`.
- Dominio 2D: proyección si es simple, si no disco parametrizado por longitud de arco.
- `triangulateDomain` (CDT con espaciado = mediana de tramos, máx 60 000 y puntos
  Steiner `extraPoints`); si hay diagonales prohibidas (aristas ya existentes en la
  malla) se agregan puntos medios y se reintenta hasta 12 veces.
- Plano: altura armónica (cotangente) desde la desviación del borde; si el borde es
  plano queda exactamente plano.
- Curvo: iterar 8 veces pesos cotangentes + Laplace 3D (membrana mínima) o solo altura
  si el dominio es el proyectado; `bulge` opcional vía Poisson normalizado a 1.
- Obstáculo (`opts.obstacle`): solo si la huella proyectada es válida; mueve vértices
  interiores a lo largo de la normal dentro del intervalo [lo,hi] con corrección
  armónica, hasta 12 rondas, `maxShift = 0.35·rEq + 0.25`.

## Observaciones para la reimplementación

- No copiar archivos del sitio: reimplementar los algoritmos con la estructura y
  convenciones de Tool3D, usando `manifold-3d`, `three`, `three-mesh-bvh` (ya
  presentes) y WebWorker.
- El motor debe ser independiente del visor y testeable en Node (funciones puras sobre
  arrays tipados).
- El módulo nuevo (`cortador-v2`) debe convivir con `cortador` sin modificarlo.
