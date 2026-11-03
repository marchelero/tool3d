import type { PathPoint } from '../core/types';
import { MeshTopology } from '../core/MeshTopology';
import type { MeshContext, SurfacePt } from '../core/MeshContext';

const BARY_EPS = 1e-9;

type Where = { kind: 'face' } | { kind: 'edge'; e: number; t: number } | { kind: 'vertex'; v: number };

/** ¿El punto de superficie está sobre una arista o un vértice de su cara? */
function classify(ctx: MeshContext, sp: SurfacePt): Where {
  const b = [sp.b0, sp.b1, sp.b2];
  const zeros = b.map((x) => x <= BARY_EPS);
  const nz = zeros.filter(Boolean).length;
  const I = ctx.I;
  if (nz >= 2) {
    const k = b.indexOf(Math.max(...b));
    return { kind: 'vertex', v: I[3 * sp.face + k] };
  }
  if (nz === 1) {
    const opp = zeros.indexOf(true);
    const k0 = (opp + 1) % 3;
    const k1 = (opp + 2) % 3;
    const v0 = I[3 * sp.face + k0];
    const v1 = I[3 * sp.face + k1];
    const e = ctx.topo.edgeBetween(v0, v1);
    if (e < 0 || ctx.topo.edgeValence[e] !== 2) return { kind: 'face' };
    const tFromV0 = b[k1] / (b[k0] + b[k1]);
    const t = ctx.topo.edgeV0[e] === v0 ? tFromV0 : 1 - tFromV0;
    return { kind: 'edge', e, t };
  }
  return { kind: 'face' };
}

/** Punto de camino para un punto de superficie (cara, arista o vértice según dónde caiga). */
export function surfacePathPoint(ctx: MeshContext, sp: SurfacePt, seg: number): PathPoint {
  return makePoint(ctx, sp, classify(ctx, sp), seg);
}

function makePoint(ctx: MeshContext, sp: SurfacePt, w: Where, seg: number): PathPoint {
  if (w.kind === 'vertex') return ctx.makeVertexPoint(w.v, seg);
  if (w.kind === 'edge') return ctx.makeEdgePoint(w.e, w.t, seg);
  return ctx.makeFacePoint(sp, seg);
}

/**
 * Camino "recto sobre la superficie" entre dos puntos: intersección de la
 * malla con el plano que contiene a ambos puntos y a la normal media. El
 * resultado son puntos exactos sobre aristas (o vértices) de la malla, de
 * modo que cada tramo queda contenido en un triángulo.
 *
 * No supone que una curva 3D quede pegada a la superficie: el camino se
 * calcula cara por cara sobre la geometría real.
 */
export function walkSurface(ctx: MeshContext, a: SurfacePt, b: SurfacePt, seg = 0, maxLenFactor = 4): PathPoint[] | null {
  const P = ctx.P;
  const I = ctx.I;
  const topo = ctx.topo;
  const FN = ctx.faceNormals;
  const wa = classify(ctx, a);
  const wb = classify(ctx, b);
  const startPt = makePoint(ctx, a, wa, seg);
  const endPt = makePoint(ctx, b, wb, seg);
  const out: PathPoint[] = [startPt];

  /** ¿La cara f contiene a b (en su interior o en su borde)? */
  const containsB = (f: number): boolean => {
    if (f === b.face) return true;
    if (wb.kind === 'edge') return ctx.faceEdgeSlot(f, wb.e) >= 0;
    if (wb.kind === 'vertex') return ctx.faceHasVertex(f, wb.v);
    return false;
  };
  const startFaces: number[] = wa.kind === 'face' ? [a.face] : ctx.facesAround(startPt);
  if (startFaces.some(containsB)) {
    out.push(endPt);
    return out;
  }

  const Dx = b.x - a.x, Dy = b.y - a.y, Dz = b.z - a.z;
  const L = Math.hypot(Dx, Dy, Dz);
  if (L < 1e-12 * ctx.diag) {
    out.push(endPt);
    return out;
  }
  let Nx = FN[3 * a.face] + FN[3 * b.face];
  let Ny = FN[3 * a.face + 1] + FN[3 * b.face + 1];
  let Nz = FN[3 * a.face + 2] + FN[3 * b.face + 2];
  if (Math.hypot(Nx, Ny, Nz) < 1e-6) {
    Nx = FN[3 * a.face];
    Ny = FN[3 * a.face + 1];
    Nz = FN[3 * a.face + 2];
  }
  // Normal del plano de corte m = D × N
  let mx = Dy * Nz - Dz * Ny;
  let my = Dz * Nx - Dx * Nz;
  let mz = Dx * Ny - Dy * Nx;
  const ml = Math.hypot(mx, my, mz);
  if (ml < 1e-9 * L * Math.hypot(Nx, Ny, Nz)) return null;
  mx /= ml;
  my /= ml;
  mz /= ml;
  const eps = 1e-10 * ctx.diag;
  const sd = (v: number) => mx * (P[3 * v] - a.x) + my * (P[3 * v + 1] - a.y) + mz * (P[3 * v + 2] - a.z);

  const maxLen = maxLenFactor * L + 12 * ctx.avgEdge;
  const maxSteps = 200000;
  let length = 0;
  let cx = a.x, cy = a.y, cz = a.z;
  let dirx = Dx / L, diry = Dy / L, dirz = Dz / L;

  /** Mejor salida del plano en una cara (sin la arista de entrada). */
  const exitOf = (face: number, entryEdge: number) => {
    let best: { score: number; kind: 0 | 1; h: number; t: number; v: number; x: number; y: number; z: number } | null = null;
    const s = [sd(I[3 * face]), sd(I[3 * face + 1]), sd(I[3 * face + 2])];
    const e0 = entryEdge >= 0 ? topo.edgeV0[entryEdge] : -1;
    const e1 = entryEdge >= 0 ? topo.edgeV1[entryEdge] : -1;
    for (let k = 0; k < 3; k++) {
      const h = 3 * face + k;
      const v = I[h];
      if (Math.abs(s[k]) <= eps) {
        if (v === e0 || v === e1) continue;
        if (wa.kind === 'vertex' && v === wa.v) continue;
        const px = P[3 * v], py = P[3 * v + 1], pz = P[3 * v + 2];
        const score = (px - cx) * dirx + (py - cy) * diry + (pz - cz) * dirz;
        if (!best || score > best.score) best = { score, kind: 1, h, t: 0, v, x: px, y: py, z: pz };
        continue;
      }
      const k1 = (k + 1) % 3;
      if (Math.abs(s[k1]) <= eps) continue;
      if (s[k] > 0 === s[k1] > 0) continue;
      const e = topo.heEdge[h];
      if (e === entryEdge) continue;
      const t = s[k] / (s[k] - s[k1]);
      const w = I[3 * face + k1];
      const px = P[3 * v] + t * (P[3 * w] - P[3 * v]);
      const py = P[3 * v + 1] + t * (P[3 * w + 1] - P[3 * v + 1]);
      const pz = P[3 * v + 2] + t * (P[3 * w + 2] - P[3 * v + 2]);
      const score = (px - cx) * dirx + (py - cy) * diry + (pz - cz) * dirz;
      if (!best || score > best.score) best = { score, kind: 0, h, t, v: -1, x: px, y: py, z: pz };
    }
    return best;
  };

  const advance = (x: number, y: number, z: number) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d > 1e-14) {
      dirx = dx / d;
      diry = dy / d;
      dirz = dz / d;
    }
    length += d;
    cx = x;
    cy = y;
    cz = z;
  };

  // Estado inicial
  let atVertex = -1;
  let face = a.face;
  let entryEdge = -1;
  let cameFromFace = -1;
  let startFace = a.face;
  if (wa.kind === 'vertex') {
    atVertex = wa.v;
  } else if (wa.kind === 'edge') {
    // Elegir la cara (de las dos de la arista) hacia la que avanza el plano.
    let bestScore = -Infinity;
    for (const f of startFaces) {
      const ex = exitOf(f, wa.e);
      if (ex && ex.score > bestScore) {
        bestScore = ex.score;
        face = f;
      }
    }
    entryEdge = wa.e;
    startFace = face;
  }

  for (let step = 0; step < maxSteps; step++) {
    if (length > maxLen) return null;
    if (atVertex < 0) {
      if (containsB(face)) {
        out.push(endPt);
        return out;
      }
      if (step > 0 && face === startFace) return null; // dio la vuelta sin encontrar b
      const ex = exitOf(face, entryEdge);
      if (!ex) return null;
      if (step === 0 && ex.score <= 0) return null;
      if (ex.kind === 0) {
        const e = topo.heEdge[ex.h];
        const t = I[ex.h] === topo.edgeV0[e] ? ex.t : 1 - ex.t;
        out.push(ctx.makeEdgePoint(e, t, seg));
        advance(ex.x, ex.y, ex.z);
        const nf = ctx.faceAcross(ex.h);
        if (nf < 0) return null;
        cameFromFace = face;
        face = nf;
        entryEdge = e;
      } else {
        out.push(ctx.makeVertexPoint(ex.v, seg));
        advance(ex.x, ex.y, ex.z);
        cameFromFace = face;
        atVertex = ex.v;
      }
    } else {
      const v = atVertex;
      // ¿b está en una cara que toca este vértice?
      for (let i = topo.vOutStart[v]; i < topo.vOutStart[v + 1]; i++) {
        if (containsB((topo.vOut[i] / 3) | 0)) {
          out.push(endPt);
          return out;
        }
      }
      let bestCos = -Infinity;
      let bestKind = -1;
      let bestFace = -1;
      let bestH = -1;
      let bestT = 0;
      let bestV = -1;
      let bx = 0, by = 0, bz = 0;
      for (let i = topo.vOutStart[v]; i < topo.vOutStart[v + 1]; i++) {
        const h0 = topo.vOut[i];
        const g = (h0 / 3) | 0;
        if (g === cameFromFace) continue;
        const hOpp = MeshTopology.next(h0); // arista opuesta a v en g: p→q
        const p = I[hOpp];
        const q = I[MeshTopology.next(hOpp)];
        const sp = sd(p);
        const sq = sd(q);
        const consider = (kind: number, x: number, y: number, z: number, extra: () => void) => {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          const d = Math.hypot(dx, dy, dz);
          if (d < 1e-14) return;
          const cos = (dx * dirx + dy * diry + dz * dirz) / d;
          if (cos > bestCos) {
            bestCos = cos;
            bestKind = kind;
            bx = x; by = y; bz = z;
            extra();
          }
        };
        if (Math.abs(sp) <= eps) {
          consider(1, P[3 * p], P[3 * p + 1], P[3 * p + 2], () => { bestV = p; bestFace = g; });
        }
        if (Math.abs(sq) <= eps) {
          consider(1, P[3 * q], P[3 * q + 1], P[3 * q + 2], () => { bestV = q; bestFace = g; });
        }
        if (Math.abs(sp) > eps && Math.abs(sq) > eps && sp > 0 !== sq > 0) {
          const t = sp / (sp - sq);
          const x = P[3 * p] + t * (P[3 * q] - P[3 * p]);
          const y = P[3 * p + 1] + t * (P[3 * q + 1] - P[3 * p + 1]);
          const z = P[3 * p + 2] + t * (P[3 * q + 2] - P[3 * p + 2]);
          consider(0, x, y, z, () => { bestFace = g; bestH = hOpp; bestT = t; });
        }
      }
      if (bestKind < 0 || bestCos <= -0.2) return null;
      if (bestKind === 0) {
        if (containsB(bestFace)) {
          out.push(endPt);
          return out;
        }
        const e = topo.heEdge[bestH];
        const t = I[bestH] === topo.edgeV0[e] ? bestT : 1 - bestT;
        out.push(ctx.makeEdgePoint(e, t, seg));
        advance(bx, by, bz);
        const nf = ctx.faceAcross(bestH);
        if (nf < 0) return null;
        cameFromFace = bestFace;
        face = nf;
        entryEdge = e;
        atVertex = -1;
      } else {
        out.push(ctx.makeVertexPoint(bestV, seg));
        advance(bx, by, bz);
        cameFromFace = -1;
        atVertex = bestV;
      }
    }
  }
  return null;
}
