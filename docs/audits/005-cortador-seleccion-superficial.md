# Auditoría de aceptación — PRD 005

**Fecha:** 2026-10-25  
**Referencia:** `docs/prd/005-cortador-seleccion-superficial.md`

| Criterio | Estado | Evidencia / observación |
| --- | --- | --- |
| AC-001 — Selección visible y editable | Parcialmente verificado | Se mantiene selección por cara/varita y pintura, con caras y contorno capturados para la operación; tests de selección pasan. Falta completar inspección manual en navegador de tolerancia, sumar/restar y overlay. |
| AC-002 — Separación superficial | Verificado en tests | Pruebas de parche plano y curvo, conservación de triángulos exteriores, profundidad y suma de volúmenes; `splitMesh` exige salida watertight/outward. |
| AC-003 — Confirmar/cancelar preview | Implementado; revisión manual pendiente | Confirmar acepta la salida ya calculada, cancelar restaura snapshot y cambios invalida confirmación. Exportación bloqueada mientras el preview esté pendiente. No se ejecutó el recorrido manual completo en navegador. |
| AC-004 — Encastres configurables y atómicos | Verificado en tests geométricos | Las tres variantes se prueban con piezas cerradas; también se prueba el rechazo de encastre sobredimensionado. Parches curvos complejos pueden rechazarse si la boolean no es válida. |
| AC-005 — Errores de selección o geometría | Verificado en tests | Se rechazan parche sin borde cerrable, profundidad inválida y encastre que no cabe; el flujo solo publica piezas después de una geometría válida. |
| AC-006 — Regresión de módulo | Verificado | Tests, TypeScript, lint, build y comprobación de whitespace concluyeron correctamente. |

## Riesgos y seguimiento

1. Ejecutar una prueba manual en navegador con una malla real STL y otra 3MF, y
   recorrer selección, preview, edición de medidas, cancelar, confirmar y exportar.
2. Validar visualmente encastres sobre selecciones curvas de distintas escalas;
   cuando el boolean sea inválido la operación se rechaza sin geometría parcial.
3. El diff contiene reformat de código preexistente junto con los cambios funcionales;
   no afecta las verificaciones, pero conviene aislar futuras modificaciones para
   mantener pequeños los diffs.

## Dictamen

La implementación satisface los criterios geométricos y de regresión automatizados.
La aceptación integral queda condicionada a la comprobación manual de los flujos UI
indicados en AC-001 y AC-003, y a inspección visual de las piezas/encastres.
