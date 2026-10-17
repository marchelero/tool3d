import ImageTracer, { type TraceOptions } from "imagetracerjs";

export interface TraceSettings {
  mode: "mono" | "color";
  numberofcolors: number;
  pathomit: number;
  ltres: number;
  qtres: number;
  blurradius: number;
}

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  mode: "color",
  numberofcolors: 8,
  pathomit: 8,
  ltres: 1,
  qtres: 1,
  blurradius: 0,
};

function buildOptions(settings: TraceSettings): TraceOptions {
  return {
    numberofcolors: settings.mode === "mono" ? 2 : settings.numberofcolors,
    colorsampling: 2,
    pathomit: settings.pathomit,
    ltres: settings.ltres,
    qtres: settings.qtres,
    blurradius: settings.blurradius,
    rightangleenhance: true,
    roundcoords: 1,
    viewbox: false,
    desc: false,
    linefilter: true,
  };
}

export function traceImageDataToSvg(
  imgData: ImageData,
  settings: TraceSettings
): string {
  return ImageTracer.imagedataToSVG(imgData, buildOptions(settings));
}

export interface ColorLayer {
  color: string;
  rgb: { r: number; g: number; b: number };
  svg: string;
  pathCount: number;
}

const PATH_REGEX = /<path\b[^>]*\/?>(?:<\/path>)?/g;
const FILL_REGEX = /fill="(rgb\([^)]+\)|#[0-9a-fA-F]{3,8})"/;

function stripStroke(path: string): string {
  return path
    .replace(/\sstroke="[^"]*"/g, "")
    .replace(/\sstroke-width="[^"]*"/g, "");
}

function parseRgb(color: string): { r: number; g: number; b: number } {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (match) {
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
    };
  }
  const hex = color.replace("#", "");
  if (hex.length >= 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 0, g: 0, b: 0 };
}

export function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const toHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function splitSvgByColor(svg: string, width: number, height: number): ColorLayer[] {
  const paths = svg.match(PATH_REGEX) ?? [];
  const groups = new Map<string, string[]>();

  for (const path of paths) {
    const match = path.match(FILL_REGEX);
    const color = match ? match[1] : "rgb(0,0,0)";
    const clean = stripStroke(path);
    const list = groups.get(color) ?? [];
    list.push(clean);
    groups.set(color, list);
  }

  const layers: ColorLayer[] = [];
  for (const [color, list] of groups.entries()) {
    const pathsMarkup = list.join("");
    layers.push({
      color,
      rgb: parseRgb(color),
      pathCount: list.length,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${pathsMarkup}</svg>`,
    });
  }

  return layers.sort((a, b) => b.pathCount - a.pathCount);
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
