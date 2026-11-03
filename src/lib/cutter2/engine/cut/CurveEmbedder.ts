import type { IndexedMesh, PathPoint } from '../core/types';
import { PK_EDGE, PK_FACE, PK_VERTEX } from '../core/types';
import type { MeshContext } from '../core/MeshContext';
import { pathPointKey } from '../core/MeshContext';
import { GeometryError } from '../core/TaskContext';
import { orient, planarFaces, triangulatePolygon } from './polygon2d';

export interface EmbedResult {
  mesh: IndexedMesh;
  /** Vértices del primer lazo en la malla nueva, en orden. */
  loop: number[];
  /** Vértices de cada lazo en la malla nueva, en el orden de los caminos. */
  loops: number[][];
  /** Cara original de la que proviene cada cara nueva. */
  faceOrigin: Int32Array;
  /** Primer índice de vértice agregado. */
  newVertexStart: number;
  /** Caras originales que fueron subdivididas. */
  touchedFaces: number;
}

/** Incrusta un camino cerrado (ver `embedPaths`). */
export function embedPath(ctx: MeshContext, path: PathPoint[]): EmbedResult {
  return embedPaths(ctx, [path]);
}

/**
 * Incrusta uno o más caminos cerrados en la malla: cada triángulo atravesado
 * se subdivide en su propio plano (triangulación restringida local) para que
 * los caminos queden formados por aristas. La superficie exterior no cambia:
 * todos los triángulos nuevos son coplanares con su triángulo de origen.
 *
 * Varios caminos se incrustan juntos (un triángulo puede ser atravesado por
 * más de uno). No pueden tocarse ni cruzarse: cada lazo tiene que delimitar
 * su propia zona.
 */
export function embedPaths(ctx: MeshContext, paths: PathPoint[][]): EmbedResult {
  const { P, I, topo } = ctx;
  const nV0 = topo.nV;
  if (!paths.length) throw new GeometryError('No hay perímetros para incrustar.', 'embed-empty-set');
  const label = (k: number) => (paths.length > 1 ? `El perímetro ${k + 1}` : 'El perímetro');

  // 1) Identificadores de vértice para cada punto de cada camino.
  const newPos: number[] = [];
  const keyToVid = new Map<string, number>();
  const owner = new Map<number, number>();
  const vidsOf: Int32Array[] = [];
  for (let k = 0; k < paths.length; k++) {
    const path = paths[k];
    const m = path.length;
    if (m < 3) throw new GeometryError(`${label(k)} es demasiado corto.`, 'embed-short');
    const vids = new Int32Array(m);
    for (let i = 0; i < m; i++) {
      const p = path[i];
      let vid: number;
      if (p.kind === PK_VERTEX) vid = p.id;
      else {
        const key = pathPointKey(p);
        const known = keyToVid.get(key);
        if (known === undefined) {
          vid = nV0 + newPos.length / 3;
          newPos.push(p.x, p.y, p.z);
          keyToVid.set(key, vid);
        } else vid = known;
      }
      const o = owner.get(vid);
      if (o !== undefined && o !== k) {
        throw new GeometryError(
          `Los perímetros ${o + 1} y ${k + 1} se tocan. Cada perímetro tiene que rodear su propia zona: separalos un poco.`,
          'loops-touch',
          `vértice ${vid}`,
        );
      }
      owner.set(vid, k);
      vids[i] = vid;
    }
    vidsOf.push(vids);
  }
  const nNew = newPos.length / 3;
  const pos = new Float64Array((nV0 + nNew) * 3);
  pos.set(P);
  pos.set(newPos, nV0 * 3);

  // 2) Puntos sobre aristas y cuerdas por cara.
  const edgePoints = new Map<number, Array<{ t: number; vid: number }>>();
  const facePointsInterior = new Map<number, number[]>();
  const chords = new Map<number, Array<[number, number, number]>>();
  for (let k = 0; k < paths.length; k++) {
    const path = paths[k];
    const vids = vidsOf[k];
    const m = path.length;
    for (let i = 0; i < m; i++) {
      const p = path[i];
      if (p.kind === PK_EDGE) {
        let l = edgePoints.get(p.id);
        if (!l) edgePoints.set(p.id, (l = []));
        if (!l.some((x) => x.vid === vids[i])) l.push({ t: p.t, vid: vids[i] });
      } else if (p.kind === PK_FACE) {
        let l = facePointsInterior.get(p.id);
        if (!l) facePointsInterior.set(p.id, (l = []));
        if (!l.includes(vids[i])) l.push(vids[i]);
      }
    }
    for (let i = 0; i < m; i++) {
      const p = path[i];
      const q = path[(i + 1) % m];
      if (vids[i] === vids[(i + 1) % m]) continue;
      if (ctx.segmentOnEdge(p, q) >= 0) continue;
      const f = ctx.commonFace(p, q);
      if (f < 0) throw new GeometryError(`${label(k)} tiene tramos desconectados.`, 'embed-gap', `segmento ${i}`);
      let l = chords.get(f);
      if (!l) chords.set(f, (l = []));
      l.push([vids[i], vids[(i + 1) % m], k]);
    }
  }
  for (const l of edgePoints.values()) l.sort((a, b) => a.t - b.t);

  // 3) Caras afectadas
  const affected = new Set<number>();
  for (const f of chords.keys()) affected.add(f);
  for (const f of facePointsInterior.keys()) affected.add(f);
  for (const e of edgePoints.keys()) {
    const h = topo.edgeHe[e];
    affected.add((h / 3) | 0);
    const t = topo.twin[h];
    if (t >= 0) affected.add((t / 3) | 0);
  }

  // 4) Retriangular cada cara afectada en su plano.
  const outIdx: number[] = [];
  const outOrigin: number[] = [];
  const nF = topo.nF;
  for (let f = 0; f < nF; f++) {
    if (affected.has(f)) continue;
    outIdx.push(I[3 * f], I[3 * f + 1], I[3 * f + 2]);
    outOrigin.push(f);
  }
  for (const f of affected) {
    const c = [I[3 * f], I[3 * f + 1], I[3 * f + 2]];
    // Marco ortonormal de la cara
    const ax = pos[3 * c[0]], ay = pos[3 * c[0] + 1], az = pos[3 * c[0] + 2];
    let e1x = pos[3 * c[1]] - ax, e1y = pos[3 * c[1] + 1] - ay, e1z = pos[3 * c[1] + 2] - az;
    const l1 = Math.hypot(e1x, e1y, e1z);
    e1x /= l1; e1y /= l1; e1z /= l1;
    const ux = pos[3 * c[2]] - ax, uy = pos[3 * c[2] + 1] - ay, uz = pos[3 * c[2] + 2] - az;
    let nx = e1y * uz - e1z * uy, ny = e1z * ux - e1x * uz, nz = e1x * uy - e1y * ux;
    const ln = Math.hypot(nx, ny, nz);
    nx /= ln; ny /= ln; nz /= ln;
    const e2x = ny * e1z - nz * e1y, e2y = nz * e1x - nx * e1z, e2z = nx * e1y - ny * e1x;

    // Polígono de borde con puntos insertados
    const boundary: number[] = [];
    for (let k = 0; k < 3; k++) {
      const v = c[k];
      boundary.push(v);
      const e = topo.heEdge[3 * f + k];
      const pts = edgePoints.get(e);
      if (pts) {
        const forward = topo.edgeV0[e] === v;
        const list = forward ? pts : pts.slice().reverse();
        for (const p of list) boundary.push(p.vid);
      }
    }
    const interior = facePointsInterior.get(f) ?? [];
    const allNodes = [...boundary, ...interior];
    const local = new Map<number, number>();
    allNodes.forEach((v, i) => local.set(v, i));
    const X = new Float64Array(allNodes.length);
    const Y = new Float64Array(allNodes.length);
    allNodes.forEach((v, i) => {
      const dx = pos[3 * v] - ax, dy = pos[3 * v + 1] - ay, dz = pos[3 * v + 2] - az;
      X[i] = dx * e1x + dy * e1y + dz * e1z;
      Y[i] = dx * e2x + dy * e2y + dz * e2z;
    });
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < boundary.length; i++) edges.push([local.get(boundary[i])!, local.get(boundary[(i + 1) % boundary.length])!]);
    const faceChords = chords.get(f) ?? [];
    const localChords: Array<[number, number, number]> = [];
    for (const [a, b, k] of faceChords) {
      const la = local.get(a);
      const lb = local.get(b);
      if (la === undefined || lb === undefined) {
        throw new GeometryError(`${label(k)} no pudo incrustarse en la malla.`, 'embed-chord', `cara ${f}`);
      }
      edges.push([la, lb]);
      localChords.push([la, lb, k]);
    }
    // Dos tramos que se cruzan dentro del mismo triángulo: los perímetros se cruzan.
    for (let i = 0; i < localChords.length; i++) {
      for (let j = i + 1; j < localChords.length; j++) {
        const [a, b, ka] = localChords[i];
        const [cc, d, kb] = localChords[j];
        if (a === cc || a === d || b === cc || b === d) continue;
        if (segmentsCross(X[a], Y[a], X[b], Y[b], X[cc], Y[cc], X[d], Y[d])) {
          throw new GeometryError(
            ka === kb ? `${label(ka)} se cruza consigo mismo.` : `Los perímetros ${Math.min(ka, kb) + 1} y ${Math.max(ka, kb) + 1} se cruzan. Separalos para que cada uno rodee su propia zona.`,
            ka === kb ? 'loop-self-cross' : 'loops-cross',
            `cara ${f}`,
          );
        }
      }
    }
    const faces = planarFaces(allNodes.map((_, i) => i), edges, X, Y);
    let produced = 0;
    for (const poly of faces) {
      const tris = triangulatePolygon(poly, X, Y);
      if (!tris) throw new GeometryError('No se pudo subdividir un triángulo atravesado por el perímetro.', 'embed-triangulate', `cara ${f}`);
      for (const [a, b, cc] of tris) {
        outIdx.push(allNodes[a], allNodes[b], allNodes[cc]);
        outOrigin.push(f);
        produced++;
      }
    }
    if (produced === 0) throw new GeometryError('Falló la subdivisión local de la malla.', 'embed-empty', `cara ${f}`);
  }

  // 5) Lazos de vértices (sin repeticiones consecutivas).
  const loops = vidsOf.map((vids, k) => {
    const loop: number[] = [];
    for (let i = 0; i < vids.length; i++) {
      const v = vids[i];
      if (loop.length && loop[loop.length - 1] === v) continue;
      loop.push(v);
    }
    if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
    if (loop.length < 3) throw new GeometryError(`${label(k)} es demasiado corto.`, 'embed-short');
    return loop;
  });

  return {
    mesh: { positions: pos, indices: Uint32Array.from(outIdx) },
    loop: loops[0],
    loops,
    faceOrigin: Int32Array.from(outOrigin),
    newVertexStart: nV0,
    touchedFaces: affected.size,
  };
}

/** Cruce propio de dos segmentos 2D (sin contar extremos compartidos ni toques). */
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}
