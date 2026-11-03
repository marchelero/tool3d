import type { PathPoint, Vec3 } from '../core/types';
import { PK_EDGE, PK_FACE } from '../core/types';
import type { MeshContext, SurfacePt } from '../core/MeshContext';
import { pathPointKey } from '../core/MeshContext';
import { segmentsCross2D } from '../core/geometry';
import { computeCurvature } from '../analysis/curvature';
import { surfacePathPoint, walkSurface } from './SurfaceWalker';
import { cleanupPath, magnetPath, projectLocal, shortestPathFallback, snapPath, straightenPath } from './GeometrySnapping';

/** Punto de control anclado: triángulo + coordenadas baricéntricas. */
export interface ControlPointInput {
  face: number;
  bary: Vec3;
}

export interface PerimeterInput {
  points: ControlPointInput[];
  closed: boolean;
  /** Imán a bordes naturales 0..1 */
  magnet: number;
  /** Suavizado de curva 0..1 */
  smoothing: number;
  /**
   * Tramos fijos (por ejemplo, de una sugerencia): para el tramo i, lista de
   * vértices de malla entre el punto de control i y el i+1 (sin incluirlos).
   */
  locked?: Record<number, number[]>;
}

export type PerimeterIssueCode =
  | 'open'
  | 'too-few-points'
  | 'segment-failed'
  | 'component'
  | 'self-intersection'
  | 'too-small'
  | 'not-separating'
  | 'boundary';

export interface PerimeterIssue {
  code: PerimeterIssueCode;
  message: string;
  /** Tramos (entre puntos de control) afectados, para pintarlos en rojo. */
  segments: number[];
  /** Posiciones aproximadas del problema (para marcarlas). */
  at?: Vec3[];
}

export interface PerimeterResult {
  path: PathPoint[];
  closed: boolean;
  segmentOk: boolean[];
  issues: PerimeterIssue[];
  /** Sin problemas geométricos (puede estar abierto). */
  clean: boolean;
  /** Cerrado y sin problemas: habilita el corte. */
  valid: boolean;
  length: number;
  controlPositions: Vec3[];
}

interface SegmentCacheEntry {
  path: PathPoint[] | null;
}

/**
 * Motor del editor de perímetros: genera el camino exacto sobre la malla a
 * partir de los puntos de control (spline + imán + suavizado) y lo valida.
 * Cachea los tramos para recalcular solo lo que cambia al editar.
 */
export class SurfaceSplineEngine {
  private segCache = new Map<string, SegmentCacheEntry>();

  constructor(private readonly ctx: MeshContext) {}

  compute(input: PerimeterInput): PerimeterResult {
    const ctx = this.ctx;
    const n = input.points.length;
    const closed = input.closed && n >= 3;
    const issues: PerimeterIssue[] = [];
    const anchors = input.points.map((p) => {
      const b = normalizeBary(p.bary);
      return ctx.surfacePt(p.face, b[0], b[1], b[2]);
    });
    const controlPositions = anchors.map((a) => [a.x, a.y, a.z] as Vec3);
    const segCount = closed ? n : Math.max(0, n - 1);
    const segmentOk = new Array<boolean>(segCount).fill(true);
    if (n === 0) {
      return { path: [], closed: false, segmentOk, issues, clean: true, valid: false, length: 0, controlPositions };
    }

    // Todos los puntos deben estar en el mismo componente conectado.
    const comp0 = ctx.faceComponent[anchors[0].face];
    for (let i = 1; i < n; i++) {
      if (ctx.faceComponent[anchors[i].face] !== comp0) {
        const segs = [i - 1, i].filter((s) => s >= 0 && s < segCount);
        segs.forEach((s) => (segmentOk[s] = false));
        issues.push({ code: 'component', message: 'Un punto quedó sobre otra superficie del modelo.', segments: segs, at: [controlPositions[i]] });
      }
    }

    if (n === 1) {
      const path = [{ ...surfacePathPoint(ctx, anchors[0], 0), pinned: true }];
      return { path, closed: false, segmentOk, issues, clean: issues.length === 0, valid: false, length: 0, controlPositions };
    }

    const curv = input.magnet > 0 ? computeCurvature(ctx) : null;
    // 1) Tramos crudos
    const raw: PathPoint[] = [];
    for (let i = 0; i < segCount; i++) {
      const i0 = i;
      const i1 = (i + 1) % n;
      let seg: PathPoint[] | null = null;
      if (segmentOk[i]) {
        const locked = input.locked?.[i];
        if (locked && locked.length >= 0) {
          seg = this.lockedSegment(anchors[i0], anchors[i1], locked, i);
        }
        if (!seg) {
          const prevIdx = closed ? (i0 - 1 + n) % n : Math.max(0, i0 - 1);
          const nextIdx = closed ? (i1 + 1) % n : Math.min(n - 1, i1 + 1);
          const key = [prevIdx, i0, i1, nextIdx].map((k) => anchorKey(input.points[k])).join('|') + `|m${input.magnet.toFixed(3)}|${i0 === prevIdx ? 'o' : ''}${i1 === nextIdx ? 'o' : ''}`;
          const cached = this.segCache.get(key);
          if (cached) {
            seg = cached.path ? cached.path.map((p) => ({ ...p, seg: i })) : null;
          } else {
            seg = this.computeSegment(anchors, i0, i1, prevIdx, nextIdx, input.magnet, curv?.valley ?? null, i);
            this.segCache.set(key, { path: seg });
            if (this.segCache.size > 4000) this.segCache.clear();
          }
        }
      }
      if (!seg) {
        segmentOk[i] = false;
        issues.push({ code: 'segment-failed', message: 'No se pudo trazar este tramo sobre la superficie.', segments: [i], at: [controlPositions[i0], controlPositions[i1]] });
        continue;
      }
      seg[0].pinned = true;
      seg[seg.length - 1].pinned = true;
      if (raw.length) seg = seg.slice(1); // el inicio coincide con el final anterior
      raw.push(...seg);
    }
    if (closed && raw.length > 1) raw.pop(); // el último punto es el primero
    // Re-numerar tramos por puntos de control
    let path = renumber(raw);

    // 2) Suavizado
    if (input.smoothing > 0 && path.length > 2 && segmentOk.every(Boolean)) {
      const smoothed = this.smooth(path, closed, input.smoothing);
      if (smoothed) path = smoothed;
    }

    // 3) Ajuste a vértices/aristas (sin astillas) y limpieza
    path = snapPath(ctx, path, closed);
    path = straightenPath(ctx, path, closed);
    path = cleanupPath(path, closed);
    path = renumber(path);

    // 4) Validación
    if (!closed) {
      issues.push({ code: 'open', message: 'El perímetro todavía no está cerrado.', segments: [] });
    }
    if (input.closed && n < 3) {
      issues.push({ code: 'too-few-points', message: 'Se necesitan al menos tres puntos para cerrar el perímetro.', segments: [] });
    }
    if (segmentOk.every(Boolean)) {
      this.validateGeometry(path, closed, issues, segmentOk);
    }
    let length = 0;
    for (let i = 0; i + 1 < path.length; i++) length += dist(path[i], path[i + 1]);
    if (closed && path.length > 1) length += dist(path[path.length - 1], path[0]);
    const clean = issues.every((x) => x.code === 'open');
    return { path, closed, segmentOk, issues, clean, valid: closed && issues.length === 0, length, controlPositions };
  }

  /**
   * Perímetro dado como camino exacto (por ejemplo, la sección plana de la
   * malla). Se ajusta, valida y devuelve igual que uno calculado.
   */
  computeFixed(fixed: PathPoint[]): PerimeterResult {
    const ctx = this.ctx;
    let path = snapPath(ctx, fixed, true);
    path = straightenPath(ctx, path, true);
    path = renumber(cleanupPath(path, true));
    const segs = path.reduce((m, p) => Math.max(m, p.seg), 0) + 1;
    const segmentOk = new Array<boolean>(segs).fill(true);
    const issues: PerimeterIssue[] = [];
    this.validateGeometry(path, true, issues, segmentOk);
    let length = 0;
    for (let i = 0; i < path.length; i++) length += dist(path[i], path[(i + 1) % path.length]);
    const controlPositions = path.filter((p) => p.pinned).map((p) => [p.x, p.y, p.z] as Vec3);
    return { path, closed: true, segmentOk, issues, clean: issues.length === 0, valid: issues.length === 0, length, controlPositions };
  }

  /** Tramo entre dos puntos de control. */
  private computeSegment(
    anchors: SurfacePt[], i0: number, i1: number, prevIdx: number, nextIdx: number,
    magnet: number, valley: Float32Array | null, seg: number,
  ): PathPoint[] | null {
    const ctx = this.ctx;
    const a = anchors[i0];
    const b = anchors[i1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    // Guía: spline Catmull-Rom centrípeta entre los puntos, proyectada localmente.
    const n = Math.max(2, Math.min(400, Math.ceil(chord / (1.2 * ctx.avgEdge))));
    const P0 = anchors[prevIdx], P3 = anchors[nextIdx];
    const pts: Vec3[] = [];
    for (let k = 0; k <= n; k++) pts.push(catmullRom(P0, a, b, P3, k / n, prevIdx === i0, nextIdx === i1));
    const proj: SurfacePt[] = [a];
    let reliable = true;
    for (let k = 1; k < n; k++) {
      const s = pts[k];
      const p = projectLocal(ctx, s[0], s[1], s[2], proj[proj.length - 1].face, 2, 10);
      const d = Math.hypot(p.x - s[0], p.y - s[1], p.z - s[2]);
      if (d > Math.max(0.35 * chord, 3 * ctx.avgEdge)) {
        reliable = false;
        break;
      }
      proj.push(p);
    }
    proj.push(b);

    if (magnet > 0 && valley) {
      const guide = reliable ? proj.map((p) => [p.x, p.y, p.z] as Vec3) : [[a.x, a.y, a.z], [b.x, b.y, b.z]] as Vec3[];
      const r = magnetPath(ctx, a, b, guide, magnet, valley, seg);
      if (r) return r;
    }
    if (reliable) {
      const out: PathPoint[] = [];
      let ok = true;
      for (let k = 0; k + 1 < proj.length; k++) {
        let w = walkSurface(ctx, proj[k], proj[k + 1], seg, 6);
        if (!w) w = shortestPathFallback(ctx, proj[k], proj[k + 1], seg);
        if (!w) {
          ok = false;
          break;
        }
        if (out.length) w = w.slice(1);
        out.push(...w);
      }
      let len = 0;
      for (let k = 0; k + 1 < out.length; k++) len += dist(out[k], out[k + 1]);
      if (ok && len <= 3 * chord + 10 * ctx.avgEdge) return out;
    }
    return walkSurface(ctx, a, b, seg, 4) ?? shortestPathFallback(ctx, a, b, seg);
  }

  /** Tramo fijo a partir de una lista de vértices de malla. */
  private lockedSegment(a: SurfacePt, b: SurfacePt, verts: number[], seg: number): PathPoint[] | null {
    const ctx = this.ctx;
    const out: PathPoint[] = [surfacePathPoint(ctx, a, seg)];
    const prevFace = a.face;
    let prevVertex = -1;
    for (const v of verts) {
      // Cada vértice debe ser vecino del punto anterior.
      if (prevVertex < 0) {
        if (!ctx.faceHasVertex(prevFace, v)) return null;
      } else if (ctx.topo.edgeBetween(prevVertex, v) < 0) return null;
      out.push(ctx.makeVertexPoint(v, seg));
      prevVertex = v;
    }
    if (prevVertex >= 0 && !ctx.faceHasVertex(b.face, prevVertex)) return null;
    if (prevVertex < 0 && a.face !== b.face) return null;
    out.push(surfacePathPoint(ctx, b, seg));
    return cleanupPath(out, false);
  }

  /** Suavizado laplaciano sobre la superficie con puntos de control fijos. */
  private smooth(path: PathPoint[], closed: boolean, amount: number): PathPoint[] | null {
    const ctx = this.ctx;
    const h = 0.75 * ctx.avgEdge;
    // Cadena re-muestreada
    const chain: Array<SurfacePt & { pinned: boolean; seg: number }> = [];
    const m = path.length;
    const segEnd = closed ? m : m - 1;
    for (let j = 0; j < segEnd; j++) {
      const p = path[j];
      const q = path[(j + 1) % m];
      const f = ctx.commonFace(p, q);
      const sp = ctx.toSurfacePt(p, f);
      if (p.pinned || chain.length === 0) chain.push({ ...sp, pinned: p.pinned, seg: p.seg });
      else chain.push({ ...sp, pinned: false, seg: p.seg });
      const L = dist(p, q);
      const k = Math.floor(L / h);
      if (f >= 0 && k >= 1) {
        for (let s = 1; s <= k; s++) {
          const t = s / (k + 1);
          const x = p.x + t * (q.x - p.x), y = p.y + t * (q.y - p.y), z = p.z + t * (q.z - p.z);
          const bb = ctx.baryOf(f, x, y, z);
          chain.push({ face: f, b0: bb[0], b1: bb[1], b2: bb[2], x, y, z, pinned: false, seg: p.seg });
        }
      }
    }
    if (!closed) {
      const last = path[m - 1];
      chain.push({ ...ctx.toSurfacePt(last), pinned: true, seg: last.seg });
    }
    // Reducir puntos demasiado juntos (no fijos)
    const pts = chain.filter((c, i) => c.pinned || i === 0 || Math.hypot(c.x - chain[i - 1].x, c.y - chain[i - 1].y, c.z - chain[i - 1].z) > 0.15 * h);
    const N = pts.length;
    if (N < 3) return null;
    const iters = Math.round(2 + 38 * amount * amount);
    const alpha = 0.5;
    for (let it = 0; it < iters; it++) {
      const nx = pts.map((p) => [p.x, p.y, p.z]);
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        if (p.pinned) continue;
        if (!closed && (i === 0 || i === N - 1)) continue;
        const a = pts[(i - 1 + N) % N];
        const b = pts[(i + 1) % N];
        nx[i][0] = p.x + alpha * ((a.x + b.x) / 2 - p.x);
        nx[i][1] = p.y + alpha * ((a.y + b.y) / 2 - p.y);
        nx[i][2] = p.z + alpha * ((a.z + b.z) / 2 - p.z);
      }
      for (let i = 0; i < N; i++) {
        const p = pts[i];
        if (p.pinned || (!closed && (i === 0 || i === N - 1))) continue;
        const q = projectLocal(ctx, nx[i][0], nx[i][1], nx[i][2], p.face, 2, 4);
        // No permitir saltos a superficies con normal opuesta.
        const fn = ctx.faceNormals;
        const dot = fn[3 * q.face] * fn[3 * p.face] + fn[3 * q.face + 1] * fn[3 * p.face + 1] + fn[3 * q.face + 2] * fn[3 * p.face + 2];
        if (dot < -0.2) continue;
        Object.assign(p, q);
      }
    }
    // Reconectar con caminos exactos
    const out: PathPoint[] = [];
    const total = closed ? N : N - 1;
    for (let i = 0; i < total; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      let w = walkSurface(ctx, a, b, a.seg, 6) ?? shortestPathFallback(ctx, a, b, a.seg);
      if (!w) return null;
      w[0].pinned = a.pinned;
      w[w.length - 1].pinned = b.pinned;
      if (out.length) w = w.slice(1);
      out.push(...w);
    }
    if (closed && out.length > 1) out.pop();
    return out;
  }

  /** Autointersecciones y tamaño mínimo. */
  private validateGeometry(path: PathPoint[], closed: boolean, issues: PerimeterIssue[], segmentOk: boolean[]): void {
    const ctx = this.ctx;
    const m = path.length;
    if (closed && m < 3) {
      issues.push({ code: 'too-small', message: 'El perímetro es demasiado chico para esta malla.', segments: [] });
      return;
    }
    // Puntos repetidos (el camino se toca a sí mismo)
    const seen = new Map<string, number>();
    const bad = new Set<number>();
    const at: Vec3[] = [];
    for (let i = 0; i < m; i++) {
      const p = path[i];
      if (p.kind === PK_FACE) continue;
      const key = pathPointKey(p);
      const j = seen.get(key);
      if (j !== undefined) {
        bad.add(p.seg);
        bad.add(path[j].seg);
        at.push([p.x, p.y, p.z]);
      } else seen.set(key, i);
    }
    // Cruces dentro de cada triángulo (coordenadas baricéntricas como 2D afín)
    const perFace = new Map<number, number[]>();
    const segCount = closed ? m : m - 1;
    const faceOfSeg = new Int32Array(segCount);
    for (let i = 0; i < segCount; i++) {
      const p = path[i];
      const q = path[(i + 1) % m];
      const f = ctx.commonFace(p, q);
      faceOfSeg[i] = f;
      if (f < 0) {
        bad.add(p.seg);
        at.push([p.x, p.y, p.z]);
        continue;
      }
      if (ctx.segmentOnEdge(p, q) >= 0) continue;
      let list = perFace.get(f);
      if (!list) perFace.set(f, (list = []));
      list.push(i);
    }
    for (const [f, list] of perFace) {
      if (list.length < 2) continue;
      const uv = (p: PathPoint) => {
        const b = ctx.baryExact(p, f);
        return [b[1], b[2]];
      };
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const i = list[x];
          const j = list[y];
          const adjacent = Math.abs(i - j) === 1 || (closed && ((i === 0 && j === segCount - 1) || (j === 0 && i === segCount - 1)));
          if (adjacent) continue;
          const [a0, a1] = [uv(path[i]), uv(path[(i + 1) % m])];
          const [b0, b1] = [uv(path[j]), uv(path[(j + 1) % m])];
          if (segmentsCross2D(a0[0], a0[1], a1[0], a1[1], b0[0], b0[1], b1[0], b1[1], 1e-14)) {
            bad.add(path[i].seg);
            bad.add(path[j].seg);
            at.push([path[i].x, path[i].y, path[i].z]);
          }
        }
      }
    }
    if (bad.size) {
      const segs = [...bad].sort((x, y) => x - y);
      segs.forEach((s) => {
        if (s < segmentOk.length) segmentOk[s] = false;
      });
      issues.push({ code: 'self-intersection', message: 'El perímetro se cruza o se toca a sí mismo.', segments: segs, at: at.slice(0, 20) });
    }
    if (closed) {
      // ¿Todo el perímetro dentro de un único triángulo?
      const faces = new Set<number>();
      for (const f of faceOfSeg) faces.add(f);
      const hasBoundary = path.some((p) => p.kind !== PK_FACE);
      if (!hasBoundary || faces.size < 2) {
        issues.push({ code: 'too-small', message: 'El perímetro es más chico que un triángulo de la malla.', segments: [] });
      }
    }
    // Bordes abiertos de la malla atravesados por el camino
    for (let i = 0; i < m; i++) {
      const p = path[i];
      if (p.kind === PK_EDGE && ctx.topo.edgeValence[p.id] !== 2) {
        issues.push({ code: 'boundary', message: 'El perímetro cruza un borde abierto o no-manifold de la malla.', segments: [p.seg], at: [[p.x, p.y, p.z]] });
        if (p.seg < segmentOk.length) segmentOk[p.seg] = false;
        break;
      }
    }
  }
}

function renumber(path: PathPoint[]): PathPoint[] {
  let seg = -1;
  return path.map((p) => {
    if (p.pinned) seg++;
    return { ...p, seg: Math.max(0, seg) };
  });
}

function anchorKey(p: ControlPointInput): string {
  return `${p.face}:${p.bary[0].toFixed(9)}:${p.bary[1].toFixed(9)}`;
}

function normalizeBary(b: Vec3): Vec3 {
  let [x, y, z] = b.map((v) => Math.max(0, v)) as Vec3;
  const s = x + y + z || 1;
  x /= s;
  y /= s;
  z /= s;
  return [x, y, z];
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Catmull-Rom centrípeta (Barry–Goldman). Extremos abiertos reflejados. */
function catmullRom(P0: SurfacePt, P1: SurfacePt, P2: SurfacePt, P3: SurfacePt, u: number, openStart: boolean, openEnd: boolean): Vec3 {
  const p1: Vec3 = [P1.x, P1.y, P1.z];
  const p2: Vec3 = [P2.x, P2.y, P2.z];
  const p0: Vec3 = openStart ? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1], 2 * p1[2] - p2[2]] : [P0.x, P0.y, P0.z];
  const p3: Vec3 = openEnd ? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1], 2 * p2[2] - p1[2]] : [P3.x, P3.y, P3.z];
  const knot = (a: Vec3, b: Vec3) => Math.max(1e-9, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + u * (t2 - t1);
  const lerp = (a: Vec3, b: Vec3, ta: number, tb: number): Vec3 => {
    const w = (t - ta) / (tb - ta);
    return [a[0] + w * (b[0] - a[0]), a[1] + w * (b[1] - a[1]), a[2] + w * (b[2] - a[2])];
  };
  const A1 = lerp(p0, p1, t0, t1);
  const A2 = lerp(p1, p2, t1, t2);
  const A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2);
  const B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}
