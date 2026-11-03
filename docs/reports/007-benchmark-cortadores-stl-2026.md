# Benchmark de cortadores STL — 2026-10-25

## Objetivo

Comparar funciones visibles y patrones de implementación de cortadores usados
para impresión 3D, y priorizar mejoras que encajen con Tool3D: web local, archivos
STL/3MF, geometría Manifold y preview antes de exportar.

## Fuentes revisadas

| Fuente | Tipo | Confianza | Hallazgos principales |
| --- | --- | --- | --- |
| [PrusaSlicer — Cut tool](https://help.prusa3d.com/article/cut-tool_1779) | Manual oficial | Alta | Plano posicionable y giratorio; planar/dovetail; decisión de qué islas conservar; plug, dowel y snap; click para poner y click derecho para retirar conectores; flip del plano. |
| [Bambu Studio — Cut tool](https://wiki.bambulab.com/en/software/bambu-studio/cut-tool) | Wiki oficial | Alta | Rotación numérica y con gizmo; reasignación de islas A/B; conservar ambas mitades o una; orientación al terminar (conservar, apoyar en corte, voltear); plug, dowel y snap. |
| [Multipart3D — Planar cut](https://multipart3d.com/features/planar-cut), [Area cut](https://multipart3d.com/features/area-cut), [Connectors](https://multipart3d.com/features/connectors) y [Dovetail](https://multipart3d.com/features/dovetail-cut) | Sitio de producto y páginas funcionales | Media-alta | Preview antes de confirmar; corte de área limitado a ventana rectangular/circular; conectores colocados sobre la cara de unión; imanes con presets como 6×3 mm; dovetail configurable por tolerancia y preview separado. |
| [SpliceSTL](https://splicestl.com/) y [descripción de funciones](https://splicestl.com/llms.txt) | Sitio de producto | Media | Afirma presets de impresoras, auto-split multi-eje, varios perfiles de seam, imanes, layout por cama, hoja de ensamblaje, estimaciones y herramientas de reparación. Es información del propio proveedor, no una evaluación independiente. |
| [PrusaSlicer — CutUtils.cpp](https://github.com/prusa3d/PrusaSlicer/blob/69c8e569410efe82259e706cd09a05ea82da9359/src/libslic3r/CutUtils.cpp) | Repositorio abierto | Alta para el código consultado | Gestiona los conectores como geometría del modelo, aplica tolerancias aumentando el hueco radial/axial y trata los dowels como objetos separados. |
| [Bambu Studio — CutUtils.cpp](https://github.com/bambulab/BambuStudio/blob/bf68eece13cbc05a9f9eaf3e1761a4d020ccd411/src/libslic3r/CutUtils.cpp) | Repositorio abierto | Alta para el código consultado | Procesa plug/snap/dowel al crear los dos lados; conserva tipos de salida y añade tolerancia a sockets. |
| [Forma3D](https://github.com/lukethehawk/Forma3D) | Repositorio MIT, editor STL local/web | Baja para benchmarking de corte | Referencia de edición local con Three.js, pero el material revisado no demuestra una herramienta de corte de precisión comparable; no se toma como base de comportamiento. |

No se copió código de estos proyectos. Se tomaron patrones funcionales como
referencia; la geometría se implementa con el pipeline local Manifold del proyecto.

## Comparación con Tool3D

Tool3D ya cuenta con selección pintada, extracción por contorno, corte plano con
ajuste de posición/orientación, modos de tapa plana y 3D, preview confirmable,
undo/redo, validación watertight, STL/3MF y encastres de espiga, llave y cola de
milano. No es prioritario duplicar esas bases.

| Brecha | Valor para el usuario | Prioridad |
| --- | --- | --- |
| Bolsillos enfrentados para imanes de disco, con medida y holgura | Ensamble oculto, reemplazable y separable; se suma a las uniones mecánicas existentes | P1 — implementado |
| Colocar/quitar conectores manualmente sobre la cara de unión | Evita que la distribución automática choque con detalles del modelo | P1 — siguiente mejora |
| Asignar islas a lado A/B y elegir orientación final de cada pieza | Control de restos y piezas listas para impresión | P2 |
| Presets de cama, auto-split multi-eje, empaquetado y hoja de montaje | Reduce la preparación de modelos mayores que la impresora | P2 — alcance amplio |
| Snap-fit, dowel independiente, perfiles interlocking wave/zigzag/jigsaw | Más opciones de unión, pero requieren diseño y pruebas mecánicas separadas | P3 |

## Decisión de implementación

Se implementaron bolsillos emparejados para **imanes de disco** en cortes planos y
superficiales. El selector parte de Ø6 × 3 mm y mantiene cantidad/holgura radial
editables. La operación sustrae una cavidad en cada lado, conserva ambas piezas
watertight y trata ambos huecos como una sola transacción de preview. El uso requiere
instalar imanes externos con polos opuestos; no se exporta una pieza de imán.

La colocación manual de conectores y los perfiles de cama quedan como propuestas
para siguientes iteraciones. El STL concreto de Charmander no está disponible en
el repositorio, así que la verificación se hará con fixtures geométricos sintéticos.

## Límites de la investigación

- Manuales y código fuente confirman capacidades documentadas, no el resultado de
  ejecutar cada producto en hardware concreto.
- Las funciones de SpliceSTL son claims publicados por su autor y pueden cambiar
  entre versiones.
- Se favorecieron patrones relevantes para impresión multipartes; no se comparó
  precio, rendimiento integral ni calidad de impresión.
