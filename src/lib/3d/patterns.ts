export type PatternKind =
  | "honeycomb"
  | "waves"
  | "lines"
  | "grid"
  | "diamonds"
  | "triangles"
  | "bricks"
  | "zigzag"
  | "diagonal"
  | "dots"
  | "crosses"
  | "stars"
  | "radial"
  | "spiral"
  | "pebbles";

export const PATTERN_LABELS: Record<PatternKind, string> = {
  honeycomb: "Panal",
  waves: "Olas",
  lines: "Líneas",
  grid: "Cuadrícula",
  diamonds: "Rombos",
  triangles: "Triángulos",
  bricks: "Ladrillos",
  zigzag: "Zigzag",
  diagonal: "Diagonales",
  dots: "Puntos",
  crosses: "Cruces",
  stars: "Estrellas",
  radial: "Radial",
  spiral: "Espiral",
  pebbles: "Guijarros",
};

export const PATTERN_KINDS = Object.keys(PATTERN_LABELS) as PatternKind[];

export interface PatternOptions {
  sizeMm: number;
  cellMm: number;
  thicknessMm: number;
  fill?: string;
}

interface Point {
  x: number;
  y: number;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

function rect(x: number, y: number, width: number, height: number): string {
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(
    height
  )}"/>`;
}

function circle(cx: number, cy: number, radius: number): string {
  return `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(radius)}"/>`;
}

function polygon(points: Point[]): string {
  if (points.length < 3) return "";
  const data = points
    .map((point) => `${round(point.x)},${round(point.y)}`)
    .join(" ");
  return `<polygon points="${data}"/>`;
}

function polar(cx: number, cy: number, radius: number, angle: number): Point {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function centroid(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function shrinkPoints(points: Point[], factor: number): Point[] {
  const center = centroid(points);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor,
  }));
}

// Convierte una polilínea abierta en una banda rellena de ancho 2*halfWidth.
function offsetBand(points: Point[], halfWidth: number): Point[] {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    left.push({
      x: points[index].x + nx * halfWidth,
      y: points[index].y + ny * halfWidth,
    });
    right.push({
      x: points[index].x - nx * halfWidth,
      y: points[index].y - ny * halfWidth,
    });
  }
  return [...left, ...right.reverse()];
}

// Recorta un polígono por el semiplano a*x + b*y <= c (Sutherland-Hodgman).
function clipHalfPlane(
  points: Point[],
  a: number,
  b: number,
  c: number
): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const centerDistance = a * current.x + b * current.y - c;
    const nextDistance = a * next.x + b * next.y - c;
    if (centerDistance <= 0) result.push(current);
    if (
      (centerDistance <= 0 && nextDistance > 0) ||
      (centerDistance > 0 && nextDistance <= 0)
    ) {
      const ratio = centerDistance / (centerDistance - nextDistance);
      result.push({
        x: current.x + (next.x - current.x) * ratio,
        y: current.y + (next.y - current.y) * ratio,
      });
    }
  }
  return result;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function linesPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  for (let y = cell / 2; y < size; y += cell) {
    parts.push(rect(0, y - thickness / 2, size, thickness));
  }
  return parts.join("");
}

function gridPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [linesPattern(size, cell, thickness)];
  for (let x = cell / 2; x < size; x += cell) {
    parts.push(rect(x - thickness / 2, 0, thickness, size));
  }
  return parts.join("");
}

function dotsPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const radius = thickness / 2;
  for (let y = cell / 2; y < size; y += cell) {
    for (let x = cell / 2; x < size; x += cell) {
      parts.push(circle(x, y, radius));
    }
  }
  return parts.join("");
}

function honeycombPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  // Celdas con vértice arriba (pointy-top): paso horizontal = celda y vertical
  // = celda * sqrt(3)/2. El radio se reduce para dejar un hueco del grosor pedido
  // entre celdas; si el radio no se reduce, las celdas se tocan y la unión de
  // sólidos se degenera (el patrón desaparecía).
  const pitch = Math.max(3, cell);
  const gap = Math.min(thickness, pitch * 0.6);
  const radius = Math.max(0.4, (pitch - gap) / Math.sqrt(3));
  const stepX = pitch;
  const stepY = (pitch * Math.sqrt(3)) / 2;
  let row = 0;
  for (let cy = 0; cy < size + stepY && row < 400; cy += stepY, row += 1) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    let count = 0;
    for (
      let cx = offset - stepX;
      cx < size + stepX && count < 400;
      cx += stepX, count += 1
    ) {
      const corners: Point[] = [];
      for (let index = 0; index < 6; index += 1) {
        corners.push(polar(cx, cy, radius, (Math.PI / 3) * index + Math.PI / 6));
      }
      parts.push(polygon(corners));
    }
  }
  return parts.join("");
}

function wavesPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const period = Math.max(3, cell * 2);
  const amplitude = cell * 0.35;
  const samples = Math.min(900, Math.max(32, Math.ceil((size / period) * 32)));
  const wave = (x: number) => amplitude * Math.sin((2 * Math.PI * x) / period);
  for (let rowY = cell / 2; rowY < size; rowY += cell) {
    const centerline: Point[] = [];
    for (let index = 0; index <= samples; index += 1) {
      const x = (size * index) / samples;
      centerline.push({ x, y: rowY + wave(x) });
    }
    parts.push(polygon(offsetBand(centerline, thickness / 2)));
  }
  return parts.join("");
}

function diamondsPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const half = Math.max(0.6, (cell - thickness) / 2);
  const stepX = cell;
  const stepY = cell;
  let row = 0;
  for (let cy = stepY / 2; cy < size + stepY && row < 400; cy += stepY, row += 1) {
    const offset = row % 2 === 0 ? 0 : stepX / 2;
    let count = 0;
    for (
      let cx = offset + stepX / 2 - stepX;
      cx < size + stepX && count < 400;
      cx += stepX, count += 1
    ) {
      parts.push(
        polygon([
          { x: cx, y: cy - half },
          { x: cx + half, y: cy },
          { x: cx, y: cy + half },
          { x: cx - half, y: cy },
        ])
      );
    }
  }
  return parts.join("");
}

function trianglesPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const side = Math.max(2.5, cell);
  const height = (side * Math.sqrt(3)) / 2;
  const factor = Math.max(0.25, 1 - (thickness / side) * 1.15);
  let row = 0;
  for (let yTop = -height; yTop < size + height && row < 400; yTop += height, row += 1) {
    const offset = row % 2 === 0 ? 0 : side / 2;
    let column = 0;
    for (
      let x = offset - side;
      x < size + side && column < 400;
      x += side, column += 1
    ) {
      const yBottom = yTop + height;
      parts.push(
        polygon(
          shrinkPoints(
            [
              { x: x + side / 2, y: yTop },
              { x, y: yBottom },
              { x: x + side, y: yBottom },
            ],
            factor
          )
        )
      );
      parts.push(
        polygon(
          shrinkPoints(
            [
              { x: x, y: yTop },
              { x: x + side, y: yTop },
              { x: x + side / 2, y: yBottom },
            ],
            factor
          )
        )
      );
    }
  }
  return parts.join("");
}

function bricksPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const width = cell * 2;
  const height = cell;
  const gap = Math.min(thickness, cell * 0.6);
  let row = 0;
  for (let y = 0; y < size && row < 400; y += height, row += 1) {
    const offset = row % 2 === 0 ? 0 : -width / 2;
    let column = 0;
    for (
      let x = offset;
      x < size && column < 400;
      x += width, column += 1
    ) {
      parts.push(rect(x + gap / 2, y + gap / 2, width - gap, height - gap));
    }
  }
  return parts.join("");
}

function zigzagPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const step = Math.max(1.5, cell / 2);
  const amplitude = cell * 0.32;
  for (let rowY = cell / 2; rowY < size; rowY += cell) {
    const centerline: Point[] = [];
    let index = 0;
    for (let x = -cell; x < size + cell * 2 && index < 600; x += step, index += 1) {
      centerline.push({
        x,
        y: rowY + (index % 2 === 0 ? -amplitude : amplitude),
      });
    }
    parts.push(polygon(offsetBand(centerline, thickness / 2)));
  }
  return parts.join("");
}

function diagonalPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const band = Math.max(0.6, cell - thickness);
  const box: Point[] = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  const total = Math.ceil((size * 2) / cell) + 4;
  for (let index = -2; index <= total; index += 1) {
    const start = -cell + index * cell;
    let strip = clipHalfPlane(box, 1, 1, start + band);
    strip = clipHalfPlane(strip, -1, -1, -start);
    if (strip.length >= 3) parts.push(polygon(strip));
  }
  return parts.join("");
}

function crossesPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const extent = Math.max(1, (cell - thickness) / 2);
  const arm = Math.max(0.5, extent * 0.36);
  let row = 0;
  for (let cy = cell / 2; cy < size && row < 400; cy += cell, row += 1) {
    let column = 0;
    for (
      let cx = cell / 2;
      cx < size && column < 400;
      cx += cell, column += 1
    ) {
      parts.push(
        polygon([
          { x: cx - extent, y: cy - arm },
          { x: cx - arm, y: cy - arm },
          { x: cx - arm, y: cy - extent },
          { x: cx + arm, y: cy - extent },
          { x: cx + arm, y: cy - arm },
          { x: cx + extent, y: cy - arm },
          { x: cx + extent, y: cy + arm },
          { x: cx + arm, y: cy + arm },
          { x: cx + arm, y: cy + extent },
          { x: cx - arm, y: cy + extent },
          { x: cx - arm, y: cy + arm },
          { x: cx - extent, y: cy + arm },
        ])
      );
    }
  }
  return parts.join("");
}

function starsPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const outer = Math.max(1, (cell - thickness) / 2);
  const inner = outer * 0.45;
  const points = 5;
  let row = 0;
  for (let cy = cell / 2; cy < size && row < 400; cy += cell, row += 1) {
    const offset = row % 2 === 0 ? 0 : cell / 2;
    let column = 0;
    for (
      let cx = offset + cell / 2;
      cx < size && column < 400;
      cx += cell, column += 1
    ) {
      const star: Point[] = [];
      for (let index = 0; index < points * 2; index += 1) {
        const radius = index % 2 === 0 ? outer : inner;
        star.push(
          polar(cx, cy, radius, -Math.PI / 2 + (Math.PI / points) * index)
        );
      }
      parts.push(polygon(star));
    }
  }
  return parts.join("");
}

function radialPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const center = size / 2;
  const inner = Math.max(3, size * 0.12);
  const outer = Math.max(inner + thickness * 2, size / 2 - thickness);
  const spokes = Math.max(8, Math.min(48, Math.round((2 * Math.PI * outer) / cell)));
  const halfAngle = Math.min(0.4, thickness / 2 / inner);
  for (let index = 0; index < spokes; index += 1) {
    const angle = (2 * Math.PI * index) / spokes;
    parts.push(
      polygon([
        polar(center, center, inner, angle - halfAngle),
        polar(center, center, inner, angle + halfAngle),
        polar(center, center, outer, angle + halfAngle),
        polar(center, center, outer, angle - halfAngle),
      ])
    );
  }
  parts.push(circle(center, center, inner * 0.9));
  return parts.join("");
}

function spiralPattern(size: number, cell: number, thickness: number): string {
  const center = size / 2;
  const gap = Math.max(cell, thickness * 1.6);
  const maxRadius = size * 0.74;
  // Arranca fuera del centro (r0) para que la banda no se solape consigo misma
  // y muestrea por longitud de arco para que la curva salga suave.
  const startRadius = Math.max(thickness * 1.05, gap * 0.3);
  const maxAngle = ((maxRadius - startRadius) / gap) * 2 * Math.PI;
  const samples = Math.min(
    3000,
    Math.max(
      240,
      Math.ceil((maxAngle * maxRadius) / Math.max(0.5, thickness))
    )
  );
  const centerline: Point[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const angle = (maxAngle * index) / samples;
    const radius = startRadius + (gap * angle) / (2 * Math.PI);
    centerline.push(polar(center, center, radius, angle));
  }
  return polygon(offsetBand(centerline, thickness / 2));
}

function pebblesPattern(size: number, cell: number, thickness: number): string {
  const parts: string[] = [];
  const random = mulberry32(20260418);
  const maxRadius = Math.max(0.8, (cell - thickness) / 2);
  let row = 0;
  for (let cy = cell / 2; cy < size && row < 400; cy += cell, row += 1) {
    let column = 0;
    for (
      let cx = cell / 2;
      cx < size && column < 400;
      cx += cell, column += 1
    ) {
      const radius = maxRadius * (0.6 + random() * 0.38);
      const jitterX = (cell / 2 - radius) * (random() * 2 - 1);
      const jitterY = (cell / 2 - radius) * (random() * 2 - 1);
      parts.push(circle(cx + jitterX, cy + jitterY, radius));
    }
  }
  return parts.join("");
}

function buildBody(
  kind: PatternKind,
  size: number,
  cell: number,
  thickness: number
): string {
  switch (kind) {
    case "honeycomb":
      return honeycombPattern(size, cell, thickness);
    case "waves":
      return wavesPattern(size, cell, thickness);
    case "grid":
      return gridPattern(size, cell, thickness);
    case "diamonds":
      return diamondsPattern(size, cell, thickness);
    case "triangles":
      return trianglesPattern(size, cell, thickness);
    case "bricks":
      return bricksPattern(size, cell, thickness);
    case "zigzag":
      return zigzagPattern(size, cell, thickness);
    case "diagonal":
      return diagonalPattern(size, cell, thickness);
    case "dots":
      return dotsPattern(size, cell, thickness);
    case "crosses":
      return crossesPattern(size, cell, thickness);
    case "stars":
      return starsPattern(size, cell, thickness);
    case "radial":
      return radialPattern(size, cell, thickness);
    case "spiral":
      return spiralPattern(size, cell, thickness);
    case "pebbles":
      return pebblesPattern(size, cell, thickness);
    case "lines":
    default:
      return linesPattern(size, cell, thickness);
  }
}

export function patternToSvg(kind: PatternKind, options: PatternOptions): string {
  const size = Math.max(10, options.sizeMm);
  const cell = Math.max(2, Math.min(options.cellMm, size / 2));
  const thickness = Math.max(0.4, Math.min(options.thicknessMm, cell * 0.95));

  const body = buildBody(kind, size, cell, thickness);
  const fill = options.fill ? ` fill="${options.fill}"` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(
    size
  )} ${round(size)}" width="${round(size)}" height="${round(
    size
  )}"><g${fill}>${body}</g></svg>`;
}

export function patternPreviewUrl(kind: PatternKind): string {
  const svg = patternToSvg(kind, {
    sizeMm: 36,
    cellMm: 8,
    thicknessMm: 2.4,
    fill: "#94a3b8",
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
