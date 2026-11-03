# Informe de implementación — PRD 006

**Fecha:** 2026-10-25  
**Alcance:** corregir la selección que se ramificaba, hacer que el contorno
seleccionado separe una pieza completa, ordenar el flujo del Cortador e incorporar
la unión por imanes del benchmark (revisión 5).

## Diagnóstico confirmado

La separación superficial convertía la selección en un patch para construir una
shell. Si dos abanicos de caras solo compartían un vértice, la captura usaba una
misma identidad topológica y el borde aparecía ramificado. Además, se rechazaba una
selección de toda la superficie aunque fuera una piel cerrada válida. El preview
fallido no restauraba la selección de forma que resultara sencillo intentar otro
tipo de corte.

## Cambios

- `src/lib/cutter/zones.ts`: captura de patch con vértices duplicados por abanico
  conectado por aristas; una singularidad de vértice deja de ser motivo para
  rechazar una selección.
- `src/lib/cutter/split.ts`: descomposición de componentes de caras del patch;
  «Recta y plana» deriva un plano de borde y usa un corte real de todo el sólido,
  mientras «Seguir forma 3D» cierra la superficie seleccionada por el contorno. La
  cáscara por profundidad se conserva como modo opcional.
- `src/components/tools/cortador/cortador-tool.tsx`: paso de preparación de malla
  visible, separación principal con cortes rápidos X/Y/Z disponibles sin varita,
  selector explícito de pieza completa/cáscara, profundidad visible solo para la
  cáscara, opciones avanzadas agrupadas y restauración del estado aceptado si el
  preview superficial falla.
- `src/lib/cutter/zones.test.ts` y `split.test.ts`: regresiones para selección con
  dos abanicos que se tocan en un vértice, pieza completa delimitada por un parche
  curvo, corte de shell opcional, encastres sobre pieza completa y corte plano sobre
  un sólido cóncavo.
- `src/lib/cutter/report.ts`: informa por separado pieza completa por contorno y
  cáscara superficial; las operaciones guardadas antes del selector conservan su
  semántica de cáscara.
- `src/lib/cutter/split.ts`: añade bolsillos coaxiales para imanes a ambos lados de
  cortes planos y superficiales. La holgura radial agranda ambos alojamientos; los
  imanes son hardware externo y no se convierten en piezas STL.
- `src/components/tools/cortador/cortador-tool.tsx`: agrega «Alojamiento para imán»
  en los dos tipos de unión, con preset Ø6×3 mm, cantidad y holgura editables.
- `src/lib/cutter/split.test.ts`: el caso oblicuo compara las piezas del modo plano
  con un `splitByPlane` directo y revisa que la cara de corte sea plana y watertight;
  nuevos casos verifican los bolsillos emparejados sobre cortes planos y pintados.

El corte sólido sigue requiriendo que la malla sea cerrada y esté orientada. El paso
de preparación muestra cuándo debe repararse; no se afirma soporte booleano para
mallas que continúen abiertas o no manifold tras reparar.

## Verificación

| Comando | Resultado |
| --- | --- |
| `npm test` | Correcto: 7 archivos, 62 tests aprobados |
| `npx tsc --noEmit` | Correcto |
| `npm run lint` | Correcto |
| `npm run build` | Correcto: Next.js 16.4.2 compiló y generó páginas estáticas |
| `git diff --check` | Correcto; Git solo avisó sobre normalización LF/CRLF |

La malla del screenshot no está disponible como archivo de prueba local. Las
regresiones deterministas cubren un patch curvo con tapa plana oblicua y el perfil
3D; falta que el usuario valide el STL real desde la interfaz.
