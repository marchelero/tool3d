# PROJECT — Tool3D

## Resumen

Toolkit web modular de utilidades para **impresión 3D**. Arranca con herramientas
de imagen, suma generación paramétrica de **posavasos 3D** y está diseñado para
crecer agregando nuevas herramientas (llaveros, generación 3D, calibración, etc.)
sin tocar el núcleo.

## Objetivo

Un "pack de herramientas" único en la web donde cada utilidad vive en su propia
ruta y se registra en un catálogo central. Todo el procesamiento pesado
(imagen, vectorización y geometría 3D) corre **client-side**: privacidad total y
sin costo de servidor.

## Stack

- **Next.js 16.4.2** (App Router, Turbopack) + **React 19.3** + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (estilo `radix-nova`)
- Procesamiento de imagen en el navegador: Canvas + `imagetracerjs` +
  `@imgly/background-removal`
- Geometría 3D: **`@jscad/modeling`** + serializers STL/3MF
- Visor 3D: **Three.js** (`OrbitControls`)
- **npm** como package manager
- Deploy objetivo: **Vercel** (sitio estático; sin API por ahora)
- Sin secretos, sin `.env`, sin backend

## Principios de arquitectura

1. **Modularidad por herramienta**: cada tool es una carpeta en
   `src/app/tools/<slug>/` + su componente en `src/components/tools/<slug>/`.
2. **Registro central**: `src/lib/tools/registry.ts` es la fuente de verdad del
   catálogo de la home. Agregar una tool = agregar una entrada.
3. **Lógica pura separada de UI**: el procesamiento vive en `src/lib/image/*` y
   `src/lib/3d/*` como funciones sin dependencias de React.
4. **Client-only cuando aplica**: las libs pesadas (IA de fondo, tracer,
   serializers, ZIP) se cargan con `dynamic import`.
5. **Sin secretos en el cliente**: no hay claves API; todo el cómputo es local.
6. **Geometría robusta**: operaciones 2D validadas + extrusión pura; evitar
   booleanos 3D que generan mallas no estancas.

## Estructura

```
src/
  app/
    layout.tsx              # shell global
    page.tsx                # catálogo (home)
    tools/<slug>/page.tsx   # una ruta por herramienta
  components/
    layout/                 # header, footer, theme toggle
    tools/<slug>/           # UI de cada herramienta
    ui/                     # shadcn/ui
  lib/
    tools/registry.ts       # catálogo central
    image/                  # procesamiento de imagen (puro)
    3d/                     # SVG → geometría, patrones, posavasos, malla, handoff
  types/                    # .d.ts de librerías sin tipos
docs/                       # PRD, arquitectura, decisiones, troubleshooting, sesión
```

## Herramientas

| Slug | Nombre | Categoría | Estado |
|------|--------|-----------|--------|
| `image` | Imagen | imagen | ✅ disponible |
| `posavasos` | Posavasos | 3d | ✅ disponible |
| `llavero` | Llavero con imagen | 3d | ⚠️ ruta placeholder (registry dice disponible) |
| `keychain` | Llaveros con nombres | 3d | ⏳ próximamente |
| `generate-3d` | Generar 3D | 3d | ⏳ próximamente |
| `calibration` | Calibración | utilidades | ⏳ próximamente |
| `boxes` | Cajas y contenedores | utilidades | ⏳ próximamente |

## Roadmap (alto nivel)

| Fase | Contenido | Estado |
|------|-----------|--------|
| 1 | Infra + **herramientas de imagen** (quitar fondo, retoque, PNG, SVG, split por color) | ✅ |
| 2 | Generador de **llaveros con nombres** (letras → SVG/STL) | ⏳ (ruta `llavero` placeholder) |
| 3 | Generación/edición 3D + export STL/3MF (**posavasos paramétrico**) | ✅ mayormente |
| 4 | Más utilidades (calibración, presets de impresión, calculadoras, cajas) | ⏳ |

## Estado actual

- Home + herramienta de imagen + posavasos 3D funcionales.
- `npm run lint` y `npm run build` pasan.
- Sin tests automatizados.
- Refactor de geometría (booleanos 2D validados, sin booleanos 3D) **sin
  commitear** al momento de esta actualización.
- Detalle de continuidad en `docs/SESSION.md`.

## Documentación

- `README.md` — guía general.
- `docs/ARCHITECTURE.md` — arquitectura y flujos.
- `docs/DECISIONS.md` — decisiones tecnológicas (ADR-lite).
- `docs/TROUBLESHOOTING.md` — problemas resueltos y errores a no repetir.
- `docs/SESSION.md` — bitácora y próximos pasos.
- `docs/prd/001-toolkit-imagen.md` — PRD original de la fase 1.

## Convenciones

- Nombres de archivos: kebab-case para rutas, PascalCase para componentes.
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`...).
- UI y mensajes en español.
- Sin comentarios innecesarios en el código; los existentes documentan el *por qué*.
