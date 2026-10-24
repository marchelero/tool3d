# LATEST — 2026-10-24

Handoff vigente: [2026-10-22-texturizador.md](./2026-10-22-texturizador.md).

- Branch `main`, HEAD `8fb03d8`, sin commit nuevo.
- Texturizador STL funcional en `/tools/texturizador`; dev en `http://localhost:3000`.
- Se corrigio el facetado/triangulos: `adaptive` y `creaseNormals` quedan apagados por defecto; la malla uniforme con normales suaves ya no muestra dientes de sierra.
- Defaults: amplitud `0.15 mm`, resolucion `0.25 mm`, `adaptive: false`, `creaseNormals: false`, `creaseAngleDeg: 60`, `texture: null`.
- Implementado: proyecciones cilindrica/esferica, vista HD por normal map (solo visual, apagada por defecto), mapas propios 1024, 8 presets de material, favoritos persistentes, undo/redo, atajos, comparador A/B, guardar/cargar ajustes y mascara pintada a mano.
- Validado: `npx tsc --noEmit`, `npm run lint`, `npm run build`; E2E cubo+Cuadricula 393.216 tri, ~2,2 s, malla cerrada y sin errores.
- Pendiente: confirmar visualmente con el STL real del usuario y no commitear sin permiso.
