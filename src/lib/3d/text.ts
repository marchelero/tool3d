import { parse } from "opentype.js";
import type { HandoffLayer } from "./handoff";

export interface KeychainFont {
  id: string;
  label: string;
  file: string;
}

export const KEYCHAIN_FONTS: KeychainFont[] = [
  { id: "lato-black", label: "Lato (gruesa)", file: "/fonts/lato-black.ttf" },
  { id: "poppins-bold", label: "Poppins (moderna)", file: "/fonts/poppins-bold.ttf" },
  { id: "varelaround", label: "Varela Round (redondeada)", file: "/fonts/varelaround.ttf" },
  { id: "anton", label: "Anton (impacto)", file: "/fonts/anton.ttf" },
  { id: "bebas", label: "Bebas Neue (alta)", file: "/fonts/bebas.ttf" },
  { id: "bungee", label: "Bungee (bloque)", file: "/fonts/bungee.ttf" },
  { id: "righteous", label: "Righteous (retro)", file: "/fonts/righteous.ttf" },
  { id: "alfaslab", label: "Alfa Slab (serif)", file: "/fonts/alfaslab.ttf" },
  { id: "lobster", label: "Lobster (cursiva)", file: "/fonts/lobster.ttf" },
  { id: "pacifico", label: "Pacifico (caligráfica)", file: "/fonts/pacifico.ttf" },
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

async function loadSystemFont(postscriptName: string): Promise<OpenTypeFont> {
  const font = localRegistry.get(postscriptName);
  if (!font) {
    throw new Error(
      "Esa fuente del equipo ya no está disponible. Volvé a cargar las fuentes del sistema."
    );
  }
  try {
    const blob = await font.blob();
    return parse(await blob.arrayBuffer());
  } catch {
    throw new Error("No se pudo leer esa fuente del equipo (puede estar protegida).");
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
