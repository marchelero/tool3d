import type { IndexedMesh } from '../core/types';
import { GeometryError } from '../core/TaskContext';

export interface ParsedSTL {
  format: 'binary' | 'ascii';
  soup: Float32Array;
  triangleCount: number;
  warnings: string[];
}

function looksAscii(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).trimStart().toLowerCase();
  if (!head.startsWith('solid')) return false;
  const probe = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))).toLowerCase();
  return probe.includes('facet') || probe.includes('vertex') || probe.includes('endsolid');
}

/** Lee STL binario o ASCII. Devuelve una sopa de triángulos (9 floats por triángulo). */
export function parseSTL(buffer: ArrayBuffer): ParsedSTL {
  const bytes = new Uint8Array(buffer);
  const warnings: string[] = [];
  if (bytes.length >= 84) {
    const dv = new DataView(buffer);
    const n = dv.getUint32(80, true);
    const expected = 84 + 50 * n;
    if (expected === bytes.length || (!looksAscii(bytes) && expected <= bytes.length && n > 0)) {
      if (expected !== bytes.length) warnings.push('El archivo STL binario tiene datos sobrantes al final; se ignoraron.');
      const soup = new Float32Array(n * 9);
      let o = 84;
      for (let t = 0; t < n; t++) {
        o += 12; // normal
        for (let k = 0; k < 9; k++) {
          soup[9 * t + k] = dv.getFloat32(o, true);
          o += 4;
        }
        o += 2; // atributo
      }
      return { format: 'binary', soup, triangleCount: n, warnings };
    }
  }
  if (!looksAscii(bytes)) {
    throw new GeometryError('El archivo no parece un STL válido.', 'stl-invalid', `bytes=${bytes.length}`);
  }
  const text = new TextDecoder().decode(bytes);
  const re = /vertex\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const values: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    values.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  if (values.length % 9 !== 0) {
    warnings.push('El STL ASCII tiene una faceta incompleta; se descartó.');
    values.length -= values.length % 9;
  }
  if (values.length === 0) throw new GeometryError('El STL ASCII no contiene triángulos.', 'stl-empty');
  return { format: 'ascii', soup: Float32Array.from(values), triangleCount: values.length / 9, warnings };
}

/** Escribe un STL binario. Las normales se calculan por cara. */
export function writeBinarySTL(mesh: IndexedMesh, name = 'STL Color Splitter 2.0', offset?: [number, number, number]): ArrayBuffer {
  const { positions: P, indices: I } = mesh;
  const nT = I.length / 3;
  const buffer = new ArrayBuffer(84 + 50 * nT);
  const dv = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buffer, 0, 80).set(header);
  dv.setUint32(80, nT, true);
  let o = 84;
  const ox = offset?.[0] ?? 0, oy = offset?.[1] ?? 0, oz = offset?.[2] ?? 0;
  for (let t = 0; t < nT; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, P[v] + ox, true);
      dv.setFloat32(o + 4, P[v + 1] + oy, true);
      dv.setFloat32(o + 8, P[v + 2] + oz, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}

/** Escribe un STL ASCII (útil para pruebas y archivos de ejemplo). */
export function writeAsciiSTL(mesh: IndexedMesh, name = 'model'): string {
  const { positions: P, indices: I } = mesh;
  const lines: string[] = [`solid ${name}`];
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[3 * t] * 3, b = I[3 * t + 1] * 3, c = I[3 * t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    lines.push(`  facet normal ${nx} ${ny} ${nz}`, '    outer loop');
    for (const v of [a, b, c]) lines.push(`      vertex ${P[v]} ${P[v + 1]} ${P[v + 2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return lines.join('\n');
}
