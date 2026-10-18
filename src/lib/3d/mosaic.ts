export type TileKind =
  | "grid"
  | "offset"
  | "mirror"
  | "flip"
  | "hex"
  | "radial";

export const TILE_LABELS: Record<TileKind, string> = {
  grid: "Cuadrícula",
  offset: "Ladrillo",
  mirror: "Espejo",
  flip: "Alternado",
  hex: "Panal",
  radial: "Radial",
};

export const TILE_KINDS: TileKind[] = [
  "grid",
  "offset",
  "mirror",
  "flip",
  "hex",
  "radial",
];

export interface MosaicOptions {
  /** Lado del lienzo generado (normalmente el ancho del posavasos). */
  sizeMm: number;
  /** Tamaño de cada copia del diseño. */
  tileMm: number;
  /** Separación entre copias. */
  gapMm: number;
  /** Rotación del mosaico completo, en grados. */
  rotation: number;
  kind: TileKind;
}

const MAX_TILES = 256;
const MAX_SOURCES = 24;
const MOSAIC_ELEMENT_BUDGET = 2000;

interface ParsedSource {
  inner: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;

function parseSource(svg: string): ParsedSource | null {
  let minX = 0;
  let minY = 0;
  let width = 0;
  let height = 0;

  const viewBox = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts.every((value) => Number.isFinite(value))) {
      [minX, minY, width, height] = parts;
    }
  }
  if (!(width > 0) || !(height > 0)) {
    const widthMatch = svg.match(/\bwidth\s*=\s*"([\d.]+)/i);
    const heightMatch = svg.match(/\bheight\s*=\s*"([\d.]+)/i);
    width = widthMatch ? Number(widthMatch[1]) : 0;
    height = heightMatch ? Number(heightMatch[1]) : 0;
    if (!(width > 0) || !(height > 0)) return null;
  }

  const open = svg.indexOf(">");
  const close = svg.lastIndexOf("</svg>");
  if (open < 0 || close < 0 || close <= open) return null;

  return {
    inner: svg.slice(open + 1, close),
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
  };
}

interface Tile {
  x: number;
  y: number;
  angle: number;
  flipX: boolean;
}

function tilePositions(
  kind: TileKind,
  sizeMm: number,
  pitch: number
): Tile[] {
  const tiles: Tile[] = [];
  const push = (x: number, y: number, angle = 0, flipX = false) => {
    if (tiles.length < MAX_TILES) tiles.push({ x, y, angle, flipX });
  };

  if (kind === "radial") {
    const center = sizeMm / 2;
    push(center, center);
    const maxRadius = sizeMm * 0.75;
    for (
      let ring = 1;
      ring * pitch <= maxRadius && tiles.length < MAX_TILES;
      ring += 1
    ) {
      const radius = ring * pitch;
      const count = Math.max(6, Math.round((2 * Math.PI * radius) / pitch));
      for (let index = 0; index < count; index += 1) {
        if (tiles.length >= MAX_TILES) break;
        const theta = (2 * Math.PI * index) / count;
        push(
          center + radius * Math.cos(theta),
          center + radius * Math.sin(theta),
          90 + (theta * 180) / Math.PI
        );
      }
    }
    return tiles;
  }

  const rowHeight = kind === "hex" ? pitch * (Math.sqrt(3) / 2) : pitch;
  const columns = Math.ceil(sizeMm / pitch) + 2;
  const rows = Math.ceil(sizeMm / rowHeight) + 2;
  for (let row = 0; row < rows; row += 1) {
    if (tiles.length >= MAX_TILES) break;
    const offset =
      kind === "offset" || kind === "hex"
        ? row % 2 === 0
          ? 0
          : pitch / 2
        : 0;
    for (let column = 0; column < columns; column += 1) {
      if (tiles.length >= MAX_TILES) break;
      const alternating = (row + column) % 2 === 1;
      push(
        column * pitch + offset - pitch / 2,
        row * rowHeight - rowHeight / 2,
        kind === "flip" && alternating ? 180 : 0,
        kind === "mirror" && alternating
      );
    }
  }
  return tiles;
}

/**
 * Repite uno o más SVG en mosaico. Cada color del diseño se pasa como una capa
 * separada (misma disposición) para que el trazado conserve sus colores.
 */
export function buildMosaicSvg(
  sources: string[],
  options: MosaicOptions
): string {
  const tileMm = Math.max(2, options.tileMm);
  const pitch = tileMm + Math.max(0, options.gapMm);
  const sizeMm = Math.max(tileMm, options.sizeMm);

  const parsed = sources
    .map(parseSource)
    .filter((source): source is ParsedSource => source !== null)
    .slice(0, MAX_SOURCES);

  if (parsed.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(sizeMm)} ${round(sizeMm)}" width="${round(sizeMm)}" height="${round(sizeMm)}"></svg>`;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const source of parsed) {
    minX = Math.min(minX, source.minX);
    minY = Math.min(minY, source.minY);
    maxX = Math.max(maxX, source.maxX);
    maxY = Math.max(maxY, source.maxY);
  }

  const rawWidth = Math.max(0.001, maxX - minX);
  const rawHeight = Math.max(0.001, maxY - minY);
  const scale = Math.min(tileMm / rawWidth, tileMm / rawHeight);
  const padX = (tileMm - rawWidth * scale) / 2;
  const padY = (tileMm - rawHeight * scale) / 2;

  // El contenido de cada capa se lleva al origen 0,0 del lienzo original.
  const body = parsed
    .map(
      (source) =>
        `<g transform="translate(${round(-minX)},${round(-minY)})">${source.inner}</g>`
    )
    .join("");

  const half = tileMm / 2;
  // Un SVG complejo no debe multiplicarse por cientos de piezas: se limita el
  // total de figuras para que la vectorización no se vuelva inmanejable.
  const elements = (
    body.match(/<(path|polygon|polyline|rect|circle|ellipse|line)\b/g) ?? []
  ).length;
  const allowedTiles = Math.max(
    4,
    Math.min(MAX_TILES, Math.floor(MOSAIC_ELEMENT_BUDGET / Math.max(1, elements)))
  );
  const tiles = tilePositions(options.kind, sizeMm, pitch)
    .slice(0, allowedTiles)
    .map((tile) => {
      const mirror = tile.flipX ? -1 : 1;
      const transform = [
        `translate(${round(tile.x)},${round(tile.y)})`,
        `rotate(${round(tile.angle)})`,
        `scale(${round(mirror)},1)`,
        `translate(${round(-half)},${round(-half)})`,
        `scale(${round(scale)})`,
        `translate(${round(padX / scale)},${round(padY / scale)})`,
      ].join(" ");
      return `<g transform="${transform}">${body}</g>`;
    })
    .join("");

  const center = round(sizeMm / 2);
  const rotation = options.rotation % 360;
  const content =
    rotation === 0
      ? tiles
      : `<g transform="rotate(${round(rotation)},${center},${center})">${tiles}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(sizeMm)} ${round(sizeMm)}" width="${round(sizeMm)}" height="${round(sizeMm)}">${content}</svg>`;
}

const PREVIEW_GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M5 3h11v4h-7v3h7v4h-11z" fill="#94a3b8"/></svg>`;

export function mosaicPreviewUrl(kind: TileKind): string {
  const svg = buildMosaicSvg([PREVIEW_GLYPH], {
    sizeMm: 40,
    tileMm: 11,
    gapMm: 1.5,
    rotation: 0,
    kind,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
