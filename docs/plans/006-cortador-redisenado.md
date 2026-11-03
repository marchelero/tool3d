# Plan de implementación — PRD 006 (revisión 6)

## Dependencias

```text
T1 Repro/topología ──> T2 normalizar patch ──> T3 shell cerrada
       │                      │                    │
       └──────────────────────┴────────────────────┴──> T5 conectar flujo UI
T4 revisar jerarquía UX ───────────────────────────────> T5
T3 + T5 ──────────────────────────────────────────────> T6 validar y documentar
```

## Tareas y evidencia

| ID | Tarea | Estado | Evidencia |
| --- | --- | --- | --- |
| T1 | Reproducir el fallo lógico con una selección que toca en un vértice y analizar el flujo de selección/cortes | Completa | Regresión reproduce el patch con abanicos de caras que se tocan solo en un vértice. |
| T2 | Crear snapshot superficial dividiendo abanicos conectados por aristas, no solo por índice de vértice | Completa | `zoneToSurfaceOp` remapea los fans y el test verifica identidades separadas. |
| T3 | Aceptar piel cerrada sin borde y comprobar salida manifold/volumen | Completa | Tests de superficie completa, patch pinchado y salida watertight con volumen conservado. |
| T4 | Reducir competencia de controles y definir la jerarquía preparar → separar → encastre → exportar | Completa | Preparación visible primero, separación principal después; controles automáticos/filtros quedan en sección avanzada. |
| T5 | Conectar geometría robusta al flujo de preview y ordenar el panel principal | Completa | Cortes rápidos X/Y/Z sin selección y preview fallido restaura modelo/selección aceptados. |
| T6 | Ejecutar suite completa y actualizar informe/auditoría de la primera revisión | Completa | 48 tests, TypeScript, lint, build y diff-check pasan; resultados en `docs/reports/006-cortador-redisenado.md` y `docs/audits/006-cortador-redisenado.md`. |
| T7 | Cambiar la separación predeterminada para que la selección delimite una pieza completa con tapa sobre el contorno | Completa | Test de parche curvo valida volumen completo, piel exterior y suma de volumen; la salida no usa espesor fijo. |
| T8 | Mantener cáscara como modo opcional, conectar el selector UI y actualizar documentación | Completa | El selector ofrece «Pieza completa por contorno» (predeterminado) y «Cáscara superficial»; profundidad solo se muestra en cáscara. Las operaciones guardadas sin modo conservan cáscara. |
| T9 | Ejecutar regresión completa y registrar evidencia de la revisión 2 | Completa | 57 tests, TypeScript, lint, build y diff-check pasan; audit separa la evidencia sintética de la inspección manual pendiente del STL del usuario. |
| T10 | Añadir cierres de pieza completa planos y siguiendo la forma 3D | Completa | Selector de tapa plana o perfil 3D implementado; la revisión 4 cambia el modo plano a un corte global derivado del borde. |
| T11 | Probar ambos estilos de tapa y verificar regresiones | Completa | El test oblicuo compara la separación plana con un `splitByPlane` directo; ambas piezas son watertight y conservan volumen. |
| T12 | Sustituir la tapa plana local por un corte plano real del sólido | Completa | `surfaceBoundaryPlane` orienta el plano al lado del patch y `splitByPlane` separa todo el sólido sin paredes de transición. |
| T13 | Ejecutar validación y actualizar evidencia de la revisión 4 | Completa | 59 tests, TypeScript, lint, build y diff-check pasan; se registra que el STL del screenshot no está disponible localmente. |
| T14 | Comparar cortadores web y repositorios abiertos para identificar brechas útiles | Completa | PrusaSlicer, Bambu Studio, Multipart3D, SpliceSTL y repos de Prusa/Bambu revisados; benchmark en `docs/reports/007-benchmark-cortadores-stl-2026.md`. |
| T15 | Añadir alojamientos para imanes a uniones planas y superficiales | Completa | Bolsillos enfrentados implementados para cortes planos y superficiales; preset Ø6×3 mm, cantidad y holgura radial editables; tests verifican reducción simétrica de volumen y watertight. |
| T16 | Validar, documentar y auditar la mejora del benchmark | Completa | 62 tests, TypeScript, lint y build pasan; informe/auditoría registran AC-007 y el benchmark. |
| T17 | Añadir modo manual de colocación y retiro de conectores sobre caras planas de unión | En curso | AC-008; conserva distribución automática y permite editar posiciones persistidas en coordenadas del modelo. |
| T18 | Validar geometría, interacción y actualizar reporte/auditoría de AC-008 | Pendiente | Tests por variante y lado, rechazo atómico, flujo agregar/quitar/volver a automático, test, tipos, lint y build. |
