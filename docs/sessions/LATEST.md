# Sesión actual

Estado: **cortador-v2 verificado en navegador con Charmander real**:
carga/selección, dos regiones con Ctrl+clic, perímetro válido, corte,
encastre y exportación ZIP en posición original. Sin commits nuevos.

Documento de continuidad: `docs/sessions/2026-10-30-cortador-v2.md`

- Módulo nuevo en `/tools/cortador-v2` (motor portado de corto.com.ar en
  `src/lib/cutter2/`), v1 intacto.
- `tsc`, `eslint` V2 (0 errores, 0 warnings), 67 tests y `next build` OK.
- Corregidos los 3 bugs reportados (grilla/anillos, moteado de selección,
  perímetro inválido) y la línea del perímetro que no se dibujaba.
- Paridad añadida: editor de perímetros múltiples, Expandir/Contraer y defaults
  de sensibilidad, imán, suavizado y exportación alineados con el original.
- Un caso que genera más de un loop independiente requiere un modelo específico
  para verificación E2E adicional.
