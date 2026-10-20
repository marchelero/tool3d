type Point = [number, number];

interface SubPath {
  points: Point[];
  closed: boolean;
}

export interface StraightenOptions {
  simplifyTolerance?: number;
  snapDegrees?: number;
  roundcoords?: 0 | 1 | 2;
}

const CURVE_STEPS = 8;
const ARG_COUNT: Record<string, number> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

function tokenize(d: string): { cmd: string; args: number[] }[] {
  const raw: string[] = [];
  const re = /([a-df-zA-DF-Z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    raw.push(match[1] ?? match[2]);
  }

  const out: { cmd: string; args: number[] }[] = [];
  let index = 0;
  while (index < raw.length) {
    const token = raw[index];
    if (!/[a-zA-Z]/.test(token)) {
      index += 1;
      continue;
    }
    const cmd = token;
    index += 1;
    const args: number[] = [];
    while (index < raw.length && !/[a-zA-Z]/.test(raw[index])) {
      const value = Number.parseFloat(raw[index]);
      if (Number.isFinite(value)) args.push(value);
      index += 1;
    }
    out.push({ cmd, args });
  }
  return out;
}

function addQuad(points: Point[], x0: number, y0: number, qx: number, qy: number, x1: number, y1: number) {
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS;
    const mt = 1 - t;
    points.push([
      mt * mt * x0 + 2 * mt * t * qx + t * t * x1,
      mt * mt * y0 + 2 * mt * t * qy + t * t * y1,
    ]);
  }
}

function addCubic(
  points: Point[],
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number
) {
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS;
    const mt = 1 - t;
    points.push([
      mt * mt * mt * x0 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x1,
      mt * mt * mt * y0 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y1,
    ]);
  }
}

function toSubPaths(d: string): SubPath[] {
  const subPaths: SubPath[] = [];
  let points: Point[] = [];
  let closed = false;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let prevCmd = "";

  const flush = () => {
    if (points.length >= 2) subPaths.push({ points, closed });
    points = [];
    closed = false;
  };

  for (const { cmd, args } of tokenize(d)) {
    const upper = cmd.toUpperCase();
    const relative = cmd !== upper;
    const count = ARG_COUNT[upper.toLowerCase()];
    if (count === undefined) continue;

    if (upper === "Z") {
      if (points.length > 0) {
        closed = true;
        flush();
      }
      x = startX;
      y = startY;
      prevCmd = upper;
      continue;
    }

    let offset = 0;
    let first = true;
    while (offset + count <= args.length) {
      const a = args.slice(offset, offset + count);
      offset += count;

      if (upper === "M") {
        const nx = relative ? x + a[0] : a[0];
        const ny = relative ? y + a[1] : a[1];
        if (first) {
          flush();
          x = nx;
          y = ny;
          startX = x;
          startY = y;
          points = [[x, y]];
        } else {
          points.push([nx, ny]);
          x = nx;
          y = ny;
        }
      } else if (upper === "L") {
        const nx = relative ? x + a[0] : a[0];
        const ny = relative ? y + a[1] : a[1];
        points.push([nx, ny]);
        x = nx;
        y = ny;
      } else if (upper === "H") {
        x = relative ? x + a[0] : a[0];
        points.push([x, y]);
      } else if (upper === "V") {
        y = relative ? y + a[0] : a[0];
        points.push([x, y]);
      } else if (upper === "Q") {
        const qx = relative ? x + a[0] : a[0];
        const qy = relative ? y + a[1] : a[1];
        const nx = relative ? x + a[2] : a[2];
        const ny = relative ? y + a[3] : a[3];
        addQuad(points, x, y, qx, qy, nx, ny);
        lastCtrlX = qx;
        lastCtrlY = qy;
        x = nx;
        y = ny;
      } else if (upper === "T") {
        const qx = prevCmd === "Q" || prevCmd === "T" ? 2 * x - lastCtrlX : x;
        const qy = prevCmd === "Q" || prevCmd === "T" ? 2 * y - lastCtrlY : y;
        const nx = relative ? x + a[0] : a[0];
        const ny = relative ? y + a[1] : a[1];
        addQuad(points, x, y, qx, qy, nx, ny);
        lastCtrlX = qx;
        lastCtrlY = qy;
        x = nx;
        y = ny;
      } else if (upper === "C") {
        const c1x = relative ? x + a[0] : a[0];
        const c1y = relative ? y + a[1] : a[1];
        const c2x = relative ? x + a[2] : a[2];
        const c2y = relative ? y + a[3] : a[3];
        const nx = relative ? x + a[4] : a[4];
        const ny = relative ? y + a[5] : a[5];
        addCubic(points, x, y, c1x, c1y, c2x, c2y, nx, ny);
        lastCtrlX = c2x;
        lastCtrlY = c2y;
        x = nx;
        y = ny;
      } else if (upper === "S") {
        const c2x = relative ? x + a[0] : a[0];
        const c2y = relative ? y + a[1] : a[1];
        const nx = relative ? x + a[2] : a[2];
        const ny = relative ? y + a[3] : a[3];
        const c1x = prevCmd === "C" || prevCmd === "S" ? 2 * x - lastCtrlX : x;
        const c1y = prevCmd === "C" || prevCmd === "S" ? 2 * y - lastCtrlY : y;
        addCubic(points, x, y, c1x, c1y, c2x, c2y, nx, ny);
        lastCtrlX = c2x;
        lastCtrlY = c2y;
        x = nx;
        y = ny;
      } else if (upper === "A") {
        const nx = relative ? x + a[5] : a[5];
        const ny = relative ? y + a[6] : a[6];
        points.push([nx, ny]);
        x = nx;
        y = ny;
      }

      prevCmd = upper;
      first = false;
    }
  }

  flush();
  return subPaths;
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }
  let t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points;

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i += 1) {
      const distance = pointSegmentDistance(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

function snapToAxes(points: Point[], snapDegrees: number, closed: boolean): Point[] {
  if (snapDegrees <= 0 || points.length < 2) return points;
  const limit = Math.tan((snapDegrees * Math.PI) / 180);
  const out = points.map((p) => [p[0], p[1]] as Point);

  const segments = closed ? out.length : out.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    const dx = Math.abs(b[0] - a[0]);
    const dy = Math.abs(b[1] - a[1]);
    if (dx === 0 && dy === 0) continue;
    if (dy <= dx * limit) {
      b[1] = a[1];
    } else if (dx <= dy * limit) {
      b[0] = a[0];
    }
  }

  return out;
}

function formatValue(value: number, roundcoords: 0 | 1 | 2): string {
  const factor = 10 ** roundcoords;
  return String(Math.round(value * factor) / factor);
}

function toPathData(subPaths: SubPath[], roundcoords: 0 | 1 | 2): string {
  const parts: string[] = [];
  for (const subPath of subPaths) {
    const points = subPath.points;
    if (points.length < 2) continue;
    const [firstX, firstY] = points[0];
    let segment = `M${formatValue(firstX, roundcoords)} ${formatValue(firstY, roundcoords)}`;
    for (let i = 1; i < points.length; i += 1) {
      segment += `L${formatValue(points[i][0], roundcoords)} ${formatValue(points[i][1], roundcoords)}`;
    }
    if (subPath.closed) segment += "Z";
    parts.push(segment);
  }
  return parts.join("");
}

function straightenPathData(d: string, options: StraightenOptions): string | null {
  const tolerance = options.simplifyTolerance ?? 1;
  const snapDegrees = options.snapDegrees ?? 5;
  const roundcoords = options.roundcoords ?? 1;

  const subPaths = toSubPaths(d);
  if (subPaths.length === 0) return null;

  const processed = subPaths.map((subPath) => {
    const simplified = simplify(subPath.points, tolerance);
    return {
      points: snapToAxes(simplified, snapDegrees, subPath.closed),
      closed: subPath.closed,
    };
  });

  const pathData = toPathData(processed, roundcoords);
  return pathData.length > 0 ? pathData : null;
}

const PATH_REGEX = /<path\b[^>]*\/?>(?:<\/path>)?/g;
const D_ATTRIBUTE_REGEX = /\sd="([^"]*)"/;

export function straightenSvgPaths(svg: string, options: StraightenOptions = {}): string {
  return svg.replace(PATH_REGEX, (path) => {
    const match = path.match(D_ATTRIBUTE_REGEX);
    if (!match) return path;
    const straightened = straightenPathData(match[1], options);
    if (!straightened) return path;
    return path.replace(D_ATTRIBUTE_REGEX, ` d="${straightened}"`);
  });
}
