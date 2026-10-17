# PROJECT — Tool3D

## Resumen
Toolkit web modular de utilidades para **impresión 3D**. Arranca con herramientas de
imagen y está diseñado para crecer agregando secciones/herramientas nuevas (generación
3D, llaveros con nombres, etc.) sin tocar el núcleo.

## Objetivo
Un "pack de herramientas" único en la web donde cada utilidad vive en su propia ruta y
se registra en un catálogo central. Todo el procesamiento pesado de imagen corre
**client-side** (privacidad + sin costo de servidor).

## Stack
- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** (componentes)
- Procesamiento de imagen en el navegador (WASM/Canvas/JS puro)
- **npm** como package manager
- Deploy objetivo: **Vercel** (estático + API routes futuras)

## Principios de arquitectura
1. **Modularidad por herramienta**: cada tool es una carpeta en `src/app/tools/<slug>/`
   + su componente en `src/components/tools/<slug>/`.
2. **Registro central**: `src/lib/tools/registry.ts` es la única fuente de verdad del
   catálogo (home, navegación, buscador). Agregar una tool = agregar una entrada.
3. **Lógica pura separada de UI**: el procesamiento de imagen vive en `src/lib/image/*`
   como funciones puras testeables, sin dependencias de React.
4. **Client-only cuando aplica**: las libs pesadas (IA de fondo, tracer) se cargan
   dinámicamente (`dynamic import`) para no inflar el bundle inicial ni romper SSR.
5. **Sin secretos en el cliente**: no hay claves API; todo el cómputo es local.

## Estructura
```
src/
  app/
    layout.tsx              # shell global
    page.tsx                # catálogo (home)
    tools/<slug>/page.tsx   # una ruta por herramienta
  components/
    layout/                 # header, footer, shell
    tools/<slug>/           # UI de cada herramienta
    ui/                     # shadcn/ui
  lib/
    tools/registry.ts       # catálogo central
    image/                  # lógica de procesamiento (pura)
docs/                       # PRD, sesiones, reports
```

## Roadmap (alto nivel)
| Fase | Contenido |
|------|-----------|
| 1 ✅ | Infra + **Herramientas de imagen** (quitar fondo, retoque, PNG, SVG, split por color) |
| 2 | Generador de llaveros con nombres (letras → SVG/STL) |
| 3 | Generación/edición 3D y exportación STL/3MF |
| 4 | Más utilidades (calibración, presets de impresión, calculadoras) |

## Estado actual
Fase 1 en construcción. Ver `docs/prd/001-toolkit-imagen.md`.

## Convenciones
- Nombres de archivos: kebab-case para rutas, PascalCase para componentes.
- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`...).
- Sin comentarios innecesarios en el código.
