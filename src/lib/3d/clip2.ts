import ClipperLib from "clipper-lib";

export type Ring = [number, number][];
type IntPoint = { X: number; Y: number };

const SCALE = 1000;
const ET = ClipperLib.ClipType;
const PT = ClipperLib.PolyType;
const FT = ClipperLib.PolyFillType;

function toInt(rings: Ring[]): IntPoint[][] {
  return rings.map((ring) =>
    ring.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))
  );
}

function toFloat(paths: IntPoint[][]): Ring[] {
  return paths.map((path) =>
    path.map((point) => [point.X / SCALE, point.Y / SCALE] as [number, number])
  );
}

function execute(
  ct: number,
  subject: IntPoint[][],
  clip: IntPoint[][] | null,
  fillSubject: number,
  fillClip: number
): IntPoint[][] {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(subject, PT.ptSubject, true);
  if (clip) clipper.AddPaths(clip, PT.ptClip, true);
  const solution = new ClipperLib.Paths();
  clipper.Execute(ct, solution, fillSubject, fillClip);
  return solution as IntPoint[][];
}

/** Unión de contornos con relleno par-impar: combina islas y huecos anidados. */
export function union(rings: Ring[]): Ring[] {
  if (rings.length === 0) return [];
  return toFloat(execute(ET.ctUnion, toInt(rings), null, FT.pftEvenOdd, FT.pftEvenOdd));
}

/** Unión de regiones sólidas (relleno no-cero): fusiona los solapes en lugar de restarlos. */
export function unionSolid(rings: Ring[]): Ring[] {
  if (rings.length === 0) return [];
  return toFloat(execute(ET.ctUnion, toInt(rings), null, FT.pftNonZero, FT.pftNonZero));
}

export function difference(subject: Ring[], clip: Ring[]): Ring[] {
  if (subject.length === 0) return [];
  if (clip.length === 0) return subject;
  return toFloat(
    execute(ET.ctDifference, toInt(subject), toInt(clip), FT.pftNonZero, FT.pftEvenOdd)
  );
}

export function intersection(subject: Ring[], clip: Ring[]): Ring[] {
  if (subject.length === 0 || clip.length === 0) return [];
  return toFloat(
    execute(ET.ctIntersection, toInt(subject), toInt(clip), FT.pftNonZero, FT.pftNonZero)
  );
}

export function area(rings: Ring[]): number {
  return (
    toInt(rings).reduce((sum, path) => sum + ClipperLib.Clipper.Area(path), 0) /
    (SCALE * SCALE)
  );
}

export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** Expande (delta>0) o encoge (delta<0) los contornos en milímetros. */
export function offset(
  rings: Ring[],
  deltaMm: number,
  join: "miter" | "round" = "round"
): Ring[] {
  if (rings.length === 0) return [];
  const arcTolerance = Math.max(0.0005, Math.abs(deltaMm) * 0.02) * SCALE;
  const co = new ClipperLib.ClipperOffset(2, arcTolerance);
  co.AddPaths(
    toInt(rings),
    join === "round" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon
  );
  const solution = new ClipperLib.Paths();
  co.Execute(solution, deltaMm * SCALE);
  return toFloat(solution as IntPoint[][]);
}
