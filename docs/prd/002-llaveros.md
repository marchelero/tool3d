# PRD 002 — Módulo Llaveros

## 1. Contexto
El posavasos ya cuenta con un motor 2D/3D robusto (Clipper + CDT + extrusión
watertight + export 3MF compatible Bambu/Orca + visor). El siguiente módulo,
**Llaveros**, es una pieza **plana** con anilla de sujeción, pensada para llevar
una **imagen** o **texto** (nombre). Reutiliza el mismo motor y la misma UX de
panel, sumando formas nuevas, contenido de texto y una forma que sigue la
**silueta de la imagen**.

## 2. Objetivos
- Entregar un módulo de llaveros **flat** completo y funcional, en el navegador.
- Reutilizar al máximo el motor y los componentes del posavasos (sin duplicar).
- Permitir **imagen o texto** como contenido central, con vista previa en vivo.
- Ofrecer formas variadas + **silueta** + **anilla**, con estilos de relieve.

## 3. Usuarios / casos de uso
- Quien quiere un llavero con un **nombre** (1–3 líneas) impreso en 3D.
- Quien quiere un llavero con un **logo/imagen** vectorizada (handoff desde Imagen).
- Quien quiere que el llavero tenga la **forma de su propio diseño** (silueta).
- Quien quiere **relieve multicolor** (cada color de la imagen a distinta altura).

## 4. Alcance

### 4.1 Reutilización (motor existente)
- `clip2.ts` (Clipper), `triangulate.ts` (CDT), `extrude.ts` (`buildSolid`,
  `extrudeRegion`, `meshQuality`), `threemf.ts` + `mesh.ts` (export), `svg.ts`
  (`svgToDesign`), `handoff.ts`, `model-viewer.tsx`, componentes `ui/*`.
- La UX del panel (tabs fijas, secciones, `NumberSlider`, presets) se replica.

### 4.2 Formas (`shape`) (must)
Redondo · Cuadrado · **Rectángulo** (ancho×alto) · **Rombo** · **Estrella**
(puntas configurables) · Hexágono · Octágono · **Corazón** · **Escudo** ·
**Silueta** (contorno de la imagen como forma).
- Redondeo de esquinas para cuadrado/rectángulo.

### 4.3 Contenido central (`designKind`) (must)
- **Imagen**: SVG (handoff desde el módulo Imagen o SVG subido). Mismas capas por
  color (`HandoffLayer{color,svg}`).
- **Texto**: 1 a 3 líneas, cada línea con contenido, tamaño y color propios.
  Fuente seleccionable, negrita, espaciado y **curvado (arco)** opcional.
  Contornos vía **opentype.js** + fuente bundleada (offline).
- **Ninguno**.
- *(Recomendación adoptada: contenido unificado en este módulo, sobre un motor de
  texto reutilizable `text.ts`; si luego se quiere texto en el posavasos, se
  agrega un módulo "Texto" que engancha el mismo motor.)*

### 4.4 Estilos (`style` / `designMode`) (must)
- **Estilo 1 — Plano/Grabado**: todo al mismo nivel (`flat`), grabado (`engrave`)
  o con relieve (`raise`).
- **Estilo 2 — Relieve multicapa**: el diseño al mismo nivel, un nivel más alto
  (`raise`) o **cada capa/color a distinta altura y color** (`layered`).

### 4.5 Silueta (`shape = silhouette`) (must)
- La forma del llavero sigue el contorno de la imagen, con un **reborde/offset**
  (grosor configurable) y el diseño grabado/en relieve dentro.
- La silueta se calcula uniendo las capas de la imagen y aplicando un `offset`
  (Clipper) hacia afuera.

### 4.6 Anilla (must)
- Agujero para la anilla: **diámetro**, **posición** (arriba-centro por defecto) y
  **refuerzo (boss)** opcional alrededor del agujero.

### 4.7 Extras (should)
- Presets de tamaño de llavero (40 / 50 / 60 mm).
- Borde/rim (reutilizado del posavasos).
- Aviso de **paredes muy finas** (no imprimible).
- Vista previa mostrando la anilla.
- Rotación del diseño.

### 4.8 Fuera de alcance
- Patrón y mosaico (no aplican al llavero).
- Backend, cuentas, persistencia en la nube.

## 5. Requisitos no funcionales
- **Privacidad**: todo client-side; nada sale del navegador.
- **Rendimiento**: `opentype.js` y la fuente por `dynamic import`.
- **Accesibilidad**: teclado, labels, contraste AA.
- **Sin secretos** en el repo.
- **Malla**: `open=0` obligatorio (validado con `meshQuality`); `over` benigno
  tolerado como en el posavasos.

## 6. Criterios de aceptación
- [ ] `npm run lint` y `npm run build` pasan sin errores.
- [ ] Se elige forma (todas las listadas) y tamaño, con vista previa.
- [ ] Se agrega **imagen** (handoff) o **texto** (1–3 líneas) y se ve en el visor.
- [ ] El texto se convierte a contornos nítidos (opentype.js) y se extruye.
- [ ] Estilos 1 y 2 operan: mismo nivel / grabado / relieve / por capa-color.
- [ ] La **silueta** genera la forma a partir de la imagen con reborde.
- [ ] El **agujero de la anilla** se genera (con refuerzo opcional).
- [ ] Se exporta STL y 3MF (multicolor) y abre bien en Bambu/Orca.
- [ ] Todas las piezas salen `open=0`.

## 7. Riesgos
- **Fuente/opentype**: fuentes con contornos complejos o glifos faltantes →
  validar/simplificar contornos y fallback de fuente.
- **Texto muy fino** (trazo delgado) → aviso de grosor mínimo.
- **Silueta** con muchos huecos/pinches (igual que el posavasos) → se acepta
  `over` benigno; `open` debe ser 0.
- **Tamaño del bundle** (fuente) → carga diferida.

## 8. Métricas de éxito
- Llavero con nombre y con logo exportables end-to-end sin servidor.
- Reutilización > 70% del motor del posavasos.

## 9. Decisiones tomadas
1. Texto → **opentype.js** + fuente bundleada (nítido, offline).
2. Formas → **todas las listadas**.
3. Estilo 2 → **mismo nivel / un nivel más alto / por capa-color**.
4. Imagen+texto → **unificado** en el módulo, sobre motor `text.ts` reutilizable
   (recomendación del agente).

## 10. Plan por fases
1. **Motor**: `shapes.ts` (formas nuevas + silueta), `text.ts` (opentype → SVG).
2. **Geometría**: `keychain.ts` (`buildKeychain`) con estilos y anilla.
3. **UI**: `keychain-tool.tsx` (panel) + reutilizar `model-viewer.tsx`.
4. **Export**: reutilizar `threemf`/`mesh`; verificar en Bambu/Orca.
5. **Verificación**: arnés Node + `npm run lint` + `npm run build`.
