# Report 009 — Mejoras de Cortador v2

## Resumen

Se alineó el layout de `/tools/cortador-v2` con Llavero y Posavasos (visor a la
izquierda y panel de controles a la derecha en escritorio; visor primero en
móvil). Se redujo trabajo de renderizado inactivo del visor Three.js y se corrigió
la detección de cambios de malla cuando los buffers nuevos conservan el mismo
número de triángulos. En el paso 2, el pincel ahora muestra sobre la superficie un
aro semitransparente del radio actual mientras se mueve el puntero, sin clic.

## Cambios

- `src/components/tools/cortador-v2/cortador-v2-tool.tsx`
  - Shell responsive en grid: visor primero y panel a la derecha en escritorio.
  - Stepper anunciado como navegación con `aria-current="step"`.
  - Botones deshacer/rehacer con etiquetas accesibles y progreso con roles
    `status`/`progressbar`.
- `src/components/tools/cortador-v2/viewer.tsx`
  - Renderizado bajo demanda; las interacciones/cambios de escena invalidan un
    frame, y se respeta el amortiguamiento de `OrbitControls`.
  - El buffer de color solo se marca para actualizar si cambió el color de alguna
    cara.
  - La geometría se reconstruye si cambia la referencia de posiciones/índices,
    aunque el conteo de caras no varíe.
  - El encuadre reutiliza geometrías ya preparadas para calcular bounds en vez de
    crear geometrías temporales.
  - Límite de pixel ratio a 1.5 para reducir carga de GPU en pantallas densas.
- `src/lib/cutter2/render-scheduler.ts` y su test: scheduler coalescente,
  cancelación al desmontar y límite de resolución.
- `src/lib/cutter2/brush-cursor.ts` y su test: cálculo de pose normalizada y
  separación visual del indicador respecto de la superficie.
- `docs/plans/009-cortador-v2-mejoras.md`: alcance y criterios de aceptación.

## Validación

- `npm test`: 72/72 tests aprobados (incluye cursor, scheduler y pipeline de
  cutter2).
- `npx tsc --noEmit`: aprobado.
- `npm run lint`: aprobado.
- `npm run build`: aprobado; `/tools/cortador-v2` se genera estática.
- Navegador: ruta carga sin errores de consola; layout revisado a 912 px de ancho,
  mostrando visor antes del panel y sin desbordamiento horizontal. Con `nariz.stl`
  cargado, el paso 2 mostró el aro del pincel al mover el puntero sobre la pieza
  sin clic; el aro desapareció al salir del canvas y al cambiar a Varita. No hubo
  errores de consola.
- Lighthouse sobre el estado inicial sin modelo: Accesibilidad 100, Best Practices
  100, SEO 80. El único hallazgo fue `robots.txt` inválido, fuera del alcance de
  este cambio.

## Límites de la verificación

No se hizo una medición cuantitativa de FPS/CPU ni un recorrido completo de
corte/exportación en el navegador. La comprobación visual del pincel usó
`nariz.stl`, pero el resto del flujo de procesamiento se apoya en la prueba
existente del pipeline y no reemplaza ese E2E. La disposición de escritorio se
comprobó en las reglas responsive del layout; la captura del navegador disponible
fue de 912 px.
