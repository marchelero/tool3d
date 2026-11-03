import { zipSync, strToU8 } from 'fflate';
import type { IndexedMesh, Vec3 } from '../core/types';
import { computeBBox } from '../core/geometry';
import { writeBinarySTL } from '../import/stl';
import { write3MF } from '../import/threemf';

export type ExportFormat = 'stl' | 'zip' | '3mf';
export type Placement = 'original' | 'print';

export interface ExportPiece {
  name: string;
  mesh: IndexedMesh;
  color: string;
  /** Dirección (exterior) de la cara que conviene apoyar en la cama. */
  downDirection?: Vec3 | null;
}

export interface ExportOptions {
  format: ExportFormat;
  placement: Placement;
  baseName: string;
}

export interface ExportFile {
  name: string;
  data: Uint8Array;
  mime: string;
}

/** Nombre de archivo seguro conservando tildes y espacios legibles. */
export function safeFileName(name: string): string {
  const s = name.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  return s || 'pieza';
}

/** Rotación (matriz 3×3 por filas) que lleva el vector unitario a hacia b. */
function rotationBetween(a: Vec3, b: Vec3): number[] {
  const [ax, ay, az] = a;
  const [bx, by, bz] = b;
  const vx = ay * bz - az * by, vy = az * bx - ax * bz, vz = ax * by - ay * bx;
  const c = ax * bx + ay * by + az * bz;
  if (c < -0.999999) {
    // 180°: rotar alrededor de un eje perpendicular cualquiera
    const p: Vec3 = Math.abs(ax) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let ux = ay * p[2] - az * p[1], uy = az * p[0] - ax * p[2], uz = ax * p[1] - ay * p[0];
    const l = Math.hypot(ux, uy, uz);
    ux /= l; uy /= l; uz /= l;
    return [2 * ux * ux - 1, 2 * ux * uy, 2 * ux * uz, 2 * uy * ux, 2 * uy * uy - 1, 2 * uy * uz, 2 * uz * ux, 2 * uz * uy, 2 * uz * uz - 1];
  }
  const k = 1 / (1 + c);
  return [
    vx * vx * k + c, vx * vy * k - vz, vx * vz * k + vy,
    vy * vx * k + vz, vy * vy * k + c, vy * vz * k - vx,
    vz * vx * k - vy, vz * vy * k + vx, vz * vz * k + c,
  ];
}

/** Coloca una pieza en posición de impresión: cara de unión abajo, apoyada en z = 0, centrada. */
export function toPrintPlacement(piece: ExportPiece): IndexedMesh {
  const P = piece.mesh.positions;
  const out = new Float64Array(P.length);
  const R = piece.downDirection ? rotationBetween(piece.downDirection, [0, 0, -1]) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  const b = computeBBox(out);
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= cx;
    out[i + 1] -= cy;
    out[i + 2] -= b.min[2];
  }
  return { positions: out, indices: piece.mesh.indices };
}

/** Distribuye piezas en la cama (posición de impresión) sin superponerlas. */
function arrange(meshes: IndexedMesh[], gap = 8): IndexedMesh[] {
  let x = 0;
  const boxes = meshes.map((m) => computeBBox(m.positions));
  const total = boxes.reduce((s, b) => s + (b.max[0] - b.min[0]) + gap, -gap);
  x = -total / 2;
  return meshes.map((m, i) => {
    const b = boxes[i];
    const w = b.max[0] - b.min[0];
    const dx = x - b.min[0];
    x += w + gap;
    const pos = Float64Array.from(m.positions);
    for (let k = 0; k < pos.length; k += 3) pos[k] += dx;
    return { positions: pos, indices: m.indices };
  });
}

/**
 * ExportManager: STL por pieza, ZIP con todas, o 3MF con piezas nombradas y
 * coloreadas. En posición original las piezas conservan sus coordenadas
 * (ensamblan solas en Bambu Studio); en posición de impresión se apoyan en
 * la cama por su cara de unión.
 */
export function exportPieces(pieces: ExportPiece[], opts: ExportOptions): ExportFile[] {
  const meshes =
    opts.placement === 'print' ? arrange(pieces.map((p) => toPrintPlacement(p))) : pieces.map((p) => p.mesh);
  const names = uniqueNames(pieces.map((p) => safeFileName(p.name)));
  const base = safeFileName(opts.baseName);
  if (opts.format === '3mf') {
    const data = write3MF(
      pieces.map((p, i) => ({ name: names[i], mesh: meshes[i], color: p.color })),
      { assembly: opts.placement === 'original', title: base },
    );
    return [{ name: `${base}.3mf`, data, mime: 'model/3mf' }];
  }
  const stls = pieces.map((p, i) => ({
    name: `${base} - ${names[i]}.stl`,
    data: new Uint8Array(writeBinarySTL(meshes[i], `${base} - ${p.name}`.slice(0, 79))),
    mime: 'model/stl',
  }));
  if (opts.format === 'stl') return stls;
  const entries: Record<string, Uint8Array> = {};
  for (const f of stls) entries[f.name] = f.data;
  entries['LEEME.txt'] = strToU8(
    [
      `${base} — piezas generadas con STL Color Splitter 2.0`,
      '',
      opts.placement === 'original'
        ? 'Las piezas conservan sus coordenadas originales: importalas juntas en Bambu Studio y quedan ensambladas.'
        : 'Las piezas están orientadas para imprimir, con la cara de unión apoyada en la cama.',
      '',
      ...pieces.map((p, i) => `- ${names[i]} (${p.mesh.indices.length / 3} triángulos)`),
      '',
    ].join('\n'),
  );
  return [{ name: `${base}.zip`, data: zipSync(entries, { level: 6 }), mime: 'application/zip' }];
}

function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    return c ? `${n} (${c + 1})` : n;
  });
}
