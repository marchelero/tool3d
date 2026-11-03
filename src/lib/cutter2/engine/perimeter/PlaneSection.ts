import type { PathPoint, Vec3 } from '../core/types';
import type { MeshContext } from '../core/MeshContext';

/**
 * Intersección exacta de la malla con un plano, como lazos cerrados de
 * puntos sobre aristas. Usa una perturbación simbólica: los vértices sobre
 * el plano se consideran apenas por encima, de modo que cada cara cortada
 * aporta exactamente un segmento y los lazos son simples.
 */
export function planeSectionLoops(ctx: MeshContext, origin: Vec3, normal: Vec3): PathPoint[][] {
  const { P, topo } = ctx;
  const nV = topo.nV;
  const d = new Float64Array(nV);
  const eps = 1e-12 * ctx.diag;
  for (let v = 0; v < nV; v++) {
    let s = (P[3 * v] - origin[0]) * normal[0] + (P[3 * v + 1] - origin[1]) * normal[1] + (P[3 * v + 2] - origin[2]) * normal[2];
    if (Math.abs(s) < eps) s = eps; // perturbación simbólica
    d[v] = s;
  }
  const crossing = new Int8Array(topo.nE);
  for (let e = 0; e < topo.nE; e++) {
    if (topo.edgeValence[e] !== 2) continue;
    crossing[e] = d[topo.edgeV0[e]] > 0 !== d[topo.edgeV1[e]] > 0 ? 1 : 0;
  }
  const visited = new Uint8Array(topo.nE);
  const loops: PathPoint[][] = [];
  for (let e0 = 0; e0 < topo.nE; e0++) {
    if (!crossing[e0] || visited[e0]) continue;
    const loop: PathPoint[] = [];
    let e = e0;
    let h = topo.edgeHe[e];
    let guard = 0;
    let closed = false;
    while (guard++ < 4_000_000) {
      visited[e] = 1;
      const v0 = topo.edgeV0[e], v1 = topo.edgeV1[e];
      const t = d[v0] / (d[v0] - d[v1]);
      loop.push(ctx.makeEdgePoint(e, t, 0));
      // Cruzar a la cara de h y buscar la otra arista cortada.
      const f = (h / 3) | 0;
      let next = -1;
      let nextH = -1;
      for (let k = 0; k < 3; k++) {
        const hk = 3 * f + k;
        const ek = topo.heEdge[hk];
        if (ek !== e && crossing[ek]) {
          next = ek;
          nextH = hk;
          break;
        }
      }
      if (next < 0) break;
      if (next === e0) {
        closed = true;
        break;
      }
      if (visited[next]) break;
      e = next;
      const tw = topo.twin[nextH];
      if (tw < 0) break;
      h = tw;
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Distancia de un punto a una polilínea cerrada de puntos de camino. */
export function distanceToLoop(x: number, y: number, z: number, loop: PathPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const l2 = ux * ux + uy * uy + uz * uz;
    let t = l2 > 0 ? ((x - a.x) * ux + (y - a.y) * uy + (z - a.z) * uz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dd = Math.hypot(x - a.x - t * ux, y - a.y - t * uy, z - a.z - t * uz);
    if (dd < best) best = dd;
  }
  return best;
}
