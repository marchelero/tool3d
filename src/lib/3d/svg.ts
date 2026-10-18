import { booleans, geometries } from "@jscad/modeling";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { Shape } from "three";

type Geom2 = ReturnType<typeof geometries.geom2.fromPoints>;
type Vec2 = [number, number];

export interface DesignBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DesignGeometry {
  polygons: Geom2[];
  bounds: DesignBounds | null;
}

const EMPTY_BOUNDS: DesignBounds = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
};

const CURVE_DIVISIONS = 12;
const POINT_EPSILON = 1e-3;
const COLLINEAR_RATIO = 1e-3;

function signedArea(points: Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function isCollinear(prev: Vec2, current: Vec2, next: Vec2): boolean {
  const area = Math.abs(
    (current[0] - prev[0]) * (next[1] - current[1]) -
      (current[1] - prev[1]) * (next[0] - current[0])
  );
  const base = distance(prev, current) + distance(current, next);
  return area <= COLLINEAR_RATIO * Math.max(base, POINT_EPSILON);
}

/**
 * Los contornos que devuelve three incluyen puntos repetidos y vértices
 * colineales al subdividir las curvas. JSCAD no tolera lados de longitud cero
 * (falla con "geometry is not closed"), así que se limpian antes de usarlos.
 */
function cleanRing(ring: Vec2[]): Vec2[] {
  const deduped: Vec2[] = [];
  for (const point of ring) {
    const last = deduped[deduped.length - 1];
    if (last && distance(last, point) <= POINT_EPSILON) continue;
    deduped.push(point);
  }
  while (deduped.length > 1 && distance(deduped[0], deduped[deduped.length - 1]) <= POINT_EPSILON) {
    deduped.pop();
  }
  if (deduped.length < 3) {
    return deduped;
  }

  const total = deduped.length;
  const result: Vec2[] = [];
  for (let index = 0; index < total; index += 1) {
    const prev = deduped[(index - 1 + total) % total];
    const current = deduped[index];
    const next = deduped[(index + 1) % total];
    if (isCollinear(prev, current, next)) continue;
    result.push(current);
  }
  return result;
}

function toPolygon(points: { x: number; y: number }[]): Vec2[] {
  // SVG usa Y hacia abajo; se invierte para trabajar en un plano Y hacia arriba.
  const polygon = cleanRing(points.map((point) => [point.x, -point.y] as Vec2));
  if (polygon.length < 3) return [];
  // JSCAD necesita contornos en sentido antihorario.
  return signedArea(polygon) < 0 ? polygon.reverse() : polygon;
}

function shapeToGeom2(shape: Shape): { geometry: Geom2 | null; points: Vec2[] } {
  const { shape: outer, holes } = shape.extractPoints(CURVE_DIVISIONS);
  const outerPoints = toPolygon(outer);
  if (outerPoints.length < 3) {
    return { geometry: null, points: [] };
  }

  let geometry = geometries.geom2.fromPoints(outerPoints);
  for (const hole of holes) {
    const holePoints = toPolygon(hole);
    if (holePoints.length < 3) continue;
    try {
      geometry = booleans.subtract(
        geometry,
        geometries.geom2.fromPoints(holePoints)
      );
    } catch {
      // Si el hueco no es válido se conserva el contorno exterior.
    }
  }

  return { geometry, points: outerPoints };
}

export function svgToDesign(svgText: string): DesignGeometry {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);

  const polygons: Geom2[] = [];
  const bounds: DesignBounds = { ...EMPTY_BOUNDS };

  for (const path of data.paths) {
    const style = path.userData?.style as { display?: string } | undefined;
    if (style?.display === "none") continue;
    for (const shape of SVGLoader.createShapes(path)) {
      let converted: { geometry: Geom2 | null; points: Vec2[] };
      try {
        converted = shapeToGeom2(shape);
      } catch {
        continue;
      }
      const { geometry, points } = converted;
      if (!geometry) continue;
      polygons.push(geometry);
      for (const [x, y] of points) {
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }
  }

  if (polygons.length === 0) {
    return { polygons: [], bounds: null };
  }

  return { polygons, bounds };
}

export function mergeBounds(
  a: DesignBounds | null,
  b: DesignBounds | null
): DesignBounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
