import type { MeshContext } from '../core/MeshContext';

/**
 * Campo de curvatura multiescala (tensor de Taubin).
 *
 * kmin: curvatura principal mínima suavizada por vértice (1/mm). Negativa
 * en valles, pliegues cóncavos y cuellos; positiva en zonas convexas.
 * H: curvatura media suavizada.
 * valley: concavidad normalizada 0..1 derivada de kmin.
 */
export interface CurvatureField {
  H: Float64Array;
  kmin: Float64Array;
  valley: Float32Array;
  valleyFace: Float32Array;
  /** Radio aproximado de la escala de análisis (mm). */
  scale: number;
  /** Curvatura de referencia para normalizar (1/mm). */
  reference: number;
}

export function computeCurvature(ctx: MeshContext, scaleRel = 0.012): CurvatureField {
  const key = `curv:${scaleRel}`;
  const cached = ctx.cache.get(key) as CurvatureField | undefined;
  if (cached) return cached;
  const { P, topo } = ctx;
  const N = ctx.vertexNormals;
  const nV = topo.nV;
  const nE = topo.nE;
  const E0 = topo.edgeV0;
  const E1 = topo.edgeV1;

  // Tensor de curvatura por vértice: M = Σ w κ_ij T Tᵀ (6 valores simétricos)
  const M = new Float64Array(nV * 6);
  const W = new Float64Array(nV);
  const Hraw = new Float64Array(nV);
  const addTo = (i: number, j: number, k: number, w: number) => {
    const nx = N[3 * i], ny = N[3 * i + 1], nz = N[3 * i + 2];
    let tx = P[3 * j] - P[3 * i], ty = P[3 * j + 1] - P[3 * i + 1], tz = P[3 * j + 2] - P[3 * i + 2];
    const d = tx * nx + ty * ny + tz * nz;
    tx -= d * nx;
    ty -= d * ny;
    tz -= d * nz;
    const tl = Math.hypot(tx, ty, tz);
    if (tl <= 0) return;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const o = 6 * i;
    const s = w * k;
    M[o] += s * tx * tx;
    M[o + 1] += s * tx * ty;
    M[o + 2] += s * tx * tz;
    M[o + 3] += s * ty * ty;
    M[o + 4] += s * ty * tz;
    M[o + 5] += s * tz * tz;
    W[i] += w;
    Hraw[i] += w * k;
  };
  for (let e = 0; e < nE; e++) {
    const a = E0[e], b = E1[e];
    const dx = P[3 * b] - P[3 * a], dy = P[3 * b + 1] - P[3 * a + 1], dz = P[3 * b + 2] - P[3 * a + 2];
    const l2 = dx * dx + dy * dy + dz * dz;
    if (l2 <= 0) continue;
    const k = ((N[3 * b] - N[3 * a]) * dx + (N[3 * b + 1] - N[3 * a + 1]) * dy + (N[3 * b + 2] - N[3 * a + 2]) * dz) / l2;
    const w = Math.sqrt(l2);
    addTo(a, b, k, w);
    addTo(b, a, k, w);
  }
  const kminRaw = new Float64Array(nV);
  for (let v = 0; v < nV; v++) {
    if (W[v] <= 0) continue;
    const o = 6 * v;
    const inv = 1 / W[v];
    Hraw[v] *= inv;
    const nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2];
    // Base tangente
    let ax: number, ay: number, az: number;
    if (Math.abs(nx) < 0.9) {
      ax = 0; ay = nz; az = -ny;
    } else {
      ax = -nz; ay = 0; az = nx;
    }
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    const bx = ny * az - nz * ay, by = nz * ax - nx * az, bz = nx * ay - ny * ax;
    const quad = (ux: number, uy: number, uz: number, vx: number, vy: number, vz: number) =>
      inv *
      (ux * (M[o] * vx + M[o + 1] * vy + M[o + 2] * vz) +
        uy * (M[o + 1] * vx + M[o + 3] * vy + M[o + 4] * vz) +
        uz * (M[o + 2] * vx + M[o + 4] * vy + M[o + 5] * vz));
    const m11 = quad(ax, ay, az, ax, ay, az);
    const m12 = quad(ax, ay, az, bx, by, bz);
    const m22 = quad(bx, by, bz, bx, by, bz);
    const tr = m11 + m22;
    const det = m11 * m22 - m12 * m12;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const e1 = tr / 2 + disc; // mayor
    const e2 = tr / 2 - disc; // menor
    // Taubin: κ = 3m - m'
    kminRaw[v] = 3 * e2 - e1;
  }

  // Suavizado a la escala pedida.
  const scale = scaleRel * ctx.diag;
  const iters = Math.max(1, Math.min(150, Math.round((scale / ctx.avgEdge) ** 2)));
  const deg = new Float64Array(nV);
  for (let e = 0; e < nE; e++) {
    deg[E0[e]]++;
    deg[E1[e]]++;
  }
  const smooth = (src: Float64Array): Float64Array => {
    let cur = Float64Array.from(src);
    let next = new Float64Array(nV);
    for (let it = 0; it < iters; it++) {
      next.fill(0);
      for (let e = 0; e < nE; e++) {
        next[E0[e]] += cur[E1[e]];
        next[E1[e]] += cur[E0[e]];
      }
      for (let v = 0; v < nV; v++) next[v] = deg[v] > 0 ? 0.5 * cur[v] + (0.5 * next[v]) / deg[v] : cur[v];
      const t = cur;
      cur = next;
      next = t;
    }
    return cur;
  };
  const kmin = smooth(kminRaw);
  const H = smooth(Hraw);

  const reference = 0.25 / Math.max(scale, 1e-9);
  const valley = new Float32Array(nV);
  for (let v = 0; v < nV; v++) {
    const c = -kmin[v] / reference;
    valley[v] = c > 0 ? 1 - Math.exp(-1.5 * c) : 0;
  }
  const nF = topo.nF;
  const I = ctx.I;
  const valleyFace = new Float32Array(nF);
  for (let f = 0; f < nF; f++) valleyFace[f] = (valley[I[3 * f]] + valley[I[3 * f + 1]] + valley[I[3 * f + 2]]) / 3;

  const field: CurvatureField = { H, kmin, valley, valleyFace, scale, reference };
  ctx.cache.set(key, field);
  return field;
}
