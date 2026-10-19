# Decisiones técnicas — Tool3D

Registro de decisiones de arquitectura y tecnología (formato ADR-lite). Cada
entrada explica **contexto**, **decisión**, **alternativas** y **consecuencias**.
El objetivo es que una sesión futura entienda *por qué* el código es como es y
no deshaga decisiones por accidente.

---

## ADR-001 — Next.js App Router como framework

**Contexto**: se necesita un sitio con varias rutas/herramientas, deploy simple
y posibilidad de agregar API routes en el futuro.

**Decisión**: Next.js 16 con App Router y TypeScript estricto.

**Alternativas**: Vite + React Router (más liviano, sin SSR), Astro (excelente
para estático, pero menos natural para apps interactivas).

**Consecuencias**:
- Rutas por carpeta (`src/app/tools/<slug>/page.tsx`), metadata por página y
  layout global.
- Build estático de todas las rutas actuales.
- `next/font/google` (Geist) y Turbopack.
- El proyecto empezó con Next 15; se actualizó a 16. `docs/PROJECT.md` puede
  quedar desfasado si no se actualiza.

---

## ADR-002 — Procesamiento 100 % client-side

**Contexto**: se procesan imágenes personales y se generan modelos 3D. Un backend
implicaría costos, latencia, privacidad y almacenamiento.

**Decisión**: todo corre en el navegador (Canvas, WASM/JS, WebGL). Sin API, sin
base de datos, sin autenticación.

**Alternativas**: backend con Python/OpenCV/trimesh; serverless con límites de
tamaño; servicio externo de remoción de fondo.

**Consecuencias**:
- Privacidad total y costo de servidor cero.
- El rendimiento depende del dispositivo del usuario.
- Hay que cuidar el tamaño del bundle (de ahí los dynamic imports).
- No hay persistencia ni colaboración.
- La calidad de la IA de fondo está acotada por el modelo que corre local.

---

## ADR-003 — Tailwind CSS 4 + shadcn/ui (radix-nova)

**Contexto**: se necesita una UI consistente, accesible y rápida de iterar, con
tema claro/oscuro.

**Decisión**: Tailwind 4 con tokens CSS (`globals.css`) y componentes shadcn/ui
copiados a `src/components/ui/`. Iconos lucide. Tema con `next-themes`.

**Alternativas**: MUI, Chakra, CSS Modules, styled-components.

**Consecuencias**:
- Componentes locales editables (no dependencia de versión de librería).
- Tokens en `oklch`, variante `dark` por clase.
- `components.json` fija estilo `radix-nova` y base neutral.
- Se deben seguir las convenciones de shadcn al agregar componentes.

---

## ADR-004 — Registro central de herramientas

**Contexto**: la home debe listar herramientas y el proyecto debe crecer sin
tocar el núcleo.

**Decisión**: `src/lib/tools/registry.ts` contiene `TOOLS` y helpers. Agregar una
tool = agregar una entrada + ruta + componente.

**Alternativas**: descubrimiento por filesystem, MDX, CMS.

**Consecuencias**:
- Tipado fuerte del catálogo (`ToolDefinition`).
- La home se genera sola.
- El header **no** usa el registry (navegación hardcodeada); si se quiere
  navegación dinámica, hay que conectarlo.
- Riesgo de inconsistencia entre `status` y la ruta real (ver `llavero`).

---

## ADR-005 — `imagetracerjs` para vectorizar

**Contexto**: convertir imágenes raster a SVG sin backend, con control de
calidad y color.

**Decisión**: `imagetracerjs`, con paleta construida a mano y
`colorsampling: 0` (paleta fija).

**Alternativas**: potrace (monocromo, excelente para siluetas), VTracer (WASM,
muy bueno pero más pesado), contornos propios.

**Consecuencias**:
- Control total de la paleta y del fondo.
- Modos mono/color/negativo/gris implementados por preprocesado.
- Se necesita un `.d.ts` propio (`src/types/imagetracerjs.d.ts`).
- El trazado puede ser ruidoso: se mitiga con presets, `pathomit`, `fidelity`,
  blur y limpieza de paths.

---

## ADR-006 — `@imgly/background-removal` para quitar fondo

**Contexto**: remover fondo con IA sin backend.

**Decisión**: `@imgly/background-removal` con modelo `isnet_fp16`, cargado por
dynamic import, con callback de progreso.

**Alternativas**: modelos propios en ONNX Runtime Web, U2Net, servicios externos.

**Consecuencias**:
- Funciona offline una vez descargado el modelo.
- El modelo pesa varios MB: se muestra progreso y se carga solo al usarlo.
- Calidad variable; por eso existe el pincel de retoque y la varita.

---

## ADR-007 — JSCAD para geometría paramétrica

**Contexto**: generar modelos 3D paramétricos (posavasos) y exportar STL/3MF.

**Decisión**: `@jscad/modeling` para geometría 2D/3D, con serializers oficiales de
STL y 3MF.

**Alternativas**: three.js CSG (menos robusto), OpenCascade WASM (potente pero
pesado), generar mallas a mano.

**Consecuencias**:
- API declarativa y paramétrica.
- Los booleanos tienen problemas de robustez (ver ADR-009).
- Se necesitan tipos propios para los serializers.

---

## ADR-008 — Three.js para el visor 3D

**Contexto**: previsualizar el modelo antes de exportar.

**Decisión**: `three` + `OrbitControls`, convirtiendo `Geom3` de JSCAD a
`BufferGeometry`.

**Alternativas**: Babylon.js, `<model-viewer>`, canvas 2D.

**Consecuencias**:
- Control total de cámara, luces y grid.
- Conversión manual de polígonos a triángulos (abanico).
- Hay que liberar geometrías/materiales al desmontar.
- Fallback textual si WebGL no está disponible.

---

## ADR-009 — Booleanos 2D en vez de booleanos 3D

**Contexto**: los booleanos 3D de JSCAD generaban mallas no estancas
(T-junctions). Los slicers veían regiones flotantes, ignoraban colores del 3MF y
producían capas vacías.

**Decisión**: construir el posavasos con **operaciones 2D + `extrudeLinear`
puro**, solapando piezas una capa. Los booleanos 2D se validan siempre.

**Estado**: **decisión tomada pero NO aplicada al cierre de esta documentación**.
`src/lib/3d/geom2-ops.ts` existe (sin integrar) y `coaster.ts` en HEAD todavía usa
`mergeSolids` (booleanos 3D). El working tree perdió la reescritura durante la
sesión; ver `docs/SESSION.md` §2.

**Alternativas**: reparar mallas 3D, usar otro kernel CSG, aceptar el problema.

**Consecuencias**:
- Mallas estancas y predecibles.
- Más piezas, pero cada una es una extrusión simple.
- La lógica de grabado/relieve/huecos se implementa en 2D (recortes) y luego se
  extruye.
- Quedó `geom2-ops.ts` como capa de validación, **aún sin integrar**.

---

## ADR-010 — `sessionStorage` para el handoff imagen → posavasos

**Contexto**: pasar capas vectorizadas de una ruta a otra sin backend.

**Decisión**: serializar `{ name, width, height, layers, savedAt }` en
`sessionStorage` bajo `tool3d:handoff:posavasos`.

**Alternativas**: query params (límite de tamaño), IndexedDB (más complejo),
estado global en memoria (se pierde al navegar), descargar y volver a subir.

**Consecuencias**:
- Simple y sin dependencias.
- Límite de tamaño de `sessionStorage` (~5 MB): SVGs grandes pueden fallar; la
  escritura devuelve `false` y se muestra un toast.
- Se pierde al cerrar la pestaña.
- No hay versión ni migración del formato.

---

## ADR-011 — Dynamic imports para dependencias pesadas

**Contexto**: `@imgly/background-removal`, `jszip`, serializers y `fflate` no
deben entrar en el bundle inicial.

**Decisión**: `await import(...)` dentro de la función que los usa.

**Alternativas**: code splitting por ruta, precarga manual.

**Consecuencias**:
- Bundle inicial liviano y SSR seguro.
- Pequeña latencia en el primer uso de cada función.
- Los tipos se declaran en `src/types/*`.

---

## ADR-012 — Parcheo manual del 3MF para conservar colores

**Contexto**: el serializer 3MF de JSCAD no asigna color por triángulo como
esperan los slicers y `colors.rgbToHex` no redondea, generando hex corruptos.

**Decisión**: descomprimir el 3MF con `fflate`, reescribir `displaycolor` de los
`<base>`, inyectar `pid`/`p1` en cada `<triangle>` y volver a comprimir.

**Alternativas**: no exportar 3MF, exportar varios STL, usar otro serializer.

**Consecuencias**:
- Colores por pieza conservados en el slicer.
- Código acoplado al formato interno del serializer.
- Hay que validar el 3MF en el slicer tras cambios.

---

## ADR-013 — Downscale a 2048 px al cargar imágenes

**Contexto**: imágenes de móvil/cámara son enormes; el trazado y el flood fill
se vuelven lentos y pueden congelar la UI.

**Decisión**: reducir el lado mayor a 2048 px al cargar, guardando el original
para poder usar resolución completa a pedido.

**Alternativas**: procesar siempre a resolución completa, usar Web Workers.

**Consecuencias**:
- UI fluida en la mayoría de los casos.
- Pérdida de detalle por defecto.
- El usuario puede activar la resolución completa (con costo de rendimiento).
- Un futuro paso natural es mover el trazado a un Web Worker.

---

## ADR-014 — Sin tests por ahora

**Contexto**: prioridad en entregar funcionalidad end-to-end rápido.

**Decisión**: no se configuró framework de tests. La verificación es
`npm run lint` + `npm run build` + prueba manual.

**Alternativas**: Vitest + Testing Library para `lib/`, Playwright para E2E.

**Consecuencias**:
- Deuda técnica explícita.
- Las funciones de `src/lib/*` son puras y fáciles de testear cuando se decida.
- Mayor riesgo de regresiones en geometría y trazado.
