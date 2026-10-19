import cdt2d from "cdt2d";
import { ShapeUtils, Vector2 } from "three";
import type { Ring } from "./clip2";

export type Vertex = [number, number];
export type Face = [number, number, number];

const keyOf = (x: number, y: number): string =>
  `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;

export function filterDegenerate(vertices: Vertex[], faces: Face[]): Face[] {
  return faces.filter(([i, j, k]) => {
    const a = vertices[i];
    const b = vertices[j];
    const c = vertices[k];
    return (
      Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-9
    );
  });
}

/** Test par-impar: un punto está dentro si cruza un número impar de aristas. */
export function pointInRegion(contours: Ring[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of contours) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Parte un anillo que se autotoca (visita el mismo vértice 2+ veces) en anillos simples. */
export function splitSelfTouching(ring: Ring): Ring[] {
  const out: Ring[] = [];
  const stack: Ring[] = [ring];
  while (stack.length) {
    const current = stack.pop()!;
    const seen = new Map<string, number>();
    let si = -1;
    let sj = -1;
    for (let i = 0; i < current.length; i += 1) {
      const k = keyOf(current[i][0], current[i][1]);
      const prev = seen.get(k);
      if (prev !== undefined) {
        si = prev;
        sj = i;
        break;
      }
      seen.set(k, i);
    }
    if (si < 0) {
      out.push(current);
      continue;
    }
    const loop1: Ring = [];
    for (let i = si; i < sj; i += 1) loop1.push(current[i]);
    const loop2: Ring = [];
    for (let i = sj; i < current.length; i += 1) loop2.push(current[i]);
    for (let i = 0; i < si; i += 1) loop2.push(current[i]);
    if (loop1.length >= 3) stack.push(loop1);
    if (loop2.length >= 3) stack.push(loop2);
  }
  return out;
}

export function preprocess(contours: Ring[]): Ring[] {
  const out: Ring[] = [];
  for (const ring of contours) out.push(...splitSelfTouching(ring));
  return out;
}

function ringArea(ring: Ring): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function isUsable(ring: Ring): boolean {
  return ring.length >= 3 && Math.abs(ringArea(ring)) > 1e-9;
}

function orient(ring: Ring, ccw: boolean): Ring {
  return ringArea(ring) >= 0 === ccw ? ring : ring.slice().reverse();
}

interface NestGroup {
  outer: Ring;
  holes: Ring[];
}

/** Agrupa contornos por anidamiento par-impar (exterior + huecos directos). */
function nestContours(contours: Ring[]): NestGroup[] {
  const infos = contours
    .filter(isUsable)
    .map((ring) => ({ ring, area: Math.abs(ringArea(ring)) }));
  const outers: typeof infos = [];
  const holes: typeof infos = [];
  for (const info of infos) {
    const [x, y] = info.ring[0];
    let depth = 0;
    for (const other of infos) {
      if (other === info) continue;
      if (pointInRegion([other.ring], x, y)) depth += 1;
    }
    (depth % 2 === 0 ? outers : holes).push(info);
  }
  return outers.map((outer) => {
    const owned = holes.filter((hole) => {
      const [hx, hy] = hole.ring[0];
      if (!pointInRegion([outer.ring], hx, hy)) return false;
      for (const other of outers) {
        if (other === outer) continue;
        if (other.area < outer.area && pointInRegion([other.ring], hx, hy)) {
          return false;
        }
      }
      return true;
    });
    return { outer: outer.ring, holes: owned.map((h) => h.ring) };
  });
}

/**
 * Triangulación de respaldo con earcut (three). Es muy tolerante a entradas
 * degeneradas o autotocadas y nunca lanza, por lo que actúa de red de seguridad
 * cuando cdt2d no puede procesar la región.
 */
export function triangulateEarcut(contours: Ring[]): {
  vertices: Vertex[];
  faces: Face[];
} {
  const groups = nestContours(contours);
  const vertices: Vertex[] = [];
  const faces: Face[] = [];
  for (const { outer, holes } of groups) {
    const outerRing = orient(outer, true);
    const holeRings = holes.map((hole) => orient(hole, false));
    const contour = outerRing.map(([x, y]) => new Vector2(x, y));
    const holePaths = holeRings.map((hole) =>
      hole.map(([x, y]) => new Vector2(x, y))
    );
    let tris: number[][];
    try {
      tris = ShapeUtils.triangulateShape(contour, holePaths);
    } catch {
      continue;
    }
    const base = vertices.length;
    for (const [x, y] of outerRing) vertices.push([x, y]);
    for (const hole of holeRings) for (const [x, y] of hole) vertices.push([x, y]);
    for (const t of tris) {
      const i = base + t[0];
      const j = base + t[1];
      const k = base + t[2];
      const a = vertices[i];
      const b = vertices[j];
      const c = vertices[k];
      const signed =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      faces.push(signed >= 0 ? [i, j, k] : [i, k, j]);
    }
  }
  return { vertices, faces: filterDegenerate(vertices, faces) };
}

/**
 * Triangulación de Delaunay restringida robusta. Los triángulos se filtran por
 * el centroide (relleno par-impar) y se orientan en sentido antihorario. Si
 * cdt2d falla con una región degenerada se recurre a earcut.
 */
export function triangulateCdt(
  contours: Ring[],
  splitPinches = false
): { vertices: Vertex[]; faces: Face[] } {
  const rings = (splitPinches ? preprocess(contours) : contours).filter(isUsable);
  const vertices: Vertex[] = [];
  const edges: [number, number][] = [];
  const edgeSet = new Set<string>();
  const shared = new Map<string, number>();

  const addShared = (x: number, y: number): number => {
    const k = keyOf(x, y);
    const found = shared.get(k);
    if (found !== undefined) return found;
    vertices.push([x, y]);
    shared.set(k, vertices.length - 1);
    return vertices.length - 1;
  };

  for (const ring of rings) {
    const local = new Map<string, number>();
    const idxs: number[] = [];
    for (const [x, y] of ring) {
      if (splitPinches) {
        const k = keyOf(x, y);
        const found = local.get(k);
        if (found !== undefined) {
          idxs.push(found);
          continue;
        }
        vertices.push([x, y]);
        const index = vertices.length - 1;
        local.set(k, index);
        idxs.push(index);
      } else {
        idxs.push(addShared(x, y));
      }
    }
    for (let i = 0; i < idxs.length; i += 1) {
      const a = idxs[i];
      const b = idxs[(i + 1) % idxs.length];
      if (a === b) continue;
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (edgeSet.has(ek)) continue;
      edgeSet.add(ek);
      edges.push([a, b]);
    }
  }

  let tris: Face[];
  try {
    tris = cdt2d(vertices, edges, {
      exterior: true,
      interior: true,
      delaunay: true,
    }) as Face[];
  } catch {
    return triangulateEarcut(contours);
  }

  const kept: Face[] = [];
  for (const [i, j, k] of tris) {
    const a = vertices[i];
    const b = vertices[j];
    const c = vertices[k];
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    if (!pointInRegion(rings, cx, cy)) continue;
    const signed =
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    kept.push(signed >= 0 ? [i, j, k] : [i, k, j]);
  }
  return { vertices, faces: filterDegenerate(vertices, kept) };
}
