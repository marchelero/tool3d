# Handoff — Texturizador STL (2026-10-22, actualizado 2026-10-24)

## Estado
- Branch: `main`; HEAD `8fb03d8`; sin commit nuevo.
- Dev activo en `http://localhost:3000`.
- El Texturizador STL esta implementado en `/tools/texturizador`.
- Modelos de prueba de 30 mm: cubo (12 tri), esfera (3.968 tri) y piramide (6 tri); los tres cerrados.
- Se corrigio el facetado que mostraba triangulos en las lineas: `adaptive` y `creaseNormals` quedan apagados por defecto.
- `npx tsc --noEmit`, `npm run lint` y `npm run build` pasan; build con 8 rutas estaticas.

## Defaults actuales
- `texture: null`, `amplitude: 0.15`, `symmetric: true`, `resolutionMm: 0.25`.
- `adaptive: false`, `creaseNormals: false`, `creaseAngleDeg: 60`.
- `repairMesh: true`, `smoothing: 0`, `surfaceSmoothing: 0`.
- `mask.enabled: false`, `mask.feather: 1`, `mask.strokes: []`.
- Preview: `650.000` triangulos; export: `1.500.000`.
- `TILE_SIZE = 512` para texturas procedurales; mapas propios a `1024`.
- Presets de resolucion: Rapida `0.7`, Media `0.4`, Fina `0.25`, Ultra `0.15`.

## Implementado
- Importacion STL binario/ASCII en cliente, preview Three.js y export STL binario.
- Worker con cancelacion y presupuesto de triangulos.
- 24 texturas procedurales, galeria con favoritos persistentes y textura personalizada 1024.
- Proyeccion triplanar, planos XY/XZ/YZ, cilindrica y esferica.
- Escala, offset, rotacion, amplitud en mm/% y simetria.
- Subdivision uniforme y adaptativa (opcional); suavizado Taubin; reparacion de malla.
- Normales con aristas duras (opcional) y vista HD por normal map triplanar/planar/cilindrico/esferico (solo visual), **apagada por defecto** para no duplicar el relieve sobre la geometria.
- Mascara por angulo/base, `feather` y pincel para proteger/texturizar zonas sobre el modelo.
- 8 presets de material: Goma/Panal, Cuero/Voronoi, Madera, Metal, Piedra, Tela, Agarre y Cristal.
- Undo/redo, atajos `Ctrl+Z`, `Ctrl+Shift+Z`, `O` (original) y `E` (exportar).
- Comparador A/B manteniendo presionado el boton; guardar/cargar ajustes en JSON.
- "Sin textura" (default) para cargar el STL sin procesar.
- Seccion **Modelo**: botones Cubo / Esfera / Piramide para probar sin cargar archivo.
- `gridPattern`: celdas altas y lisas, lineas como surcos bajos.

## Archivos principales
- `src/components/tools/texturizador/texturizer-tool.tsx`
- `src/components/tools/texturizador/texturizer-viewer.tsx`
- `src/components/tools/texturizador/texture-gallery.tsx`
- `src/lib/texturizer/{types,textures,subdivide,displace,load-stl,export-stl,worker,worker-client,primitives}.ts`
- `src/app/tools/texturizador/page.tsx`
- `src/lib/tools/registry.ts`
- `tsconfig.json` (`exclude: ["node_modules", "out"]`)
- `docs/PROJECT.md`
- `docs/prd/003-texturizador-stl.md`

## Validacion
```bash
npx tsc --noEmit
npm run lint
npm run build
```

Resultado: todos pasan. E2E con Chrome headless/SwiftShader:
- Cubo + Cuadricula, defaults con HD apagada: 393.216 tri, `Proceso: 2228 ms`, malla cerrada, sin errores; sin triangulos en las lineas.
- Esfera + Cilindrica: 294.656 tri, `Proceso: 4483 ms`, malla cerrada.
- Solo adaptativa: 342.222 tri, `Proceso: 5361 ms`.
- Adaptativa + aristas duras: 342.222 tri, `Proceso: 17482 ms`.
- Aristas duras con malla uniforme: 393.216 tri, `Proceso: 7435 ms`; sin triangulos, celdas aun algo redondeadas.
- Mascara pintada: 17 trazos, 15.345 caras enmascaradas, `Proceso: 2657 ms`.
- Capturas en `C:\Users\Marcelo\AppData\Local\Temp\texttest-06c5cdde32354556a9dfc7879bce5565\`: `final-default-hd-off.png`, `final-default-015.png`, `final-hd-035.png`, `final-hd-off-035.png`, `crease-uniform-hd-off.png`, `paint-01.png`, `ab-hold.png`, `sphere-cylindrical.png`, `saved-settings.json`.

## Pendiente / notas
1. Revisar el default con el STL real del usuario y confirmar visualmente que ya no quedan triangulos.
2. La celda de Cuadricula aun se ve algo redondeada: la transicion del patron es ancha respecto a 0.25 mm; subir escala o bajar amplitud. La vista HD es solo visual y no cambia el STL.
3. La proyeccion triplanar deforma la cuadricula en esferas y caras inclinadas; para organicas usar cilindrica/esferica o un plano.
4. `adaptive` y `creaseNormals` son opcionales y lentos; `creaseNormals` puede facetar paredes si el angulo es bajo.
5. El pincel usa la malla procesada para el raycast, pero la mascara se calcula sobre vertices sin desplazar (desfase ~amplitud).
6. Guardar/cargar ajustes no incluye el STL ni el mapa personalizado.
7. No commitear sin autorizacion explicita.

## Notas
- `docs/SESSION.md` contiene bitacora antigua y puede estar desactualizado; este archivo es el handoff vigente.
