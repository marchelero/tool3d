import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { Ring } from "./clip2";

type Vec2 = [number, number];

export interface DesignBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DesignGeometry {
  /** Contornos (exteriores y huecos) en milímetros, listos para Clipper. */
  contours: Ring[];
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
const MAX_PATHS = 600;
const MAX_CONTOURS = 6000;

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
 * colineales al subdividir las curvas. Se limpian antes de pasarlos a Clipper
 * para evitar lados de longitud cero.
 */
function cleanRing(ring: Vec2[]): Vec2[] {
  const deduped: Vec2[] = [];
  for (const point of ring) {
    const last = deduped[deduped.length - 1];
    if (last && distance(last, point) <= POINT_EPSILON) continue;
    deduped.push(point);
  }
  while (
    deduped.length > 1 &&
    distance(deduped[0], deduped[deduped.length - 1]) <= POINT_EPSILON
  ) {
    deduped.pop();
  }
  if (deduped.length < 3) return deduped;

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

/** SVG usa Y hacia abajo; se invierte para trabajar en un plano Y hacia arriba. */
function toRing(points: { x: number; y: number }[]): Vec2[] {
  const ring = cleanRing(points.map((point) => [point.x, -point.y] as Vec2));
  return ring.length >= 3 ? ring : [];
}

export function svgToDesign(svgText: string): DesignGeometry {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);

  const contours: Ring[] = [];
  const bounds: DesignBounds = { ...EMPTY_BOUNDS };

  const push = (ring: Vec2[]) => {
    if (ring.length < 3 || contours.length >= MAX_CONTOURS) return;
    contours.push(ring);
    for (const [x, y] of ring) {
      if (x < bounds.minX) bounds.minX = x;
      if (x > bounds.maxX) bounds.maxX = x;
      if (y < bounds.minY) bounds.minY = y;
      if (y > bounds.maxY) bounds.maxY = y;
    }
  };

  for (const path of data.paths.slice(0, MAX_PATHS)) {
    const style = path.userData?.style as { display?: string } | undefined;
    if (style?.display === "none") continue;
    let shapes;
    try {
      shapes = path.toShapes();
    } catch {
      continue;
    }
    for (const shape of shapes) {
      let points;
      try {
        points = shape.extractPoints(CURVE_DIVISIONS);
      } catch {
        continue;
      }
      push(toRing(points.shape));
      for (const hole of points.holes) push(toRing(hole));
    }
  }

  if (contours.length === 0) {
    return { contours: [], bounds: null };
  }

  return { contours, bounds };
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
