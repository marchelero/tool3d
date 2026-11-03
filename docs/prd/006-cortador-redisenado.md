# PRD 006 — Cortador 3D guiado y tolerante a topología real (revisión 6)

## Motivo

La primera revisión corrigió el rechazo topológico, pero el preview aún extrae una
cáscara de profundidad fija. La referencia del usuario requiere que el borde
pintado sea el borde real del corte y que la zona delimitada salga como una pieza
completa, no como una lámina que deja restos del volumen original.

La segunda revisión extraía el volumen completo, pero la tapa podía seguir la
profundidad irregular de las aristas 3D del contorno y formar una punta en la pieza
restante. El usuario debe poder elegir un cierre plano o conservar la forma 3D del
contorno; el cierre plano será la opción inicial para evitar picos no deseados.

La tercera revisión proyectaba el perímetro a un plano y lo unía al borde original
con paredes laterales. En contornos muy irregulares esas paredes dejaban láminas o
puntas. El modo plano debe hacer una división real del sólido por un plano derivado
del contorno, no construir un cap local con paredes de transición.

## Objetivo

Reordenar el cortador alrededor de un camino principal comprensible —preparar,
seleccionar y separar, revisar encastres y exportar— y permitir que el usuario
extraiga como pieza completa el volumen que queda detrás de la zona pintada. El
contorno de selección debe ser el perímetro del corte; la profundidad de una
cáscara no puede ser el resultado predeterminado.

## Alcance

- Mantener carga STL/3MF y reparación como primer paso visible.
- Agrupar las acciones frecuentes en un flujo guiado: selección, tipo de corte,
  preview/confirmación y exportación. Los parámetros avanzados no deben competir
  visualmente con la acción principal.
- La varita y el pincel muestran la selección directamente sobre el modelo; Shift
  suma y Alt resta. La selección capturada para un corte es una instantánea estable.
- Normalizar la topología local de una selección duplicando vértices donde varios
  abanicos de caras solo se tocan en un punto. Un vértice compartido no puede ser
  motivo suficiente para bloquear el corte.
- Para una selección parcial con contorno cerrado, «Recta y plana» deriva un plano
  del perímetro y divide el sólido completo por ese plano; conserva como pieza la
  mitad que contiene la selección. Es la opción inicial y no añade paredes de
  transición que puedan dejar láminas. «Seguir forma 3D» cierra la piel seleccionada
  por el contorno 3D y conserva sus variaciones. Ambos resultados deben ser watertight.
  El modo predeterminado es pieza completa, no una cáscara de espesor fijo.
- Mantener la extracción de cáscara con profundidad como modo secundario explícito;
  una selección de superficie completa sin borde solo es válida en ese modo.
- Mantener los cortes rectos, curvos y por forma como alternativas accesibles;
  al menos el corte recto por eje debe estar disponible sin activar la varita.
- Configurar, previsualizar y aceptar encastres después de crear la separación.
  El fallo de un encastre no puede borrar una separación válida ni mutar piezas
  aceptadas.
- En cortes planos y superficiales, ofrecer alojamientos emparejados para imanes de
  disco. El preset inicial es Ø6 × 3 mm, con cantidad y holgura radial ajustables;
  ambos huecos deben quedar alineados en las dos caras de unión. Los imanes son
  hardware externo y no se agregan como geometría exportada.
- Si una malla abierta o no manifold no se puede reparar, explicar la acción
  requerida; no presentar un error topológico interno sin orientación.

## Fuera de alcance

- Garantizar operaciones booleanas sobre una malla que siga abierta, autointersecada
  o no manifold después de ejecutar reparación.
- Interpretar colores 3MF como volúmenes sólidos.
- Rediseñar los formatos de archivo o la persistencia de proyectos.

## Criterios de aceptación

### AC-001 — Flujo legible

- **Escenario:** el usuario abre el cortador.
- **Acción:** carga un modelo y avanza por las opciones principales.
- **Esperado:** preparar, cortar, revisar encastre y exportar se distinguen con
  jerarquía visual; no hace falta buscar la acción principal entre controles
  avanzados.
- **No debe:** ocultar el corte recto básico detrás de la varita.
- **Verificación:** inspección responsive/manual de pantalla y teclado.

### AC-002 — Corte básico disponible

- **Escenario:** malla cerrada y reparada cargada, con o sin zona seleccionada.
- **Acción:** crear un corte plano y ejecutar preview.
- **Esperado:** el plano corta la pieza en piezas watertight y se puede confirmar.
- **No debe:** exigir que exista selección superficial ni un contorno pintado.
- **Verificación:** prueba Manifold en geometría convexa/cóncava y recorrido UI.

### AC-003 — El contorno seleccionado define la pieza completa

- **Escenario:** se pinta una zona parcial conectada de una pieza cerrada, incluso
  si su contorno pasa por vértices compartidos.
- **Acción:** elegir «Pieza completa» y separar la selección.
- **Esperado:** en «Recta y plana», un plano derivado del perímetro divide el sólido
  completo y se conserva como pieza el lado donde está el patch seleccionado; el
  resultado coincide con un corte plano directo y ambas piezas quedan cerradas.
  «Seguir forma 3D» conserva exactamente las caras exteriores seleccionadas y cierra
  por su perfil 3D. En ambos estilos la suma de volúmenes coincide con el original
  dentro de ±0.5 %.
- **No debe:** sustituir el corte por una cáscara de 4 mm, crear paredes laterales de
  transición en el modo plano ni dejar láminas/puntas en el resto.
- **Verificación:** test geométrico de parche oblicuo que compara el modo plano con
  `splitByPlane`, test de perfil 3D y revisión visual del preview contra la referencia.

### AC-004 — Cáscara superficial opcional

- **Escenario:** el usuario elige explícitamente el modo «Cáscara superficial».
- **Acción:** ajustar profundidad y separar la zona.
- **Esperado:** se crea una cáscara de la profundidad indicada y el núcleo restante;
  ambos son watertight y conservan el volumen total dentro de ±0.5 %.
- **No debe:** aplicar ese modo silenciosamente al flujo «Pieza completa».
- **Verificación:** test Manifold de cubo y prueba UI de ambos modos.

### AC-005 — Encastres aislados del corte base

- **Escenario:** existe una separación superficial válida.
- **Acción:** activar o cambiar un encastre y pedir preview.
- **Esperado:** un encastre válido produce piezas cerradas coincidentes; uno
  inválido conserva las piezas aceptadas y explica cómo ajustar las medidas.
- **No debe:** deshacer o corromper la separación base aceptada.
- **Verificación:** tests por variante y caso de error, más recorrido manual.

### AC-006 — Validación del módulo

- **Esperado:** `npm test`, `npx tsc --noEmit`, `npm run lint` y `npm run build`
  terminan correctamente.
- **Verificación:** registrar resultados en informe y auditoría.

### AC-007 — Alojamiento para imanes

- **Escenario:** hay un corte plano o una separación superficial válida.
- **Acción:** elegir «Imanes» y ajustar diámetro, profundidad, holgura y cantidad.
- **Esperado:** el preview presenta bolsillos coaxiales y enfrentados en ambas
  mitades; las piezas siguen watertight y los huecos no se exportan como piezas
  sueltas.
- **No debe:** dejar un solo lado modificado ni conservar una separación parcial
  si una cavidad falla.
- **Verificación:** tests geométricos para corte plano y superficial, diagnóstico
  watertight y chequeo de dimensiones/volumen.

### AC-008 — Colocar y quitar conectores manualmente

- **Escenario:** existe una separación válida con un plano axis-aligned o una pieza
  completa por contorno con tapa plana, y se eligió un tipo de conector.
- **Acción:** activar colocación manual y hacer clic sobre la cara de unión de una
  de las mitades; después quitar o limpiar una o más posiciones.
- **Esperado:** cada punto produce un conector y alojamiento coincidentes en ambas
  piezas. La lista permite quitar conectores individualmente y conserva los demás.
  Cambiar dimensiones recalcula el mismo conjunto de posiciones; volver a automático
  habilita la distribución existente.
- **No debe:** usar posiciones automáticas implícitas cuando el modo manual está
  vacío, modificar solo una mitad, aceptar puntos fuera de la cara útil o reemplazar
  el preview aceptado si una posición no cabe.
- **Persistencia:** las posiciones se guardan en coordenadas del modelo para que
  mover el corte no las convierta en coordenadas de pantalla.
- **Límite:** el modo manual solo se ofrece para caras planas de cortes axis-aligned
  y tapas planas de pieza completa. Tapa «Seguir forma 3D», cáscara y planos
  oblicuos mantienen la distribución automática.
- **Verificación:** tests Manifold validan ambos lados watertight y centros
  coincidentes para cada variante, rechazo atómico de una posición inválida y tests
  de interacción para agregar/quitar/cambiar a automático.
