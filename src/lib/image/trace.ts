import ImageTracer, { type TraceOptions } from "imagetracerjs";

export type TraceMode =
  | "color"
  | "mono"
  | "mono-invert"
  | "negative"
  | "grayscale";

export interface TraceSettings {
  mode: TraceMode;
  numberofcolors: number;
  pathomit: number;
  fidelity: number;
  roundcoords: 0 | 1 | 2;
  blurradius: number;
  blurdelta: number;
  rightangleenhance: boolean;
  strokewidth: number;
  alphaThreshold: number;
}

export const DEFAULT_TRACE_SETTINGS: TraceSettings = {
  mode: "color",
  numberofcolors: 8,
  pathomit: 8,
  fidelity: 0.5,
  roundcoords: 2,
  blurradius: 0,
  blurdelta: 64,
  rightangleenhance: false,
  strokewidth: 1,
  alphaThreshold: 128,
};

export type TracePreset = "logo" | "detailed" | "illustration" | "silhouette";

export const TRACE_PRESET_LABELS: Record<TracePreset, string> = {
  logo: "Logo",
  detailed: "Detallado",
  illustration: "Ilustración",
  silhouette: "Silueta",
};

export const TRACE_PRESETS: Record<TracePreset, Partial<TraceSettings>> = {
  logo: {
    fidelity: 0.3,
    pathomit: 0,
    roundcoords: 2,
    rightangleenhance: false,
    blurradius: 0,
    blurdelta: 64,
    strokewidth: 1,
  },
  detailed: {
    fidelity: 0.15,
    pathomit: 0,
    roundcoords: 2,
    rightangleenhance: false,
    blurradius: 0,
    blurdelta: 64,
    strokewidth: 0,
  },
  illustration: {
    fidelity: 0.7,
    pathomit: 4,
    roundcoords: 1,
    rightangleenhance: false,
    blurradius: 3,
    blurdelta: 96,
    strokewidth: 1,
  },
  silhouette: {
    fidelity: 1.5,
    pathomit: 10,
    roundcoords: 0,
    rightangleenhance: true,
    blurradius: 4,
    blurdelta: 160,
    strokewidth: 0,
  },
};

const BACKGROUND_SENTINEL = { r: 255, g: 0, b: 255 };
const CONTENT_PADDING = 2;
const MERGE_DISTANCE = 40;

interface PaletteColor {
  r: number;
  g: number;
  b: number;
}

function buildOptions(
  settings: TraceSettings,
  prepared: ImageData
): TraceOptions {
  const alphaThreshold = Math.max(0, Math.min(255, settings.alphaThreshold));
  const fidelity = Math.max(0.05, Math.min(5, settings.fidelity));
  const base: TraceOptions = {
    pathomit: settings.pathomit,
    ltres: fidelity,
    qtres: fidelity,
    blurradius: settings.blurradius,
    blurdelta: settings.blurdelta,
    colorquantcycles: 1,
    mincolorratio: 0,
    rightangleenhance: settings.rightangleenhance,
    roundcoords: settings.roundcoords,
    strokewidth: settings.strokewidth,
    viewbox: false,
    desc: false,
    linefilter: true,
  };

  if (settings.mode === "mono" || settings.mode === "mono-invert") {
    return {
      ...base,
      colorsampling: 0,
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { ...BACKGROUND_SENTINEL, a: 255 },
      ],
    };
  }

  const colors = buildColorPalette(
    prepared,
    alphaThreshold,
    settings.numberofcolors
  );

  return {
    ...base,
    colorsampling: 0,
    pal: [
      { ...BACKGROUND_SENTINEL, a: 255 },
      ...colors.map((color) => ({ ...color, a: 255 })),
    ],
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
  const bounds =
    settings.mode === "mono-invert"
      ? { x: 0, y: 0, width: imgData.width, height: imgData.height }
      : computeAlphaBounds(imgData, threshold);

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
      const isBackground = alpha < threshold;

      if (settings.mode === "mono-invert") {
        if (isBackground) {
          out.data[dstIndex] = 0;
          out.data[dstIndex + 1] = 0;
          out.data[dstIndex + 2] = 0;
        } else {
          out.data[dstIndex] = BACKGROUND_SENTINEL.r;
          out.data[dstIndex + 1] = BACKGROUND_SENTINEL.g;
          out.data[dstIndex + 2] = BACKGROUND_SENTINEL.b;
        }
      } else if (isBackground) {
        out.data[dstIndex] = BACKGROUND_SENTINEL.r;
        out.data[dstIndex + 1] = BACKGROUND_SENTINEL.g;
        out.data[dstIndex + 2] = BACKGROUND_SENTINEL.b;
      } else if (settings.mode === "mono") {
        out.data[dstIndex] = 0;
        out.data[dstIndex + 1] = 0;
        out.data[dstIndex + 2] = 0;
      } else if (settings.mode === "negative") {
        out.data[dstIndex] = 255 - imgData.data[srcIndex];
        out.data[dstIndex + 1] = 255 - imgData.data[srcIndex + 1];
        out.data[dstIndex + 2] = 255 - imgData.data[srcIndex + 2];
      } else if (settings.mode === "grayscale") {
        const luma = Math.round(
          imgData.data[srcIndex] * 0.299 +
            imgData.data[srcIndex + 1] * 0.587 +
            imgData.data[srcIndex + 2] * 0.114
        );
        out.data[dstIndex] = luma;
        out.data[dstIndex + 1] = luma;
        out.data[dstIndex + 2] = luma;
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

interface ColorBin extends PaletteColor {
  count: number;
}

function collectColorBins(
  imgData: ImageData,
  alphaThreshold: number
): { bins: ColorBin[]; total: number } {
  const { data } = imgData;
  const counts = new Int32Array(4096);
  const sumR = new Float64Array(4096);
  const sumG = new Float64Array(4096);
  const sumB = new Float64Array(4096);
  let total = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaThreshold) continue;
    total += 1;
    const key =
      ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts[key] += 1;
    sumR[key] += data[i];
    sumG[key] += data[i + 1];
    sumB[key] += data[i + 2];
  }

  const bins: ColorBin[] = [];
  for (let key = 0; key < counts.length; key += 1) {
    const count = counts[key];
    if (count === 0) continue;
    bins.push({
      count,
      r: Math.round(sumR[key] / count),
      g: Math.round(sumG[key] / count),
      b: Math.round(sumB[key] / count),
    });
  }
  bins.sort((a, b) => b.count - a.count);

  return { bins, total };
}

function isSentinel({ r, g, b }: PaletteColor): boolean {
  return (
    r === BACKGROUND_SENTINEL.r &&
    g === BACKGROUND_SENTINEL.g &&
    b === BACKGROUND_SENTINEL.b
  );
}

interface ColorCluster extends ColorBin {
  sumR: number;
  sumG: number;
  sumB: number;
}

function clusterColorBins(bins: ColorBin[], maxDistance: number): ColorBin[] {
  const limit = maxDistance * maxDistance;
  const clusters: ColorCluster[] = [];

  for (const bin of bins) {
    let target: ColorCluster | undefined;
    for (const cluster of clusters) {
      const dr = cluster.r - bin.r;
      const dg = cluster.g - bin.g;
      const db = cluster.b - bin.b;
      if (dr * dr + dg * dg + db * db <= limit) {
        target = cluster;
        break;
      }
    }

    if (!target) {
      clusters.push({
        count: bin.count,
        r: bin.r,
        g: bin.g,
        b: bin.b,
        sumR: bin.r * bin.count,
        sumG: bin.g * bin.count,
        sumB: bin.b * bin.count,
      });
      continue;
    }

    target.count += bin.count;
    target.sumR += bin.r * bin.count;
    target.sumG += bin.g * bin.count;
    target.sumB += bin.b * bin.count;
    target.r = Math.round(target.sumR / target.count);
    target.g = Math.round(target.sumG / target.count);
    target.b = Math.round(target.sumB / target.count);
  }

  return clusters
    .sort((a, b) => b.count - a.count)
    .map(({ r, g, b, count }) => ({ r, g, b, count }));
}

export function estimateColorCount(
  imgData: ImageData,
  alphaThreshold: number
): number {
  const { bins, total } = collectColorBins(imgData, alphaThreshold);
  if (total === 0) return 0;
  const minPixels = Math.max(1, Math.floor(total * 0.005));
  return bins.reduce((count, bin) => (bin.count >= minPixels ? count + 1 : count), 0);
}

export function buildColorPalette(
  imgData: ImageData,
  alphaThreshold: number,
  count: number
): PaletteColor[] {
  const capped = Math.max(1, Math.min(64, count));
  const { bins } = collectColorBins(imgData, alphaThreshold);
  const merged = clusterColorBins(bins, MERGE_DISTANCE);
  const colors: PaletteColor[] = [];

  for (const bin of merged) {
    if (isSentinel(bin)) continue;
    colors.push({ r: bin.r, g: bin.g, b: bin.b });
    if (colors.length >= capped) break;
  }

  return colors;
}

export function tracePreparedImage(
  prepared: ImageData,
  settings: TraceSettings
): string {
  const svg = ImageTracer.imagedataToSVG(prepared, buildOptions(settings, prepared));
  return stripBackgroundPaths(svg);
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
