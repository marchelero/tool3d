# Auditoría de aceptación — PRD 006

**Fecha:** 2026-10-25  
**Referencia:** `docs/prd/006-cortador-redisenado.md`

| Criterio | Estado | Evidencia / observación |
| --- | --- | --- |
| AC-001 — Flujo legible | Implementado; inspección manual pendiente | El panel empieza con preparación y reparación, continúa con separación, ofrece cortes X/Y/Z y deja filtros/automatización en opciones avanzadas. Hace falta revisar responsive/teclado en navegador. |
| AC-002 — Corte básico disponible | Verificado geométricamente | El corte por plano no depende de selección. Tests de sólido convexo y sólido cóncavo validan piezas watertight y suma de volúmenes. |
| AC-003 — El contorno seleccionado define la pieza completa | Verificado geométricamente | Test de parche oblicuo compara el modo plano con un `splitByPlane` directo y verifica área coplanar, dos sólidos y conservación ±0.5 %; otro test valida el perfil 3D y la piel exterior exacta. También cubre los abanicos que se tocan en un vértice. |
| AC-004 — Cáscara superficial opcional | Verificado geométricamente | Tests conservan el modo de cáscara por profundidad, permiten una selección de superficie cerrada y rechazan usar una superficie cerrada como pieza completa porque no tiene perímetro de corte. |
| AC-005 — Encastres aislados | Verificado por regresión | Se prueban espiga, llave y cola de milano tanto en la cáscara como en una pieza delimitada por contorno; fallo por medidas imposibles no deja geometría parcial. |
| AC-006 — Validación | Verificado | `npm test` (62 tests), `npx tsc --noEmit`, `npm run lint`, `npm run build` y `git diff --check` concluyeron correctamente. |
| AC-007 — Alojamiento para imanes | Verificado geométricamente | Tests prueban bolsillos en ambas mitades de un corte plano y una separación superficial planar; los dos volúmenes disminuyen de forma equivalente y las piezas permanecen watertight. El reporte describe el preset y holgura radial. |

## Seguimiento manual

La malla del screenshot no está presente en el repositorio. Revisar con ese archivo:
selección con varita, pieza completa por contorno, cáscara opcional, recuperación
ante error y corte rápido por eje. No presentar la prueba sintética como validación
del STL exacto del usuario.
