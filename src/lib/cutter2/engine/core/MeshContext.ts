import type { IndexedMesh, PathPoint, Vec3 } from './types';
import { PK_EDGE, PK_FACE, PK_VERTEX } from './types';
import { MeshTopology } from './MeshTopology';
import { TriangleBVH } from './TriangleBVH';
import { averageEdgeLength, bboxDiagonal, computeBBox, computeFaceNormals, computeVertexNormals } from './geometry';

/** Punto sobre la superficie con cara, baricéntricas y posición. */
export interface SurfacePt {
  face: number;
  b0: number;
  b1: number;
  b2: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Contexto geométrico de una malla: topología, normales, BVH y cachés de
 * análisis. Se construye una vez por pieza y se reutiliza (caché).
 */
export class MeshContext {
  readonly mesh: IndexedMesh;
  readonly P: Float64Array;
  readonly I: Uint32Array;
  readonly topo: MeshTopology;
  readonly faceNormals: Float64Array;
  readonly faceAreas: Float64Array;
  readonly vertexNormals: Float64Array;
  readonly avgEdge: number;
  readonly diag: number;
  readonly faceComponent: Int32Array;
  readonly componentCount: number;
  private _bvh: TriangleBVH | null = null;
  private _faceAdj: Int32Array | null = null;
  /** Cachés de análisis (curvatura, segmentación, etc.). */
  readonly cache = new Map<string, unknown>();

  constructor(mesh: IndexedMesh) {
    this.mesh = mesh;
    this.P = mesh.positions;
    this.I = mesh.indices;
    this.topo = MeshTopology.build(mesh.indices, mesh.positions.length / 3);
    const fn = computeFaceNormals(mesh);
    this.faceNormals = fn.normals;
    this.faceAreas = fn.areas;
    this.vertexNormals = computeVertexNormals(mesh, fn.normals, fn.areas);
    this.avgEdge = averageEdgeLength(mesh) || 1;
    this.diag = bboxDiagonal(computeBBox(mesh.positions)) || 1;
    const comps = this.topo.components();
    this.faceComponent = comps.faceComponent;
    this.componentCount = comps.count;
  }

  get nV(): number {
    return this.topo.nV;
  }

  get nF(): number {
    return this.topo.nF;
  }

  get bvh(): TriangleBVH {
    if (!this._bvh) this._bvh = new TriangleBVH(this.P, this.I);
    return this._bvh;
  }

  get faceAdj(): Int32Array {
    if (!this._faceAdj) this._faceAdj = this.topo.faceAdjacency();
    return this._faceAdj;
  }

  /**
   * Cara que continúa la superficie al cruzar la semiarista h: la gemela en
   * una arista normal; en una arista no-manifold, la cara con orientación
   * coherente cuya normal más se parece (una aleta o una pared interna que
   * cuelgan de la arista quedan descartadas). -1 en un borde abierto.
   */
  faceAcross(h: number): number {
    const t = this.topo.twin[h];
    if (t >= 0) return (t / 3) | 0;
    if (t === -1) return -1;
    const f = (h / 3) | 0;
    const N = this.faceNormals;
    const a = this.topo.origin(h);
    let best = -1;
    let bestScore = -Infinity;
    for (const g of this.topo.nonManifoldHalfedges().get(this.topo.heEdge[h]) ?? []) {
      const fg = (g / 3) | 0;
      if (fg === f) continue;
      const coherent = this.topo.dest(g) === a ? 1 : 0; // recorre la arista al revés: orientación coherente
      const dot = N[3 * f] * N[3 * fg] + N[3 * f + 1] * N[3 * fg + 1] + N[3 * f + 2] * N[3 * fg + 2];
      const score = 2 * coherent + dot;
      if (score > bestScore) {
        bestScore = score;
        best = fg;
      }
    }
    return best;
  }

  /**
   * Como faceAcross, pero solo si la elección es mutua (la otra cara también
   * continúa en esta): en una arista no-manifold une las dos caras de una
   * misma superficie y deja afuera lo que cuelga de ella (una aleta, otro
   * cuerpo pegado por la arista). -1 si no hay continuación mutua.
   */
  mutualAcross(h: number): number {
    const t = this.topo.twin[h];
    if (t >= 0) return (t / 3) | 0;
    const g = this.faceAcross(h);
    if (g < 0) return -1;
    const f = (h / 3) | 0;
    const e = this.topo.heEdge[h];
    for (const h2 of this.topo.nonManifoldHalfedges().get(e) ?? []) {
      if (((h2 / 3) | 0) === g) return this.faceAcross(h2) === f ? g : -1;
    }
    return -1;
  }

  vertex(v: number, out: Vec3 = [0, 0, 0]): Vec3 {
    out[0] = this.P[3 * v];
    out[1] = this.P[3 * v + 1];
    out[2] = this.P[3 * v + 2];
    return out;
  }

  surfacePt(face: number, b0: number, b1: number, b2: number): SurfacePt {
    const I = this.I;
    const P = this.P;
    const a = I[3 * face] * 3, b = I[3 * face + 1] * 3, c = I[3 * face + 2] * 3;
    return {
      face, b0, b1, b2,
      x: b0 * P[a] + b1 * P[b] + b2 * P[c],
      y: b0 * P[a + 1] + b1 * P[b + 1] + b2 * P[c + 1],
      z: b0 * P[a + 2] + b1 * P[b + 2] + b2 * P[c + 2],
    };
  }

  /** Baricéntricas de un punto (supuesto sobre el plano de la cara). */
  baryOf(face: number, x: number, y: number, z: number): [number, number, number] {
    const I = this.I;
    const P = this.P;
    const a = I[3 * face] * 3, b = I[3 * face + 1] * 3, c = I[3 * face + 2] * 3;
    const v0x = P[b] - P[a], v0y = P[b + 1] - P[a + 1], v0z = P[b + 2] - P[a + 2];
    const v1x = P[c] - P[a], v1y = P[c + 1] - P[a + 1], v1z = P[c + 2] - P[a + 2];
    const v2x = x - P[a], v2y = y - P[a + 1], v2z = z - P[a + 2];
    const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
    const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
    const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
    const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
    const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
    const den = d00 * d11 - d01 * d01;
    if (den === 0) return [1 / 3, 1 / 3, 1 / 3];
    const v = (d11 * d20 - d01 * d21) / den;
    const w = (d00 * d21 - d01 * d20) / den;
    return [1 - v - w, v, w];
  }

  /** Normal interpolada (normales de vértice) en un punto de superficie. */
  interpolatedNormal(sp: SurfacePt, out: Vec3 = [0, 0, 0]): Vec3 {
    const I = this.I;
    const N = this.vertexNormals;
    const a = I[3 * sp.face] * 3, b = I[3 * sp.face + 1] * 3, c = I[3 * sp.face + 2] * 3;
    const x = sp.b0 * N[a] + sp.b1 * N[b] + sp.b2 * N[c];
    const y = sp.b0 * N[a + 1] + sp.b1 * N[b + 1] + sp.b2 * N[c + 1];
    const z = sp.b0 * N[a + 2] + sp.b1 * N[b + 2] + sp.b2 * N[c + 2];
    const len = Math.hypot(x, y, z) || 1;
    out[0] = x / len;
    out[1] = y / len;
    out[2] = z / len;
    return out;
  }

  edgeLength(e: number): number {
    const a = this.topo.edgeV0[e] * 3;
    const b = this.topo.edgeV1[e] * 3;
    const P = this.P;
    return Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
  }

  /** ¿La cara f contiene al vértice v? */
  faceHasVertex(f: number, v: number): boolean {
    const I = this.I;
    return I[3 * f] === v || I[3 * f + 1] === v || I[3 * f + 2] === v;
  }

  /** Índice local (0..2) de la semiarista de la cara f que corresponde a la arista e, o -1. */
  faceEdgeSlot(f: number, e: number): number {
    const he = this.topo.heEdge;
    if (he[3 * f] === e) return 0;
    if (he[3 * f + 1] === e) return 1;
    if (he[3 * f + 2] === e) return 2;
    return -1;
  }

  // ---- Puntos de camino ------------------------------------------------

  makeVertexPoint(v: number, seg: number, pinned = false): PathPoint {
    const P = this.P;
    return { kind: PK_VERTEX, id: v, t: 0, b0: 0, b1: 0, b2: 0, x: P[3 * v], y: P[3 * v + 1], z: P[3 * v + 2], seg, pinned };
  }

  makeEdgePoint(e: number, t: number, seg: number, pinned = false): PathPoint {
    const P = this.P;
    const a = this.topo.edgeV0[e] * 3;
    const b = this.topo.edgeV1[e] * 3;
    return {
      kind: PK_EDGE, id: e, t, b0: 0, b1: 0, b2: 0,
      x: P[a] + t * (P[b] - P[a]), y: P[a + 1] + t * (P[b + 1] - P[a + 1]), z: P[a + 2] + t * (P[b + 2] - P[a + 2]),
      seg, pinned,
    };
  }

  makeFacePoint(sp: SurfacePt, seg: number, pinned = false): PathPoint {
    return { kind: PK_FACE, id: sp.face, t: 0, b0: sp.b0, b1: sp.b1, b2: sp.b2, x: sp.x, y: sp.y, z: sp.z, seg, pinned };
  }

  /** Una cara que contiene al punto de camino. */
  faceOfPoint(p: PathPoint): number {
    if (p.kind === PK_FACE) return p.id;
    if (p.kind === PK_EDGE) return (this.topo.edgeHe[p.id] / 3) | 0;
    const s = this.topo.vOutStart[p.id];
    return s < this.topo.vOutStart[p.id + 1] ? (this.topo.vOut[s] / 3) | 0 : -1;
  }

  /** Convierte un punto de camino en punto de superficie (cara + baricéntricas). */
  toSurfacePt(p: PathPoint, preferFace = -1): SurfacePt {
    if (p.kind === PK_FACE) return { face: p.id, b0: p.b0, b1: p.b1, b2: p.b2, x: p.x, y: p.y, z: p.z };
    let f = preferFace >= 0 && this.pointOnFace(p, preferFace) ? preferFace : this.faceOfPoint(p);
    if (f < 0) f = 0;
    const [b0, b1, b2] = this.baryExact(p, f);
    return { face: f, b0, b1, b2, x: p.x, y: p.y, z: p.z };
  }

  /** Baricéntricas exactas de un punto de vértice/arista en una cara que lo contiene. */
  baryExact(p: PathPoint, f: number): [number, number, number] {
    const I = this.I;
    const out: [number, number, number] = [0, 0, 0];
    if (p.kind === PK_VERTEX) {
      for (let k = 0; k < 3; k++) if (I[3 * f + k] === p.id) out[k] = 1;
      return out;
    }
    if (p.kind === PK_EDGE) {
      const v0 = this.topo.edgeV0[p.id];
      const v1 = this.topo.edgeV1[p.id];
      for (let k = 0; k < 3; k++) {
        if (I[3 * f + k] === v0) out[k] = 1 - p.t;
        else if (I[3 * f + k] === v1) out[k] = p.t;
      }
      return out;
    }
    return this.baryOf(f, p.x, p.y, p.z);
  }

  /** ¿El punto de camino está en la clausura de la cara f? */
  pointOnFace(p: PathPoint, f: number): boolean {
    if (p.kind === PK_FACE) return p.id === f;
    if (p.kind === PK_VERTEX) return this.faceHasVertex(f, p.id);
    return this.faceEdgeSlot(f, p.id) >= 0;
  }

  /**
   * Cara común que contiene el segmento entre dos puntos de camino
   * consecutivos, o -1 si no comparten cara.
   */
  commonFace(p: PathPoint, q: PathPoint): number {
    if (p.kind === PK_FACE) return this.pointOnFace(q, p.id) ? p.id : -1;
    if (q.kind === PK_FACE) return this.pointOnFace(p, q.id) ? q.id : -1;
    // Ninguno es interior: probar las caras alrededor de p.
    const cands = this.facesAround(p);
    for (const f of cands) if (this.pointOnFace(q, f)) return f;
    return -1;
  }

  /** Caras que contienen a un punto de vértice o arista. */
  facesAround(p: PathPoint): number[] {
    if (p.kind === PK_FACE) return [p.id];
    if (p.kind === PK_EDGE) {
      const h = this.topo.edgeHe[p.id];
      const out = [(h / 3) | 0];
      const t = this.topo.twin[h];
      if (t >= 0) out.push((t / 3) | 0);
      return out;
    }
    const out: number[] = [];
    for (let i = this.topo.vOutStart[p.id]; i < this.topo.vOutStart[p.id + 1]; i++) out.push((this.topo.vOut[i] / 3) | 0);
    return out;
  }

  /** ¿El segmento pq corre sobre una arista de la malla? */
  segmentOnEdge(p: PathPoint, q: PathPoint): number {
    const topo = this.topo;
    if (p.kind === PK_FACE || q.kind === PK_FACE) return -1;
    if (p.kind === PK_EDGE && q.kind === PK_EDGE) return p.id === q.id ? p.id : -1;
    if (p.kind === PK_VERTEX && q.kind === PK_VERTEX) return topo.edgeBetween(p.id, q.id);
    const e = p.kind === PK_EDGE ? p : q;
    const v = p.kind === PK_VERTEX ? p : q;
    return topo.edgeV0[e.id] === v.id || topo.edgeV1[e.id] === v.id ? e.id : -1;
  }
}

export function samePathPoint(a: PathPoint, b: PathPoint): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === PK_EDGE) return Math.abs(a.t - b.t) < 1e-12;
  if (a.kind === PK_FACE) return Math.abs(a.b0 - b.b0) < 1e-12 && Math.abs(a.b1 - b.b1) < 1e-12;
  return true;
}

export function pathPointKey(p: PathPoint): string {
  if (p.kind === PK_VERTEX) return `v${p.id}`;
  if (p.kind === PK_EDGE) return `e${p.id}:${p.t.toFixed(12)}`;
  return `f${p.id}:${p.b0.toFixed(12)}:${p.b1.toFixed(12)}`;
}
