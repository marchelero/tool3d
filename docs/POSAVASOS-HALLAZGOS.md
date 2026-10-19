# Posavasos: hallazgos de geometría (ronda sin commit, 2026-10-18)

Documento de traspaso para reiniciar el módulo **Posavasos** sin repetir los caminos muertos.
Todo lo que sigue está **medido** con un arnés Node sobre el SVG real del usuario y sobre casos
sintéticos; no son suposiciones.

---

## 0. Resumen ejecutivo

- El problema de fondo no era el SVG ni los colores: son **tres defectos concretos de JSCAD**
  (booleanos 2D, transformaciones perezosas y triangulación de tapas) más un defecto de **earcut**
  (filtrado de puntos colineales).
- Con geometría calculada a mano (sin booleanos 3D, sin booleanos 2D de JSCAD, sin `transforms.*`,
  sin `extrudeLinear` para contornos con huecos) se llegó a **0 aristas abiertas y 0 caras repetidas
  en los 3 modos** (Grabado, Relieve, Huecos) con el SVG real.
- Aun así el resultado no convence visualmente. Las hipótesis ordenadas están en la sección 6;
  la principal es que **las celdas de color de una misma capa se extruyen por separado al mismo Z**
  (caras coplanares que titilan) y que **las rutas de respaldo por bandas** reaparecen cuando el
  umbral de rasterizado no se cumple (holguras de 0,05 mm = los "cuadrados").
- Recomendación fuerte para el reinicio: **hacer TODA la geometría 2D con una librería de clipping
  robusta (Clipper / Vatti)** y extruir con three.js; validar siempre la malla antes de mostrar/exportar.

---

## 1. Estado del repo y qué tocar para volver atrás

HEAD actual: **`099c5f4`** ("feat: add coaster and mosaic 3D modeling tools with JSCAD integration").
Nada de esta ronda se ha commiteado.

Modificados por esta ronda (revertir con `git restore`):

- `src/lib/3d/coaster.ts`  (pipeline reescrito: zonas, `place` manual, `liftSolid`, raster, validación)
- `src/lib/3d/svg.ts`      (los huecos de un `path` se arman con `createRegion`, no con booleanos)

Nuevos, sin trackear (borrar si se vuelve a `099c5f4`):

- `src/lib/3d/region.ts`     (extrusor manual + raster-booleano + `meshQuality`)
- `src/lib/3d/geom2-ops.ts`  (helpers 2D: `areaOf`, `isSolid`, `asCCW`, `clipToConvex`, `outlinePoints`, `dedupe`)

Dependencias actuales: `coaster.ts → region.ts → geom2-ops.ts` y `svg.ts → region.ts`.
En `099c5f4` ninguno de esos dos archivos nuevos existe, así que se pueden borrar sin más.

Otros cambios sin trackear que **no** son de esta ronda (seguían ahí antes): `README.md`,
`docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/SESSION.md`, `docs/TROUBLESHOOTING.md`,
`docs/PROJECT.md` (modificado). Además `tmp-mosaic.mjs` aparece como borrado (era un fichero del
commit, resto de pruebas).

Comandos de rollback (los hace el usuario; yo no commiteo ni borro sin verbo explícito):

```powershell
git restore src/lib/3d/coaster.ts src/lib/3d/svg.ts tmp-mosaic.mjs
Remove-Item src/lib/3d/region.ts
Remove-Item src/lib/3d/geom2-ops.ts
npm run lint; npm run build
```

---

## 2. Los defectos de base (medidos)

### 2.1 Los booleanos 2D de JSCAD no sirven con SVGs vectorizados

`booleans.union` / `booleans.subtract` sobre contornos de imagetracer fallan de dos maneras:

- **Resultado sin cerrar**: `geom2.toOutlines()` lanza
  `Error: geometry is not closed at vertex -42.5698,38.86428` (el vértice está en la esquina
  redondeada de la base: distancia 13,9997 al centro del arco). El **área sí es correcta**
  (7927,80 → 4766,90), o sea que el fallo es topológico, no de medida.
- **Degradación silenciosa**: `booleans.union` de 5 anillos devolvió **área 0,00 y 0 anillos**.
  Con 35 anillos devolvió 448 lados y 0 anillos.

Variantes probadas que **todas** fallaron igual: base con 32 y 64 segmentos, orden ascendente/
descendente/de documento, anillo base deduplicado y reconstruido, forma variádica
(`subtract(base, ...cells)`) y forma array (`subtract(base, cells)`), y
`modifiers.generalize({ snap: true })` sobre el resultado. **No es cuestión de orden, de snap ni
de número de segmentos.**

### 2.2 `transforms.*` de JSCAD es perezoso (esto causó media sesión de confusión)

`transforms.scale/translate/rotateZ` **no escriben las coordenadas**: devuelven geometría perezosa
y `.sides` / `.polygons` siguen con los datos originales hasta que una medición los "cuece".
Evidencia literal:

```
cell.sides[0]          [[156.5,-3],[149,-12.5]]
scaled .sides[0] (a)   [[156.5,-3],[149,-12.5]]   <- sin medir: como si no se hubiera escalado
area(scaled) (a)       766.426                    <- measureArea SÍ aplica la escala
scaled .sides[0] (b)   [[78.25,-1.5],[74.5,-6.25]] <- tras medir: correcto
moved vertex  (a)      [156.5,-3,0]
moved vertex  (c)      [156.5,-3,5]               <- tras measureBoundingBox: correcto
```

Consecuencia: el recorte y la colocación se hicieron durante horas con **celdas sin escalar ni
centrar** (huecos fuera de la base, la mitad del dibujo basura, colores fundidos, piezas sin
desplazar en Z). **Arreglo**: mapear los vértices a mano (`place`) y desplazar Z a mano (`liftSolid`).

### 2.3 `extrusions.extrudeLinear` deja las tapas abiertas

Medido por conteo de aristas (open = usadas 1 vez):

| perfil 2D | open |
|---|---|
| sin huecos | 0 |
| 1, 2 y 3 huecos poligonales | 0 |
| 4 huecos rectangulares | 8 |
| 9 huecos rectangulares | 36 |
| 9 huecos **redondos** | 0 |
| 9 huecos que se **tocan** (unión = 1 hueco) | 0 |
| contorno en **L** + **1** hueco | 8 |
| contorno convexo + 3 huecos | 0 |

Es decir: falla con **contorno cóncavo** (aunque sea 1 hueco) y con **≥4 huecos rectangulares**.
`modifiers.generalize({ snap: true, triangulate: true })` lo arregló en el micro-test (296 → 332
polígonos, open 0) pero **no con los datos reales** (seguía open = 468). El bug está en el
`assignHoles`/earcut interno; no es parcheable desde fuera.

### 2.4 Earcut de three filtra los puntos colineales

`ShapeUtils.triangulateShape` (earcut de three) llama a `filterPoints`: **el borde real de la tapa
no coincide con los anillos de entrada**. Si las paredes se generan desde los anillos, quedan
**T-junctions** → aristas abiertas (esto mantuvo 128 piezas fantasma hasta que se midió).

**Regla de oro**: las paredes deben salir del **borde de las tapas trianguladas** (aristas que
aparecen una sola vez), nunca de los anillos de entrada.

### 2.5 Las celdas del vectorizador se solapan y comparten aristas

- Anillos top del SVG real: 35 (negro 2, blanco 20, rojo 13). No hay **anidamiento**, pero **8 pares
  se solapan** de verdad. Solapes medidos por muestreo de rejilla (0,08 mm):
  3,501 / 1,862 / 1,222 / 2,598 / 0,032 mm² (sobre anillos de 196,6 / 2396,4 / 215,8 / 27,0 /
  13,9 / 13,5 mm²).
- Muchas celdas **comparten aristas exactas** (teselado): al unirlas por emparejado de aristas de
  `geom2.create` se mezclan los anillos y sale geometría basura (área inflada, 9212,97 > 7927,80).
- **Encoger** los anillos (0,02 a 0,5 mm) **no elimina los solapes reales** (quedan 4-6) y solo
  cambia el número de piezas (794 → 558). Tampoco sirve el jitter (±0,0015 mm → área 32,48; ±0,004 →
  área -176,66) ni el snap a 0,001/0,01 mm.

---

## 3. Lo que sí funcionó (arquitectura que llegó a 0 aristas abiertas)

1. **Extrusión propia por anillos** (`region.ts`):
   - anillos con `ringsOf` (= `toOutlines` + dedupe + validación), clasificación por **anidamiento**
     (`nestingDepth`/`ringParents`), **nunca por el signo del área** (el winding de `toOutlines` no
     es fiable);
   - tapas con `ShapeUtils.triangulateShape` (earcut de three), con **comprobación de cobertura**
     (Σ triángulos ≈ |outer| − Σ|huecos|);
   - **paredes desde las aristas de borde de las tapas** (aristas usadas 1 vez) compartiendo
     exactamente los mismos vértices que la tapa → malla cerrada por construcción.
   - `snapRing` (rejilla 1e-3) + `simplifyRing` (colineales) antes de triangular.
2. **Booleano 2D propio por rasterizado** (`rasterDifference`, `rasterFill`): rejilla de 0,05 mm,
   relleno por scanline con regla **non-zero** (los solapes y anidamientos se resuelven solos),
   material = relleno(base) AND NOT relleno(corte), **trazado de contornos** por grietas dirigidas
   y **Douglas-Peucker** (0,08 mm) para simplificar. Resultado medido: área trazada 6430,85 vs
   6429,20 analítica, y **1 pieza watertight** donde el camino por anillos daba 128.
3. **Colocación manual**: `place` (scale + offset + rotación mapeando aristas) y `liftSolid`
   (desplaza los vértices en Z). Nada de `transforms.*`.
4. **Escalonado por capas**: cada capa del SVG sube 0,02 mm respecto a la anterior (el vectorizador
   apila capas que se solapan; a igual Z hay caras coplanares y titileo).
5. **Validación obligatoria**: `meshQuality(geom3) = { open, over }` contando aristas por clave de
   coordenadas redondeada a 1e-3; aceptar solo 0/0 y, si no, trocear o descartar.
6. **Exportación**: el parche de colores 3MF (`addTriangleColors` con fflate en `mesh.ts`) funciona
   (736/736 triángulos con `p1` y `displaycolor` correctos) y ya está en el commit.

### Verificación final de esta ronda (SVG real, defaults: base 90 mm radio 14, 12×0,2 mm, banda 4 capas)

```
through/top : 55 piezas, 0 problemas, capBase 4670.69   (7927.80 -> 4670.69 = 3257.11 mm2 calados)
engrave/top : 100 piezas, 0 problemas
   Base 0..1.60 (7927.80) | Color 1 (2) 1.40..2.36 | Color 2 (29) 1.40..2.38 | Color 3 (13) 1.40..2.40
   Base superior 1.60..2.40 (4670.69)
raise/top   : 45 piezas, 0 problemas (Base completa + colores en 2.20..3.16 / 3.18 / 3.20)
```

`npm run lint` limpio y `npm run build` OK (5 rutas estáticas).

---

## 4. Lo que NO funcionó: caminos muertos que no hay que repetir

- **Booleanos 2D de JSCAD** (`union`, `subtract`, variádicos y array) → sin cerrar o degradados a 0.
- **Normalizar con `asCCW` o reconstruir desde `toOutlines`**: pierde los huecos internos y luego
  JSCAD no puede extruir.
- **Emparejar aristas con `geom2.create` para simular unión/resta**: no resuelve intersecciones;
  produce regiones basura (área inflada) y troceos de cientos de piezas.
- **Encoger / jitter / snap** para arreglar aristas coincidentes o solapes: no elimina solapes
  reales y el jitter destruye las áreas (32,48 / -176,66 mm²).
- **`extrudeLinear`** para contornos cóncavos o con varios huecos, y confiar en que
  `modifiers.generalize` lo repare.
- **Trocear por cajas** (dividir el bbox) para separar huecos que se cruzan: es imposible separarlos
  por recorte; con `MAX_DEPTH = 12` acabó generando 128-3370 piezas del tamaño de una banda, con
  holgura de 0,05 mm entre tramos y huecos recortados al borde → **los "cuadrados"/rayado**.
- **Escribir tu propio ear-clipping con puenteo de huecos**: empeoró todo (1448 aristas abiertas,
  11,87 % de error de área).
- **Booleanos 3D** (lo que hace `099c5f4`): dejan T-junctions; el laminador ve aristas abiertas y
  regiones flotantes.
- **Leer `.sides`/`.polygons` después de `transforms.*` sin medir antes** (pereza): mediciones falsas.
- **Reescrituras masivas con `Get-Content`/`Set-Content`** en PowerShell: doble-codificó un fuente
  (BOM + mojibake). Usar siempre la herramienta de edición o `[IO.File]::ReadAllText` + `WriteAllBytes`.

---

## 5. Método de verificación (reproducible)

1. **Node 24 ejecuta `.ts` directamente** (type stripping). Para importar los fuentes en Node hay que
   reescribir en las copias:
   - `import { a, b } from "@jscad/modeling";` → `import jscadPkg from "@jscad/modeling"; const { a, b } = jscadPkg as any;`
     (`@jscad/modeling` es CJS sin detección de named exports);
   - `from "./x"` → `from "./x.ts"`.
2. Copiar `coaster.ts`, `geom2-ops.ts`, `region.ts` a `tmp-3d/` y añadir stubs de `svg.ts`
   (`svgToDesign`/`mergeBounds`), `patterns.ts`, `mosaic.ts` y `handoff.ts` real.
3. `parse-svg.ts`: parsea el SVG real por `fill="rgb(r,g,b)"` en orden de documento (M/L/Q/Z
   absolutos, Y invertida) y devuelve capas `{ color, svg }`.
4. `run.ts`: construye el modelo con `buildCoaster` en varios modos y reporta por pieza
   z-range, `open`, `over` y **área de tapa por shoelace** (ojo: `measurements.measureArea(poly3)`
   devolvía 0; usar shoelace sobre los vértices).
5. **Borrar `tmp-3d/` y los scripts `tmp-*.ps1` antes de `npm run build`** (Next los type-checkea y
   falla). `Remove-Item -Recurse` está bloqueado: borrar archivos uno a uno y luego la carpeta.

SVG de prueba: `C:/Users/Marcelo/Downloads/vivid-red-and-black-spider-on-stylized-web-icon-vector (4).svg`
(314×309, imagetracer 1.2.6; capas `rgb(8,5,5)`: 20 paths, `rgb(253,253,253)`: 20, `rgb(232,31,41)`: 13).

---

## 6. Por qué todavía no convence (hipótesis, en orden)

1. **Caras coplanares dentro de una misma capa de color** (la más probable). Las celdas de una capa
   se extruyen **por separado** y a menudo se solapan (sección 2.5): a igual Z hay caras superiores
   coplanares → z-fighting = **titileo/rayado**. El escalonado de 0,02 mm solo separa capas, no
   celdas de la misma capa. Se arregla **uniendo las celdas de cada capa en una sola región 2D**
   antes de extruir (necesita unión robusta: Clipper, no JSCAD).
2. **Rutas de respaldo activas**. El rasterizado se usa solo si `holes.length >= 4` (base) o
   `rings.length >= 5` (colores). Con diseños/patrones por debajo del umbral sigue activo el camino
   por anillos, que en cuanto se cruzan dos huecos **trocea por bandas** (holgura 0,05 mm) → los
   "cuadrados" que se ven en Grabado/Huecos/Patrones. Se arregla usando el raster (o Clipper)
   **siempre** que haya más de un hueco que se solape, no por umbral.
3. **Huecos fragmenta la base**. El calado de un patrón tipo telaraña parte la base en **islas**
   (55 piezas): cada una es watertight, pero el posavasos queda troceado y "raro". Conviene
   detectar desconexión y avisar (o limitar el calado a `margin`).
4. **Pérdida de detalle del raster** (0,05 mm) y de la simplificación (0,08 mm): escalones/"escalera"
   en curvas finas. Es aceptable al imprimir, pero se nota en el visor.
5. **Falta validación en runtime dentro de la app**: si una pieza sale con `open`/`over`, se muestra
   y se exporta igual. Añadir el chequeo y avisar/bloquear es barato y evita entregar basura.

---

## 7. Recomendación para el reinicio

### 7.1 Stack propuesto

- **Geometría 2D con Clipper** (`js-angusj-clipper` o `clipper-lib`, algoritmo de Vatti): unión de
  las celdas de cada color, diferencia con la base, recortes por zona y bandas. Es robusto con
  polígonos que se solapan, se anidan o comparten aristas, y trabaja en enteros (escalar ×1000).
  **Esto elimina de golpe los problemas 2.1, 2.5, 5.2 y la necesidad del raster propio.**
- **Extrusión con three.js** (`THREE.ExtrudeGeometry` con `Shape`/`Path`, ya está en el proyecto);
  si se quiere control fino, reutilizar el patrón validado de esta ronda:
  earcut + **paredes desde las aristas de borde de la tapa** (sección 2.4).
- Si se necesita CSG 3D de verdad (por ejemplo, restar un sólido a otro): **`manifold-3d`** (WASM),
  que garantiza malla manifold. Nunca los booleanos 3D de JSCAD.
- **Nunca**: booleanos 2D de JSCAD, `transforms.*` de JSCAD (pereza), `extrudeLinear` con contornos
  cóncavos o varios huecos, ear-clipping propio con puenteo.

### 7.2 Plan de trabajo sugerido (sobre `099c5f4`)

1. **Mantener** la UI, el visor, el registry, la exportación STL/3MF y el parche de colores (todo eso
   funciona y está commiteado).
2. **Pipeline 2D único** (sin booleanos 3D):
   `SVG → anillos (three SVGLoader o parser de d) → snap 1e-3 → unión por capa de color (Clipper) →
   diferencia con la base (Clipper) → región por tramo de Z (grabado/relieve/huecos)`.
3. **Extruir cada región** con three (o earcut+paredes) y **validar `open`/`over` por pieza**;
   descartar/avisar si falla.
4. **Apilar** tramos con un solape de una capa (0,2 mm) y **escalonar 0,02 mm por capa de color**
   (o, mejor, unir cada capa y no escalonar).
5. **Avisar** cuando el calado desconecte la base (islas) o cuando el diseño no quepa.
6. Exportar y **probar en el laminador** (los archivos anteriores siguen rotos, hay que re-exportar).

### 7.3 Reglas cortas para no volver a caer

- Un solo motor 2D, y que sea robusto (Clipper). Nada de JSCAD para booleans.
- Medir SIEMPRE antes de leer datos de una geometría transformada.
- Validar la malla (open/over) antes de mostrar o exportar.
- Si hay que trocear una región, es señal de que la entrada es inválida: arreglar la entrada
  (unión real), no trocear.
- Cualquier paso nuevo: probarlo antes en el arnés (`tmp-3d`) con el SVG real y con casos
  sintéticos (contorno en L + 1 hueco, 9 huecos rectangulares, anillos que se tocan y anillos que se
  solapan).

---

## 8. Anexo: números de referencia

| Dato | Valor |
|---|---|
| Base por defecto | cuadrado 90 mm, radio 14, `segments 32`, 36 puntos |
| Área de la base (JSCAD) | 7927,80 mm² |
| Área del SVG real en la base | 3257,11 mm² calados (resto 4670,69) |
| Capas por defecto | 12 × 0,2 mm = 2,40 mm; banda 4 capas = 0,80 mm; margen 6 mm; diseño 78 mm |
| Solapes de los 14 huecos | 8 pares; 0,032 a 3,501 mm² |
| `RASTER_MM` / `RASTER_SIMPLIFY_MM` / `RASTER_MAX_CELLS` | 0,05 mm / 0,08 mm / 16 M |
| `MAX_DEPTH` del troceo | 12 (2^7 = 128 piezas por tramo en el peor caso) |
| Área trazada por el raster | 6430,85 vs 6429,20 analítica |
| Escalonado por capa | 0,02 mm |

## 9. Anexo: piezas reutilizables de esta ronda

- `meshQuality(geom3)` → `{ open, over }` (conteo de aristas por clave redondeada a 1e-3) y el
  patrón «**paredes desde el borde de las tapas**» (imprimen malla cerrada con earcut).
- Clasificación de anillos por **anidamiento** (`ringParents`, `nestingDepth`) en vez de por winding.
- `snapRing` (rejilla de 1 µm) y `simplifyRing` (quitar colineales) antes de triangular/deduplicar.
- Colocación manual (`place`) y desplazamiento en Z manual (`liftSolid`) para esquivar la pereza.
- Raster-booleano (scanline non-zero + trazado de grietas + Douglas-Peucker) como **último recurso**
  si no se quiere añadir Clipper.
- Receta del arnés Node (sección 5) y los probes ya escritos como plantilla de test.

---

## 10. Anexo: complicaciones que **yo mismo** introduje (recomendé/decidí y me complicaron)

Esto es la autocrítica de la ronda: qué atajos elegí, cuánto costaron y qué regla saco de cada uno.
Es la parte más útil para un reinicio, porque son errores de **proceso**, no de JSCAD.

1. **Seguir con JSCAD en vez de cambiar de librería.** Encadené 3D → 2D → emparejado de aristas con
   `geom2.create` → booleano propio por raster, en vez de pasar a Clipper cuando el primer síntoma
   apareció (área correcta pero `toOutlines` lanza). Coste: prácticamente toda la sesión.
   *Regla:* si un booleano da área correcta pero no cierra, ese mismo turno se cambia de herramienta.
2. **Dar por buenas mediciones con geometría transformada sin verificar el instrumento.** Los
   `transforms.*` perezosos me hicieron sacar conclusiones imposibles (probes 12, 15, 16, 18, 19) y
   "arreglos" (snap/jitter/shrink) que atacaban el síntoma equivocado. Coste: media sesión.
   *Regla:* ante un resultado que contradice a otro probe, **verificar el instrumento antes de
   seguir**; medir SIEMPRE (`areaOf`/bbox) y releer `.sides` después de transformar.
3. **Mi propio medidor del arnés estaba mal.** Leía `polygon.vertices[0][2]` en vez de
   `measurements.measureBoundingBox`: concluí "las piezas quedan en z=0" y perseguí un fantasma
   durante varios probes. *Regla:* validar la herramienta de medición con un caso trivial
   (cuadrado 1×1 extruido y trasladado) antes de sacar conclusiones de ella.
4. **Recomendé `modifiers.generalize` (`sealMesh`) como "el fix"** y no lo era: con datos reales
   seguía dejando `open > 0`. Coste: una ronda completa + el lío del import profundo
   (`modifiers.generalize` está tipado como namespace no invocable). *Regla:* una cura probada solo
   con datos sintéticos no es una cura; probarla con el SVG real antes de aplicarla.
5. **Parchear la entrada (shrink / jitter / snap / `CELL_GAP_MM`) en vez de entender el defecto.**
   Cuatro intentos seguidos que no quitaron ningún solape real y que además dejaron líneas visibles
   de 0,02-0,2 mm entre celdas. *Regla:* no tocar la entrada hasta haber medido el defecto.
6. **Mantener el troceo por cajas (`solveRings`/`MAX_DEPTH`) como respaldo.** Yo mismo lo defendí y
   con eso dejé vivo el síntoma que ve el usuario: tramos de banda con 0,05 mm de holgura y huecos
   recortados al borde = **los cuadrados/rayado**. *Regla:* si hay que trocear, la entrada es
   inválida; el troceo puede existir en pruebas, nunca en el resultado que se muestra o exporta.
7. **Escribir mi propio ear-clipping con puenteo de huecos.** Empeoró todo (1448 aristas abiertas,
   11,87 % de error de área). *Regla:* no reimplementar triangulación; usar earcut y, si falla,
   arreglar la entrada.
8. **Umbrales mágicos** (`holes >= 4`, `rings >= 5`) para elegir raster vs analítico: dejaron el
   camino malo activo por defecto. *Regla:* decidir por validación medida (`meshQuality` + nº de
   piezas), no por umbrales fijos.
9. **Arnés obsoleto.** Corrí `probe34` con una copia vieja de `tmp-3d/region.ts` (tolerancia 0,015)
   y saqué la conclusión falsa "157 aristas abiertas". *Regla:* regenerar las copias **después** de
   cada edición en `src/`, y desconfiar del resultado que contradice al anterior.
10. **Tocar `src/` antes de validar la hipótesis.** Cambié `coaster.ts` (subtractCells, filledHoles,
    pushRingsPiece, tramos) y medí después. Coste: varios ciclos de editar-regenerar-reprobar.
    *Regla:* primero el probe en `tmp-3d`, después el cambio en `src/`.
11. **Reescritura masiva con `Get-Content`/`Set-Content`**: doble-codificó `coaster.ts` (BOM +
    mojibake) y costó una recuperación manual. *Regla:* usar la herramienta de edición o
    `[IO.File]::ReadAllText` + `WriteAllBytes` con `UTF8Encoding($false)`.
12. **Verificar lint/build tarde.** Los dejé para el final de cada bloque largo, así que algunos
    errores de tipos (imports sobrantes, `modifiers.generalize`) se arrastraron. *Regla:* lint al
    cerrar cada bloque de cambios; build antes de pedir una prueba al usuario.
13. **Comunicar sin que el usuario pueda medir.** Reporté "0 problemas" mientras seguía habiendo
    troceo visible: mi métrica (open/over) no era la que él ve. *Regla:* reportar con la métrica del
    usuario (¿se ve bien? ¿cuántas piezas? ¿sigue titilando?) y pedir la captura antes de dar por
    bueno un arreglo.

### 10.1 Tres reglas de parada (para el reinicio)
- **Parada por herramienta:** un booleano que da área correcta pero no cierra → cambiar de
  herramienta (Clipper) ese mismo turno.
- **Parada por contradicción:** dos mediciones que no pueden ser ciertas a la vez → verificar el
  instrumento antes de tocar la solución.
- **Parada por parche:** si para que salga bien hay que trocear, encoger, jitter o snap → la entrada
  está mal y se arregla en origen (unión real con Clipper).

