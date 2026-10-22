import type {
  ProcessOptions,
  ProcessResult,
  ProjectionMode,
} from "./types";
import {
  computeBounds,
  computeMaskWeights,
  computeVertexNormals,
  analyzeMesh,
  repairMesh,
  smoothVertices,
  subdivideMesh,
  weldTriangleSoup,
} from "./subdivide";
import { prepareTextureTile } from "./textures";

const TEXTURE_BASE_MM = 10;

function sampleTile(
  data: Float32Array,
  size: number,
  u: number,
  v: number
): number {
  const wrappedU = ((u % 1) + 1) % 1;
  const wrappedV = ((v % 1) + 1) % 1;
  const x = wrappedU * size;
  const y = wrappedV * size;
  const x0 = Math.floor(x) % size;
  const y0 = Math.floor(y) % size;
  const x1 = (x0 + 1) % size;
  const y1 = (y0 + 1) % size;
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  const a = data[y0 * size + x0];
  const b = data[y0 * size + x1];
  const c = data[y1 * size + x0];
  const d = data[y1 * size + x1];
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

function projectionUv(
  mode: Exclude<ProjectionMode, "triplanar">,
  x: number,
  y: number,
  z: number
): [number, number] {
  if (mode === "xy") return [x, y];
  if (mode === "xz") return [x, z];
  return [y, z];
}

function sampleProjected(
  tileData: Float32Array,
  size: number,
  baseMm: number,
  uMm: number,
  vMm: number,
  scaleU: number,
  scaleV: number,
  cos: number,
  sin: number,
  offsetU: number,
  offsetV: number
): number {
  const u = (uMm * scaleU) / baseMm;
  const v = (vMm * scaleV) / baseMm;
  const rotatedU = u * cos - v * sin + offsetU;
  const rotatedV = u * sin + v * cos + offsetV;
  return sampleTile(tileData, size, rotatedU, rotatedV);
}

function sampleHeight(
  options: ProcessOptions,
  tileData: Float32Array,
  baseMm: number,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number
): number {
  const scaleU = options.scaleU;
  const scaleV = options.scaleV;
  const radians = (options.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const offsetU = options.offsetU;
  const offsetV = options.offsetV;
  const size = options.tile.size;
  const sample = (u: number, v: number) =>
    sampleProjected(
      tileData,
      size,
      baseMm,
      u,
      v,
      scaleU,
      scaleV,
      cos,
      sin,
      offsetU,
      offsetV
    );

  if (options.projection !== "triplanar") {
    const [u, v] = projectionUv(options.projection, x, y, z);
    return sample(u, v);
  }

  const wx = Math.pow(Math.abs(nx), 4);
  const wy = Math.pow(Math.abs(ny), 4);
  const wz = Math.pow(Math.abs(nz), 4);
  const total = wx + wy + wz;
  if (total < 1e-8) {
    return sample(x, y);
  }
  let height = 0;
  if (wx > 1e-8) height += sample(z, y) * (wx / total);
  if (wy > 1e-8) height += sample(x, z) * (wy / total);
  if (wz > 1e-8) height += sample(x, y) * (wz / total);
  return height;
}

function displaceVertices(
  vertices: Float32Array,
  normals: Float32Array,
  weights: Float32Array,
  options: ProcessOptions,
  tileData: Float32Array,
  baseMm: number
): Float32Array {
  const displaced = new Float32Array(vertices.length);
  const amplitude = Math.max(0, options.amplitudeMm);
  for (let index = 0; index < vertices.length; index += 3) {
    const x = vertices[index];
    const y = vertices[index + 1];
    const z = vertices[index + 2];
    const nx = normals[index];
    const ny = normals[index + 1];
    const nz = normals[index + 2];
    const height = sampleHeight(
      options,
      tileData,
      baseMm,
      x,
      y,
      z,
      nx,
      ny,
      nz
    );
    const signed = options.symmetric ? height * 2 - 1 : height;
    const distance =
      signed * amplitude * weights[index / 3];
    displaced[index] = x + nx * distance;
    displaced[index + 1] = y + ny * distance;
    displaced[index + 2] = z + nz * distance;
  }
  return displaced;
}

export function processMesh(
  positions: Float32Array,
  options: ProcessOptions,
  onProgress?: (progress: number, phase: string) => void
): ProcessResult {
  const startedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  onProgress?.(0.04, "Analizando malla");
  const welded = weldTriangleSoup(positions);
  const repaired = options.repairMesh ? repairMesh(welded) : welded;
  const diagnostics = analyzeMesh(repaired);
  const subdivided = subdivideMesh(
    repaired,
    options.targetEdgeMm,
    options.maxTriangles,
    onProgress
  );
  onProgress?.(0.8, "Calculando relieve");
  const faces = new Uint32Array(subdivided.faces);
  const baseVertices = new Float32Array(subdivided.vertices);
  const vertices: Float32Array =
    options.surfaceSmoothing > 0
      ? smoothVertices(baseVertices, faces, options.surfaceSmoothing)
      : baseVertices;
  const baseMm = TEXTURE_BASE_MM;
  const normals = computeVertexNormals(vertices, faces);
  const { weights, maskedTriangles } = computeMaskWeights(
    vertices,
    faces,
    options.mask
  );
  const tileData = prepareTextureTile(options.tile, options.smoothing);
  const displaced = displaceVertices(
    vertices,
    normals,
    weights,
    options,
    tileData,
    baseMm
  );
  const finalNormals = computeVertexNormals(displaced, faces);
  const bounds = computeBounds(displaced);
  const elapsedMs =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
    startedAt;
  onProgress?.(1, "Listo");
  return {
    positions: displaced,
    indices: faces,
    normals: finalNormals,
    triangles: faces.length / 3,
    sourceTriangles: positions.length / 9,
    maskedTriangles,
    openEdges: diagnostics.openEdges,
    nonManifoldEdges: diagnostics.nonManifoldEdges,
    capped: subdivided.capped,
    completed: subdivided.completed,
    elapsedMs,
    bounds,
  };
}
