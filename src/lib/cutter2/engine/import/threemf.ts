import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { IndexedMesh } from '../core/types';
import { GeometryError } from '../core/TaskContext';
import { escapeXml, localName, parseXml } from './xml';

/** Matriz afín 3×4 en orden columna: [m00 m10 m20 m01 m11 m21 m02 m12 m22 tx ty tz]. */
type Affine = Float64Array;

function identity(): Affine {
  return Float64Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
}

/** Convierte el atributo transform de 3MF (convención de vector fila) a afín. */
function parseTransform(s: string | undefined): Affine {
  if (!s) return identity();
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return identity();
  // x' = x*m00 + y*m10 + z*m20 + m30 (los índices de 3MF son fila, columna)
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22, m30, m31, m32] = v;
  // Columna j de la matriz lineal = imagen del eje j.
  return Float64Array.from([m00, m01, m02, m10, m11, m12, m20, m21, m22, m30, m31, m32]);
}

/** a ∘ b : primero b, después a. */
function compose(a: Affine, b: Affine): Affine {
  const r = new Float64Array(12);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      r[3 * col + row] = a[row] * b[3 * col] + a[3 + row] * b[3 * col + 1] + a[6 + row] * b[3 * col + 2];
    }
  }
  for (let row = 0; row < 3; row++) {
    r[9 + row] = a[row] * b[9] + a[3 + row] * b[10] + a[6 + row] * b[11] + a[9 + row];
  }
  return r;
}

function determinant(m: Affine): number {
  return (
    m[0] * (m[4] * m[8] - m[7] * m[5]) -
    m[3] * (m[1] * m[8] - m[7] * m[2]) +
    m[6] * (m[1] * m[5] - m[4] * m[2])
  );
}

const UNIT_SCALE: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

interface ObjectDef {
  id: string;
  name?: string;
  vertices?: Float64Array;
  triangles?: Uint32Array;
  components: Array<{ objectId: string; transform: Affine; path?: string }>;
}

interface ModelFile {
  unitScale: number;
  objects: Map<string, ObjectDef>;
  build: Array<{ objectId: string; transform: Affine; path?: string }>;
}

function parseModelFile(xml: string): ModelFile {
  const objects = new Map<string, ObjectDef>();
  const build: ModelFile['build'] = [];
  let unitScale = 1;
  let current: ObjectDef | null = null;
  let verts: number[] = [];
  let tris: number[] = [];
  let inBuild = false;
  parseXml(xml, {
    open(rawName, a) {
      const name = localName(rawName);
      switch (name) {
        case 'model':
          unitScale = UNIT_SCALE[(a.unit ?? 'millimeter').toLowerCase()] ?? 1;
          break;
        case 'object':
          current = { id: a.id, name: a.name, components: [] };
          verts = [];
          tris = [];
          break;
        case 'vertex':
          verts.push(+a.x, +a.y, +a.z);
          break;
        case 'triangle':
          tris.push(+a.v1, +a.v2, +a.v3);
          break;
        case 'component':
          if (current) {
            const path = a['p:path'] ?? Object.entries(a).find(([k]) => localName(k) === 'path')?.[1];
            current.components.push({ objectId: a.objectid, transform: parseTransform(a.transform), path });
          }
          break;
        case 'build':
          inBuild = true;
          break;
        case 'item':
          if (inBuild) {
            const path = a['p:path'] ?? Object.entries(a).find(([k]) => localName(k) === 'path')?.[1];
            build.push({ objectId: a.objectid, transform: parseTransform(a.transform), path });
          }
          break;
      }
    },
    close(rawName) {
      const name = localName(rawName);
      if (name === 'object' && current) {
        const obj: ObjectDef = current;
        if (verts.length) obj.vertices = Float64Array.from(verts);
        if (tris.length) obj.triangles = Uint32Array.from(tris);
        objects.set(obj.id, obj);
        current = null;
      } else if (name === 'build') {
        inBuild = false;
      }
    },
  });
  return { unitScale, objects, build };
}

export interface Parsed3MF {
  soup: Float64Array;
  triangleCount: number;
  objectNames: string[];
  warnings: string[];
}

function normPath(p: string): string {
  return p.replace(/^\//, '');
}

/** Lee un 3MF (núcleo + extensión de producción, compatible con Bambu Studio). */
export function parse3MF(buffer: ArrayBuffer): Parsed3MF {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new GeometryError('El archivo 3MF no es un ZIP válido.', '3mf-zip');
  }
  const warnings: string[] = [];
  let rootPath = '3D/3dmodel.model';
  const rels = files['_rels/.rels'];
  if (rels) {
    parseXml(strFromU8(rels), {
      open(name, a) {
        if (localName(name) === 'Relationship' && (a.Type ?? '').endsWith('/3dmodel')) rootPath = normPath(a.Target);
      },
    });
  }
  const lowerMap = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
  const cache = new Map<string, ModelFile>();
  const loadModel = (path: string): ModelFile => {
    const key = normPath(path);
    let m = cache.get(key);
    if (m) return m;
    const real = files[key] ? key : lowerMap.get(key.toLowerCase());
    if (!real) throw new GeometryError(`El 3MF hace referencia a un archivo inexistente: ${path}`, '3mf-missing', path);
    m = parseModelFile(strFromU8(files[real]));
    cache.set(key, m);
    return m;
  };

  const root = loadModel(rootPath);
  const soup: number[] = [];
  const objectNames: string[] = [];

  const emit = (filePath: string, objectId: string, transform: Affine, depth: number) => {
    if (depth > 16) {
      warnings.push('Se ignoró una referencia circular o demasiado profunda en el 3MF.');
      return;
    }
    const file = loadModel(filePath);
    const obj = file.objects.get(objectId);
    if (!obj) {
      warnings.push(`Objeto ${objectId} no encontrado en ${filePath}.`);
      return;
    }
    const scale = file.unitScale;
    if (obj.vertices && obj.triangles) {
      if (obj.name) objectNames.push(obj.name);
      const V = obj.vertices;
      const T = obj.triangles;
      const flip = determinant(transform) < 0;
      const nV = V.length / 3;
      for (let t = 0; t < T.length / 3; t++) {
        const ids = flip ? [T[3 * t], T[3 * t + 2], T[3 * t + 1]] : [T[3 * t], T[3 * t + 1], T[3 * t + 2]];
        if (ids.some((v) => v >= nV)) {
          warnings.push('Se descartó un triángulo con índices fuera de rango.');
          continue;
        }
        for (const v of ids) {
          const x = V[3 * v] * scale, y = V[3 * v + 1] * scale, z = V[3 * v + 2] * scale;
          soup.push(
            transform[0] * x + transform[3] * y + transform[6] * z + transform[9],
            transform[1] * x + transform[4] * y + transform[7] * z + transform[10],
            transform[2] * x + transform[5] * y + transform[8] * z + transform[11],
          );
        }
      }
    }
    for (const c of obj.components) {
      // La traslación del componente está en las unidades del archivo.
      const ct = Float64Array.from(c.transform);
      ct[9] *= scale;
      ct[10] *= scale;
      ct[11] *= scale;
      emit(c.path ? normPath(c.path) : filePath, c.objectId, compose(transform, ct), depth + 1);
    }
  };

  for (const item of root.build) {
    const t = Float64Array.from(item.transform);
    t[9] *= root.unitScale;
    t[10] *= root.unitScale;
    t[11] *= root.unitScale;
    emit(item.path ? normPath(item.path) : rootPath, item.objectId, t, 0);
  }
  if (soup.length === 0) throw new GeometryError('El 3MF no contiene mallas imprimibles.', '3mf-empty');
  return { soup: Float64Array.from(soup), triangleCount: soup.length / 9, objectNames, warnings };
}

export interface ThreeMFPart {
  name: string;
  mesh: IndexedMesh;
  /** Color #RRGGBB */
  color: string;
  offset?: [number, number, number];
}

function fmt(x: number): string {
  const s = Math.fround(x).toPrecision(9);
  return String(Number(s));
}

/**
 * Escribe un 3MF con cada pieza como objeto independiente y un objeto
 * "ensamble" que las agrupa como partes de un solo modelo (Bambu Studio las
 * abre como partes a las que se les asigna un filamento distinto).
 */
export function write3MF(parts: ThreeMFPart[], options: { assembly: boolean; title?: string }): Uint8Array {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<model unit="millimeter" xml:lang="es-AR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">');
  out.push('<metadata name="Application">STL Color Splitter 2.0</metadata>');
  if (options.title) out.push(`<metadata name="Title">${escapeXml(options.title)}</metadata>`);
  out.push('<resources>');
  out.push('<basematerials id="1">');
  for (const p of parts) out.push(`<base name="${escapeXml(p.name)}" displaycolor="${p.color.toUpperCase()}FF"/>`);
  out.push('</basematerials>');
  parts.forEach((p, i) => {
    const id = i + 2;
    out.push(`<object id="${id}" name="${escapeXml(p.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>`);
    const P = p.mesh.positions;
    const ox = p.offset?.[0] ?? 0, oy = p.offset?.[1] ?? 0, oz = p.offset?.[2] ?? 0;
    const chunk: string[] = [];
    for (let v = 0; v < P.length / 3; v++) {
      chunk.push(`<vertex x="${fmt(P[3 * v] + ox)}" y="${fmt(P[3 * v + 1] + oy)}" z="${fmt(P[3 * v + 2] + oz)}"/>`);
    }
    out.push(chunk.join(''));
    out.push('</vertices><triangles>');
    const I = p.mesh.indices;
    const tchunk: string[] = [];
    for (let t = 0; t < I.length / 3; t++) tchunk.push(`<triangle v1="${I[3 * t]}" v2="${I[3 * t + 1]}" v3="${I[3 * t + 2]}"/>`);
    out.push(tchunk.join(''));
    out.push('</triangles></mesh></object>');
  });
  const assemblyId = parts.length + 2;
  if (options.assembly) {
    out.push(`<object id="${assemblyId}" name="${escapeXml(options.title ?? 'Ensamble')}" type="model"><components>`);
    parts.forEach((_, i) => out.push(`<component objectid="${i + 2}"/>`));
    out.push('</components></object>');
  }
  out.push('</resources><build>');
  if (options.assembly) out.push(`<item objectid="${assemblyId}"/>`);
  else parts.forEach((_, i) => out.push(`<item objectid="${i + 2}"/>`));
  out.push('</build></model>');

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>';
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(out.join('\n')),
  });
}
