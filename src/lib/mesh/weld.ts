import { computeBounds } from "./bounds";
import type { MeshData } from "./types";

export function weldTriangleSoup(positions: Float32Array): MeshData {
  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw new Error("La malla no contiene triángulos válidos");
  }
  const bounds = computeBounds(positions);
  const maxDimension = Math.max(bounds.size[0], bounds.size[1], bounds.size[2]);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error("La malla no tiene dimensiones válidas");
  }
  const tolerance = Math.max(1e-6, maxDimension * 1e-6);
  const lookup = new Map<string, number>();
  const vertices: number[] = [];
  const faces: number[] = [];

  const addVertex = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x / tolerance)},${Math.round(
      y / tolerance
    )},${Math.round(z / tolerance)}`;
    const existing = lookup.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length / 3;
    vertices.push(x, y, z);
    lookup.set(key, index);
    return index;
  };

  for (let index = 0; index < positions.length; index += 9) {
    const ax = positions[index];
    const ay = positions[index + 1];
    const az = positions[index + 2];
    const bx = positions[index + 3];
    const by = positions[index + 4];
    const bz = positions[index + 5];
    const cx = positions[index + 6];
    const cy = positions[index + 7];
    const cz = positions[index + 8];
    if (
      !Number.isFinite(ax) ||
      !Number.isFinite(ay) ||
      !Number.isFinite(az) ||
      !Number.isFinite(bx) ||
      !Number.isFinite(by) ||
      !Number.isFinite(bz) ||
      !Number.isFinite(cx) ||
      !Number.isFinite(cy) ||
      !Number.isFinite(cz)
    ) {
      throw new Error("La malla contiene coordenadas inválidas");
    }
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area = Math.hypot(nx, ny, nz);
    if (area <= maxDimension * maxDimension * 1e-12) continue;
    const a = addVertex(ax, ay, az);
    const b = addVertex(bx, by, bz);
    const c = addVertex(cx, cy, cz);
    if (a === b || b === c || c === a) continue;
    faces.push(a, b, c);
  }

  if (faces.length < 3) {
    throw new Error("La malla no contiene triángulos válidos");
  }

  return {
    vertices: new Float32Array(vertices),
    faces: new Uint32Array(faces),
  };
}
