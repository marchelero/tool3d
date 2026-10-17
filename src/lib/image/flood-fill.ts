export interface FloodFillResult {
  mask: Uint8Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const ALPHA_CUTOFF = 16;
const MAX_COLOR_DISTANCE = Math.sqrt(3) * 255;

export function floodFillByColor(
  imgData: ImageData,
  startX: number,
  startY: number,
  tolerance: number
): FloodFillResult | null {
  const { data, width, height } = imgData;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return null;
  }

  const startIndex = startY * width + startX;
  const startOffset = startIndex * 4;
  const refR = data[startOffset];
  const refG = data[startOffset + 1];
  const refB = data[startOffset + 2];
  const refA = data[startOffset + 3];
  const selectingTransparent = refA < ALPHA_CUTOFF;

  const clampedTolerance = Math.max(0, Math.min(100, tolerance));
  const maxDistance = (clampedTolerance / 100) * MAX_COLOR_DISTANCE;

  const mask = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = startIndex;
  mask[startIndex] = 1;

  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    const y = (index - x) / width;

    const candidates = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];

    for (const neighbor of candidates) {
      if (neighbor < 0 || mask[neighbor]) continue;

      const offset = neighbor * 4;
      const alpha = data[offset + 3];
      let matches: boolean;

      if (selectingTransparent) {
        matches = alpha < ALPHA_CUTOFF;
      } else if (alpha < ALPHA_CUTOFF) {
        matches = false;
      } else {
        const dr = data[offset] - refR;
        const dg = data[offset + 1] - refG;
        const db = data[offset + 2] - refB;
        matches =
          Math.sqrt(dr * dr + dg * dg + db * db) <= maxDistance;
      }

      if (matches) {
        mask[neighbor] = 1;
        stack[top++] = neighbor;
        const nx = neighbor % width;
        const ny = (neighbor - nx) / width;
        if (nx < minX) minX = nx;
        if (nx > maxX) maxX = nx;
        if (ny < minY) minY = ny;
        if (ny > maxY) maxY = ny;
      }
    }
  }

  return { mask, minX, minY, maxX, maxY };
}
