# Audit 009 — Cortador v2: UX y rendimiento

## Resultado

**Aprobado con verificación visual parcial.** El módulo v2 conserva el motor y el
flujo de seis pasos, pasa la suite, lint, typecheck y build. La auditoría en
navegador confirmó el layout y la previsualización del pincel con un STL real;
faltó un recorrido completo de corte/exportación y una medición de rendimiento en
CPU/GPU.

## Criterios

| Criterio | Estado | Evidencia / límite |
| --- | --- | --- |
| AC-001 Disposición consistente | Parcial | DOM y CSS colocan controles al costado derecho desde `lg`; navegador revisado a 912 px confirma visor primero en vista angosta. No hubo captura a ≥1024 px. |
| AC-002 Interacciones 3D completas | Parcial | Scheduler invalida por cambios de cámara, geometría, colores, líneas y resize; pipeline motor existente pasa. No se recorrió el modelo en el navegador. |
| AC-003 Menos trabajo con escena quieta | Parcial | Scheduler deja de programar frames una vez estable, coalesce invalidaciones y se cubre con tres tests unitarios. La reducción no se midió con profiler. |
| AC-004 Integridad del flujo | Parcial | TypeScript, ESLint, build y pipeline de cutter2 pasan; lector import/export en UI no se ejecutó en esta pasada. |
| AC-005 Previsualización del pincel | Aprobado | En `/tools/cortador-v2` con `nariz.stl`, Pincel + activo: el aro aparece con pointer-move sin clic y desaparece con pointer-leave y al cambiar a Varita; sin errores de consola. El radio visible era 3,0 mm. |

## Seguridad y alcance

- Todo el procesamiento permanece local; no se agregaron dependencias ni secretos.
- No se modificaron `src/lib/cutter/**`, `src/components/tools/cortador/**` ni el
  motor `src/lib/cutter2/engine/**`.
- No se observó error de consola en la carga inicial.

## Verificaciones ejecutadas

- `npm test` — 72 tests aprobados en la verificación final, incluyendo los dos
  casos unitarios de `brush-cursor`.
- `npx tsc --noEmit` — aprobado.
- `npm run lint` — aprobado.
- `npm run build` — aprobado en la verificación final.
- Navegador — preview del pincel revisado con `nariz.stl`; aro visible sin clic,
  oculto tras salir del canvas/cambiar a Varita y sin errores de consola.
- Lighthouse: Accesibilidad 100, Best Practices 100, SEO 80; `robots.txt` inválido
  es un hallazgo previo y no relacionado con este trabajo.
