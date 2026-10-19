import cdt2d from "cdt2d";
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

/**
 * Triangulación de Delaunay restringida robusta. Los triángulos se filtran por
 * el centroide (relleno par-impar) y se orientan en sentido antihorario. Es la
 * única vía que cierra el contorno del icono vectorizado sin T-junctions.
 */
export function triangulateCdt(
  contours: Ring[],
  splitPinches = false
): { vertices: Vertex[]; faces: Face[] } {
  const rings = splitPinches ? preprocess(contours) : contours;
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

  const tris = cdt2d(vertices, edges, {
    exterior: true,
    interior: true,
    delaunay: true,
  }) as Face[];

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
