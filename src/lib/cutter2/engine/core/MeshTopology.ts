/**
 * Topología de semiaristas (half-edges) para mallas triangulares indexadas.
 *
 * Semiarista h = 3·f + k va del vértice indices[h] al vértice indices[next(h)].
 * twin[h] = semiarista opuesta, -1 si es borde abierto, -2 si la arista es
 * no-manifold (más de dos caras).
 */
export class MeshTopology {
  readonly nV: number;
  readonly nF: number;
  readonly nH: number;
  readonly nE: number;
  readonly indices: Uint32Array;
  readonly twin: Int32Array;
  readonly heEdge: Int32Array;
  readonly edgeV0: Uint32Array;
  readonly edgeV1: Uint32Array;
  readonly edgeHe: Int32Array;
  /** Cantidad de semiaristas sobre cada arista (1 = borde, 2 = normal, >2 = no-manifold). */
  readonly edgeValence: Uint8Array;
  /** 1 si las dos caras de la arista tienen orientación inconsistente. */
  readonly edgeFlipped: Uint8Array;
  readonly vOutStart: Uint32Array;
  readonly vOut: Uint32Array;

  boundaryEdgeCount = 0;
  nonManifoldEdgeCount = 0;
  inconsistentEdgeCount = 0;

  private constructor(
    indices: Uint32Array,
    nV: number,
    twin: Int32Array,
    heEdge: Int32Array,
    nE: number,
    edgeV0: Uint32Array,
    edgeV1: Uint32Array,
    edgeHe: Int32Array,
    edgeValence: Uint8Array,
    edgeFlipped: Uint8Array,
    vOutStart: Uint32Array,
    vOut: Uint32Array,
  ) {
    this.indices = indices;
    this.nV = nV;
    this.nF = indices.length / 3;
    this.nH = indices.length;
    this.twin = twin;
    this.heEdge = heEdge;
    this.nE = nE;
    this.edgeV0 = edgeV0;
    this.edgeV1 = edgeV1;
    this.edgeHe = edgeHe;
    this.edgeValence = edgeValence;
    this.edgeFlipped = edgeFlipped;
    this.vOutStart = vOutStart;
    this.vOut = vOut;
    for (let e = 0; e < nE; e++) {
      const val = edgeValence[e];
      if (val === 1) this.boundaryEdgeCount++;
      else if (val > 2) this.nonManifoldEdgeCount++;
      if (edgeFlipped[e]) this.inconsistentEdgeCount++;
    }
  }

  static next(h: number): number {
    return h % 3 === 2 ? h - 2 : h + 1;
  }

  static prev(h: number): number {
    return h % 3 === 0 ? h + 2 : h - 1;
  }

  origin(h: number): number {
    return this.indices[h];
  }

  dest(h: number): number {
    return this.indices[h % 3 === 2 ? h - 2 : h + 1];
  }

  /** Construye la topología. Coste lineal: agrupa semiaristas por vértice menor. */
  static build(indices: Uint32Array, nV: number): MeshTopology {
    const nH = indices.length;
    const next = MeshTopology.next;
    const start = new Uint32Array(nV + 1);
    for (let h = 0; h < nH; h++) {
      const a = indices[h];
      const b = indices[next(h)];
      start[(a < b ? a : b) + 1]++;
    }
    for (let i = 0; i < nV; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nV);
    const bucket = new Uint32Array(nH);
    for (let h = 0; h < nH; h++) {
      const a = indices[h];
      const b = indices[next(h)];
      bucket[fill[a < b ? a : b]++] = h;
    }

    const heEdge = new Int32Array(nH).fill(-1);
    const twin = new Int32Array(nH).fill(-1);
    const e0 = new Uint32Array(nH);
    const e1 = new Uint32Array(nH);
    const eHe = new Int32Array(nH);
    const eVal = new Uint8Array(nH);
    const eFlip = new Uint8Array(nH);
    let nE = 0;
    const group: number[] = [];
    for (let v = 0; v < nV; v++) {
      const s = start[v];
      const e = start[v + 1];
      for (let i = s; i < e; i++) {
        const h = bucket[i];
        if (heEdge[h] >= 0) continue;
        const a = indices[h];
        const b = indices[next(h)];
        const hi = a > b ? a : b;
        group.length = 0;
        group.push(h);
        for (let j = i + 1; j < e; j++) {
          const h2 = bucket[j];
          if (heEdge[h2] >= 0) continue;
          const a2 = indices[h2];
          const b2 = indices[next(h2)];
          if ((a2 > b2 ? a2 : b2) === hi) group.push(h2);
        }
        const id = nE++;
        for (let k = 0; k < group.length; k++) heEdge[group[k]] = id;
        e0[id] = v;
        e1[id] = hi;
        eHe[id] = h;
        eVal[id] = group.length > 255 ? 255 : group.length;
        if (group.length === 2) {
          const g0 = group[0];
          const g1 = group[1];
          twin[g0] = g1;
          twin[g1] = g0;
          if (indices[g0] === indices[g1]) eFlip[id] = 1;
        } else if (group.length > 2) {
          for (let k = 0; k < group.length; k++) twin[group[k]] = -2;
        }
      }
    }

    const vOutStart = new Uint32Array(nV + 1);
    for (let h = 0; h < nH; h++) vOutStart[indices[h] + 1]++;
    for (let i = 0; i < nV; i++) vOutStart[i + 1] += vOutStart[i];
    const vFill = vOutStart.slice(0, nV);
    const vOut = new Uint32Array(nH);
    for (let h = 0; h < nH; h++) vOut[vFill[indices[h]]++] = h;

    return new MeshTopology(
      indices,
      nV,
      twin,
      heEdge,
      nE,
      e0.slice(0, nE),
      e1.slice(0, nE),
      eHe.slice(0, nE),
      eVal.slice(0, nE),
      eFlip.slice(0, nE),
      vOutStart,
      vOut,
    );
  }

  private _nonManifoldHalfedges: Map<number, number[]> | null = null;

  /** Semiaristas de cada arista no-manifold (más de dos caras), por id de arista. */
  nonManifoldHalfedges(): Map<number, number[]> {
    if (!this._nonManifoldHalfedges) {
      const m = new Map<number, number[]>();
      for (let h = 0; h < this.nH; h++) {
        if (this.twin[h] !== -2) continue;
        const e = this.heEdge[h];
        let l = m.get(e);
        if (!l) m.set(e, (l = []));
        l.push(h);
      }
      this._nonManifoldHalfedges = m;
    }
    return this._nonManifoldHalfedges;
  }

  /** Caras del otro lado de la semiarista h: la gemela, o todas las demás de una arista no-manifold. */
  facesAcross(h: number): number[] {
    const t = this.twin[h];
    if (t >= 0) return [(t / 3) | 0];
    if (t === -1) return [];
    const f = (h / 3) | 0;
    const out: number[] = [];
    for (const g of this.nonManifoldHalfedges().get(this.heEdge[h]) ?? []) {
      const fg = (g / 3) | 0;
      if (fg !== f) out.push(fg);
    }
    return out;
  }

  /** Cara vecina a través de cada semiarista (3 por cara), -1 si no hay vecino único. */
  faceAdjacency(): Int32Array {
    const adj = new Int32Array(this.nH);
    for (let h = 0; h < this.nH; h++) {
      const t = this.twin[h];
      adj[h] = t >= 0 ? (t / 3) | 0 : -1;
    }
    return adj;
  }

  /** Semiarista de a hacia b, o -1. */
  halfedgeFromTo(a: number, b: number): number {
    for (let i = this.vOutStart[a]; i < this.vOutStart[a + 1]; i++) {
      const h = this.vOut[i];
      if (this.dest(h) === b) return h;
    }
    return -1;
  }

  /** Arista entre a y b, o -1. */
  edgeBetween(a: number, b: number): number {
    let h = this.halfedgeFromTo(a, b);
    if (h < 0) h = this.halfedgeFromTo(b, a);
    return h < 0 ? -1 : this.heEdge[h];
  }

  /** Componentes conectados por aristas compartidas. */
  components(): { faceComponent: Int32Array; count: number; sizes: number[] } {
    const nF = this.nF;
    const parent = new Int32Array(nF);
    for (let i = 0; i < nF; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const firstFace = new Int32Array(this.nE).fill(-1);
    for (let h = 0; h < this.nH; h++) {
      const e = this.heEdge[h];
      if (e < 0) continue;
      const f = (h / 3) | 0;
      if (firstFace[e] < 0) firstFace[e] = f;
      else {
        const ra = find(firstFace[e]);
        const rb = find(f);
        if (ra !== rb) parent[ra] = rb;
      }
    }
    const faceComponent = new Int32Array(nF);
    const rootToComp = new Map<number, number>();
    const sizes: number[] = [];
    for (let f = 0; f < nF; f++) {
      const r = find(f);
      let c = rootToComp.get(r);
      if (c === undefined) {
        c = sizes.length;
        rootToComp.set(r, c);
        sizes.push(0);
      }
      faceComponent[f] = c;
      sizes[c]++;
    }
    return { faceComponent, count: sizes.length, sizes };
  }

  /**
   * Cuenta vértices no-manifold: aquellos cuyas caras incidentes no forman un
   * único abanico conectado por aristas.
   */
  nonManifoldVertexCount(): number {
    let count = 0;
    const seen = new Uint8Array(this.nH);
    for (let v = 0; v < this.nV; v++) {
      const s = this.vOutStart[v];
      const e = this.vOutStart[v + 1];
      if (e - s === 0) continue;
      let fans = 0;
      for (let i = s; i < e; i++) {
        const h0 = this.vOut[i];
        if (seen[h0]) continue;
        fans++;
        // Recorrer el abanico en ambos sentidos.
        let h = h0;
        while (h >= 0 && !seen[h]) {
          seen[h] = 1;
          const t = this.twin[MeshTopology.prev(h)];
          h = t >= 0 ? t : -1;
        }
        h = h0;
        for (;;) {
          const t = this.twin[h];
          if (t < 0) break;
          const hn = MeshTopology.next(t);
          if (seen[hn]) break;
          seen[hn] = 1;
          h = hn;
        }
      }
      if (fans > 1) count++;
    }
    return count;
  }
}

/** Unión-búsqueda simple sobre enteros. */
export class UnionFind {
  readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }
  union(a: number, b: number): number {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
    return rb;
  }
}
