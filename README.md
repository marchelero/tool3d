# Tool3D

Toolkit web modular de utilidades para **impresión 3D**. Todo el procesamiento
(imagen, vectorización, geometría 3D) corre **en el navegador**: no hay backend,
no hay cuentas y no hay secretos.

- Repositorio: <https://github.com/marchelero/tool3d>
- Idioma de la UI: español
- Estado: **funcional y en desarrollo activo** (fases 1 y parte de 2/3 completas)

---

## 1. Qué hace hoy

| Ruta | Herramienta | Estado |
|------|-------------|--------|
| `/` | Catálogo de herramientas (home) | ✅ |
| `/tools/image` | Editar imagen, quitar fondo, vectorizar a SVG, separar por color | ✅ |
| `/tools/posavasos` | Posavasos paramétrico 3D con relieve/grabado/huecos + export STL/3MF | ✅ |
| `/tools/llavero` | Llavero con imagen | ⚠️ Placeholder (el registro lo marca "available") |

Herramientas registradas como "próximamente": llaveros con nombres (`keychain`),
generar 3D (`generate-3d`), calibración (`calibration`), cajas (`boxes`).

### Flujo estrella

```
Imagen  →  quitar fondo / retocar  →  vectorizar  →  separar por colores
                                                          │
                                                          ▼ (sessionStorage)
                                                  Posavasos 3D  →  STL / 3MF
```

La herramienta de imagen puede enviar las capas vectorizadas directamente a la
de posavasos mediante un *handoff* en `sessionStorage` (clave
`tool3d:handoff:posavasos`), sin backend ni archivos intermedios.

---

## 2. Stack

| Capa | Tecnología | Versión |
|------|------------|---------|
| Framework | Next.js (App Router, Turbopack) | 16.4.2 |
| UI | React | 19.3.0 |
| Lenguaje | TypeScript (strict) | 5 |
| Estilos | Tailwind CSS | 4 |
| Componentes | shadcn/ui (`radix-nova`) + Radix UI | radix-ui 1.8 |
| Iconos | lucide-react | 1.59 |
| Tema | next-themes | 0.4 |
| Notificaciones | sonner | 2.0 |
| Stepper | @stepperize/react | 8.0 |
| Quitar fondo | @imgly/background-removal | 1.7 |
| Vectorización | imagetracerjs | 1.2 |
| Geometría 3D | @jscad/modeling | 2.13 |
| Serializers | @jscad/stl-serializer, @jscad/3mf-serializer | 2.1 |
| Visor 3D | three + OrbitControls | 0.186 |
| ZIP | jszip (descargas) / fflate (parcheo 3MF) | 3.10 / 0.8 |
| Package manager | npm | — |

Configuración relevante:

- `next.config.ts`: `cacheComponents`, `partialPrefetching` y regla de Turbopack
  para `@tailwindcss/turbopack`.
- `tsconfig.json`: `strict: true`, alias `@/* → ./src/*`.
- `components.json`: estilo `radix-nova`, base neutral, iconos lucide.
- Sin variables de entorno ni `.env`.

---

## 3. Empezar

Requisitos: Node.js 20+ y npm.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # build de producción
npm start        # servir el build
npm run lint     # ESLint
```

### Estado de verificación (2026-10-18)

| Comando | Resultado |
|---------|-----------|
| `npm run lint` | ✅ sin errores |
| `npm run build` | ✅ compila + TypeScript + 5 rutas estáticas |
| Tests | ❌ no hay framework de tests configurado |

Rutas generadas en el build: `/`, `/_not-found`, `/tools/image`,
`/tools/llavero`, `/tools/posavasos`.

---

## 4. Estructura

```
src/
  app/
    layout.tsx                 # shell global (header + footer + providers)
    page.tsx                   # catálogo (home) leído del registry
    globals.css                # tokens Tailwind 4 + shadcn
    tools/
      image/page.tsx           # ruta → <ImageTool />
      llavero/page.tsx         # ruta placeholder
      posavasos/page.tsx       # ruta → <PosavasoTool />
  components/
    layout/                    # header, footer, theme toggle
    providers.tsx              # ThemeProvider + TooltipProvider + Toaster
    tools/
      image/
        image-tool.tsx         # UI principal (stepper Editar/Vector/Convertir)
        editor-canvas.tsx      # canvas con pincel, varita y recorte
        dropzone.tsx           # drag & drop
        svg-preview.tsx        # preview de SVG con fondos
        zoom-viewport.tsx      # zoom/pan reutilizable
        types.ts               # BrushSettings, HistoryEntry, Rect
      posavasos/
        posavasos-tool.tsx     # UI principal (panel base/diseño + export)
        model-viewer.tsx       # visor Three.js
    ui/                        # shadcn/ui
  lib/
    tools/registry.ts          # catálogo central de herramientas
    image/
      canvas.ts                # canvas, load, blobs, extractRegion
      background.ts            # wrapper de @imgly/background-removal
      trace.ts                 # cuantización, trazado, split por color
      flood-fill.ts            # varita mágica
      export.ts                # BMP e ICO caseros
      download.ts              # download de blob/texto/ZIP
    utils.ts                   # cn()
  types/
    imagetracerjs.d.ts         # tipos del tracer
    jscad-serializers.d.ts     # tipos de serializers STL/3MF
```

---

## 5. Arquitectura en 30 segundos

1. **Una herramienta = una ruta + un componente + una entrada en el registry.**
   `src/lib/tools/registry.ts` define `slug`, nombre, descripción, categoría,
   estado, icono, tags y features.
2. **Lógica pura separada de React** en `src/lib/*`. Es lo que se puede testear
   y reutilizar.
3. **Client-only cuando hace falta**: las librerías pesadas se cargan con
   `dynamic import` (`@imgly/background-removal`, `jszip`, serializers,
   `fflate`) para no inflar el bundle inicial ni romper SSR.
4. **Privacidad por diseño**: ninguna imagen sale del navegador.
5. **Sin estado global**: la comunicación entre herramientas es por
   `sessionStorage` (handoff explícito del usuario).

Diagrama:

```
┌──────────────────────────── Browser ────────────────────────────┐
│  /tools/image                                                   │
│    Dropzone → ImageTool → lib/image/* → imagetracerjs            │
│         │                         │                             │
│         │                         ├─ PNG/JPEG/WEBP/BMP/ICO       │
│         │                         ├─ SVG (1 archivo)             │
│         │                         └─ SVG por color + ZIP         │
│         │                                                       │
│         └─ writePosavasosHandoff() ── sessionStorage ──┐         │
│                                                          ▼       │
│  /tools/posavasos                                   readHandoff  │
│    PosavasoTool → buildCoaster() → @jscad/modeling              │
│      → piecesToMeshes() → three (visor)                          │
│      → exportStl() / export3mf() (3MF con color por triángulo)    │
└─────────────────────────────────────────────────────────────────┘
```

Detalle completo en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 6. Herramienta de imagen

Ruta: `src/app/tools/image/page.tsx` → `src/components/tools/image/image-tool.tsx`.

### Editar
- Carga por drag & drop o selector: PNG, JPEG, WEBP, BMP.
- Al cargar, se reduce a **máx. 2048 px** de lado mayor (rendimiento). Botón para
  usar la resolución completa.
- Rotar 90° izquierda/derecha, voltear horizontal/vertical, recortar.
- Redimensionar en **px, cm o mm** con DPI configurable y bloqueo de proporción.
- **Quitar fondo** con IA local (`isnet_fp16`), con progreso.
- **Pincel** para borrar o restaurar el fondo, con tamaño ajustable.
- **Varita mágica** (flood fill por color) con tolerancia.
- Undo/Redo del canvas (hasta 30 pasos) y undo/redo de ajustes de vector.

### Vectorizar
- `imagetracerjs` con cinco modos: `color`, `mono`, `mono-invert`, `negative`,
  `grayscale`.
- Presets: Logo, Detallado, Ilustración, Silueta.
- Controles: nº de colores (máx. 32, según colores detectados), fidelidad,
  `pathomit`, redondeo de coordenadas, blur, `rightangleenhance`, grosor de
  trazo, umbral alpha, quitar fondo y tolerancia de fondo.
- El trazado se recalcula solo (debounce 400 ms).
- Paleta de colores detectados con toggle para excluir colores.

### Convertir / exportar
- Imagen: PNG (transparente), JPEG (flatten blanco), WEBP, BMP, ICO.
- SVG completo.
- **Un SVG por color** (capas separadas) con descarga individual o ZIP.
- **Enviar a posavasos** con las capas visibles.

---

## 7. Herramienta de posavasos

Ruta: `src/app/tools/posavasos/page.tsx` → `posavasos-tool.tsx`.

### Base
- Formas: cuadrado con esquinas redondeadas, redondo, hexágono, octágono.
- Ancho, radio de esquina, nº de capas, altura de capa (mm).
- Color base.
- Labio perimetral opcional (ancho y capas).

### Diseño
- Tipos: sin diseño, imagen, patrón, mosaico.
- Modos: **grabado**, **relieve** y **huecos** (through).
- Posición: arriba, abajo o todo el alto; capas de banda.
- Margen, escala, rotación e inversión (solo patrones).
- Patrones: 15 tipos (panal, olas, líneas, cuadrícula, rombos, triángulos,
  ladrillos, zigzag, diagonales, puntos, cruces, estrellas, radial, espiral,
  guijarros).
- Mosaico: 6 disposiciones (cuadrícula, ladrillo, espejo, alternado, panal,
  radial) + tamaño de pieza, separación y rotación.
- Entrada de diseño:
  - handoff desde la herramienta de imagen, o
  - carga manual de un SVG (se separa por color).

### Salida
- Visor 3D Three.js: órbita, zoom, vistas iso/superior/frontal, grid,
  auto-rotación y pantalla completa (`Esc` para salir).
- Export **STL binario**.
- Export **3MF con color por triángulo** (parcheo del ZIP interno).
- Nombre de archivo derivado del SVG/imagen de origen.

El modelo se reconstruye solo con debounce de 200 ms cada vez que cambia una
setting o el diseño.

---

## 8. Decisiones y lecciones

- Decisiones de arquitectura y tecnología: [`docs/DECISIONS.md`](docs/DECISIONS.md).
- Problemas encontrados y cómo se resolvieron (evitar repetirlos):
  [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).
- Estado de la última sesión y cómo continuar:
  [`docs/SESSION.md`](docs/SESSION.md).
- Producto y roadmap: [`docs/PROJECT.md`](docs/PROJECT.md) y
  [`docs/prd/001-toolkit-imagen.md`](docs/prd/001-toolkit-imagen.md).

### Las tres reglas que más dolores de cabeza evitaron

1. **No usar booleanos 3D de JSCAD** para construir piezas imprimibles: dejan
   mallas no estancas. Usar **booleanos 2D + extrusión pura** y solapar una capa.
2. **Validar siempre los booleanos 2D de JSCAD**: fallan en silencio devolviendo
   geometría basura. Verificar área, solidez y contención; forzar CCW.
3. **No confiar en el color a nivel de objeto del 3MF**: hay que inyectar
   `pid`/`p1` por triángulo en el XML y corregir el hex de `displaycolor`.

> ⚠️ Las reglas 1 y 2 están implementadas en `src/lib/3d/geom2-ops.ts`, pero al
> cierre de esta documentación `coaster.ts` (HEAD) todavía usa booleanos 3D y ese
> archivo está huérfano. Ver `docs/SESSION.md` §2.

---

## 9. Cómo agregar una herramienta nueva

1. Crear `src/app/tools/<slug>/page.tsx` con metadata y el componente.
2. Crear `src/components/tools/<slug>/<slug>-tool.tsx`.
3. Si hay lógica reusable, crearla pura en `src/lib/<area>/*` (sin React).
4. Agregar la entrada en `src/lib/tools/registry.ts`:
   ```ts
   {
     slug: "<slug>",
     name: "...",
     description: "...",
     category: "3d" | "imagen" | "utilidades",
     status: "available" | "soon",
     icon: SomeLucideIcon,
     tags: ["..."],
     features: ["..."],
   }
   ```
5. Importar librerías pesadas con `await import(...)`.
6. Verificar `npm run lint` y `npm run build`.

> El catálogo de la home se genera solo desde `TOOLS`. El header actual **no**
> consume el registry (navegación hardcodeada a `/`).

---

## 10. Convenciones

- Archivos de ruta en **kebab-case**; componentes en **PascalCase**.
- Commits en **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `chore:`).
- Sin comentarios innecesarios; los comentarios existentes documentan *por qué*
  (bugs de JSCAD, límites, etc.), no el *qué*.
- Toda la UI y los mensajes en español.
- Sin secretos ni `.env`.

---

## 11. Limitaciones conocidas

- El refactor de geometría (booleanos 2D + extrusión pura) **no está aplicado**
  en `coaster.ts` al cierre de esta documentación: `geom2-ops.ts` existe pero
  está huérfano. Ver `docs/SESSION.md` §2.
- `/tools/llavero` existe pero es un placeholder; el registry lo marca
  `available`. **Inconsistencia pendiente de corregir** (ver `docs/SESSION.md`).
- No hay tests automatizados.
- No hay persistencia: recargar la página pierde la imagen (el handoff usa
  `sessionStorage`, no IndexedDB).
- El SVG de entrada en posavasos tiene límites (`MAX_PATHS = 600`,
  `MAX_POLYGONS = 1200`) para no bloquear el hilo.
- Los patrones/mosaicos tienen topes de filas/columnas/piezas para acotar costo.
- El 3MF se parchea a mano; validar siempre en el slicer antes de imprimir.
- La herramienta de imagen reduce a 2048 px por defecto; para detalles finos hay
  que activar resolución completa.

---

## 12. Documentación

| Documento | Contenido |
|-----------|-----------|
| [`docs/PROJECT.md`](docs/PROJECT.md) | Resumen, objetivo, stack, estado y roadmap |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Capas, módulos, flujos e invariantes |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisiones tecnológicas y trade-offs (ADR-lite) |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Errores reales y sus soluciones |
| [`docs/SESSION.md`](docs/SESSION.md) | Bitácora, estado git y próximos pasos |
| [`docs/prd/001-toolkit-imagen.md`](docs/prd/001-toolkit-imagen.md) | PRD original de la fase 1 |
