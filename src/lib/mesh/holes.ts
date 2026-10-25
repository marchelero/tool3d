import { boundaryLoops } from "./topology";
import type { MeshData, Vec3 } from "./types";

export interface HoleFillResult {
  mesh: MeshData;
  loops: number;
  filled: number;
  skipped: number;
  addedTriangles: number;
  warnings: string[];
}

interface Point2 {
  x: number;
  y: number;
}

function newellNormal(points: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return [nx, ny, nz];
}

function normalized(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-12) return [0, 0, 1];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function project(
  points: Vec3[],
  normal: Vec3
): { points2: Point2[]; basisU: Vec3; basisV: Vec3 } {
  const reference: Vec3 =
    Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const basisU = normalized(cross(normal, reference));
  const basisV = cross(normal, basisU);
  const origin = points[0];
  const points2 = points.map((point) => {
    const dx = point[0] - origin[0];
    const dy = point[1] - origin[1];
    const dz = point[2] - origin[2];
    return {
      x: dx * basisU[0] + dy * basisU[1] + dz * basisU[2],
      y: dx * basisV[0] + dy * basisV[1] + dz * basisV[2],
    };
  });
  return { points2, basisU, basisV };
}

function signedArea2(points: Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function pointInTriangle(
  point: Point2,
  a: Point2,
  b: Point2,
  c: Point2
): boolean {
  const ab = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  const bc = (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x);
  const ca = (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x);
  const hasNegative = ab < 0 || bc < 0 || ca < 0;
  const hasPositive = ab > 0 || bc > 0 || ca > 0;
  return !(hasNegative && hasPositive);
}

function earClip(points: Point2[]): number[][] {
  const indices = points.map((_, index) => index);
  if (signedArea2(points) < 0) indices.reverse();
  const triangles: number[][] = [];
  let guard = 0;
  while (indices.length > 3 && guard < points.length * points.length) {
    guard += 1;
    let clipped = false;
    for (let cursor = 0; cursor < indices.length; cursor += 1) {
      const previous = indices[(cursor - 1 + indices.length) % indices.length];
      const current = indices[cursor];
      const next = indices[(cursor + 1) % indices.length];
      const a = points[previous];
      const b = points[current];
      const c = points[next];
      const crossValue =
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (crossValue <= 1e-12) continue;
      let contains = false;
      for (const candidate of indices) {
        if (
          candidate === previous ||
          candidate === current ||
          candidate === next
        ) {
          continue;
        }
        if (pointInTriangle(points[candidate], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push([previous, current, next]);
      indices.splice(cursor, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push(indices.slice());
  return triangles;
}

export function fillHoles(
  mesh: MeshData,
  maxHoleEdges: number
): HoleFillResult {
  const loops = boundaryLoops(mesh);
  const warnings: string[] = [];
  const vertices = Array.from(mesh.vertices);
  const faces = Array.from(mesh.faces);
  let filled = 0;
  let skipped = 0;
  let addedTriangles = 0;

  for (const loop of loops) {
    if (loop.length < 3) {
      skipped += 1;
      continue;
    }
    if (loop.length > maxHoleEdges) {
      skipped += 1;
      warnings.push(
        `Se omitió un hueco de ${loop.length} aristas (límite ${maxHoleEdges}).`
      );
      continue;
    }
    const points = loop.map((index) => {
      return [
        vertices[index * 3],
        vertices[index * 3 + 1],
        vertices[index * 3 + 2],
      ] as Vec3;
    });
    const normalRaw = newellNormal(points);
    const normalLength = Math.hypot(normalRaw[0], normalRaw[1], normalRaw[2]);
    if (normalLength <= 1e-12) {
      skipped += 1;
      continue;
    }
    const normal = normalized(normalRaw);
    const { points2 } = project(points, normal);
    let maxDistance = 0;
    const origin = points[0];
    for (const point of points) {
      const dx = point[0] - origin[0];
      const dy = point[1] - origin[1];
      const dz = point[2] - origin[2];
      maxDistance = Math.max(
        maxDistance,
        Math.abs(dx * normal[0] + dy * normal[1] + dz * normal[2])
      );
    }
    const diagonal = Math.hypot(
      Math.max(...points.map((point) => point[0])) -
        Math.min(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])) -
        Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[2])) -
        Math.min(...points.map((point) => point[2]))
    );
    const planar = maxDistance <= Math.max(1e-3, diagonal * 1e-3);

    if (planar) {
      const triangles = earClip(points2);
      if (triangles.length === 0) {
        skipped += 1;
        continue;
      }
      for (const triangle of triangles) {
        faces.push(
          loop[triangle[0]],
          loop[triangle[1]],
          loop[triangle[2]]
        );
        addedTriangles += 1;
      }
      filled += 1;
      continue;
    }

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const point of points) {
      cx += point[0];
      cy += point[1];
      cz += point[2];
    }
    const centroidIndex = vertices.length / 3;
    vertices.push(cx / points.length, cy / points.length, cz / points.length);
    for (let index = 0; index < loop.length; index += 1) {
      faces.push(
        centroidIndex,
        loop[index],
        loop[(index + 1) % loop.length]
      );
      addedTriangles += 1;
    }
    filled += 1;
    warnings.push(
      `Hueco no planar cerrado con abanico (${loop.length} aristas); revisá la zona.`
    );
  }

  return {
    mesh: {
      vertices: new Float32Array(vertices),
      faces: new Uint32Array(faces),
    },
    loops: loops.length,
    filled,
    skipped,
    addedTriangles,
    warnings,
  };
}
