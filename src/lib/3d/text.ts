import { parse } from "opentype.js";
import type { HandoffLayer } from "./handoff";

export interface KeychainFont {
  id: string;
  label: string;
  file: string;
}

export const KEYCHAIN_FONTS: KeychainFont[] = [
  { id: "lato-black", label: "Lato (gruesa)", file: "/fonts/lato-black.ttf" },
  { id: "baloo2", label: "Baloo (redondeada)", file: "/fonts/baloo2.ttf" },
  { id: "bungee", label: "Bungee (bloque)", file: "/fonts/bungee.ttf" },
];

export type OpenTypeFont = ReturnType<typeof parse>;

export interface TextLine {
  text: string;
  sizeMm: number;
  color: string;
}

export interface TextOptions {
  /** Separación extra entre glifos, en mm. */
  letterSpacingMm?: number;
  /** Separación vertical extra entre líneas, en mm. */
  lineGapMm?: number;
}

const cache = new Map<string, Promise<OpenTypeFont>>();

/** Parsea una fuente desde un buffer (útil para pruebas y para el navegador). */
export function parseFont(buffer: ArrayBuffer): OpenTypeFont {
  return parse(buffer);
}

export function fontFile(id: string): string {
  const option = KEYCHAIN_FONTS.find((font) => font.id === id) ?? KEYCHAIN_FONTS[0];
  return option.file;
}

export function loadFont(id: string): Promise<OpenTypeFont> {
  const existing = cache.get(id);
  if (existing) return existing;
  const promise = fetch(fontFile(id))
    .then((response) => {
      if (!response.ok) throw new Error(`No se pudo cargar la fuente (${response.status})`);
      return response.arrayBuffer();
    })
    .then((buffer) => parse(buffer));
  cache.set(id, promise);
  return promise;
}

function lineToSvg(
  font: OpenTypeFont,
  text: string,
  x: number,
  baseline: number,
  sizeMm: number,
  letterSpacingMm: number
): string {
  // opentype aplica `letterSpacing` en em (lo multiplica por el tamaño de fuente).
  const letterSpacing = sizeMm > 0 ? letterSpacingMm / sizeMm : 0;
  const path = font.getPath(text, x, baseline, sizeMm, { letterSpacing });
  const d = path.toPathData(3);
  return `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
}

/**
 * Convierte de 1 a N líneas de texto en capas (una por línea) con los contornos
 * de los glifos, centradas horizontalmente y apiladas verticalmente.
 */
export function buildTextLayers(
  font: OpenTypeFont,
  lines: TextLine[],
  options: TextOptions = {}
): HandoffLayer[] {
  const usable = lines.filter((line) => line.text.trim().length > 0 && line.sizeMm > 0);
  if (usable.length === 0) return [];

  const gap = Math.max(0, options.lineGapMm ?? 0);
  const spacing = Math.max(0, options.letterSpacingMm ?? 0);

  const measured = usable.map((line) => {
    const path = font.getPath(line.text, 0, 0, line.sizeMm);
    const bbox = path.getBoundingBox();
    const letterSpacing = line.sizeMm > 0 ? spacing / line.sizeMm : 0;
    const advance = font.getAdvanceWidth(line.text, line.sizeMm, { letterSpacing });
    return { line, bbox, advance };
  });

  const totalHeight =
    measured.reduce((sum, item) => sum + (item.bbox.y2 - item.bbox.y1), 0) +
    gap * Math.max(0, measured.length - 1);

  let cursorTop = -totalHeight / 2;
  return measured.map((item) => {
    const x = -item.advance / 2;
    const baseline = cursorTop - item.bbox.y1;
    cursorTop += item.bbox.y2 - item.bbox.y1 + gap;
    return {
      color: item.line.color,
      svg: lineToSvg(font, item.line.text, x, baseline, item.line.sizeMm, spacing),
    };
  });
}
