import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import { GeometryError } from '../core/TaskContext';
import { distanceToPolyline, pointInPolygon } from './polygon2d';

export interface DomainMesh {
  /** Coordenadas 2D: primero los n puntos del borde (mismo orden), luego interiores. */
  X: Float64Array;
  Y: Float64Array;
  /** Triángulos CCW en el dominio. */
  tris: Uint32Array;
  boundaryCount: number;
}

/**
 * Triangulación de calidad de un polígono simple: puntos interiores en red
 * triangular + Delaunay restringido (Delaunator + Constrainautor), con el
 * borde exacto como restricción. Nunca usa abanicos desde un centro.
 */
export function triangulateDomain(
  bx: Float64Array,
  by: Float64Array,
  spacing: number,
  maxInterior = 60000,
  extra: Array<[number, number]> = [],
): DomainMesh {
  const n = bx.length;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    minx = Math.min(minx, bx[i]); maxx = Math.max(maxx, bx[i]);
    miny = Math.min(miny, by[i]); maxy = Math.max(maxy, by[i]);
    const j = (i + 1) % n;
    area2 += bx[i] * by[j] - bx[j] * by[i];
  }
  if (area2 <= 0) throw new GeometryError('El contorno del corte está invertido o es nulo.', 'domain-orientation');
  const area = area2 / 2;
  let h = spacing;
  const cellArea = (Math.sqrt(3) / 2) * h * h;
  if (area / cellArea > maxInterior) h = Math.sqrt(area / maxInterior / (Math.sqrt(3) / 2));

  const xs: number[] = Array.from(bx);
  const ys: number[] = Array.from(by);
  for (const [ex, ey] of extra) {
    xs.push(ex);
    ys.push(ey);
  }
  const nearExtra = (x: number, y: number) => extra.some(([ex, ey]) => Math.hypot(x - ex, y - ey) < 0.45 * h);
  const dy = (Math.sqrt(3) / 2) * h;
  let row = 0;
  for (let y = miny + dy / 2; y < maxy; y += dy, row++) {
    const off = row % 2 ? h / 2 : 0;
    for (let x = minx + off + h / 4; x < maxx; x += h) {
      if (!pointInPolygon(x, y, bx, by)) continue;
      if (distanceToPolyline(x, y, bx, by) < 0.55 * h) continue;
      if (extra.length && nearExtra(x, y)) continue;
      xs.push(x);
      ys.push(y);
    }
  }
  const coords = new Float64Array(xs.length * 2);
  for (let i = 0; i < xs.length; i++) {
    coords[2 * i] = xs[i];
    coords[2 * i + 1] = ys[i];
  }
  let del: Delaunator<Float64Array>;
  let con: Constrainautor;
  try {
    del = new Delaunator(coords);
    con = new Constrainautor(del);
    for (let i = 0; i < n; i++) con.constrainOne(i, (i + 1) % n);
  } catch (e) {
    throw new GeometryError('No se pudo triangular la superficie de corte.', 'domain-cdt', String(e));
  }
  const T = del.triangles;
  const HE = del.halfedges;
  const nT = T.length / 3;
  // Clasificación topológica: desde el casco convexo, sin cruzar aristas
  // restringidas, se alcanza todo el exterior. Es exacta incluso con puntos
  // del borde colineales (no depende de pruebas de punto en polígono).
  const outside = new Uint8Array(nT);
  const stack: number[] = [];
  for (let e = 0; e < T.length; e++) {
    if (HE[e] === -1 && !con.isConstrained(e)) {
      const t = (e / 3) | 0;
      if (!outside[t]) {
        outside[t] = 1;
        stack.push(t);
      }
    }
  }
  while (stack.length) {
    const t = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      const e = 3 * t + k;
      if (con.isConstrained(e)) continue;
      const opp = HE[e];
      if (opp < 0) continue;
      const u = (opp / 3) | 0;
      if (!outside[u]) {
        outside[u] = 1;
        stack.push(u);
      }
    }
  }
  const out: number[] = [];
  const minArea = 1e-12 * h * h;
  for (let t = 0; t < nT; t++) {
    if (outside[t]) continue;
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    // Normalizar a CCW.
    const ar = (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
    if (Math.abs(ar) <= minArea) {
      throw new GeometryError('La superficie de corte generó un triángulo degenerado.', 'domain-degenerate', `t=${t}`);
    }
    if (ar > 0) out.push(a, b, c);
    else out.push(a, c, b);
  }
  // Verificar que cada arista del borde pertenezca a exactamente un triángulo.
  const count = new Map<number, number>();
  const N = xs.length;
  for (let t = 0; t < out.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = out[3 * t + k];
      const b = out[3 * t + ((k + 1) % 3)];
      const key = a < b ? a * N + b : b * N + a;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n;
    const key = a < b ? a * N + b : b * N + a;
    if (count.get(key) !== 1) {
      throw new GeometryError('La superficie de corte no respeta el contorno.', 'domain-boundary', `arista ${i}`);
    }
  }
  return { X: Float64Array.from(xs), Y: Float64Array.from(ys), tris: Uint32Array.from(out), boundaryCount: n };
}
