# PRD 003 — Módulo Texturizador STL

## 1. Contexto

La app ya resuelve imagen, posavasos y llaveros. Falta una herramienta para tomar
un modelo STL existente y agregarle una **textura física** (desplazamiento real de
la superficie) antes de imprimirlo.

Referencia: [CNCKitchen/stlTexturizer](https://github.com/CNCKitchen/stlTexturizer)
(BumpMesh). Es un producto muy completo: 101 texturas, proyecciones múltiples,
capas, máscaras pintadas, proyectos y exportadores. No conviene intentar copiarlo
entero de una vez.

La propuesta es un módulo propio, en español, client-side y con la misma línea
visual que Imagen/Posavasos/Llavero, empezando por un MVP sólido y ampliándolo
por fases.

**Nombre propuesto:** `Texturizador`  
**Slug propuesto:** `texturizador`  
**Categoría:** 3D

## 2. Objetivo

Permitir que un usuario cargue un STL, elija una textura, ajuste proyección,
escala, profundidad y máscara, vea el resultado en 3D y exporte un STL nuevo con
la geometría desplazada, todo sin subir el archivo a ningún servidor.

## 3. Usuarios y casos de uso

- Quien quiere dar agarre a una pieza impresa (textura de diamante, panal, etc.).
- Quien quiere un acabado decorativo (madera, tela, ondas, escamas).
- Quien quiere texturizar solo una cara o excluir la base de apoyo.
- Quien tiene un STL de un cliente/proveedor y no quiere compartirlo.
- Quien necesita un STL final, no una imagen ni un mapa de normales.

## 4. Alcance del MVP (Fase 1)

### 4.1 Importación y visor (must)

- Cargar STL binario o ASCII por botón y por drag & drop.
- Validar: archivo no vacío, triángulos finitos, al menos 1 triángulo.
- Mostrar nombre, número de triángulos, dimensiones en mm y peso del archivo.
- Visor Three.js con órbita, zoom, paneo, encuadre automático y grilla.
- Mostrar el modelo original mientras no haya textura aplicada.
- Barra de estado con progreso durante subdivisión/desplazamiento.
- Botón "Nuevo" para limpiar el proyecto.

### 4.2 Texturas (must)

- Galería de texturas procedurales seamless, con miniatura y estado seleccionado.
- Set inicial de 12: cuadrícula, ladrillo, puntos, panal, escamas, ondas,
  rayas, trama, diamante/knurl, ruido, chevron y carbono.
- Selector de textura + botón "Quitar textura".
- Mapa personalizado: subir PNG/JPG/WebP como mapa de desplazamiento.
- Vista previa de la textura elegida y su tamaño.
- Las texturas se generan localmente; no se descargan assets externos.

### 4.3 Proyección y transformación (must)

- Modos: **Triplanar**, **Plano XY**, **Plano XZ**, **Plano YZ**.
- Escala U y V, con opción de bloquear proporción.
- Desplazamiento U y V.
- Rotación de la textura (0–360°).
- La proyección debe funcionar en modelos sin UVs (STL no trae UVs).

### 4.4 Desplazamiento (must)

- Amplitud en mm o porcentaje del tamaño del modelo.
- Modo **simétrico** (gris medio neutro, blanco hacia afuera, negro hacia
  adentro) y modo **solo outward**.
- Suavizado del mapa (0–1) para reducir aliasing.
- Interruptor "Vista previa 3D" para comparar geometría real vs. aproximación.
- Aviso si la amplitud supera el 10% de la dimensión menor.
- Botón "Restablecer textura" (no borra el modelo).

### 4.5 Resolución y subdivisión (must)

- Control de resolución de malla (mm de arista objetivo).
- Subdivisión uniforme/adaptativa con vértices compartidos para no generar
  grietas en la malla.
- Presupuesto máximo de triángulos para evitar bloquear el navegador.
- Indicador de triángulos de entrada, triángulos de salida y memoria estimada.
- La exportación puede usar una resolución mayor que la vista previa.

### 4.6 Máscara (must en versión básica)

- **Incluir todo** / **Excluir**.
- Máscara por ángulo: caras superiores e inferiores con umbral configurable.
- Botón "Excluir base" para no texturizar la cara de apoyo.
- La máscara debe ser continua en los bordes (sin desgarrar la malla).
- El pintado con pincel/relleno queda para Fase 3.

### 4.7 Exportación (must)

- Exportar **STL binario** con la geometría desplazada.
- Conservar unidades y orientación del STL original.
- Nombre de archivo basado en el original + sufijo `-texturizado`.
- Mostrar peso estimado y cantidad de triángulos antes de exportar.
- Si no hay textura aplicada, permitir exportar el original sin cambios.

### 4.8 Fuera de alcance del MVP

- OBJ, 3MF, STEP.
- Texturas multicapa.
- Pincel/relleno de máscara.
- Proyección cilíndrica, esférica y cúbica con mezcla de costuras.
- Guardar/cargar proyecto, undo/redo global, historial.
- Biblioteca de 101 texturas.
- Edición de la malla (cortes, soportes, reparación).

## 5. Fases

### Fase 1 — MVP usable
STL + visor + 12 texturas + mapa custom + triplanar/planos + escala/offset/
rotación + amplitud/simétrico/suavizado + máscara por ángulo + STL export.

### Fase 2 — Calidad y proyecciones
Cúbica/cilíndrica/esférica, mezcla de costuras, texturas categorizadas,
favoritos, más patrones, comparación antes/después, presets de agarre/acabado.

### Fase 3 — Editor avanzado
Máscara pintada con pincel/relleno, capas de textura, undo/redo, proyectos
`.tool3d`, 3MF/OBJ/STEP.

## 6. Arquitectura propuesta

```
src/app/tools/texturizador/page.tsx
src/components/tools/texturizador/
  texturizer-tool.tsx        # estado, orquestación, panel
  texturizer-viewer.tsx      # Three.js: escena, cámara, grilla, malla
  texture-gallery.tsx        # galería y miniaturas
src/lib/texturizer/
  types.ts                   # TexturizerSettings, TextureId, MaskSettings
  load-stl.ts                # STLLoader + normalización + stats
  subdivide.ts               # subdivisión watertight con vértices compartidos
  textures.ts                # patrones procedurales + muestreo + thumbs
  displace.ts                # proyección, máscara, desplazamiento
  export-stl.ts              # STL binario
  worker.ts                  # procesamiento pesado (subdividir/desplazar)
```

- UI: reutilizar `PanelTooltips`, `PanelSection`, `SegmentedControl`,
  `Slider`, `ToggleButton`, `Field`, `Hint`, `GroupLabel`.
- Estado local del componente; sin backend ni persistencia en Fase 1.
- Procesamiento en Web Worker con buffers transferibles.
- Motor puro separado de React para poder probarlo con Node.

## 7. Requisitos no funcionales

- **Privacidad:** archivos y texturas se procesan en el navegador. Sin uploads.
- **Rendimiento:** no bloquear la UI; progreso visible; límite de triángulos;
  cancelar procesamiento si el usuario cambia de configuración.
- **Robustez:** STL no manifold no debe romper la app; avisar si hay bordes
  abiertos. La subdivisión no debe introducir nuevas grietas.
- **Accesibilidad:** labels, foco visible, `aria-pressed` en galería, texto
  alternativo para el visor, contraste AA.
- **Sin secretos:** no hay claves ni servicios externos.
- **Compatibilidad:** Chrome/Edge/Firefox/Safari actuales; WebGL2.

## 8. Criterios de aceptación

### AC-001: Importar STL
- **Escenario:** usuario sin modelo.
- **Acción:** suelta un STL binario válido.
- **Esperado:** se muestra el modelo, triángulos y dimensiones; se puede orbitar.
- **No debe:** subir el archivo a la red ni recargar la página.
- **Verificación:** prueba manual + Network vacío + `npm run build`.

### AC-002: Aplicar textura
- **Escenario:** STL cargado.
- **Acción:** elige "Panal", amplitud 0.6 mm, triplanar.
- **Esperado:** la superficie cambia y se distinguen las celdas; el estado de la
  textura queda seleccionado.
- **Verificación:** inspección visual + captura antes/después.

### AC-003: Transformar textura
- **Escenario:** textura aplicada.
- **Acción:** cambia escala, offset y rotación.
- **Esperado:** el patrón se mueve/escala/rota sin romper la malla.
- **Verificación:** inspección visual + valores restaurados con "Restablecer".

### AC-004: Desplazamiento
- **Escenario:** textura con amplitud > 0.
- **Acción:** activa/desactiva simétrico.
- **Esperado:** simétrico empuja hacia adentro y afuera; desactivado solo hacia
  afuera. Amplitud 0 deja la geometría sin cambios visibles.
- **Verificación:** comparación de bounds y vista 3D.

### AC-005: Máscara por ángulo
- **Escenario:** cubo cargado.
- **Acción:** activa "Excluir base" y ajusta el ángulo.
- **Esperado:** la base no se texturiza y el resto sí; no aparecen agujeros.
- **Verificación:** inspección visual + chequeo de bordes abiertos.

### AC-006: Exportar STL
- **Escenario:** textura aplicada.
- **Acción:** presiona "Exportar STL".
- **Esperado:** descarga un STL que se vuelve a abrir con las mismas dimensiones
  y con el relieve visible.
- **No debe:** exportar la malla de vista previa (baja resolución) si se eligió alta.
- **Verificación:** reimportar el STL en la app / visor externo + comparar bounds.

### AC-007: Archivo inválido
- **Escenario:** usuario carga un archivo que no es STL.
- **Acción:** suelta el archivo.
- **Esperado:** mensaje de error claro; el modelo anterior no se destruye.
- **Verificación:** prueba manual con `.txt` y STL corrupto.

### AC-008: Rendimiento
- **Escenario:** STL de ~250k triángulos, resolución media.
- **Acción:** aplicar textura.
- **Esperado:** la UI sigue respondiendo y muestra progreso; no se supera el
  presupuesto de triángulos configurado.
- **Verificación:** medición manual + contador de triángulos.

### AC-009: Validación del repo
- **Acción:** ejecutar `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- **Esperado:** los tres pasan.
- **Verificación:** salida de consola.

## 9. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Explosión de triángulos | Navegador bloqueado / OOM | Presupuesto duro, worker, preview decimado |
| Grietas por subdivisión | STL no imprimible | Vértices de arista compartidos + test de bordes |
| STL no manifold | Resultado inválido | Diagnóstico y aviso; no prometer reparación |
| Modelos muy grandes | Carga lenta | Límite de archivo, procesamiento incremental, cancelar |
| Costuras de proyección | Textura visiblemente cortada | Triplanar ponderado; fases 2 para cubic/cyl |
| Máscara dura | Degradado/desgarro | Peso por vértice continuo; bordes suaves |
| Memoria de texturas | Crash en móvil | Tiles 256/512 px, cache acotado, liberar al cambiar |

## 10. Decisiones propuestas

1. Nombre **Texturizador**, slug `texturizador`.
2. Fase 1 solo STL; 3MF/OBJ después.
3. Texturas procedurales locales + mapa custom; sin assets remotos.
4. Proyección triplanar como default; planos XY/XZ/YZ en Fase 1.
5. Desplazamiento por vértice en CPU dentro de un Worker.
6. Export STL binario; 3MF en Fase 3.
7. Máscara por ángulo en Fase 1; pincel en Fase 3.

## 11. Métricas de éxito

- Un usuario puede cargar un STL, texturizarlo y descargar un STL válido sin
  instrucciones externas.
- El STL exportado se abre en Bambu Studio/Orca/Cura sin reparaciones.
- La app sigue siendo client-side y no agrega backend.
- Tiempo de aplicación de textura < 5 s para 250k triángulos en desktop.

## 12. Preguntas abiertas

- ¿El nombre "Texturizador" es el definitivo?
- ¿La Fase 1 debe incluir mapa custom desde el inicio o dejarlo para Fase 2?
- ¿Se prioriza máscara por ángulo o pincel?
- ¿Se necesita 3MF desde la primera versión?
