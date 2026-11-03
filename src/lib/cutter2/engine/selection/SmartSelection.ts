import type { MeshContext } from '../core/MeshContext';
import { MinHeap } from '../core/heap';
import { computeCurvature } from '../analysis/curvature';

/**
 * Segmentación jerárquica para la varita inteligente.
 *
 * 1. Altitud por cara = concavidad (valles, ángulos diedros cóncavos y
 *    curvatura media suavizada).
 * 2. Marcadores = zonas convexas o planas conectadas.
 * 3. Inundación (watershed) desde los marcadores: las fronteras quedan en el
 *    fondo de los valles (por ejemplo, la base de una nariz).
 * 4. Fusión jerárquica por saliencia de frontera: primero se unen las
 *    fronteras débiles y las regiones diminutas. El usuario elige el nivel
 *    con la sensibilidad, sin recalcular la geometría.
 */
export interface Segmentation {
  /** Región base por cara. */
  faceRegion: Int32Array;
  regionCount: number;
  /** Área por región base. */
  regionArea: Float64Array;
  /** Fusiones: tripletas (regiónA, regiónB, costo) en orden de costo creciente. */
  merges: Float64Array;
}

export function segmentMesh(ctx: MeshContext): Segmentation {
  const cached = ctx.cache.get('segmentation') as Segmentation | undefined;
  if (cached) return cached;
  const { topo, faceNormals: FN, faceAreas } = ctx;
  const nF = topo.nF;
  const adj = ctx.faceAdj;
  const curv = computeCurvature(ctx);
  const I = ctx.I;
  const P = ctx.P;

  // Altitud por cara: concavidad suave + pliegues cóncavos agudos.
  const alt = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    let crease = 0;
    for (let k = 0; k < 3; k++) {
      const g = adj[3 * f + k];
      if (g < 0) continue;
      const dot = FN[3 * f] * FN[3 * g] + FN[3 * f + 1] * FN[3 * g + 1] + FN[3 * f + 2] * FN[3 * g + 2];
      if (dot > 0.985) continue; // < ~10°
      // ¿Cóncava? el baricentro de g queda "por encima" del plano de f
      const ca = centroid(P, I, f);
      const cb = centroid(P, I, g);
      const s = (cb[0] - ca[0]) * FN[3 * f] + (cb[1] - ca[1]) * FN[3 * f + 1] + (cb[2] - ca[2]) * FN[3 * f + 2];
      if (s > 0) crease = Math.max(crease, Math.min(1, (1 - dot) * 3));
    }
    alt[f] = Math.max(curv.valleyFace[f], crease);
  }

  // Marcadores: componentes conexas de caras bajas.
  const totalArea = faceAreas.reduce((a, b) => a + b, 0);
  const minMarkerArea = 0.0004 * totalArea;
  const label = new Int32Array(nF).fill(-1);
  const thresholds = [0.06, 0.12, 0.2];
  let regionCount = 0;
  for (const th of thresholds) {
    if (regionCount > 0) break;
    label.fill(-1);
    regionCount = 0;
    const tmp = new Int32Array(nF).fill(-1);
    let comp = 0;
    const compArea: number[] = [];
    for (let f = 0; f < nF; f++) {
      if (tmp[f] >= 0 || alt[f] >= th) continue;
      const stack = [f];
      tmp[f] = comp;
      let area = 0;
      while (stack.length) {
        const x = stack.pop()!;
        area += faceAreas[x];
        for (let k = 0; k < 3; k++) {
          const g = adj[3 * x + k];
          if (g >= 0 && tmp[g] < 0 && alt[g] < th) {
            tmp[g] = comp;
            stack.push(g);
          }
        }
      }
      compArea.push(area);
      comp++;
    }
    const keep = new Int32Array(comp).fill(-1);
    for (let c = 0; c < comp; c++) if (compArea[c] >= minMarkerArea) keep[c] = regionCount++;
    for (let f = 0; f < nF; f++) if (tmp[f] >= 0 && keep[tmp[f]] >= 0) label[f] = keep[tmp[f]];
  }
  if (regionCount === 0) {
    label.fill(0);
    regionCount = 1;
  }

  // Inundación por prioridad de altitud.
  const heap = new MinHeap(nF);
  const pendingLabel = new Int32Array(nF).fill(-1);
  for (let f = 0; f < nF; f++) {
    if (label[f] < 0) continue;
    for (let k = 0; k < 3; k++) {
      const g = adj[3 * f + k];
      if (g >= 0 && label[g] < 0 && pendingLabel[g] < 0) {
        pendingLabel[g] = label[f];
        heap.push(alt[g], g);
      }
    }
  }
  while (heap.size) {
    const f = heap.pop();
    if (label[f] >= 0) continue;
    label[f] = pendingLabel[f];
    for (let k = 0; k < 3; k++) {
      const g = adj[3 * f + k];
      if (g >= 0 && label[g] < 0 && pendingLabel[g] < 0) {
        pendingLabel[g] = label[f];
        heap.push(Math.max(alt[g], alt[f] * 0.999), g);
      }
    }
  }
  // Caras sin región (componentes sin marcador): una región por componente.
  for (let f = 0; f < nF; f++) {
    if (label[f] >= 0) continue;
    const r = regionCount++;
    const stack = [f];
    label[f] = r;
    while (stack.length) {
      const x = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const g = adj[3 * x + k];
        if (g >= 0 && label[g] < 0) {
          label[g] = r;
          stack.push(g);
        }
      }
    }
  }

  // Grafo de adyacencia de regiones.
  const regionArea = new Float64Array(regionCount);
  for (let f = 0; f < nF; f++) regionArea[label[f]] += faceAreas[f];
  const boundary = new Map<number, { len: number; sum: number }>();
  const R = regionCount;
  for (let h = 0; h < topo.nH; h++) {
    const f = (h / 3) | 0;
    const g = adj[h];
    if (g < 0 || g < f) continue;
    const ra = label[f];
    const rb = label[g];
    if (ra === rb) continue;
    const a = I[h] * 3;
    const b = I[h % 3 === 2 ? h - 2 : h + 1] * 3;
    const len = Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
    const key = ra < rb ? ra * R + rb : rb * R + ra;
    const e = boundary.get(key) ?? { len: 0, sum: 0 };
    e.len += len;
    e.sum += len * Math.max(alt[f], alt[g]);
    boundary.set(key, e);
  }

  // Fusión jerárquica (montículo con invalidación perezosa).
  const parent = new Int32Array(R);
  for (let i = 0; i < R; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const area = Float64Array.from(regionArea);
  const nbr: Array<Map<number, { len: number; sum: number }>> = Array.from({ length: R }, () => new Map());
  for (const [key, e] of boundary) {
    const a = Math.floor(key / R);
    const b = key - a * R;
    nbr[a].set(b, { ...e });
    nbr[b].set(a, { ...e });
  }
  const minArea = 0.002 * totalArea;
  const cost = (a: number, b: number, e: { len: number; sum: number }) => {
    const sal = e.sum / Math.max(e.len, 1e-12);
    // Regiones diminutas se absorben primero.
    if (Math.min(area[a], area[b]) < minArea) return -1 + sal * 0.01;
    return sal;
  };
  type Cand = { a: number; b: number; c: number };
  const cands: Cand[] = [];
  const heap2 = new MinHeap(Math.max(16, boundary.size * 2));
  const push = (a: number, b: number) => {
    const e = nbr[a].get(b);
    if (!e) return;
    cands.push({ a, b, c: cost(a, b, e) });
    heap2.push(cands[cands.length - 1].c, cands.length - 1);
  };
  for (let a = 0; a < R; a++) for (const b of nbr[a].keys()) if (a < b) push(a, b);
  const merges: number[] = [];
  let lastCost = -Infinity;
  while (heap2.size) {
    const ci = heap2.pop();
    const { a, b, c } = cands[ci];
    if (find(a) !== a || find(b) !== b) continue;
    const e = nbr[a].get(b);
    if (!e) continue;
    if (Math.abs(cost(a, b, e) - c) > 1e-12) continue; // obsoleto
    // fusionar b en a
    parent[b] = a;
    area[a] += area[b];
    for (const [x, eb] of nbr[b]) {
      if (x === a) continue;
      const ea = nbr[a].get(x);
      if (ea) {
        ea.len += eb.len;
        ea.sum += eb.sum;
        nbr[x].set(a, ea);
      } else {
        nbr[a].set(x, eb);
        nbr[x].set(a, eb);
      }
      nbr[x].delete(b);
    }
    nbr[a].delete(b);
    nbr[b].clear();
    const eff = Math.max(lastCost, Math.max(0, c));
    lastCost = eff;
    merges.push(a, b, eff);
    for (const x of nbr[a].keys()) push(Math.min(a, x), Math.max(a, x));
  }

  const seg: Segmentation = { faceRegion: label, regionCount: R, regionArea, merges: Float64Array.from(merges) };
  ctx.cache.set('segmentation', seg);
  return seg;
}

function centroid(P: Float64Array, I: Uint32Array, f: number): [number, number, number] {
  const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
  return [(P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3];
}

/**
 * Etiquetas de región para un nivel de sensibilidad (0 = fino, 1 = grueso).
 * Se usa también en el hilo principal (es barato).
 */
export function regionsAtLevel(seg: Pick<Segmentation, 'regionCount' | 'merges'>, threshold: number): Int32Array {
  const R = seg.regionCount;
  const parent = new Int32Array(R);
  for (let i = 0; i < R; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const m = seg.merges;
  for (let i = 0; i < m.length; i += 3) {
    if (m[i + 2] > threshold) break;
    const a = find(m[i]);
    const b = find(m[i + 1]);
    if (a !== b) parent[b] = a;
  }
  const out = new Int32Array(R);
  for (let i = 0; i < R; i++) out[i] = find(i);
  return out;
}
