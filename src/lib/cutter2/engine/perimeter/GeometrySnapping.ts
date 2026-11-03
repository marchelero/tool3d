import type { PathPoint } from '../core/types';
import { PK_EDGE, PK_FACE } from '../core/types';
import type { MeshContext, SurfacePt } from '../core/MeshContext';
import { samePathPoint } from '../core/MeshContext';
import { closestPointOnTriangle, type ClosestResult } from '../core/geometry';
import { MinHeap } from '../core/heap';
import { surfacePathPoint } from './SurfaceWalker';

/**
 * GeometrySnapping: proyección local sobre la superficie, ajuste a vértices
 * y aristas, y caminos de costo mínimo (imán a valles y respaldo geodésico).
 */

const tmp: ClosestResult = { x: 0, y: 0, z: 0, u: 0, v: 0, w: 0 };

/**
 * Proyecta un punto sobre la superficie buscando solo en el vecindario de
 * `nearFace` (anillos de vértices). Así nunca salta a otra superficie
 * cercana en el espacio pero lejana sobre la malla.
 */
export function projectLocal(ctx: MeshContext, x: number, y: number, z: number, nearFace: number, rings = 2, maxRings = 6): SurfacePt {
  const { P, I, topo } = ctx;
  const visited = new Set<number>([nearFace]);
  let frontier = [nearFace];
  const ringOf = new Map<number, number>([[nearFace, 0]]);
  let bestFace = nearFace;
  let bestD = Infinity;
  let bu = 1, bv = 0, bw = 0, bx = 0, by = 0, bz = 0;
  const test = (f: number) => {
    const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
    closestPointOnTriangle(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], tmp);
    const d = (tmp.x - x) ** 2 + (tmp.y - y) ** 2 + (tmp.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      bestFace = f;
      bu = tmp.u; bv = tmp.v; bw = tmp.w;
      bx = tmp.x; by = tmp.y; bz = tmp.z;
    }
  };
  test(nearFace);
  let ring = 0;
  let limit = rings;
  while (ring < limit && frontier.length) {
    ring++;
    const next: number[] = [];
    for (const f of frontier) {
      for (let k = 0; k < 3; k++) {
        const v = I[3 * f + k];
        for (let i = topo.vOutStart[v]; i < topo.vOutStart[v + 1]; i++) {
          const g = (topo.vOut[i] / 3) | 0;
          if (visited.has(g)) continue;
          visited.add(g);
          ringOf.set(g, ring);
          next.push(g);
          test(g);
        }
      }
    }
    frontier = next;
    // Si el mejor está en el anillo exterior, ampliar la búsqueda.
    if (ring === limit && ringOf.get(bestFace) === ring && limit < maxRings) limit++;
  }
  return { face: bestFace, b0: bu, b1: bv, b2: bw, x: bx, y: by, z: bz };
}

export interface SnapOptions {
  /** Tolerancia relativa a la longitud de arista local (0..0.5). */
  relTol: number;
  /** Desplazamiento máximo absoluto (mm). */
  maxSnap: number;
}

export function defaultSnapOptions(ctx: MeshContext): SnapOptions {
  return { relTol: 0.12, maxSnap: Math.min(0.25, 0.002 * ctx.diag) };
}

/**
 * Ajusta puntos muy cercanos a vértices o aristas para evitar triángulos
 * astilla al incrustar el perímetro. Los desplazamientos son menores que una
 * fracción de la arista local y el resultado es el mismo que se muestra y
 * que se corta (no hay diferencias entre vista y exportación).
 */
export function snapPath(ctx: MeshContext, path: PathPoint[], closed: boolean, opts = defaultSnapOptions(ctx)): PathPoint[] {
  const { P, I, topo } = ctx;
  const out: PathPoint[] = [];
  for (const p0 of path) {
    let p = p0;
    const rel = p.pinned ? opts.relTol / 3 : opts.relTol;
    if (p.kind === PK_EDGE) {
      const L = ctx.edgeLength(p.id);
      const tol = Math.min(rel * L, opts.maxSnap);
      if (p.t * L <= tol) p = { ...ctx.makeVertexPoint(topo.edgeV0[p.id], p.seg, p.pinned) };
      else if ((1 - p.t) * L <= tol) p = { ...ctx.makeVertexPoint(topo.edgeV1[p.id], p.seg, p.pinned) };
    } else if (p.kind === PK_FACE) {
      const f = p.id;
      const vids = [I[3 * f], I[3 * f + 1], I[3 * f + 2]];
      const pts = vids.map((v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]]);
      const edgeLen = [0, 1, 2].map((k) => Math.hypot(pts[(k + 1) % 3][0] - pts[k][0], pts[(k + 1) % 3][1] - pts[k][1], pts[(k + 1) % 3][2] - pts[k][2]));
      const minEdge = Math.min(...edgeLen);
      const tolV = Math.min(rel * minEdge, opts.maxSnap);
      let snapped = false;
      for (let k = 0; k < 3; k++) {
        const d = Math.hypot(p.x - pts[k][0], p.y - pts[k][1], p.z - pts[k][2]);
        if (d <= tolV) {
          p = ctx.makeVertexPoint(vids[k], p.seg, p.pinned);
          snapped = true;
          break;
        }
      }
      if (!snapped) {
        // Distancia a cada arista k (de vids[k] a vids[k+1]) = bary del vértice opuesto × altura.
        const bary = [p.b0, p.b1, p.b2];
        for (let k = 0; k < 3; k++) {
          const opp = (k + 2) % 3;
          const ux = pts[(k + 1) % 3][0] - pts[k][0], uy = pts[(k + 1) % 3][1] - pts[k][1], uz = pts[(k + 1) % 3][2] - pts[k][2];
          const wx = pts[opp][0] - pts[k][0], wy = pts[opp][1] - pts[k][1], wz = pts[opp][2] - pts[k][2];
          const area2 = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx);
          const h = area2 / (edgeLen[k] || 1);
          const d = bary[opp] * h;
          const tolE = Math.min(rel * edgeLen[k], opts.maxSnap);
          if (d <= tolE) {
            const e = topo.heEdge[3 * f + k];
            // Parámetro sobre la arista (de vids[k] a vids[k+1]) proyectando el punto.
            const qx = p.x - pts[k][0], qy = p.y - pts[k][1], qz = p.z - pts[k][2];
            let t = (qx * ux + qy * uy + qz * uz) / (edgeLen[k] ** 2);
            t = Math.min(1, Math.max(0, t));
            const te = vids[k] === topo.edgeV0[e] ? t : 1 - t;
            p = ctx.makeEdgePoint(e, te, p.seg, p.pinned);
            const L = edgeLen[k];
            const tol = Math.min(rel * L, opts.maxSnap);
            if (p.t * L <= tol) p = ctx.makeVertexPoint(topo.edgeV0[e], p.seg, p.pinned);
            else if ((1 - p.t) * L <= tol) p = ctx.makeVertexPoint(topo.edgeV1[e], p.seg, p.pinned);
            break;
          }
        }
      }
    }
    const last = out[out.length - 1];
    if (last && samePathPoint(last, p)) {
      if (p.pinned && !last.pinned) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return cleanupPath(out, closed);
}

/** Quita duplicados consecutivos y retrocesos A-B-A. */
export function cleanupPath(path: PathPoint[], closed: boolean): PathPoint[] {
  let pts = path.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    if (closed && pts.length > 1 && samePathPoint(pts[0], pts[pts.length - 1])) {
      const last = pts.pop()!;
      if (last.pinned && !pts[0].pinned) pts[0] = last;
      changed = true;
    }
    const out: PathPoint[] = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && samePathPoint(last, p)) {
        if (p.pinned && !last.pinned) out[out.length - 1] = p;
        changed = true;
        continue;
      }
      // Retroceso: ... A B A ... -> ... A ...
      if (out.length >= 2 && samePathPoint(out[out.length - 2], p) && !out[out.length - 1].pinned) {
        out.pop();
        changed = true;
        continue;
      }
      out.push(p);
    }
    pts = out;
    if (closed && pts.length >= 3) {
      const n = pts.length;
      if (samePathPoint(pts[n - 2], pts[0]) && !pts[n - 1].pinned) {
        pts.pop();
        changed = true;
      } else if (samePathPoint(pts[n - 1], pts[1]) && !pts[0].pinned) {
        pts.shift();
        changed = true;
      }
    }
  }
  return pts;
}

/**
 * Elimina quiebres dentro de un mismo triángulo: si tres puntos consecutivos
 * P, Q, R están en la clausura de una misma cara, Q sobra (el tramo P→R
 * sigue dentro de esa cara). Evita pliegues en "Z" que harían coincidir la
 * superficie de corte con caras de la malla. Un punto de control solo se
 * quita si está prácticamente sobre P→R (y su marca pasa a R).
 */
export function straightenPath(ctx: MeshContext, path: PathPoint[], closed: boolean, pinnedTol?: number): PathPoint[] {
  const tol = pinnedTol ?? 0.05 * ctx.avgEdge;
  let pts = path.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 20 && pts.length > 3) {
    changed = false;
    const out: PathPoint[] = [];
    const n = pts.length;
    const removed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      // Vecinos vigentes
      let ip = (i - 1 + n) % n;
      while (removed[ip] && ip !== i) ip = (ip - 1 + n) % n;
      const ir = (i + 1) % n;
      if (ip === i || ip === ir || removed[ir]) continue;
      const P = pts[ip], Q = pts[i], R = pts[ir];
      if (Q.pinned) {
        // distancia de Q al segmento PR
        const ux = R.x - P.x, uy = R.y - P.y, uz = R.z - P.z;
        const l2 = ux * ux + uy * uy + uz * uz;
        let t = l2 > 0 ? ((Q.x - P.x) * ux + (Q.y - P.y) * uy + (Q.z - P.z) * uz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(Q.x - P.x - t * ux, Q.y - P.y - t * uy, Q.z - P.z - t * uz);
        if (d > tol) continue;
      }
      if (sharedFace(ctx, P, Q, R) < 0) continue;
      removed[i] = 1;
      if (Q.pinned) pts[ir] = { ...R, pinned: true };
      changed = true;
    }
    for (let i = 0; i < n; i++) if (!removed[i]) out.push(pts[i]);
    pts = out;
  }
  return shortcutPath(ctx, cleanupPath(pts, closed), closed, tol);
}

/**
 * Atajos locales: si dos puntos no consecutivos del camino comparten un
 * triángulo y el tramo entre ellos es corto, se reemplaza por el segmento
 * directo (que queda dentro de ese triángulo). Elimina muescas del tamaño de
 * un triángulo que, al cerrar la pieza, harían coincidir la tapa con aristas
 * de la malla.
 */
export function shortcutPath(ctx: MeshContext, path: PathPoint[], closed: boolean, pinnedTol: number, lookAhead = 8): PathPoint[] {
  let pts = path.slice();
  for (let pass = 0; pass < 6; pass++) {
    const n = pts.length;
    if (n < 5) break;
    if (closed && pass > 0) {
      // Rotar para cubrir también la zona del cierre del lazo.
      const off = Math.floor(n / 2) + pass;
      pts = [...pts.slice(off % n), ...pts.slice(0, off % n)];
    }
    let changed = false;
    const keep = new Uint8Array(n).fill(1);
    let i = 0;
    const limit = n - 1;
    while (i < limit) {
      const A = pts[i];
      let best = -1;
      let arc = 0;
      for (let s = 1; s <= lookAhead && i + s < n; s++) {
        const j = i + s;
        const prev = pts[i + s - 1];
        const B = pts[j];
        arc += Math.hypot(B.x - prev.x, B.y - prev.y, B.z - prev.z);
        if (s < 2) continue;
        // Los intermedios no deben ser puntos de control lejanos al atajo.
        let ok = true;
        for (let t = 1; t < s && ok; t++) {
          const Q = pts[(i + t) % n];
          if (!keep[(i + t) % n]) ok = false;
          else if (Q.pinned && distToSegment(Q, A, B) > pinnedTol) ok = false;
        }
        if (!ok) break;
        const chord = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
        if (arc > 3 * chord + 2 * ctx.avgEdge) continue;
        if (ctx.commonFace(A, B) >= 0) best = s;
      }
      if (best >= 2) {
        let pinned = false;
        for (let t = 1; t < best; t++) {
          const k = (i + t) % n;
          if (pts[k].pinned) pinned = true;
          keep[k] = 0;
        }
        const jb = (i + best) % n;
        if (pinned && !pts[jb].pinned) pts[jb] = { ...pts[jb], pinned: true };
        changed = true;
        i += best;
      } else {
        i++;
      }
    }
    if (!changed && pass > 0) break;
    pts = pts.filter((_, k) => keep[k]);
  }
  if (closed && pts.length) {
    // Volver a empezar en el primer punto de control (numeración de tramos).
    let start = 0;
    let bestSeg = Infinity;
    pts.forEach((p, k) => {
      if (p.pinned && p.seg < bestSeg) {
        bestSeg = p.seg;
        start = k;
      }
    });
    pts = [...pts.slice(start), ...pts.slice(0, start)];
  }
  return cleanupPath(pts, closed);
}

function distToSegment(Q: PathPoint, P: PathPoint, R: PathPoint): number {
  const ux = R.x - P.x, uy = R.y - P.y, uz = R.z - P.z;
  const l2 = ux * ux + uy * uy + uz * uz;
  let t = l2 > 0 ? ((Q.x - P.x) * ux + (Q.y - P.y) * uy + (Q.z - P.z) * uz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(Q.x - P.x - t * ux, Q.y - P.y - t * uy, Q.z - P.z - t * uz);
}

function sharedFace(ctx: MeshContext, P: PathPoint, Q: PathPoint, R: PathPoint): number {
  for (const f of ctx.facesAround(Q)) {
    if (ctx.pointOnFace(P, f) && ctx.pointOnFace(R, f)) return f;
  }
  return -1;
}

/** Vértices de la cara que contiene al punto, con su distancia. */
function faceCorners(ctx: MeshContext, sp: SurfacePt): Array<{ v: number; d: number }> {
  const { P, I } = ctx;
  const out: Array<{ v: number; d: number }> = [];
  for (let k = 0; k < 3; k++) {
    const v = I[3 * sp.face + k];
    out.push({ v, d: Math.hypot(P[3 * v] - sp.x, P[3 * v + 1] - sp.y, P[3 * v + 2] - sp.z) });
  }
  return out;
}

/**
 * Dijkstra sobre el grafo de vértices entre dos puntos de superficie. El
 * costo de cada arista lo define `edgeCost` (longitud × factor). `allowed`
 * restringe los vértices utilizables (corredor).
 */
export function dijkstraSurface(
  ctx: MeshContext,
  a: SurfacePt,
  b: SurfacePt,
  edgeCost: (v0: number, v1: number, len: number) => number,
  allowed: ((v: number) => boolean) | null,
  seg: number,
  maxVisit = 2_000_000,
): PathPoint[] | null {
  if (a.face === b.face) return [surfacePathPoint(ctx, a, seg), surfacePathPoint(ctx, b, seg)];
  const { P, topo } = ctx;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new MinHeap(256);
  for (const { v, d } of faceCorners(ctx, a)) {
    if (allowed && !allowed(v)) continue;
    const c = edgeCost(-1, v, d);
    if (c < (dist.get(v) ?? Infinity)) {
      dist.set(v, c);
      prev.set(v, -1);
      heap.push(c, v);
    }
  }
  const targets = new Map<number, number>();
  for (const { v, d } of faceCorners(ctx, b)) targets.set(v, edgeCost(v, -1, d));
  let bestTotal = Infinity;
  let bestEnd = -1;
  let visits = 0;
  while (heap.size) {
    const v = heap.pop();
    const dv = heap.lastKey;
    if (dv > (dist.get(v) ?? Infinity)) continue;
    if (dv >= bestTotal) break;
    if (++visits > maxVisit) break;
    const tc = targets.get(v);
    if (tc !== undefined && dv + tc < bestTotal) {
      bestTotal = dv + tc;
      bestEnd = v;
    }
    for (let i = topo.vOutStart[v]; i < topo.vOutStart[v + 1]; i++) {
      const h = topo.vOut[i];
      const w = topo.dest(h);
      if (allowed && !allowed(w)) continue;
      const len = Math.hypot(P[3 * w] - P[3 * v], P[3 * w + 1] - P[3 * v + 1], P[3 * w + 2] - P[3 * v + 2]);
      const nd = dv + edgeCost(v, w, len);
      if (nd < (dist.get(w) ?? Infinity)) {
        dist.set(w, nd);
        prev.set(w, v);
        heap.push(nd, w);
      }
    }
    // Las aristas entrantes de vértices de borde no aparecen como salientes
    // de v en mallas abiertas; para mallas cerradas basta con las salientes.
  }
  if (bestEnd < 0) return null;
  const verts: number[] = [];
  for (let v = bestEnd; v >= 0; v = prev.get(v) ?? -1) verts.push(v);
  verts.reverse();
  const out: PathPoint[] = [surfacePathPoint(ctx, a, seg)];
  for (const v of verts) out.push(ctx.makeVertexPoint(v, seg));
  out.push(surfacePathPoint(ctx, b, seg));
  return cleanupPath(out, false);
}

/** Camino geodésico aproximado (solo longitud) dentro de un corredor elíptico. */
export function shortestPathFallback(ctx: MeshContext, a: SurfacePt, b: SurfacePt, seg: number): PathPoint[] | null {
  const { P } = ctx;
  const chord = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const budget = chord * 1.8 + 6 * ctx.avgEdge;
  const allowed = (v: number) =>
    Math.hypot(P[3 * v] - a.x, P[3 * v + 1] - a.y, P[3 * v + 2] - a.z) + Math.hypot(P[3 * v] - b.x, P[3 * v + 1] - b.y, P[3 * v + 2] - b.z) <= budget;
  const r = dijkstraSurface(ctx, a, b, (_v0, _v1, len) => len, allowed, seg);
  if (r) return r;
  return dijkstraSurface(ctx, a, b, (_v0, _v1, len) => len, null, seg);
}

/**
 * Imán a bordes naturales: camino de costo mínimo que favorece valles de
 * concavidad, sin alejarse más de un corredor de la curva guía (la spline
 * del usuario). `strength` 0..1. Los puntos de control nunca se mueven.
 */
export function magnetPath(
  ctx: MeshContext,
  a: SurfacePt,
  b: SurfacePt,
  guide: Array<[number, number, number]>,
  strength: number,
  valley: Float32Array,
  seg: number,
): PathPoint[] | null {
  const { P } = ctx;
  const chord = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const R = Math.max(5 * ctx.avgEdge, 0.3 * chord) * (0.6 + 0.8 * strength);
  const pts = guide.length >= 2 ? guide : [[a.x, a.y, a.z], [b.x, b.y, b.z]] as Array<[number, number, number]>;
  // Caja del corredor
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k] - R);
      max[k] = Math.max(max[k], p[k] + R);
    }
  }
  const distCache = new Map<number, number>();
  const distToGuide = (v: number): number => {
    const d = distCache.get(v);
    if (d !== undefined) return d;
    const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
    if (x < min[0] || y < min[1] || z < min[2] || x > max[0] || y > max[1] || z > max[2]) {
      distCache.set(v, Infinity);
      return Infinity;
    }
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1];
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
      const l2 = ux * ux + uy * uy + uz * uz;
      let t = l2 > 0 ? ((x - p[0]) * ux + (y - p[1]) * uy + (z - p[2]) * uz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dd = Math.hypot(x - p[0] - t * ux, y - p[1] - t * uy, z - p[2] - t * uz);
      if (dd < best) best = dd;
    }
    distCache.set(v, best);
    return best;
  };
  const s = Math.max(0, Math.min(1, strength));
  const cost = (v0: number, v1: number, len: number) => {
    const d0 = v0 >= 0 ? distToGuide(v0) : 0;
    const d1 = v1 >= 0 ? distToGuide(v1) : 0;
    const vv0 = v0 >= 0 ? valley[v0] : v1 >= 0 ? valley[v1] : 0;
    const vv1 = v1 >= 0 ? valley[v1] : vv0;
    const dm = (d0 + d1) / 2 / R;
    const vm = (vv0 + vv1) / 2;
    return len * ((1 - s) * (1 + 6 * dm * dm) + s * (0.06 + (1 - vm) * (1 - vm)));
  };
  return dijkstraSurface(ctx, a, b, cost, (v) => distToGuide(v) <= R, seg);
}
