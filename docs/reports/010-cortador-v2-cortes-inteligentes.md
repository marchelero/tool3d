# Reporte 010 — Cortador v2: corpus y gates de cortes inteligentes

## Estado

Importación y análisis del corpus están completados. Se validó un corte y export
real de Charmander vía Vitest; **la matriz completa de corte/export de los nueve
STL sigue pendiente**. La detección por pintura permanece bloqueada hasta recibir
el 3MF reexportado por el usuario.

## Entorno y método

- Windows, Node.js `v24.22.2`, npm `11.19.1`.
- Los originales en `C:\Users\Marcelo\Downloads\Pokemon+mini+Toys_stls` se
  abrieron en solo lectura. No se copiaron ni modificaron.
- `importModel` y `analyzeMesh` se ejecutaron en procesos Node separados por
  archivo. Los tiempos/RSS son mediciones locales, no un benchmark del navegador.
- La búsqueda de autointersecciones del analizador se omite por defecto para
  mallas sobre 800,000 triángulos; esa limitación se conserva explícitamente.

## Corpus STL

Todos importaron como `stl-binary`, sin warnings, conservando el número de
triángulos. El análisis encontró una componente cerrada y `cuttable=true` para los
nueve. No se hallaron bordes abiertos, aristas non-manifold, aristas inconsistentes
ni caras degeneradas.

| Archivo | Bytes | Triángulos | SHA-256 | Intersecciones / límite |
| --- | ---: | ---: | --- | --- |
| `obj_1_Pikachu mini.stl` | 10,586,884 | 211,736 | `1AB062E203CB686A1563CCA1777C4BB568B1AD42DE86691791DC5CCEA7C752EF` | 85; 16 vértices de contacto |
| `obj_2_Charmander mini.stl` | 15,154,584 | 303,090 | `EFD87C8CDAFB1C4A2C890D4DD9F6F4E4C7BEFC81A97E9D66A1ED4036B200ABDF` | 6 |
| `obj_3_Mini Bulbasaur.stl` | 70,841,684 | 1,416,832 | `237D1956F8AE5D3B885A608E278385E52C772A2AD24609C46F199209C0CDF23E` | No revisadas (>800k triángulos) |
| `obj_4_squirtle mini.stl` | 71,792,184 | 1,435,842 | `F7DCE8B42CBA05E21BC1F3D409F4F87AE8A53B4AC789A7DB476AF066DA2EF0EB` | No revisadas (>800k triángulos) |
| `obj_5_Snorlax mini.stl` | 13,449,084 | 268,980 | `34662AC61E37A0F9F39CD1A8D2F95276FD640910104AA63125BEC388E32193F5` | 12 |
| `obj_6_charizard mini.stl` | 14,599,784 | 291,994 | `23641A19D1336A5FC4A126F78A6CFF33CCDAF93671E5FD6732481CC176F16AD8` | 0; 2 vértices de contacto |
| `obj_7_Gengar mini.stl` | 70,522,784 | 1,410,454 | `A5114C2ECB87CFF265009BC6461E8C372E447A1434F3A16D9191527258789572` | No revisadas (>800k triángulos) |
| `obj_8_Mewtwo mini.stl` | 17,446,384 | 348,926 | `26FE920312A3A031638B442939ADD97DF1236374C088FDC302EC32E5677527E0` | 10 |
| `obj_9_Eevee.stl` | 14,303,684 | 286,072 | `271C2738E2F9CB10F6E6DB413AC52B360049CD9BE18F3EE6AAC8141CB62B4EC3` | 2 |

Totales: 298,697,056 bytes y 5,973,926 triángulos. El más grande es Squirtle.
Importación: 0.21–2.18 s y RSS de 155–454 MB tras la carga. Análisis: 1.7–6.2 s
y RSS aproximado de 203–454 MB.

## Mediciones de selección/perímetro en Charmander

Con una selección exploratoria formada por centroides de cara en la mitad superior
del bbox:

- `getSelectionData`: 0.71 s.
- `suggestPerimeters`: 26.18 s.
- 23 regiones en los datos de selección; el motor devolvió tres alternativas
  incluyendo el borde de selección. Una generó un perímetro autointersectado; dos
  perímetros resultaron válidos.
- Ejecución exploratoria: 28.557 s, RSS máximo observado alrededor de 312 MB.

Los 26.18 s justifican perfilar esta operación, pero todavía no justifican una
optimización concreta. No se han obtenido perfiles internos de CPU ni una medición
pareada antes/después.

## 3MF de Charmander

`paint_2_Charmander mini.3mf` (4,253,218 bytes) importa como 303,090 triángulos y
151,547 vértices, en 2.243 s y sin warnings. La malla importada no conserva
`<basematerials>`, `<colorgroup>`, grupos de textura ni referencias de propiedad
por triángulo (`pid`, `p1`, `p2`, `p3`). El ZIP contiene colores de filamento en
configuración, pero no asignación de pintura por cara. No es un fixture válido para
derivar el límite pintado de la cola. El usuario reexportará un 3MF que conserve
esa pintura.

## Gate representativo de corte/exportación: Charmander

El smoke inicial `src/lib/cutter2/charmander-corpus-smoke.test.ts` se ejecutó bajo
Vitest (50.38 s); tras el refactor cooperativo, `src/lib/cutter2/charmander-async-smoke.test.ts`
se ejecutó con `WorkerTaskContext` real (66.94 s). Ninguno usó Node CJS.

- Fuente: Charmander real, 303,090 triángulos; selección exploratoria de 106,061
  caras en la mitad superior; tres candidatos.
- `Perímetro ajustado` produjo un perímetro y separación inválidos. `Perímetro
  suave` produjo perímetro válido, separó la pieza y el preview planar fue válido;
  el commit creó dos piezas (`Parte seleccionada` y `Resto`).
- Export STL: dos archivos; ambos reimportaron como `cuttable=true` y con cero
  bordes abiertos.
- Export 3MF: un paquete con tres elementos `<object>` (los dos meshes más el
  assembly) y dos `<component>` que refieren a las piezas nombradas. El round-trip
  reimporta el mismo total de triángulos y pasa análisis de malla; el parser actual
  aplana el assembly y devuelve una componente conectada. Esto no demuestra pérdida
  de objetos en el paquete, pero sí que la identidad de subobjetos no sobrevive a
  `parse3MF`.
- El intento previo con Node CJS falló al resolver `manifold-3d` ESM; no es un fallo
  del motor ni se usa como evidencia del flujo.
- El primer smoke asíncrono detectó que un checkpoint del servicio bajaba el
  progreso de 0.99 a 0.98. Se reprodujo exactamente en el evento 1,191,241 y se
  corrigió elevando el checkpoint de preparación a 0.995. El re-run completó con
  1,191,243 eventos monótonos, llegó al commit de dos piezas y exportó dos STL de
  13,721,184 y 1,510,784 bytes, más un 3MF de 4,137,744 bytes. Las candidatas y la
  geometría se mantuvieron sin cambio.
- Una segunda revalidación incorporó checkpoints cooperativos dentro de curvatura
  y limitó las notificaciones de progreso. El smoke Vitest/Vite 1/1 pasó en
  83.88 s: 303,090 triángulos fuente, 106,061 caras seleccionadas, dos sugerencias
  más la frontera de selección, preview válido, commit de dos piezas y round-trip
  STL/3MF con conteos esperados. El progreso fue monótono, finalizó en 1 y emitió
  menos de 1,000 notificaciones (antes fueron 1,191,243). El harness local se retiró
  tras guardar evidencia para no añadir una dependencia de ruta local a la suite.

Resultado: el gate representativo `B` está validado en Charmander antes y después
del refactor cooperativo. No se ejecutó corte/export en los otros ocho modelos,
por lo que AC-001 y la matriz completa siguen pendientes. Los checkpoints y el
progreso monótono de sugerencias pasan el smoke; todavía falta cancelar desde la
UI/worker y comprobar que no se publica estado parcial.

## Pendientes

- [x] Ejecutar corte, STL y 3MF round-trip en Charmander real mediante Vitest/Vite.
- [ ] Ejecutar el flujo por cada STL viable y registrar causa/tiempo si falla.
- [ ] Perfilar `suggestPerimeters` y las fases del corte/export antes de optimizar.
- [x] Verificar progreso monótono de sugerencias en Charmander real tras el refactor.
- [x] Limitar notificaciones sin perder cancelación cooperativa; test de workload
      confirmó menos de 250 notificaciones en fixture sintético.
- [ ] Verificar cancelación desde UI/worker y conservación del estado consistente.
- [ ] Implementar y probar persistencia local IndexedDB con archivo fuente completo,
      cuando cierre el gate de corte/export.
- [ ] Implementar lote atómico y candidatos geométricos tras los gates previos.
- [ ] Reanudar AC-007 solo con el 3MF que preserva pintura por cara.

## Corrección UX: puntos de perímetro pequeño

La captura del usuario mostró 11 controles de perímetro, sobre una zona de 7,9 mm,
que no se distinguían en el paso 3. La causa era `PointsMaterial` con
`sizeAttenuation: true` (2,4 px nominales), que reducía los marcadores al alejar la
cámara. El visor ahora usa un contorno oscuro fijo de 12 px y un centro cyan de
6 px, con picking de hasta 18 px CSS. También descarta controles fuera del frustum
antes del picking.

- `src/lib/cutter2/perimeter-handle.test.ts`: 5/5 tests pasan para tamaño,
  selección por distancia y clipping.
- ESLint dirigido al visor/helper/tests: aprobado.
- Revisión independiente: APPROVE, sin hallazgos tras corregir el filtrado de
  controles detrás/fuera de cámara.
- **Límite visual:** no se pudo repetir la captura post-fix porque la pestaña del
  navegador no estaba visible. El cambio se validó con tests y revisión, no con una
  comprobación visual posterior del perímetro.
- TypeScript, ESLint y suite completa pasan: 89 tests en 16 archivos; build Next
  pasa e incluye ambas rutas. `git diff --check` no reportó errores de whitespace.
  No se capturó screenshot post-cambio porque el browser ocultó la pestaña.

## Barra estándar común (AC-009)

- Se integró `StandardModelViewerToolbar` en los visores de Cortador v2 y Posavasos,
  conservando renderers separados e interacciones locales. Incluye expandir,
  zoom, centrar, siete presets, cuadrícula, alambre y acciones extra del visor.
- Tests del componente: 2/2; suite dirigida tras integración: cinco archivos,
  12/12; TypeScript y ESLint pasan.
- Posavasos conserva `camera.up` Z-up tras construir OrbitControls; las vistas
  superior/inferior usan una inclinación de 3° para evitar el polo singular. Dos
  tests cubren eje/up no paralelo y signo de dirección en ambos polos.
- Browser Cortador v2 y Posavasos: DOM mostró los controles comunes y propios;
  expandir aplicó viewport completo, y Escape restauró el layout en ambas rutas.
  Consola sin errores. No afirmar captura visual post-integración ni inspección
  visual individual de cada acción estándar.
