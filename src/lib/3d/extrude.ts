import { geometries } from "@jscad/modeling";
import type { Ring } from "./clip2";
import { triangulateCdt } from "./triangulate";

export type Geom3 = ReturnType<typeof geometries.geom3.create>;
export type Poly3 = ReturnType<typeof geometries.poly3.create>;
export type Vec3 = [number, number, number];

const KEY = 1e6;

/** Almacén de vértices 3D: reutiliza índices por coordenada para soldar caras. */
class VertexStore {
  readonly vertices: Vec3[] = [];
  private readonly map = new Map<string, number>();

  add(x: number, y: number, z: number): number {
    const key = `${Math.round(x * KEY)},${Math.round(y * KEY)},${Math.round(z * KEY)}`;
    const found = this.map.get(key);
    if (found !== undefined) return found;
    const index = this.vertices.length;
    this.vertices.push([x, y, z]);
    this.map.set(key, index);
    return index;
  }
}

export interface Slab {
  zBottom: number;
  zTop: number;
  region: Ring[];
}

interface BoundaryEdge {
  px: number;
  py: number;
  qx: number;
  qy: number;
  z: number;
  pKey: string;
  qKey: string;
}

const pointKey = (x: number, y: number): string =>
  `${Math.round(x * KEY)},${Math.round(y * KEY)}`;

/**
 * Emite la tapa triangulada de una región a una altura dada y devuelve sus
 * aristas de borde dirigidas (las que aparecen una sola vez y sin reversa).
 */
function emitCap(
  store: VertexStore,
  polygons: Poly3[],
  region: Ring[],
  z: number,
  flip: boolean
): BoundaryEdge[] {
  if (region.length === 0) return [];
  const { vertices, faces } = triangulateCdt(region);
  const directed = new Map<string, number>();
  const edges: { px: number; py: number; qx: number; qy: number; key: string }[] = [];

  for (const [i, j, k] of faces) {
    const a = vertices[i];
    const b = vertices[j];
    const c = vertices[k];
    const order: [number, number][] = flip ? [a, c, b] : [a, b, c];
    const tri = order.map((p) => store.add(p[0], p[1], z));
    polygons.push(
      geometries.poly3.create([
        store.vertices[tri[0]],
        store.vertices[tri[1]],
        store.vertices[tri[2]],
      ])
    );
    for (let t = 0; t < 3; t += 1) {
      const u = order[t];
      const v = order[(t + 1) % 3];
      const key = `${pointKey(u[0], u[1])}|${pointKey(v[0], v[1])}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
      edges.push({ px: u[0], py: u[1], qx: v[0], qy: v[1], key });
    }
  }

  const boundaries: BoundaryEdge[] = [];
  for (const edge of edges) {
    const reverseKey = `${pointKey(edge.qx, edge.qy)}|${pointKey(edge.px, edge.py)}`;
    if (directed.get(edge.key) !== 1 || (directed.get(reverseKey) ?? 0) !== 0) {
      continue;
    }
    boundaries.push({
      px: edge.px,
      py: edge.py,
      qx: edge.qx,
      qy: edge.qy,
      z,
      pKey: pointKey(edge.px, edge.py),
      qKey: pointKey(edge.qx, edge.qy),
    });
  }
  return boundaries;
}

/**
 * Construye un sólido a partir de una pila de tramos. Cada tramo se emite como
 * una caja cerrada independiente (tapa inferior + superior + paredes), de modo
 * que las tapas de un tramo emparejan por construcción con sus propias paredes.
 * Las caras internas en las uniones entre tramos son coplanares y las resuelve
 * el laminador; a cambio, la malla queda watertight aunque el triangulador
 * descarte alguna arista restringida casi-degenerada.
 */
export function buildSolid(slabs: Slab[]): Geom3 {
  const stack = slabs
    .filter((slab) => slab.zTop - slab.zBottom > 1e-9)
    .sort((a, b) => a.zBottom - b.zBottom);
  if (stack.length === 0) return geometries.geom3.create([]);

  const store = new VertexStore();
  const polygons: Poly3[] = [];

  for (const slab of stack) {
    emitCap(store, polygons, slab.region, slab.zBottom, true);
    const boundaries = emitCap(store, polygons, slab.region, slab.zTop, false);
    for (const edge of boundaries) {
      const a = store.add(edge.qx, edge.qy, slab.zTop);
      const b = store.add(edge.px, edge.py, slab.zTop);
      const c = store.add(edge.px, edge.py, slab.zBottom);
      const d = store.add(edge.qx, edge.qy, slab.zBottom);
      polygons.push(
        geometries.poly3.create([
          store.vertices[a],
          store.vertices[b],
          store.vertices[c],
          store.vertices[d],
        ])
      );
    }
  }

  return geometries.geom3.create(polygons);
}

/** Prisma simple: útil para piezas de una sola altura. */
export function extrudeRegion(contours: Ring[], z: number, height: number): Geom3 {
  return buildSolid([{ zBottom: z, zTop: z + height, region: contours }]);
}

export interface MeshQuality {
  polygons: number;
  open: number;
  over: number;
  zMin: number;
  zMax: number;
}

const qualityKey = (v: number[]): string =>
  `${Math.round(v[0] * 1000) / 1000},${Math.round(v[1] * 1000) / 1000},${
    Math.round(v[2] * 1000) / 1000
  }`;

/**
 * Mide la malla: `open` son aristas de borde (malla no cerrada) y `over` son
 * aristas compartidas por más de dos caras (no-manifold puntual en los pinch
 * points del dibujo). `open > 0` invalida el sólido; `over > 0` es tolerable.
 */
export function meshQuality(geom3: Geom3): MeshQuality {
  const polygons = geom3.polygons;
  const edges = new Map<string, number>();
  let zMin = Number.POSITIVE_INFINITY;
  let zMax = Number.NEGATIVE_INFINITY;

  for (const poly of polygons) {
    const vertices = poly.vertices;
    for (const vertex of vertices) {
      if (vertex[2] < zMin) zMin = vertex[2];
      if (vertex[2] > zMax) zMax = vertex[2];
    }
    for (let i = 0; i < vertices.length; i += 1) {
      const a = qualityKey(vertices[i]);
      const b = qualityKey(vertices[(i + 1) % vertices.length]);
      if (a === b) continue;
      const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }

  let open = 0;
  let over = 0;
  for (const count of edges.values()) {
    if (count === 1) open += 1;
    else if (count > 2) over += 1;
  }

  return {
    polygons: polygons.length,
    open,
    over,
    zMin: polygons.length ? zMin : 0,
    zMax: polygons.length ? zMax : 0,
  };
}
