import ImageTracer, { type TraceOptions } from "imagetracerjs";

export interface TraceSettings {
  mode: "mono" | "color";
  numberofcolors: number;
  pathomit: number;
  ltres: number;
  qtres: number;
  blurradius: number;
  alphaThreshold: number;
}

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  mode: "color",
  numberofcolors: 8,
  pathomit: 8,
  ltres: 1,
  qtres: 1,
  blurradius: 0,
  alphaThreshold: 128,
};

const BACKGROUND_SENTINEL = { r: 255, g: 0, b: 255 };
const CONTENT_PADDING = 2;

function buildOptions(settings: TraceSettings): TraceOptions {
  const base: TraceOptions = {
    pathomit: settings.pathomit,
    ltres: settings.ltres,
    qtres: settings.qtres,
    blurradius: settings.blurradius,
    rightangleenhance: true,
    roundcoords: 1,
    viewbox: false,
    desc: false,
    linefilter: true,
    strokewidth: 0,
  };

  if (settings.mode === "mono") {
    return {
      ...base,
      colorsampling: 0,
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { ...BACKGROUND_SENTINEL, a: 255 },
      ],
    };
  }

  return {
    ...base,
    colorsampling: 2,
    numberofcolors: Math.min(64, settings.numberofcolors + 1),
  };
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeAlphaBounds(
  imgData: ImageData,
  threshold: number
): Bounds | null {
  const { data, width, height } = imgData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function prepareTraceImageData(
  imgData: ImageData,
  settings: TraceSettings
): ImageData {
  const threshold = Math.max(0, Math.min(255, settings.alphaThreshold));
  const bounds = computeAlphaBounds(imgData, threshold);

  if (!bounds) {
    const empty = new ImageData(1, 1);
    empty.data[0] = BACKGROUND_SENTINEL.r;
    empty.data[1] = BACKGROUND_SENTINEL.g;
    empty.data[2] = BACKGROUND_SENTINEL.b;
    empty.data[3] = 255;
    return empty;
  }

  const x0 = Math.max(0, bounds.x - CONTENT_PADDING);
  const y0 = Math.max(0, bounds.y - CONTENT_PADDING);
  const x1 = Math.min(
    imgData.width,
    bounds.x + bounds.width + CONTENT_PADDING
  );
  const y1 = Math.min(
    imgData.height,
    bounds.y + bounds.height + CONTENT_PADDING
  );
  const width = x1 - x0;
  const height = y1 - y0;

  const out = new ImageData(width, height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const srcIndex = ((y0 + row) * imgData.width + (x0 + col)) * 4;
      const dstIndex = (row * width + col) * 4;
      const alpha = imgData.data[srcIndex + 3];

      if (alpha < threshold) {
        out.data[dstIndex] = BACKGROUND_SENTINEL.r;
        out.data[dstIndex + 1] = BACKGROUND_SENTINEL.g;
        out.data[dstIndex + 2] = BACKGROUND_SENTINEL.b;
      } else if (settings.mode === "mono") {
        out.data[dstIndex] = 0;
        out.data[dstIndex + 1] = 0;
        out.data[dstIndex + 2] = 0;
      } else {
        out.data[dstIndex] = imgData.data[srcIndex];
        out.data[dstIndex + 1] = imgData.data[srcIndex + 1];
        out.data[dstIndex + 2] = imgData.data[srcIndex + 2];
      }
      out.data[dstIndex + 3] = 255;
    }
  }

  return out;
}

export function estimateColorCount(
  imgData: ImageData,
  alphaThreshold: number
): number {
  const { data } = imgData;
  const bins = new Int32Array(4096);
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaThreshold) continue;
    total += 1;
    const key =
      ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    bins[key] += 1;
  }

  if (total === 0) return 0;

  const minPixels = Math.max(1, Math.floor(total * 0.005));
  let count = 0;
  for (let i = 0; i < bins.length; i += 1) {
    if (bins[i] >= minPixels) count += 1;
  }
  return count;
}

export function tracePreparedImage(
  prepared: ImageData,
  settings: TraceSettings
): string {
  const svg = ImageTracer.imagedataToSVG(prepared, buildOptions(settings));
  return stripBackgroundPaths(svg);
}

export function traceImageDataToSvg(
  imgData: ImageData,
  settings: TraceSettings
): string {
  return tracePreparedImage(prepareTraceImageData(imgData, settings), settings);
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

function isBackgroundColor(color: string): boolean {
  const { r, g, b } = parseRgb(color);
  return r > 180 && g < 90 && b > 180;
}

export function stripBackgroundPaths(svg: string): string {
  return svg.replace(PATH_REGEX, (path) => {
    const match = path.match(FILL_REGEX);
    if (match && isBackgroundColor(match[1])) {
      return "";
    }
    return path;
  });
}

export function filterSvgByColors(
  svg: string,
  excluded: ReadonlySet<string>
): string {
  if (excluded.size === 0) return svg;
  return svg.replace(PATH_REGEX, (path) => {
    const match = path.match(FILL_REGEX);
    if (!match) return path;
    return excluded.has(rgbToHex(parseRgb(match[1]))) ? "" : path;
  });
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
    if (isBackgroundColor(color)) {
      continue;
    }
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
