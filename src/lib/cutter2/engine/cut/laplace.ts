/**
 * Resolución de sistemas laplacianos sobre triangulaciones (membranas
 * armónicas y superficies mínimas) con gradiente conjugado precondicionado.
 */

export interface TriMesh {
  /** n×3 */
  pos: Float64Array;
  tris: Uint32Array;
  /** true para vértices fijos (borde). */
  fixed: Uint8Array;
}

/** Pesos por arista no dirigida (clave a*n+b con a<b). */
export type EdgeWeights = Map<number, number>;

export function uniformWeights(tris: Uint32Array, n: number): EdgeWeights {
  const w: EdgeWeights = new Map();
  for (let t = 0; t < tris.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = tris[3 * t + k];
      const b = tris[3 * t + ((k + 1) % 3)];
      const key = a < b ? a * n + b : b * n + a;
      w.set(key, 1);
    }
  }
  return w;
}

/** Pesos cotangentes (fórmula de Pinkall–Polthier), recortados a positivos. */
export function cotanWeights(pos: Float64Array, tris: Uint32Array, n: number, coords = 3): EdgeWeights {
  const w: EdgeWeights = new Map();
  const get = (i: number, k: number) => (k < coords ? pos[coords * i + k] : 0);
  for (let t = 0; t < tris.length / 3; t++) {
    const v = [tris[3 * t], tris[3 * t + 1], tris[3 * t + 2]];
    for (let k = 0; k < 3; k++) {
      const o = v[k];
      const a = v[(k + 1) % 3];
      const b = v[(k + 2) % 3];
      const ux = get(a, 0) - get(o, 0), uy = get(a, 1) - get(o, 1), uz = get(a, 2) - get(o, 2);
      const vx = get(b, 0) - get(o, 0), vy = get(b, 1) - get(o, 1), vz = get(b, 2) - get(o, 2);
      const dot = ux * vx + uy * vy + uz * vz;
      const cr = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const cot = cr > 1e-300 ? dot / cr : 0;
      const key = a < b ? a * n + b : b * n + a;
      w.set(key, (w.get(key) ?? 0) + cot / 2);
    }
  }
  for (const [k, v] of w) w.set(k, Math.min(1e3, Math.max(1e-3, v)));
  return w;
}

/**
 * Resuelve Σ_j w_ij (x_i − x_j) = rhs_i para los vértices libres, con los
 * fijos como condición de borde. `values` (n × dim) tiene los valores
 * iniciales; se actualiza en el lugar.
 */
export function solveLaplace(
  n: number,
  fixed: Uint8Array,
  weights: EdgeWeights,
  values: Float64Array,
  dim: number,
  source?: Float64Array,
  tol = 1e-10,
  maxIter = 4000,
): void {
  const free: number[] = [];
  const idx = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (!fixed[i]) idx[i] = free.push(i) - 1;
  const m = free.length;
  if (m === 0) return;
  // CSR del sistema libre-libre
  const rowsTmp: Array<Array<[number, number]>> = Array.from({ length: m }, () => []);
  const diag = new Float64Array(m);
  const rhsBase: Float64Array[] = [];
  for (let d = 0; d < dim; d++) rhsBase.push(new Float64Array(m));
  if (source) for (let r = 0; r < m; r++) for (let d = 0; d < dim; d++) rhsBase[d][r] = source[dim * free[r] + d];
  for (const [key, w] of weights) {
    const a = Math.floor(key / n);
    const b = key - a * n;
    const ia = idx[a];
    const ib = idx[b];
    if (ia >= 0) diag[ia] += w;
    if (ib >= 0) diag[ib] += w;
    if (ia >= 0 && ib >= 0) {
      rowsTmp[ia].push([ib, -w]);
      rowsTmp[ib].push([ia, -w]);
    } else if (ia >= 0) {
      for (let d = 0; d < dim; d++) rhsBase[d][ia] += w * values[dim * b + d];
    } else if (ib >= 0) {
      for (let d = 0; d < dim; d++) rhsBase[d][ib] += w * values[dim * a + d];
    }
  }
  const rowPtr = new Int32Array(m + 1);
  for (let r = 0; r < m; r++) rowPtr[r + 1] = rowPtr[r] + rowsTmp[r].length;
  const colIdx = new Int32Array(rowPtr[m]);
  const vals = new Float64Array(rowPtr[m]);
  for (let r = 0; r < m; r++) {
    let o = rowPtr[r];
    for (const [c, v] of rowsTmp[r]) {
      colIdx[o] = c;
      vals[o++] = v;
    }
  }
  const mul = (x: Float64Array, out: Float64Array) => {
    for (let r = 0; r < m; r++) {
      let s = diag[r] * x[r];
      for (let o = rowPtr[r]; o < rowPtr[r + 1]; o++) s += vals[o] * x[colIdx[o]];
      out[r] = s;
    }
  };
  const x = new Float64Array(m);
  const r = new Float64Array(m);
  const z = new Float64Array(m);
  const p = new Float64Array(m);
  const q = new Float64Array(m);
  for (let d = 0; d < dim; d++) {
    const b = rhsBase[d];
    for (let i = 0; i < m; i++) x[i] = values[dim * free[i] + d];
    mul(x, q);
    let bnorm = 0;
    for (let i = 0; i < m; i++) {
      r[i] = b[i] - q[i];
      bnorm += b[i] * b[i];
    }
    bnorm = Math.sqrt(bnorm) || 1;
    for (let i = 0; i < m; i++) {
      z[i] = r[i] / diag[i];
      p[i] = z[i];
    }
    let rz = 0;
    for (let i = 0; i < m; i++) rz += r[i] * z[i];
    for (let it = 0; it < maxIter; it++) {
      let rn = 0;
      for (let i = 0; i < m; i++) rn += r[i] * r[i];
      if (Math.sqrt(rn) <= tol * bnorm) break;
      mul(p, q);
      let pq = 0;
      for (let i = 0; i < m; i++) pq += p[i] * q[i];
      if (pq <= 0) break;
      const alpha = rz / pq;
      for (let i = 0; i < m; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * q[i];
      }
      for (let i = 0; i < m; i++) z[i] = r[i] / diag[i];
      let rz2 = 0;
      for (let i = 0; i < m; i++) rz2 += r[i] * z[i];
      const beta = rz2 / rz;
      rz = rz2;
      for (let i = 0; i < m; i++) p[i] = z[i] + beta * p[i];
    }
    for (let i = 0; i < m; i++) values[dim * free[i] + d] = x[i];
  }
}
