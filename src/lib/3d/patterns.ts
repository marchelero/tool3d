export type PatternKind =
  | "honeycomb"
  | "lines"
  | "grid"
  | "waves"
  | "dots"
  | "radial";

export const PATTERN_LABELS: Record<PatternKind, string> = {
  honeycomb: "Panal",
  lines: "Líneas",
  grid: "Cuadrícula",
  waves: "Olas",
  dots: "Puntos",
  radial: "Radial",
};

export const PATTERN_KINDS = Object.keys(PATTERN_LABELS) as PatternKind[];

export interface PatternOptions {
  sizeMm: number;
  cellMm: number;
  thicknessMm: number;
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
  const data = points
    .map((point) => `${round(point.x)},${round(point.y)}`)
    .join(" ");
  return `<polygon points="${data}"/>`;
}

function polar(cx: number, cy: number, radius: number, angle: number): Point {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
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
  const period = cell * 2;
  const amplitude = cell * 0.35;
  const half = thickness / 2;
  const samples = 60;
  const wave = (x: number) => amplitude * Math.sin((2 * Math.PI * x) / period);
  for (let rowY = cell / 2; rowY < size; rowY += cell) {
    const top: Point[] = [];
    const bottom: Point[] = [];
    for (let index = 0; index <= samples; index += 1) {
      const x = (size * index) / samples;
      top.push({ x, y: rowY - half + wave(x) });
      bottom.push({ x, y: rowY + half + wave(x) });
    }
    parts.push(polygon([...top, ...bottom.reverse()]));
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

export function patternToSvg(kind: PatternKind, options: PatternOptions): string {
  const size = Math.max(10, options.sizeMm);
  const cell = Math.max(2, Math.min(options.cellMm, size / 2));
  const thickness = Math.max(0.4, Math.min(options.thicknessMm, cell * 0.95));

  let body = "";
  switch (kind) {
    case "lines":
      body = linesPattern(size, cell, thickness);
      break;
    case "grid":
      body = gridPattern(size, cell, thickness);
      break;
    case "dots":
      body = dotsPattern(size, cell, thickness);
      break;
    case "honeycomb":
      body = honeycombPattern(size, cell, thickness);
      break;
    case "waves":
      body = wavesPattern(size, cell, thickness);
      break;
    case "radial":
      body = radialPattern(size, cell, thickness);
      break;
    default:
      body = "";
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(
    size
  )} ${round(size)}" width="${round(size)}" height="${round(size)}">${body}</svg>`;
}
