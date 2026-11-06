# Plan 009 — Mejoras de UX y rendimiento de Cortador v2

## Objetivo

Pulir `cortador-v2` en dos frentes: alinear la disposición visual con los módulos
Llavero y Posavasos —visor a la izquierda, controles a la derecha— y reducir
trabajo de renderizado innecesario al inspeccionar mallas grandes. Mantener intacto
el motor v2 y no modificar el Cortador v1.

## Alcance

- Reorganizar el shell de la herramienta para ubicar controles a la derecha en
  escritorio y el visor antes del panel en pantallas angostas.
- Conservar el asistente de seis pasos, la navegación, los controles fijos al pie
  del panel y el visor 3D a pantalla amplia.
- Hacer el render de Three.js bajo demanda, incluyendo interacciones con cámara,
  puntero, cambios de geometría/colores y redimensionado; evitar un ciclo de 60 FPS
  cuando la escena está quieta.
- Evitar subir de nuevo el buffer de colores cuando la máscara no cambió y
  reconstruir la geometría cuando cambian los buffers fuente, aunque el conteo de
  triángulos sea igual.
- Limitar la resolución del canvas para reducir carga de GPU en modelos grandes.
- Mejorar semántica accesible del stepper, deshacer/rehacer y el indicador de tarea.
- Mostrar en modo pincel un indicador visual con el diámetro actual al mover el
  puntero sobre la pieza, sin exigir un clic.

## Fuera de alcance

- Cambios a `src/lib/cutter2/engine/**`, protocolos/worker o algoritmo de corte.
- Cambios a `src/lib/cutter/**` y `src/components/tools/cortador/**` (Cortador v1).
- Funcionalidad nueva de reparación, selección, perímetros, encastres o exportación.
- Cambios globales de diseño que afecten a Llavero o Posavasos.

## Criterios de aceptación

### AC-001 — Disposición consistente

- **Escenario:** se abre `/tools/cortador-v2` en escritorio y móvil.
- **Acción:** se inspecciona el orden de visor, pasos y controles.
- **Esperado:** el visor ocupa la columna izquierda y el panel de pasos queda a la
  derecha en escritorio; en móvil el visor aparece primero y los controles se
  desplazan en su propio panel sin desbordar horizontalmente.
- **No debe:** perder el footer de acciones, el stepper ni recortar los controles.
- **Verificación:** inspección de layout responsive y recorrido en navegador.

### AC-002 — Interacciones 3D completas

- **Escenario:** hay un modelo cargado y se navega, selecciona, pinta o edita un
  perímetro.
- **Acción:** se usa órbita/zoom, vistas predefinidas, selección y edición.
- **Esperado:** toda mutación visible invalida y dibuja el visor; la cámara sigue
  respondiendo con amortiguación y los cambios de geometría se reflejan incluso si
  el nuevo modelo tiene el mismo número de triángulos.
- **No debe:** dejar el canvas congelado o usar geometría anterior.
- **Verificación:** recorrido manual en navegador con selección, drag, vista y
  geometría actualizada.

### AC-003 — Menos trabajo cuando la vista está quieta

- **Escenario:** la escena no recibe entrada ni cambios de props.
- **Acción:** se espera a que termine cualquier amortiguación de cámara.
- **Esperado:** no continúa un ciclo perpetuo de renderizado; un cambio visual
  vuelve a dibujar la escena. Los buffers de color solo se marcan para subida cuando
  realmente cambió al menos una cara.
- **Verificación:** inspección del scheduler del visor, lint/typecheck/build y
  prueba de interacción.

### AC-004 — Integridad del flujo

- **Escenario:** se importa un STL/3MF, se realiza corte, encastre y exportación.
- **Acción:** se navega con los controles laterales y se cambia de tamaño de
  ventana.
- **Esperado:** el flujo existente sigue disponible y el progreso/tarea se anuncia
  semánticamente.
- **Verificación:** tests existentes, typecheck, lint, build y recorrido E2E si el
  navegador está disponible.

### AC-005 — Previsualización del pincel

- **Escenario:** hay una pieza cargada en el paso 2 y está activo Pincel + o
  Pincel −.
- **Acción:** se mueve el puntero sobre la superficie, se lo saca del visor y se
  cambia a Varita.
- **Esperado:** aparece sobre la superficie un círculo que representa el radio
  actual del pincel sin hacer clic; el tamaño sigue el control de radio.
- **No debe:** pintar ni cambiar la selección por el mero movimiento; el indicador
  desaparece al salir de la pieza/visor o al cambiar a Varita.
- **Verificación:** recorrido en navegador con un STL, inspección visual del
  indicador durante hover y ausencia tras pointer-leave/cambio de herramienta.

## Restricciones preservadas

- Todo el cómputo sigue local y en Web Worker como antes.
- No introducir dependencias ni tocar `package.json`.
- No modificar módulos v1 ni regenerar el motor recuperado.
