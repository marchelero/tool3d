import type { TextureId, TextureSelection, TextureTile } from "./types";

export const TEXTURE_LABELS: Record<TextureSelection, string> = {
  grid: "Cuadrícula",
  brick: "Ladrillo",
  dots: "Puntos",
  honeycomb: "Panal",
  scales: "Escamas",
  waves: "Ondas",
  stripes: "Rayas",
  weave: "Trama",
  knurl: "Diamante",
  noise: "Ruido",
  chevron: "Chevron",
  carbon: "Carbono",
  bubbles: "Burbujas",
  wood: "Madera",
  marble: "Mármol",
  topography: "Topografía",
  circuit: "Circuito",
  triangles: "Triángulos",
  voronoi: "Células",
  ripple: "Ondas radiales",
  crosshatch: "Rayado cruzado",
  stipple: "Punteado",
  truchet: "Azulejos",
  bark: "Corteza",
  custom: "Personalizada",
};

const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(u: number, v: number, period: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const wrap = (value: number) => ((value % period) + period) % period;
  const ix0 = wrap(x0);
  const ix1 = wrap(x0 + 1);
  const iy0 = wrap(y0);
  const iy1 = wrap(y0 + 1);
  const top = lerp(hash2(ix0, iy0), hash2(ix1, iy0), sx);
  const bottom = lerp(hash2(ix0, iy1), hash2(ix1, iy1), sx);
  return lerp(top, bottom, sy);
}

function wrappedDelta(value: number): number {
  return value - Math.round(value);
}

function fractalNoise(u: number, v: number, period: number): number {
  return (
    periodicNoise(u, v, period) * 0.5 +
    periodicNoise(u, v, period * 2) * 0.25 +
    periodicNoise(u, v, period * 4) * 0.125
  ) / 0.875;
}

function gridPattern(u: number, v: number): number {
  const cells = 5;
  const fx = fract(u * cells);
  const fy = fract(v * cells);
  const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
  const groove = 1 - smoothstep(0.05, 0.12, edge);
  return clamp01(0.1 + 0.9 * (1 - groove * 0.85));
}

function brickPattern(u: number, v: number): number {
  const rows = 4;
  const cols = 2;
  const row = Math.floor(v * rows);
  const fx = fract(u * cols + (row % 2) * 0.5);
  const fy = fract(v * rows);
  const dx = Math.min(fx, 1 - fx) / cols;
  const dy = Math.min(fy, 1 - fy) / rows;
  const surface = smoothstep(0.016, 0.055, Math.min(dx, dy));
  return 0.08 + surface * 0.92;
}

function dotsPattern(u: number, v: number): number {
  const cells = 5;
  const fx = fract(u * cells) - 0.5;
  const fy = fract(v * cells) - 0.5;
  const distance = Math.hypot(fx, fy);
  return 0.1 + 0.9 * (1 - smoothstep(0.18, 0.34, distance));
}

function honeycombPattern(u: number, v: number): number {
  const cols = 4;
  const rows = 4;
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  for (let row = 0; row < rows; row += 1) {
    const cy = (row + 0.5) / rows;
    const offset = (row % 2) * 0.5;
    for (let col = 0; col < cols; col += 1) {
      const cx = (col + 0.5 + offset) / cols;
      const du = wrappedDelta(u - cx);
      const dv = wrappedDelta(v - cy);
      const distance = du * du + dv * dv;
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  const edge = Math.sqrt(second) - Math.sqrt(nearest);
  return 0.1 + 0.9 * smoothstep(0, 0.04, edge);
}

function scalesPattern(u: number, v: number): number {
  const cols = 4;
  const rows = 4;
  let height = 0;
  for (let row = 0; row < rows; row += 1) {
    const cy = (row + 0.5) / rows;
    const offset = (row % 2) * 0.5;
    for (let col = 0; col < cols; col += 1) {
      const cx = (col + 0.5 + offset) / cols;
      const du = wrappedDelta(u - cx);
      const dv = wrappedDelta(v - cy);
      const distance = Math.hypot(du, dv);
      const dome = 1 - smoothstep(0.1, 0.245, distance);
      if (dome > height) height = dome;
    }
  }
  return 0.08 + height * 0.92;
}

function wavesPattern(u: number, v: number): number {
  const wave = Math.sin(TAU * (u * 3 + 0.18 * Math.sin(TAU * v * 2)));
  return 0.08 + 0.84 * smoothstep(-0.55, 0.55, wave);
}

function stripesPattern(u: number, v: number): number {
  const stripe = Math.sin(TAU * (u * 7 + v * 2));
  return 0.08 + 0.84 * smoothstep(-0.6, 0.6, stripe);
}

function weavePattern(u: number, v: number): number {
  const cells = 4;
  const cx = Math.floor(u * cells);
  const cy = Math.floor(v * cells);
  const fu = fract(u * cells);
  const fv = fract(v * cells);
  const horizontal = ((cx + cy) % 2 + 2) % 2 === 0;
  const thread = horizontal
    ? 1 - Math.abs(fv - 0.5) * 2
    : 1 - Math.abs(fu - 0.5) * 2;
  const cross = horizontal
    ? 1 - Math.abs(fu - 0.5) * 2
    : 1 - Math.abs(fv - 0.5) * 2;
  const height = Math.pow(clamp01(thread), 0.7) * (0.75 + 0.25 * cross);
  return 0.06 + 0.94 * height;
}

function knurlPattern(u: number, v: number): number {
  const cells = 5;
  const fx = fract(u * cells) - 0.5;
  const fy = fract(v * cells) - 0.5;
  const distance = Math.abs(fx) + Math.abs(fy);
  return 0.08 + 0.92 * (1 - smoothstep(0.08, 0.5, distance));
}

function noisePattern(u: number, v: number): number {
  const first = periodicNoise(u, v, 4) * 0.5;
  const second = periodicNoise(u, v, 8) * 0.25;
  const third = periodicNoise(u, v, 16) * 0.125;
  const value = (first + second + third) / 0.875;
  return 0.08 + 0.84 * smoothstep(0.25, 0.75, value);
}

function chevronPattern(u: number, v: number): number {
  const zig = Math.abs(fract(u * 4) - 0.5) * 2;
  const wave = Math.sin(TAU * (v * 3 + zig * 0.35));
  return 0.08 + 0.84 * smoothstep(-0.55, 0.55, wave);
}

function carbonPattern(u: number, v: number): number {
  const cells = 6;
  const cx = Math.floor(u * cells);
  const cy = Math.floor(v * cells);
  const fu = fract(u * cells);
  const fv = fract(v * cells);
  const twill = ((cx - cy) % 4 + 4) % 4 < 2;
  const thread = twill
    ? 1 - Math.abs(fv - 0.5) * 2
    : 1 - Math.abs(fu - 0.5) * 2;
  const micro = 0.5 + 0.5 * Math.cos(TAU * (twill ? fv : fu) * 3);
  return 0.06 + 0.94 * Math.pow(clamp01(thread), 0.55) * (0.8 + 0.2 * micro);
}

function bubblesPattern(u: number, v: number): number {
  const cells = 5;
  let height = 0;
  for (let row = 0; row < cells; row += 1) {
    const cy = (row + 0.5) / cells;
    const offset = (row % 2) * 0.5;
    for (let col = 0; col < cells; col += 1) {
      const cx = (col + 0.5 + offset) / cells;
      const distance = Math.hypot(
        wrappedDelta(u - cx),
        wrappedDelta(v - cy)
      );
      const dome = 1 - smoothstep(0.08, 0.24, distance);
      const rim = 1 - smoothstep(0, 0.035, Math.abs(distance - 0.215));
      height = Math.max(height, dome * 0.65 + rim * 0.45);
    }
  }
  return 0.08 + 0.92 * Math.min(1, height);
}

function woodPattern(u: number, v: number): number {
  const noise = fractalNoise(u, v, 4);
  const grain = fract(
    v * 10 + 0.55 * noise + 0.06 * Math.sin(TAU * u * 3)
  );
  const line = 1 - smoothstep(0, 0.16, Math.min(grain, 1 - grain));
  const fine = periodicNoise(u, v, 32);
  return clamp01(0.08 + 0.84 * line + 0.08 * fine);
}

function marblePattern(u: number, v: number): number {
  const noise = fractalNoise(u, v, 4);
  const main = 1 -
    smoothstep(
      0,
      0.12,
      Math.abs(Math.sin(TAU * (u * 2 + v + 0.9 * noise)))
    );
  const fine = 1 -
    smoothstep(
      0,
      0.07,
      Math.abs(Math.sin(TAU * (u * 5 - v * 3 + 0.5 * noise)))
    );
  return clamp01(0.1 + 0.55 * main + 0.35 * fine);
}

function topographyPattern(u: number, v: number): number {
  const value = fractalNoise(u, v, 3);
  const contour = fract(value * 8);
  const edge = Math.min(contour, 1 - contour);
  return 0.1 + 0.9 * (1 - smoothstep(0, 0.12, edge));
}

function circuitPattern(u: number, v: number): number {
  const cells = 4;
  const fu = fract(u * cells);
  const fv = fract(v * cells);
  const lineU = 1 - smoothstep(0.035, 0.075, Math.min(fu, 1 - fu));
  const lineV = 1 - smoothstep(0.035, 0.075, Math.min(fv, 1 - fv));
  const pad = 1 - smoothstep(0.12, 0.19, Math.hypot(fu - 0.5, fv - 0.5));
  return 0.08 + 0.92 * Math.max(Math.max(lineU, lineV) * 0.55, pad);
}

function trianglesPattern(u: number, v: number): number {
  const first = Math.abs(fract(u * 5 + v * 5) - 0.5);
  const second = Math.abs(fract(u * 5 - v * 5) - 0.5);
  const third = Math.abs(fract(v * 5) - 0.5);
  const edge = Math.min(first, second, third);
  return 0.08 + 0.92 * (1 - smoothstep(0.015, 0.085, edge));
}

function voronoiPattern(u: number, v: number): number {
  const cells = 4;
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  const baseX = Math.floor(u * cells);
  const baseY = Math.floor(v * cells);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const gx = baseX + dx;
      const gy = baseY + dy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const jitterX = 0.5 + (hash2(wx, wy) - 0.5) * 0.7;
      const jitterY = 0.5 + (hash2(wx + 17, wy + 31) - 0.5) * 0.7;
      const cx = (gx + jitterX) / cells;
      const cy = (gy + jitterY) / cells;
      const distance = (u - cx) ** 2 + (v - cy) ** 2;
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
      } else if (distance < second) {
        second = distance;
      }
    }
  }
  const edge = Math.sqrt(second) - Math.sqrt(nearest);
  return 0.1 + 0.9 * smoothstep(0, 0.06, edge);
}

function ripplePattern(u: number, v: number): number {
  const du = wrappedDelta(u - 0.5);
  const dv = wrappedDelta(v - 0.5);
  const wave = Math.sin(TAU * Math.hypot(du, dv) * 7);
  return 0.08 + 0.84 * smoothstep(-0.55, 0.55, wave);
}

function crosshatchPattern(u: number, v: number): number {
  const first = Math.abs(Math.sin(TAU * (u + v) * 5));
  const second = Math.abs(Math.sin(TAU * (u - v) * 5));
  return 0.08 + 0.92 * (1 - smoothstep(0, 0.16, Math.min(first, second)));
}

function stipplePattern(u: number, v: number): number {
  const dots = smoothstep(0.58, 0.72, periodicNoise(u, v, 28));
  const fine = periodicNoise(u, v, 56);
  return 0.1 + 0.8 * dots + 0.08 * fine;
}

function truchetPattern(u: number, v: number): number {
  const cells = 4;
  const cx = Math.floor(u * cells);
  const cy = Math.floor(v * cells);
  const fu = fract(u * cells);
  const fv = fract(v * cells);
  const wx = ((cx % cells) + cells) % cells;
  const wy = ((cy % cells) + cells) % cells;
  const variant = Math.floor(hash2(wx, wy) * 4);
  const ox = variant % 2;
  const oy = Math.floor(variant / 2);
  const arc =
    1 -
    smoothstep(0.02, 0.09, Math.abs(Math.hypot(fu - ox, fv - oy) - 0.5));
  const edge = 1 - smoothstep(0.02, 0.055, Math.min(fu, 1 - fu, fv, 1 - fv));
  return 0.08 + 0.84 * arc + 0.08 * edge;
}

function barkPattern(u: number, v: number): number {
  const noise = fractalNoise(u, v, 4);
  const ridge = Math.sin(TAU * (u * 11 + 0.9 * noise));
  const groove = 1 - smoothstep(0, 0.22, Math.abs(ridge));
  const fine = periodicNoise(u, v, 48);
  return clamp01(0.08 + 0.84 * groove + 0.08 * fine);
}

function patternHeight(id: TextureId, u: number, v: number): number {
  switch (id) {
    case "grid":
      return gridPattern(u, v);
    case "brick":
      return brickPattern(u, v);
    case "dots":
      return dotsPattern(u, v);
    case "honeycomb":
      return honeycombPattern(u, v);
    case "scales":
      return scalesPattern(u, v);
    case "waves":
      return wavesPattern(u, v);
    case "stripes":
      return stripesPattern(u, v);
    case "weave":
      return weavePattern(u, v);
    case "knurl":
      return knurlPattern(u, v);
    case "noise":
      return noisePattern(u, v);
    case "chevron":
      return chevronPattern(u, v);
    case "carbon":
      return carbonPattern(u, v);
    case "bubbles":
      return bubblesPattern(u, v);
    case "wood":
      return woodPattern(u, v);
    case "marble":
      return marblePattern(u, v);
    case "topography":
      return topographyPattern(u, v);
    case "circuit":
      return circuitPattern(u, v);
    case "triangles":
      return trianglesPattern(u, v);
    case "voronoi":
      return voronoiPattern(u, v);
    case "ripple":
      return ripplePattern(u, v);
    case "crosshatch":
      return crosshatchPattern(u, v);
    case "stipple":
      return stipplePattern(u, v);
    case "truchet":
      return truchetPattern(u, v);
    case "bark":
      return barkPattern(u, v);
    default:
      return 0.5;
  }
}

export function buildTextureTile(id: TextureId, size = 256): TextureTile {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      data[y * size + x] = clamp01(patternHeight(id, u, v));
    }
  }
  return { size, data };
}

function blurPass(
  source: Float32Array,
  target: Float32Array,
  size: number,
  radius: number,
  horizontal: boolean
): void {
  const width = radius * 2 + 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sx = horizontal ? (x + offset + size) % size : x;
        const sy = horizontal ? y : (y + offset + size) % size;
        sum += source[sy * size + sx];
      }
      target[y * size + x] = sum / width;
    }
  }
}

export function prepareTextureTile(
  tile: TextureTile,
  smoothing: number
): Float32Array {
  const amount = clamp01(smoothing);
  if (amount <= 0) return tile.data;
  const radius = Math.max(1, Math.round(amount * 2.5));
  const passes = amount > 0.6 ? 2 : 1;
  const current = new Float32Array(tile.data);
  const temporary = new Float32Array(tile.data.length);
  for (let pass = 0; pass < passes; pass += 1) {
    blurPass(current, temporary, tile.size, radius, true);
    blurPass(temporary, current, tile.size, radius, false);
  }
  return current;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se pudo leer la imagen"));
    image.src = source;
  });
}

export async function customTextureFromFile(
  file: File,
  size = 256
): Promise<TextureTile> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar el mapa");
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    const data = new Float32Array(size * size);
    for (let index = 0; index < data.length; index += 1) {
      const offset = index * 4;
      const alpha = pixels[offset + 3] / 255;
      const luminance =
        (0.2126 * pixels[offset] +
          0.7152 * pixels[offset + 1] +
          0.0722 * pixels[offset + 2]) /
        255;
      data[index] = clamp01(luminance * alpha);
    }
    return { size, data, name: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function textureTileFromImageData(
  image: ImageData,
  name?: string
): TextureTile {
  const size = Math.min(image.width, image.height);
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.data[offset + 3] / 255;
      const luminance =
        (0.2126 * image.data[offset] +
          0.7152 * image.data[offset + 1] +
          0.0722 * image.data[offset + 2]) /
        255;
      data[y * size + x] = clamp01(luminance * alpha);
    }
  }
  return { size, data, name };
}
