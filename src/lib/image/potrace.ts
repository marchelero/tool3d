import { init, potrace } from "esm-potrace-wasm";
import { filterSvgShapes, removeEmptyGroups } from "./svg";

let ready: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!ready) {
    ready = init();
  }
  return ready;
}

export interface PotraceSettings {
  colors: number;
  turdsize?: number;
  alphamax?: number;
  opttolerance?: number;
}

function isSentinel(r: number, g: number, b: number): boolean {
  return r > 200 && g < 90 && b > 200;
}

function isBackgroundRgb(r: number, g: number, b: number): boolean {
  if (isSentinel(r, g, b)) return true;
  if (r > 240 && g > 240 && b > 240) return true;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 225;
}

function flattenOnWhite(image: ImageData): ImageData {
  const output = new ImageData(image.width, image.height);
  const source = image.data;
  const target = output.data;
  for (let i = 0; i < source.length; i += 4) {
    const alpha = source[i + 3] / 255;
    const r = Math.round(source[i] * alpha + 255 * (1 - alpha));
    const g = Math.round(source[i + 1] * alpha + 255 * (1 - alpha));
    const b = Math.round(source[i + 2] * alpha + 255 * (1 - alpha));
    const background = isBackgroundRgb(r, g, b);
    target[i] = background ? 255 : r;
    target[i + 1] = background ? 255 : g;
    target[i + 2] = background ? 255 : b;
    target[i + 3] = 255;
  }
  return output;
}

const NAMED_BACKGROUND = new Set([
  "white",
  "magenta",
  "fuchsia",
  "transparent",
  "none",
]);

function parseChannel(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    return Math.round((Number.parseFloat(trimmed) / 100) * 255);
  }
  return Number.parseFloat(trimmed);
}

function colorIsBackground(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) return false;
  if (NAMED_BACKGROUND.has(value)) return true;
  if (value.startsWith("url(")) return false;

  if (value.startsWith("#")) {
    const body = value.slice(1);
    let hex = body;
    if (body.length === 3 || body.length === 4) {
      hex = body
        .slice(0, 3)
        .split("")
        .map((c) => `${c}${c}`)
        .join("");
    }
    if (hex.length < 6) return false;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return false;
    }
    return isBackgroundRgb(r, g, b);
  }

  const match = value.match(/rgba?\(([^)]+)\)/);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return false;
    const r = parseChannel(parts[0]);
    const g = parseChannel(parts[1]);
    const b = parseChannel(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return false;
    }
    return isBackgroundRgb(r, g, b);
  }

  return false;
}

function stripBackgroundElements(svg: string): string {
  return removeEmptyGroups(
    filterSvgShapes(svg, (fill) =>
      fill === null ? true : !colorIsBackground(fill)
    )
  );
}

export async function traceImageWithPotrace(
  image: ImageData,
  settings: PotraceSettings
): Promise<string> {
  await ensureReady();
  const colors = Math.max(1, Math.round(settings.colors));
  const svg = await potrace(flattenOnWhite(image), {
    turdsize: settings.turdsize ?? 2,
    turnpolicy: 4,
    alphamax: settings.alphamax ?? 1,
    opticurve: 1,
    opttolerance: settings.opttolerance ?? 0.2,
    pathonly: false,
    extractcolors: colors > 2,
    posterizelevel: Math.max(2, Math.min(8, colors)),
    posterizationalgorithm: 0,
  });
  return stripBackgroundElements(svg);
}
