# PRD 001 — Toolkit 3D: Infraestructura + Herramientas de Imagen

## 1. Contexto
Se necesita un sitio web que funcione como **pack de herramientas útiles para impresión
3D**, empezando por el manejo de imágenes (preparar logotipos/figuras para imprimir:
sacar fondo, vectorizar, separar por colores). El proyecto debe permitir **agregar
herramientas nuevas a futuro** (llaveros con nombres, generación 3D, etc.) sin reescribir
el núcleo.

## 2. Objetivos
- Establecer una **infraestructura modular** reutilizable para todas las herramientas.
- Entregar una **primera herramienta de imagen completa y funcional**.
- Que el sitio sea **desplegable** (Vercel) y fácil de extender.

## 3. Usuarios / casos de uso
- Diseñador/aficionado a impresión 3D que tiene un logo o figura con fondo y quiere
  aislarla y prepararla para imprimir o grabar.
- Usuario que quiere convertir una imagen a **SVG** para corte/grabado o para
  convertirlo a STL más adelante.
- Usuario que quiere **separar una imagen multicolor en capas por color** (para
  impresión multicolor / por partes).

## 4. Alcance — Fase 1

### 4.1 Infraestructura (must)
- Proyecto Next.js 15 + TS + Tailwind + shadcn/ui.
- Shell de UI: header con marca, navegación, tema claro/oscuro.
- **Página de catálogo** en `/` que lista todas las herramientas desde un registro
  central (`src/lib/tools/registry.ts`).
- Patrón claro para agregar una herramienta nueva (ruta + entrada de registro).
- `docs/` con PROJECT.md y PRDs.

### 4.2 Herramienta "Imagen" (`/tools/image`) (must)
1. **Cargar imagen**: drag & drop + selector de archivo (PNG/JPG/WEBP).
2. **Quitar fondo** (client-side, IA en el navegador). Preview antes/después.
3. **Retoque manual del mask**: pincel para **borrar** y **restaurar** zonas cuando el
   borrado automático no sale perfecto. Ajuste de tamaño de pincel + deshacer.
4. **Exportar**:
   - **PNG** (con transparencia).
   - **SVG** (vectorizado por trazado).
5. **Dividir por color → varios SVG**: cuantizar colores y generar **un SVG por color**
   (capas separadas), con descarga individual y en conjunto (ZIP).

### 4.3 Fuera de alcance (Fase 1)
- Backend de procesamiento, cuentas de usuario, persistencia en la nube.
- Generación 3D / STL (fases futuras).
- Llaveros con nombres (fase futura).

## 5. Requisitos no funcionales
- **Privacidad**: las imágenes nunca salen del navegador.
- **Rendimiento**: librerías pesadas por `dynamic import`; no bloquear el hilo principal
  en lo posible.
- **Accesibilidad**: navegación por teclado, labels, contraste AA.
- **Responsive**: usable en desktop y tablet.
- **Sin secretos** en el repo.

## 6. Criterios de aceptación
- [ ] `npm run build` y `npm run lint` pasan sin errores.
- [ ] La home lista las herramientas desde el registro y navega a `/tools/image`.
- [ ] Se puede subir una imagen, quitarle el fondo y descargar el PNG transparente.
- [ ] Se puede corregir el mask con el pincel (borrar/restaurar).
- [ ] Se puede exportar SVG vectorizado.
- [ ] Se puede activar "dividir por color" y obtener un SVG por color (descarga
      individual y ZIP).
- [ ] Agregar una tool nueva requiere solo: carpeta de ruta + entrada de registro.

## 7. Riesgos
- Modelo de IA de fondo pesado (~varios MB) → mitigado con carga diferida y feedback de
  progreso.
- Trazado SVG de imágenes ruidosas → mitigado con controles de umbral/simplificación y
  vista previa.
- Compatibilidad de WebGL/WASM → fallback y mensajes claros.

## 8. Métricas de éxito
- Todas las herramientas de imagen operativas end-to-end sin servidor.
- Tiempo para agregar una herramienta futura < 30 min (patrón claro).
