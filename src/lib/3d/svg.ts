import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { unionSolid } from "./clip2";
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
const MAX_PATHS = 600;
const MAX_CONTOURS = 6000;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Los contornos que devuelve three incluyen puntos repetidos (lados de longitud
 * cero) al subdividir las curvas. Se deduplican antes de pasarlos a Clipper.
 * No se eliminan vértices colineales: hacerlo deformaba/corrompía contornos de
 * fuentes reales (p. ej. la "N" de Calibri).
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
  return deduped;
}

/** Conserva la orientación del SVG: el visor 3D ya lo muestra en el sentido correcto. */
function toRing(points: { x: number; y: number }[]): Vec2[] {
  const ring = cleanRing(points.map((point) => [point.x, point.y] as Vec2));
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
    // Se recorren los subpaths crudos en vez de `toShapes()`: `toShapes`
    // descarta o mal-clasifica contornos con ciertas fuentes (p. ej. Calibri),
    // rellenando los contadores de las letras. Los subpaths traen TODOS los
    // contornos y la unión por regla non-zero resuelve el anidamiento
    // (exteriores + huecos), que es como se definen las fuentes.
    const raw: Vec2[][] = [];
    for (const subPath of path.subPaths) {
      let points;
      try {
        points = subPath.getPoints(CURVE_DIVISIONS);
      } catch {
        continue;
      }
      const ring = toRing(points);
      if (ring.length >= 3) raw.push(ring);
    }
    if (raw.length === 0) continue;
    let resolved: Vec2[][] = raw;
    if (raw.length > 1) {
      try {
        resolved = unionSolid(raw);
      } catch {
        resolved = raw;
      }
    }
    for (const ring of resolved) push(ring);
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
