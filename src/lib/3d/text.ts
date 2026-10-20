import { parse, type OpenTypePath } from "opentype.js";
import type { HandoffLayer } from "./handoff";

export interface KeychainFont {
  id: string;
  label: string;
  file: string;
}

// Prefijo del sitio cuando se publica bajo un subdirectorio (GitHub Pages).
// En local es "" (sirve desde la raíz).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const KEYCHAIN_FONTS: KeychainFont[] = [
  { id: "lato-black", label: "Lato (gruesa)", file: `${BASE_PATH}/fonts/lato-black.ttf` },
  { id: "poppins-bold", label: "Poppins (moderna)", file: `${BASE_PATH}/fonts/poppins-bold.ttf` },
  { id: "varelaround", label: "Varela Round (redondeada)", file: `${BASE_PATH}/fonts/varelaround.ttf` },
  { id: "anton", label: "Anton (impacto)", file: `${BASE_PATH}/fonts/anton.ttf` },
  { id: "bebas", label: "Bebas Neue (alta)", file: `${BASE_PATH}/fonts/bebas.ttf` },
  { id: "bungee", label: "Bungee (bloque)", file: `${BASE_PATH}/fonts/bungee.ttf` },
  { id: "righteous", label: "Righteous (retro)", file: `${BASE_PATH}/fonts/righteous.ttf` },
  { id: "alfaslab", label: "Alfa Slab (serif)", file: `${BASE_PATH}/fonts/alfaslab.ttf` },
  { id: "lobster", label: "Lobster (cursiva)", file: `${BASE_PATH}/fonts/lobster.ttf` },
  { id: "pacifico", label: "Pacifico (caligráfica)", file: `${BASE_PATH}/fonts/pacifico.ttf` },
];

/** Prefijo de los ids que representan una fuente del sistema (Local Font Access API). */
export const LOCAL_FONT_PREFIX = "local:";

export interface SystemFont {
  id: string;
  label: string;
}

const localRegistry = new Map<string, LocalFontData>();

/** ¿El navegador soporta leer las fuentes del equipo? (Chrome/Edge). */
export function systemFontsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.queryLocalFonts === "function"
  );
}

/**
 * Estado del permiso de fuentes locales. Si ya está concedido, se pueden listar
 * sin volver a preguntar (y sin necesidad de un clic).
 */
export async function systemFontsPermission(): Promise<
  PermissionState | "unsupported"
> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  try {
    const status = await navigator.permissions.query({
      name: "local-fonts" as PermissionName,
    });
    return status.state;
  } catch {
    return "unsupported";
  }
}

/** Pide permiso y lista las fuentes instaladas en el equipo. */
export async function loadSystemFonts(): Promise<SystemFont[]> {
  if (!systemFontsSupported()) {
    throw new Error("Este navegador no permite leer las fuentes del equipo.");
  }
  const fonts = await window.queryLocalFonts!();
  localRegistry.clear();
  const list: SystemFont[] = [];
  for (const font of fonts) {
    localRegistry.set(font.postscriptName, font);
    list.push({ id: LOCAL_FONT_PREFIX + font.postscriptName, label: font.fullName });
  }
  list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}

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
  const promise = id.startsWith(LOCAL_FONT_PREFIX)
    ? loadSystemFont(id.slice(LOCAL_FONT_PREFIX.length))
    : fetch(fontFile(id))
        .then((response) => {
          if (!response.ok) {
            throw new Error(`No se pudo cargar la fuente (${response.status})`);
          }
          return response.arrayBuffer();
        })
        .then((buffer) => parse(buffer));
  cache.set(id, promise);
  promise.catch(() => cache.delete(id));
  return promise;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * Muchas fuentes del sistema (sobre todo en Windows) vienen en colecciones
 * TrueType (.ttc). opentype.js no las entiende, así que si el buffer es una
 * colección se extrae la primera fuente como un sfnt independiente.
 */
function firstFontFromCollection(buffer: ArrayBuffer): ArrayBuffer {
  if (buffer.byteLength < 12) return buffer;
  const view = new DataView(buffer);
  if (view.getUint32(0) !== 0x74746366) return buffer; // 'ttcf'
  const numFonts = view.getUint32(8);
  if (numFonts < 1) return buffer;
  const dirOffset = view.getUint32(12);
  if (dirOffset + 12 > buffer.byteLength) return buffer;
  const numTables = view.getUint16(dirOffset + 4);
  if (numTables === 0) return buffer;

  const records: { offset: number; length: number }[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const rec = dirOffset + 12 + i * 16;
    if (rec + 16 > buffer.byteLength) return buffer;
    records.push({
      offset: view.getUint32(rec + 8),
      length: view.getUint32(rec + 12),
    });
  }

  const headerSize = 12 + numTables * 16;
  const offsets: number[] = [];
  let total = headerSize;
  for (const record of records) {
    offsets.push(total);
    total += record.length;
    if (total % 4 !== 0) total += 4 - (total % 4);
  }

  const out = new Uint8Array(total);
  out.set(new Uint8Array(buffer, dirOffset, headerSize), 0);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < numTables; i += 1) {
    outView.setUint32(12 + i * 16 + 8, offsets[i]);
    const src = records[i];
    if (src.offset + src.length <= buffer.byteLength) {
      out.set(new Uint8Array(buffer, src.offset, src.length), offsets[i]);
    }
  }
  return out.buffer;
}

async function loadSystemFont(postscriptName: string): Promise<OpenTypeFont> {
  const font = localRegistry.get(postscriptName);
  if (!font) {
    throw new Error(
      "Esa fuente del equipo ya no está disponible. Volvé a cargar las fuentes del sistema."
    );
  }
  let buffer: ArrayBuffer;
  try {
    const blob = await font.blob();
    buffer = await blob.arrayBuffer();
  } catch (error) {
    throw new Error(
      `No se pudo leer esa fuente del equipo (${errorMessage(error)}).`
    );
  }
  try {
    return parse(firstFontFromCollection(buffer));
  } catch (error) {
    throw new Error(
      `Esa fuente del equipo no se pudo interpretar (${errorMessage(error)}).`
    );
  }
}

function lineToSvg(
  font: OpenTypeFont,
  text: string,
  x: number,
  baseline: number,
  sizeMm: number,
  letterSpacingMm: number
): string {
  const path = buildLinePath(font, text, x, baseline, sizeMm, letterSpacingMm).path;
  // opentype trabaja con Y hacia arriba y el SVG con Y hacia abajo: se invierte
  // para que el texto no salga reflejado (la imagen de Potrace ya viene bien).
  for (const command of path.commands) {
    if (typeof command.y === "number") command.y = -command.y;
    if (typeof command.y1 === "number") command.y1 = -command.y1;
    if (typeof command.y2 === "number") command.y2 = -command.y2;
  }
  const d = path.toPathData(3);
  const box = path.getBoundingBox();
  const width = Math.max(0.001, box.x2 - box.x1);
  const height = Math.max(0.001, box.y2 - box.y1);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${d}"/></svg>`;
}

/**
 * Traza una línea con opentype. Si el shaping falla (algunas fuentes del equipo
 * usan sustituciones GSUB que opentype.js no soporta y lanza), cae a un trazado
 * glifo a glifo sin shaping para que el texto igual se genere.
 */
function buildLinePath(
  font: OpenTypeFont,
  text: string,
  x: number,
  baseline: number,
  sizeMm: number,
  letterSpacingMm: number
): { path: OpenTypePath; advance: number } {
  const letterSpacing = sizeMm > 0 ? letterSpacingMm / sizeMm : 0;
  try {
    return {
      path: font.getPath(text, x, baseline, sizeMm, { letterSpacing }),
      advance: font.getAdvanceWidth(text, sizeMm, { letterSpacing }),
    };
  } catch {
    const scale = sizeMm / (font.unitsPerEm || 1000);
    let cursor = x;
    const parts = Array.from(text).map((char) => {
      const glyph = font.charToGlyph(char);
      const part = glyph.getPath(cursor, baseline, sizeMm);
      cursor += (glyph.advanceWidth ?? 0) * scale + letterSpacingMm;
      return part;
    });
    const path = parts[0];
    if (!path) return { path: font.getPath("", x, baseline, sizeMm), advance: 0 };
    for (let i = 1; i < parts.length; i += 1) path.extend(parts[i]);
    return { path, advance: cursor - x };
  }
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
    const { path, advance } = buildLinePath(font, line.text, 0, 0, line.sizeMm, spacing);
    return { line, bbox: path.getBoundingBox(), advance };
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
