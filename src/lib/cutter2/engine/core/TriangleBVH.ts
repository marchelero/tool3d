import { closestPointOnTriangle, rayTriangle, type ClosestResult } from './geometry';

const LEAF_SIZE = 6;

/**
 * Jerarquía de volúmenes envolventes (AABB) sobre triángulos, en TypeScript
 * puro para el worker. Consultas: punto más cercano, rayos, cajas y pares de
 * triángulos solapados (para autointersecciones).
 */
export class TriangleBVH {
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
  /** Triángulos (ids de cara) reordenados por nodo. */
  readonly tris: Uint32Array;
  /** 6 valores por nodo: min xyz, max xyz. */
  readonly bounds: Float64Array;
  /** 2 valores por nodo: hijo izquierdo / derecho, u hoja: [-(inicio+1), cantidad]. */
  readonly nodes: Int32Array;
  nodeCount = 0;

  constructor(positions: Float64Array, indices: Uint32Array, faces?: ArrayLike<number>) {
    this.positions = positions;
    this.indices = indices;
    const nT = faces ? faces.length : indices.length / 3;
    const tris = new Uint32Array(nT);
    for (let i = 0; i < nT; i++) tris[i] = faces ? faces[i] : i;
    this.tris = tris;
    const maxNodes = Math.max(1, 2 * Math.ceil(nT / 2) + 1) * 2;
    this.bounds = new Float64Array(maxNodes * 6);
    this.nodes = new Int32Array(maxNodes * 2);
    if (nT > 0) this.build(nT);
  }

  private build(nT: number): void {
    const P = this.positions;
    const I = this.indices;
    const cent = new Float64Array(nT * 3);
    const tb = new Float64Array(nT * 6);
    for (let i = 0; i < nT; i++) {
      const f = this.tris[i];
      const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(P[a + k], P[b + k], P[c + k]);
        const hi = Math.max(P[a + k], P[b + k], P[c + k]);
        tb[6 * i + k] = lo;
        tb[6 * i + 3 + k] = hi;
        cent[3 * i + k] = (lo + hi) / 2;
      }
    }
    // Índice local de triángulo (0..nT) que se reordena durante la construcción.
    const order = new Uint32Array(nT);
    for (let i = 0; i < nT; i++) order[i] = i;

    const stack: number[] = [];
    const root = this.allocNode();
    stack.push(root, 0, nT);
    while (stack.length) {
      const end = stack.pop()!;
      const start = stack.pop()!;
      const node = stack.pop()!;
      // Caja del nodo
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      let cmnx = Infinity, cmny = Infinity, cmnz = Infinity, cmxx = -Infinity, cmxy = -Infinity, cmxz = -Infinity;
      for (let i = start; i < end; i++) {
        const t = order[i];
        const o = 6 * t;
        if (tb[o] < mnx) mnx = tb[o];
        if (tb[o + 1] < mny) mny = tb[o + 1];
        if (tb[o + 2] < mnz) mnz = tb[o + 2];
        if (tb[o + 3] > mxx) mxx = tb[o + 3];
        if (tb[o + 4] > mxy) mxy = tb[o + 4];
        if (tb[o + 5] > mxz) mxz = tb[o + 5];
        const cx = cent[3 * t], cy = cent[3 * t + 1], cz = cent[3 * t + 2];
        if (cx < cmnx) cmnx = cx;
        if (cy < cmny) cmny = cy;
        if (cz < cmnz) cmnz = cz;
        if (cx > cmxx) cmxx = cx;
        if (cy > cmxy) cmxy = cy;
        if (cz > cmxz) cmxz = cz;
      }
      const bo = node * 6;
      this.bounds[bo] = mnx; this.bounds[bo + 1] = mny; this.bounds[bo + 2] = mnz;
      this.bounds[bo + 3] = mxx; this.bounds[bo + 4] = mxy; this.bounds[bo + 5] = mxz;
      const count = end - start;
      const ex = cmxx - cmnx, ey = cmxy - cmny, ez = cmxz - cmnz;
      if (count <= LEAF_SIZE || Math.max(ex, ey, ez) <= 0) {
        this.nodes[2 * node] = -(start + 1);
        this.nodes[2 * node + 1] = count;
        continue;
      }
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = (start + end) >> 1;
      quickSelect(order, start, end - 1, mid, cent, axis);
      const left = this.allocNode();
      const right = this.allocNode();
      this.nodes[2 * node] = left;
      this.nodes[2 * node + 1] = right;
      stack.push(left, start, mid);
      stack.push(right, mid, end);
    }
    const permuted = new Uint32Array(nT);
    for (let i = 0; i < nT; i++) permuted[i] = this.tris[order[i]];
    this.tris.set(permuted);
  }

  private allocNode(): number {
    return this.nodeCount++;
  }

  private isLeaf(node: number): boolean {
    return this.nodes[2 * node] < 0;
  }

  /** Distancia² del punto a la caja del nodo. */
  private boxDist2(node: number, x: number, y: number, z: number): number {
    const b = this.bounds;
    const o = node * 6;
    const dx = x < b[o] ? b[o] - x : x > b[o + 3] ? x - b[o + 3] : 0;
    const dy = y < b[o + 1] ? b[o + 1] - y : y > b[o + 4] ? y - b[o + 4] : 0;
    const dz = z < b[o + 2] ? b[o + 2] - z : z > b[o + 5] ? z - b[o + 5] : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Punto más cercano sobre la malla. `filter` permite descartar caras. */
  closestPoint(
    x: number, y: number, z: number,
    maxDist = Infinity,
    filter?: (face: number) => boolean,
  ): { face: number; x: number; y: number; z: number; u: number; v: number; w: number; dist: number } | null {
    if (this.nodeCount === 0) return null;
    const P = this.positions;
    const I = this.indices;
    let best2 = maxDist * maxDist;
    let bestFace = -1;
    const best: ClosestResult = { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 };
    const tmp: ClosestResult = { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 };
    const stack: number[] = [0];
    while (stack.length) {
      const node = stack.pop()!;
      if (this.boxDist2(node, x, y, z) >= best2) continue;
      if (this.isLeaf(node)) {
        const start = -this.nodes[2 * node] - 1;
        const count = this.nodes[2 * node + 1];
        for (let i = start; i < start + count; i++) {
          const f = this.tris[i];
          if (filter && !filter(f)) continue;
          const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
          closestPointOnTriangle(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], tmp);
          const d2 = (tmp.x - x) ** 2 + (tmp.y - y) ** 2 + (tmp.z - z) ** 2;
          if (d2 < best2) {
            best2 = d2;
            bestFace = f;
            Object.assign(best, tmp);
          }
        }
      } else {
        const l = this.nodes[2 * node];
        const r = this.nodes[2 * node + 1];
        const dl = this.boxDist2(l, x, y, z);
        const dr = this.boxDist2(r, x, y, z);
        if (dl < dr) {
          stack.push(r, l);
        } else {
          stack.push(l, r);
        }
      }
    }
    if (bestFace < 0) return null;
    return { face: bestFace, ...best, dist: Math.sqrt(best2) };
  }

  /** Todas las intersecciones de un rayo, ordenadas por distancia. */
  raycastAll(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    tMax = Infinity,
  ): Array<{ face: number; t: number; u: number; v: number }> {
    const hits: Array<{ face: number; t: number; u: number; v: number }> = [];
    if (this.nodeCount === 0) return hits;
    const P = this.positions;
    const I = this.indices;
    const inv = [1 / dx, 1 / dy, 1 / dz];
    const b = this.bounds;
    const bary = { u: 0, v: 0 };
    const stack: number[] = [0];
    while (stack.length) {
      const node = stack.pop()!;
      const o = node * 6;
      let t0 = 0, t1 = tMax;
      const orig = [ox, oy, oz];
      let miss = false;
      for (let k = 0; k < 3; k++) {
        let ta = (b[o + k] - orig[k]) * inv[k];
        let tb = (b[o + 3 + k] - orig[k]) * inv[k];
        if (ta > tb) {
          const s = ta;
          ta = tb;
          tb = s;
        }
        if (Number.isNaN(ta) || Number.isNaN(tb)) continue;
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1 * (1 + 1e-12) + 1e-12) {
          miss = true;
          break;
        }
      }
      if (miss) continue;
      if (this.isLeaf(node)) {
        const start = -this.nodes[2 * node] - 1;
        const count = this.nodes[2 * node + 1];
        for (let i = start; i < start + count; i++) {
          const f = this.tris[i];
          const a = I[3 * f] * 3, bb = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
          const t = rayTriangle(ox, oy, oz, dx, dy, dz, P[a], P[a + 1], P[a + 2], P[bb], P[bb + 1], P[bb + 2], P[c], P[c + 1], P[c + 2], bary);
          if (t >= 0 && t <= tMax) hits.push({ face: f, t, u: bary.u, v: bary.v });
        }
      } else {
        stack.push(this.nodes[2 * node], this.nodes[2 * node + 1]);
      }
    }
    hits.sort((p, q) => p.t - q.t);
    // Un rayo que pasa por una arista o un vértice toca varias caras en el
    // mismo punto: se conserva una sola intersección por punto.
    const out: typeof hits = [];
    const dl = Math.hypot(dx, dy, dz);
    for (const h of hits) {
      const last = out[out.length - 1];
      if (last && Math.abs(h.t - last.t) * dl < 1e-9 * (1 + Math.abs(h.t) * dl)) continue;
      out.push(h);
    }
    return out;
  }

  /** Caras cuya caja se solapa con la caja dada. */
  queryBox(min: ArrayLike<number>, max: ArrayLike<number>, cb: (face: number) => void): void {
    if (this.nodeCount === 0) return;
    const b = this.bounds;
    const stack: number[] = [0];
    while (stack.length) {
      const node = stack.pop()!;
      const o = node * 6;
      if (b[o] > max[0] || b[o + 3] < min[0] || b[o + 1] > max[1] || b[o + 4] < min[1] || b[o + 2] > max[2] || b[o + 5] < min[2]) continue;
      if (this.isLeaf(node)) {
        const start = -this.nodes[2 * node] - 1;
        const count = this.nodes[2 * node + 1];
        for (let i = start; i < start + count; i++) cb(this.tris[i]);
      } else {
        stack.push(this.nodes[2 * node], this.nodes[2 * node + 1]);
      }
    }
  }

  /**
   * Recorre pares de triángulos cuyas cajas se solapan entre este BVH y `other`
   * (puede ser el mismo). Si el callback devuelve true, se detiene.
   */
  overlapPairs(other: TriangleBVH, cb: (faceA: number, faceB: number) => boolean | void, pad = 0): void {
    if (this.nodeCount === 0 || other.nodeCount === 0) return;
    const self = this === other;
    const A = this.bounds;
    const B = other.bounds;
    const stack: number[] = [0, 0];
    const overlap = (na: number, nb: number) => {
      const oa = na * 6, ob = nb * 6;
      return !(
        A[oa] > B[ob + 3] + pad || A[oa + 3] < B[ob] - pad ||
        A[oa + 1] > B[ob + 4] + pad || A[oa + 4] < B[ob + 1] - pad ||
        A[oa + 2] > B[ob + 5] + pad || A[oa + 5] < B[ob + 2] - pad
      );
    };
    while (stack.length) {
      const nb = stack.pop()!;
      const na = stack.pop()!;
      if (!overlap(na, nb)) continue;
      const leafA = this.isLeaf(na);
      const leafB = other.isLeaf(nb);
      if (leafA && leafB) {
        const sa = -this.nodes[2 * na] - 1, ca = this.nodes[2 * na + 1];
        const sb = -other.nodes[2 * nb] - 1, cb2 = other.nodes[2 * nb + 1];
        for (let i = sa; i < sa + ca; i++) {
          const fa = this.tris[i];
          for (let j = sb; j < sb + cb2; j++) {
            const fb = other.tris[j];
            if (self && na === nb && j <= i) continue;
            if (cb(fa, fb) === true) return;
          }
        }
        continue;
      }
      if (self && na === nb) {
        const l = this.nodes[2 * na];
        const r = this.nodes[2 * na + 1];
        stack.push(l, l, r, r, l, r);
        continue;
      }
      if (leafB || (!leafA && this.nodeSize(na) >= other.nodeSize(nb))) {
        stack.push(this.nodes[2 * na], nb, this.nodes[2 * na + 1], nb);
      } else {
        stack.push(na, other.nodes[2 * nb], na, other.nodes[2 * nb + 1]);
      }
    }
  }

  private nodeSize(node: number): number {
    const b = this.bounds;
    const o = node * 6;
    return b[o + 3] - b[o] + b[o + 4] - b[o + 1] + b[o + 5] - b[o + 2];
  }
}

function quickSelect(order: Uint32Array, lo: number, hi: number, k: number, cent: Float64Array, axis: number): void {
  while (hi > lo) {
    const mid = (lo + hi) >> 1;
    const pivot = cent[3 * order[mid] + axis];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (cent[3 * order[i] + axis] < pivot) i++;
      while (cent[3 * order[j] + axis] > pivot) j--;
      if (i <= j) {
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}
