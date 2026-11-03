import type { BBox, IndexedMesh, Vec3 } from './types';

/** Normal unitaria de la cara f. Devuelve el doble del área. */
export function faceNormal(P: Float64Array, I: Uint32Array, f: number, out: Vec3): number {
  const a = I[3 * f] * 3;
  const b = I[3 * f + 1] * 3;
  const c = I[3 * f + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len > 0) {
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return len;
}

/** Normales unitarias por cara (3 por cara) y áreas. */
export function computeFaceNormals(mesh: IndexedMesh): { normals: Float64Array; areas: Float64Array } {
  const { positions: P, indices: I } = mesh;
  const nF = I.length / 3;
  const normals = new Float64Array(nF * 3);
  const areas = new Float64Array(nF);
  const n: Vec3 = [0, 0, 0];
  for (let f = 0; f < nF; f++) {
    const dbl = faceNormal(P, I, f, n);
    normals[3 * f] = n[0];
    normals[3 * f + 1] = n[1];
    normals[3 * f + 2] = n[2];
    areas[f] = dbl / 2;
  }
  return { normals, areas };
}

/** Normales por vértice ponderadas por área. */
export function computeVertexNormals(mesh: IndexedMesh, faceNormals: Float64Array, faceAreas: Float64Array): Float64Array {
  const { positions: P, indices: I } = mesh;
  const nV = P.length / 3;
  const out = new Float64Array(nV * 3);
  const nF = I.length / 3;
  for (let f = 0; f < nF; f++) {
    const w = faceAreas[f];
    for (let k = 0; k < 3; k++) {
      const v = I[3 * f + k] * 3;
      out[v] += faceNormals[3 * f] * w;
      out[v + 1] += faceNormals[3 * f + 1] * w;
      out[v + 2] += faceNormals[3 * f + 2] * w;
    }
  }
  for (let v = 0; v < nV; v++) {
    const x = out[3 * v], y = out[3 * v + 1], z = out[3 * v + 2];
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      out[3 * v] = x / len;
      out[3 * v + 1] = y / len;
      out[3 * v + 2] = z / len;
    }
  }
  return out;
}

export function computeBBox(positions: Float64Array | Float32Array, indices?: Uint32Array): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const visit = (i: number) => {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  };
  if (indices) {
    for (let k = 0; k < indices.length; k++) visit(indices[k]);
  } else {
    const n = positions.length / 3;
    for (let i = 0; i < n; i++) visit(i);
  }
  return { min, max };
}

export function bboxDiagonal(b: BBox): number {
  return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
}

/** Volumen con signo (positivo si las normales apuntan hacia afuera). */
export function signedVolume(mesh: IndexedMesh, faces?: ArrayLike<number>): number {
  const { positions: P, indices: I } = mesh;
  let vol = 0;
  const nF = faces ? faces.length : I.length / 3;
  for (let i = 0; i < nF; i++) {
    const f = faces ? faces[i] : i;
    const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
    vol +=
      P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
      P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
      P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return vol / 6;
}

export function surfaceArea(mesh: IndexedMesh): number {
  const { positions: P, indices: I } = mesh;
  let area = 0;
  for (let f = 0; f < I.length / 3; f++) {
    const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

export function averageEdgeLength(mesh: IndexedMesh, sample = 20000): number {
  const { positions: P, indices: I } = mesh;
  const nF = I.length / 3;
  const step = Math.max(1, Math.floor(nF / sample));
  let sum = 0;
  let n = 0;
  for (let f = 0; f < nF; f += step) {
    for (let k = 0; k < 3; k++) {
      const a = I[3 * f + k] * 3;
      const b = I[3 * f + ((k + 1) % 3)] * 3;
      sum += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Resultado de punto más cercano sobre un triángulo, con baricéntricas. */
export interface ClosestResult {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  w: number;
}

/** Punto más cercano a p sobre el triángulo abc (Ericson, RTCD 5.1.5). */
export function closestPointOnTriangle(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: ClosestResult,
): void {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out.x = ax; out.y = ay; out.z = az; out.u = 1; out.v = 0; out.w = 0;
    return;
  }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out.x = bx; out.y = by; out.z = bz; out.u = 0; out.v = 1; out.w = 0;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.x = ax + v * abx; out.y = ay + v * aby; out.z = az + v * abz;
    out.u = 1 - v; out.v = v; out.w = 0;
    return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out.x = cx; out.y = cy; out.z = cz; out.u = 0; out.v = 0; out.w = 1;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.x = ax + w * acx; out.y = ay + w * acy; out.z = az + w * acz;
    out.u = 1 - w; out.v = 0; out.w = w;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out.x = bx + w * (cx - bx); out.y = by + w * (cy - by); out.z = bz + w * (cz - bz);
    out.u = 0; out.v = 1 - w; out.w = w;
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out.x = ax + abx * v + acx * w;
  out.y = ay + aby * v + acy * w;
  out.z = az + abz * v + acz * w;
  out.u = 1 - v - w; out.v = v; out.w = w;
}

/** Intersección rayo-triángulo (Möller–Trumbore). Devuelve t o -1. */
export function rayTriangle(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  baryOut?: { u: number; v: number },
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-300) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-12 || u > 1 + 1e-12) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-12 || u + v > 1 + 1e-12) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (baryOut) {
    baryOut.u = u;
    baryOut.v = v;
  }
  return t;
}

const tmpA = new Float64Array(3);
const tmpB = new Float64Array(3);

function sub3(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

/**
 * Intersección segmento-triángulo. Devuelve el parámetro s∈[0,1] del segmento
 * o -1. `eps` es una tolerancia relativa para los bordes del triángulo.
 */
export function segmentTriangle(
  p: ArrayLike<number>, q: ArrayLike<number>,
  a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>,
  eps = 1e-10,
): number {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const e1 = sub3(tmpA, b, a);
  const e2 = sub3(tmpB, c, a);
  const px = dy * e2[2] - dz * e2[1];
  const py = dz * e2[0] - dx * e2[2];
  const pz = dx * e2[1] - dy * e2[0];
  const det = e1[0] * px + e1[1] * py + e1[2] * pz;
  const scale = Math.hypot(e1[0], e1[1], e1[2]) * Math.hypot(e2[0], e2[1], e2[2]) * Math.hypot(dx, dy, dz);
  if (Math.abs(det) <= 1e-12 * scale) return -1; // paralelo o coplanar
  const inv = 1 / det;
  const tx = p[0] - a[0], ty = p[1] - a[1], tz = p[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -eps || u > 1 + eps) return -1;
  const qx = ty * e1[2] - tz * e1[1];
  const qy = tz * e1[0] - tx * e1[2];
  const qz = tx * e1[1] - ty * e1[0];
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -eps || u + v > 1 + eps) return -1;
  const s = (e2[0] * qx + e2[1] * qy + e2[2] * qz) * inv;
  if (s < -eps || s > 1 + eps) return -1;
  return s;
}

function orient2d(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** ¿Se cruzan los segmentos 2D ab y cd en su interior? (sin contar extremos compartidos) */
export function segmentsCross2D(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
  eps = 0,
): boolean {
  const d1 = orient2d(cx, cy, dx, dy, ax, ay);
  const d2 = orient2d(cx, cy, dx, dy, bx, by);
  const d3 = orient2d(ax, ay, bx, by, cx, cy);
  const d4 = orient2d(ax, ay, bx, by, dx, dy);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/**
 * Prueba de intersección entre dos triángulos 3D que puede ignorar vértices
 * compartidos (por índice). `shared` contiene pares [i, j] con la esquina i
 * del primer triángulo idéntica a la esquina j del segundo.
 */
export function trianglesIntersect(
  T1: ArrayLike<number>[],
  T2: ArrayLike<number>[],
  shared: Array<[number, number]>,
  relEps = 1e-9,
): boolean {
  const n1 = triNormalRaw(T1);
  const n2 = triNormalRaw(T2);
  const l1 = Math.hypot(n1[0], n1[1], n1[2]);
  const l2 = Math.hypot(n2[0], n2[1], n2[2]);
  if (l1 === 0 || l2 === 0) return false;
  const cosang = (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) / (l1 * l2);
  const size = Math.sqrt(Math.max(l1, l2));
  // Distancias de los vértices de T2 al plano de T1.
  const d2 = T2.map((p) => ((p[0] - T1[0][0]) * n1[0] + (p[1] - T1[0][1]) * n1[1] + (p[2] - T1[0][2]) * n1[2]) / l1);
  const coplanar = Math.abs(cosang) > 1 - 1e-10 && d2.every((d) => Math.abs(d) <= relEps * size * 10);

  if (shared.length >= 3) return true; // cara duplicada
  if (shared.length === 2) {
    if (!coplanar && Math.abs(cosang) < 1 - 1e-8) return false;
    // Arista compartida: se superponen si los opuestos quedan del mismo lado.
    const [i0, j0] = shared[0];
    const [i1, j1] = shared[1];
    const iOpp = 3 - i0 - i1;
    const jOpp = 3 - j0 - j1;
    const A = T1[i0], B = T1[i1];
    const ex = B[0] - A[0], ey = B[1] - A[1], ez = B[2] - A[2];
    const side = (P: ArrayLike<number>) => {
      const px = P[0] - A[0], py = P[1] - A[1], pz = P[2] - A[2];
      // Componente perpendicular a la arista, proyectada sobre n1 × e.
      const cx = n1[1] * ez - n1[2] * ey;
      const cy = n1[2] * ex - n1[0] * ez;
      const cz = n1[0] * ey - n1[1] * ex;
      return px * cx + py * cy + pz * cz;
    };
    const s1 = side(T1[iOpp]);
    const s2 = side(T2[jOpp]);
    return s1 * s2 > 0;
  }
  if (coplanar) return coplanarOverlap(T1, T2, n1, shared);
  if (shared.length === 1) {
    const [i, j] = shared[0];
    const a1 = T1[(i + 1) % 3], b1 = T1[(i + 2) % 3];
    const a2 = T2[(j + 1) % 3], b2 = T2[(j + 2) % 3];
    if (segmentTriangle(a1, b1, T2[0], T2[1], T2[2], -1e-9) >= 0) return true;
    if (segmentTriangle(a2, b2, T1[0], T1[1], T1[2], -1e-9) >= 0) return true;
    return false;
  }
  for (let k = 0; k < 3; k++) {
    if (segmentTriangle(T1[k], T1[(k + 1) % 3], T2[0], T2[1], T2[2], 0) >= 0) return true;
    if (segmentTriangle(T2[k], T2[(k + 1) % 3], T1[0], T1[1], T1[2], 0) >= 0) return true;
  }
  return false;
}

function triNormalRaw(T: ArrayLike<number>[]): [number, number, number] {
  const ux = T[1][0] - T[0][0], uy = T[1][1] - T[0][1], uz = T[1][2] - T[0][2];
  const vx = T[2][0] - T[0][0], vy = T[2][1] - T[0][1], vz = T[2][2] - T[0][2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

function coplanarOverlap(T1: ArrayLike<number>[], T2: ArrayLike<number>[], n: number[], shared: Array<[number, number]>): boolean {
  // Proyección al plano dominante.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const [i0, i1] = az >= ax && az >= ay ? [0, 1] : ay >= ax ? [0, 2] : [1, 2];
  const p1 = T1.map((p) => [p[i0], p[i1]]);
  const p2 = T2.map((p) => [p[i0], p[i1]]);
  const sharedSet1 = new Set(shared.map((s) => s[0]));
  const sharedSet2 = new Set(shared.map((s) => s[1]));
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      const A0 = p1[a], A1 = p1[(a + 1) % 3];
      const B0 = p2[b], B1 = p2[(b + 1) % 3];
      if (segmentsCross2D(A0[0], A0[1], A1[0], A1[1], B0[0], B0[1], B1[0], B1[1])) return true;
    }
  }
  const inside = (P: number[], T: number[][]) => {
    const s0 = orient2d(T[0][0], T[0][1], T[1][0], T[1][1], P[0], P[1]);
    const s1 = orient2d(T[1][0], T[1][1], T[2][0], T[2][1], P[0], P[1]);
    const s2 = orient2d(T[2][0], T[2][1], T[0][0], T[0][1], P[0], P[1]);
    return (s0 > 0 && s1 > 0 && s2 > 0) || (s0 < 0 && s1 < 0 && s2 < 0);
  };
  for (let k = 0; k < 3; k++) {
    if (!sharedSet1.has(k) && inside(p1[k], p2)) return true;
    if (!sharedSet2.has(k) && inside(p2[k], p1)) return true;
  }
  // Baricentros: cubre el caso de triángulos idénticos en posición.
  const c1 = [(p1[0][0] + p1[1][0] + p1[2][0]) / 3, (p1[0][1] + p1[1][1] + p1[2][1]) / 3];
  return inside(c1, p2);
}
