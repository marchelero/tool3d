import { union, type Ring } from "./clip2";

export type KeychainShape =
  | "round"
  | "square"
  | "rectangle"
  | "diamond"
  | "star"
  | "hex"
  | "oct"
  | "heart"
  | "shield"
  | "silhouette";

export const SHAPE_LABELS: Record<KeychainShape, string> = {
  round: "Redondo",
  square: "Cuadrado",
  rectangle: "Rectángulo",
  diamond: "Rombo",
  star: "Estrella",
  hex: "Hexágono",
  oct: "Octágono",
  heart: "Corazón",
  shield: "Escudo",
  silhouette: "Silueta",
};

export const KEYCHAIN_SHAPES = Object.keys(SHAPE_LABELS) as KeychainShape[];

export interface ShapeParams {
  widthMm: number;
  heightMm: number;
  cornerMm: number;
  starPoints: number;
  starInnerRatio: number;
}

const CURVE_SEGMENTS = 96;

function circleRing(radius: number, segments: number): Ring {
  const points: Ring = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (2 * Math.PI * index) / segments;
    points.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return points;
}

/** Rectángulo con esquinas redondeadas, recorrido en sentido antihorario. */
function roundedRectRing(
  width: number,
  height: number,
  radius: number,
  segments: number
): Ring {
  const hw = width / 2;
  const hh = height / 2;
  const r = Math.max(0, Math.min(radius, hw - 0.01, hh - 0.01));
  if (r <= 0.001) {
    return [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
  }
  const corners: [number, number, number][] = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, (3 * Math.PI) / 2],
  ];
  const points: Ring = [];
  for (const [cx, cy, start] of corners) {
    for (let index = 0; index <= segments; index += 1) {
      const angle = start + (Math.PI / 2) * (index / segments);
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  }
  return points;
}

function diamondRing(hw: number, hh: number): Ring {
  return [
    [0, -hh],
    [hw, 0],
    [0, hh],
    [-hw, 0],
  ];
}

function starRing(
  points: number,
  rx: number,
  ry: number,
  innerRatio: number
): Ring {
  const total = Math.max(3, Math.round(points)) * 2;
  const ratio = Math.max(0.1, Math.min(innerRatio, 0.95));
  const ring: Ring = [];
  for (let index = 0; index < total; index += 1) {
    const scale = index % 2 === 0 ? 1 : ratio;
    const angle = -Math.PI / 2 + (Math.PI / (total / 2)) * index;
    ring.push([rx * scale * Math.cos(angle), ry * scale * Math.sin(angle)]);
  }
  return ring;
}

function polygonRing(
  sides: number,
  rx: number,
  ry: number,
  rotation: number
): Ring {
  const ring: Ring = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (2 * Math.PI * index) / sides + rotation;
    ring.push([rx * Math.cos(angle), ry * Math.sin(angle)]);
  }
  return ring;
}

function heartRing(rx: number, ry: number, segments: number): Ring {
  const raw: [number, number][] = [];
  for (let index = 0; index < segments; index += 1) {
    const t = (2 * Math.PI * index) / segments;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    raw.push([x, y]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = (2 * rx) / Math.max(1e-6, maxX - minX);
  const sy = (2 * ry) / Math.max(1e-6, maxY - minY);
  // La curva paramétrica tiene Y hacia arriba; se invierte para el plano Y-arriba.
  return raw.map(([x, y]) => [(x - cx) * sx, -(y - cy) * sy] as [number, number]);
}

function shieldRing(hw: number, hh: number, segments: number): Ring {
  const points: Ring = [];
  const shoulder = 0.45;

  const halfWidth = (t: number) => {
    if (t <= shoulder) return hw;
    const fall = (t - shoulder) / (1 - shoulder);
    return hw * Math.pow(1 - fall, 0.72);
  };

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    points.push([halfWidth(t), hh - t * 2 * hh]);
  }
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    points.push([-halfWidth(1 - t), -hh + t * 2 * hh]);
  }

  return points;
}

function rawShapeRing(shape: KeychainShape, params: ShapeParams): Ring {
  const width = Math.max(4, params.widthMm);
  const usesHeight =
    shape === "rectangle" ||
    shape === "diamond" ||
    shape === "star" ||
    shape === "heart" ||
    shape === "shield";
  const height = usesHeight ? Math.max(4, params.heightMm) : width;
  const hw = width / 2;
  const hh = height / 2;

  switch (shape) {
    case "round":
      return circleRing(width / 2, 180);
    case "diamond":
      return diamondRing(hw, hh);
    case "star":
      return starRing(params.starPoints, hw, hh, params.starInnerRatio);
    case "hex":
      return polygonRing(6, hw, hh, 0);
    case "oct":
      return polygonRing(8, hw / Math.cos(Math.PI / 8), hh / Math.cos(Math.PI / 8), Math.PI / 8);
    case "heart":
      return heartRing(hw, hh, 180);
    case "shield":
      return shieldRing(hw, hh, CURVE_SEGMENTS);
    case "square":
    case "rectangle":
    default:
      return roundedRectRing(width, height, params.cornerMm, 24);
  }
}

/** Contorno normalizado (CCW, sin auto-intersecciones) listo para Clipper. */
export function buildShapeRings(shape: KeychainShape, params: ShapeParams): Ring[] {
  return union([rawShapeRing(shape, params)]);
}
