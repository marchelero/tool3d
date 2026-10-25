import { computeBounds } from "@/lib/mesh/bounds";
import { edgeKey } from "@/lib/mesh/topology";
import type { MeshBounds, MeshData, Vec3 } from "@/lib/mesh/types";
import type { CutAxis, PlaneCutOp, RegionCutOp, Ring2 } from "./types";

export interface ZoneOptions {
  tolerance: number;
  useColor: boolean;
  useAngle: boolean;
  contiguous: boolean;
}

export interface ZoneResult {
  faces: number[];
  boundaryLoops: Vec3[][];
  area: number;
  normal: Vec3;
  axis: CutAxis;
  color: string | null;
  triangles: number;
}

interface ZoneCache {
  faceCount: number;
  vertexCount: number;
  normals: Float32Array;
  areas: Float32Array;
  vertexOffsets: Uint32Array;
  vertexFaces: Uint32Array;
}

interface ColorRegions {
  colors: string[];
  key: string;
  labels: Int32Array;
  results: Map<number, ZoneResult>;
}

const zoneCaches = new WeakMap<MeshData, ZoneCache>();
const colorCaches = new WeakMap<string[], Int32Array>();
const zoneResultCaches = new WeakMap<MeshData, Map<string, ZoneResult>>();
const colorRegionCaches = new WeakMap<MeshData, Map<string, ColorRegions>>();

function buildZoneCache(mesh: MeshData): ZoneCache {
  const faceCount = mesh.faces.length / 3;
  const vertexCount = mesh.vertices.length / 3;
  const normals = new Float32Array(faceCount * 3);
  const areas = new Float32Array(faceCount);
  const counts = new Uint32Array(vertexCount + 1);

  for (let face = 0; face < faceCount; face += 1) {
    const a = mesh.faces[face * 3] * 3;
    const b = mesh.faces[face * 3 + 1] * 3;
    const c = mesh.faces[face * 3 + 2] * 3;
    const abx = mesh.vertices[b] - mesh.vertices[a];
    const aby = mesh.vertices[b + 1] - mesh.vertices[a + 1];
    const abz = mesh.vertices[b + 2] - mesh.vertices[a + 2];
    const acx = mesh.vertices[c] - mesh.vertices[a];
    const acy = mesh.vertices[c + 1] - mesh.vertices[a + 1];
    const acz = mesh.vertices[c + 2] - mesh.vertices[a + 2];
    const x = aby * acz - abz * acy;
    const y = abz * acx - abx * acz;
    const z = abx * acy - aby * acx;
    const length = Math.hypot(x, y, z) || 1;
    normals[face * 3] = x / length;
    normals[face * 3 + 1] = y / length;
    normals[face * 3 + 2] = z / length;
    areas[face] = length / 2;
    counts[mesh.faces[face * 3]] += 1;
    counts[mesh.faces[face * 3 + 1]] += 1;
    counts[mesh.faces[face * 3 + 2]] += 1;
  }

  const vertexOffsets = new Uint32Array(vertexCount + 1);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    vertexOffsets[vertex + 1] = vertexOffsets[vertex] + counts[vertex];
  }
  const cursor = vertexOffsets.slice(0, vertexCount);
  const vertexFaces = new Uint32Array(faceCount * 3);
  for (let face = 0; face < faceCount; face += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.faces[face * 3 + corner];
      vertexFaces[cursor[vertex]] = face;
      cursor[vertex] += 1;
    }
  }

  return { faceCount, vertexCount, normals, areas, vertexOffsets, vertexFaces };
}

function getZoneCache(mesh: MeshData): ZoneCache {
  const cached = zoneCaches.get(mesh);
  if (cached) return cached;
  const built = buildZoneCache(mesh);
  zoneCaches.set(mesh, built);
  return built;
}

function hexDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return -1;
}

function parseHexColor(color: string): number {
  const text = color.trim();
  const start = text.charCodeAt(0) === 35 ? 1 : 0;
  if (text.length - start !== 6) return -1;
  const r = (hexDigit(text.charCodeAt(start)) << 4) | hexDigit(text.charCodeAt(start + 1));
  const g =
    (hexDigit(text.charCodeAt(start + 2)) << 4) | hexDigit(text.charCodeAt(start + 3));
  const b =
    (hexDigit(text.charCodeAt(start + 4)) << 4) | hexDigit(text.charCodeAt(start + 5));
  if (r < 0 || g < 0 || b < 0) return -1;
  return (r << 16) | (g << 8) | b;
}

function getColorData(colors: string[]): Int32Array {
  const cached = colorCaches.get(colors);
  if (cached) return cached;
  const packed = new Int32Array(colors.length);
  for (let index = 0; index < colors.length; index += 1) {
    packed[index] = parseHexColor(colors[index]);
  }
  colorCaches.set(colors, packed);
  return packed;
}

function colorDistancePacked(a: number, b: number): number {
  if (a < 0 || b < 0) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    ((a >> 16) & 255) - ((b >> 16) & 255),
    ((a >> 8) & 255) - ((b >> 8) & 255),
    (a & 255) - (b & 255)
  );
}

function getColorRegions(
  mesh: MeshData,
  cache: ZoneCache,
  colorData: Int32Array,
  colors: string[],
  tolerance: number,
  colorLimit: number,
  useAngle: boolean,
  angleLimit: number
): ColorRegions {
  let byTolerance = colorRegionCaches.get(mesh);
  if (!byTolerance) {
    byTolerance = new Map();
    colorRegionCaches.set(mesh, byTolerance);
  }
  const key = `${Math.round(tolerance)}|${useAngle ? Math.round(angleLimit) : 0}`;
  const cached = byTolerance.get(key);
  if (cached && cached.colors === colors) return cached;

  const normals = cache.normals;
  const cosLimit = useAngle ? Math.cos((angleLimit * Math.PI) / 180) : -1;
  const labels = new Int32Array(cache.faceCount);
  labels.fill(-1);
  const queue = new Int32Array(cache.faceCount);
  for (let seedFace = 0; seedFace < cache.faceCount; seedFace += 1) {
    if (labels[seedFace] !== -1) continue;
    const seedColor = colorData[seedFace];
    if (seedColor < 0) {
      labels[seedFace] = -2;
      continue;
    }
    const label = seedFace;
    let head = 0;
    let tail = 0;
    labels[seedFace] = label;
    queue[tail] = seedFace;
    tail += 1;
    while (head < tail) {
      const face = queue[head];
      head += 1;
      forEachNeighbor(mesh, cache, face, (neighbor) => {
        if (labels[neighbor] !== -1) return;
        const color = colorData[neighbor];
        if (color < 0 || colorDistancePacked(seedColor, color) > colorLimit) return;
        if (useAngle) {
          const dot =
            normals[face * 3] * normals[neighbor * 3] +
            normals[face * 3 + 1] * normals[neighbor * 3 + 1] +
            normals[face * 3 + 2] * normals[neighbor * 3 + 2];
          if (dot < cosLimit) return;
        }
        labels[neighbor] = label;
        queue[tail] = neighbor;
        tail += 1;
      });
    }
  }

  const regions: ColorRegions = { colors, key, labels, results: new Map() };
  byTolerance.set(key, regions);
  return regions;
}

function facesForLabel(labels: Int32Array, label: number): number[] {
  const faces: number[] = [];
  for (let face = 0; face < labels.length; face += 1) {
    if (labels[face] === label) faces.push(face);
  }
  return faces;
}

function dominantAxis(normal: Vec3): CutAxis {
  const [x, y, z] = normal.map((value) => Math.abs(value));
  if (z >= x && z >= y) return "z";
  if (x >= y) return "x";
  return "y";
}

function projectPoint(point: Vec3, axis: CutAxis): [number, number] {
  if (axis === "x") return [point[1], point[2]];
  if (axis === "y") return [point[0], point[2]];
  return [point[0], point[1]];
}

function averageColor(packed: Int32Array, faces: number[]): string | null {
  const totals = [0, 0, 0];
  let count = 0;
  const step = Math.max(1, Math.floor(faces.length / 4096));
  for (let index = 0; index < faces.length; index += step) {
    const value = packed[faces[index]];
    if (value === undefined || value < 0) continue;
    totals[0] += (value >> 16) & 255;
    totals[1] += (value >> 8) & 255;
    totals[2] += value & 255;
    count += 1;
  }
  if (count === 0) return null;
  const hex = totals
    .map((total) =>
      Math.round(total / count)
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
  return `#${hex}`;
}

function sharesEdge(faces: Uint32Array, face: number, other: number): boolean {
  const a = faces[face * 3];
  const b = faces[face * 3 + 1];
  const c = faces[face * 3 + 2];
  const d = faces[other * 3];
  const e = faces[other * 3 + 1];
  const f = faces[other * 3 + 2];
  let shared = 0;
  if (a === d || a === e || a === f) shared += 1;
  if (b === d || b === e || b === f) shared += 1;
  if (c === d || c === e || c === f) shared += 1;
  return shared >= 2;
}

function forEachNeighbor(
  mesh: MeshData,
  cache: ZoneCache,
  face: number,
  visit: (neighbor: number) => void
) {
  const faces = mesh.faces;
  for (let corner = 0; corner < 3; corner += 1) {
    const vertex = faces[face * 3 + corner];
    const start = cache.vertexOffsets[vertex];
    const end = cache.vertexOffsets[vertex + 1];
    for (let index = start; index < end; index += 1) {
      const candidate = cache.vertexFaces[index];
      if (candidate === face) continue;
      if (sharesEdge(faces, face, candidate)) visit(candidate);
    }
  }
}

export function selectZone(
  mesh: MeshData,
  seedFace: number,
  options: ZoneOptions,
  faceColors?: string[] | null
): ZoneResult {
  const cache = getZoneCache(mesh);
  if (seedFace < 0 || seedFace >= cache.faceCount) {
    throw new Error("La cara seleccionada no es válida");
  }
  const colorsAvailable = Boolean(
    faceColors && faceColors.length === cache.faceCount
  );
  const colorData =
    options.useColor && colorsAvailable ? getColorData(faceColors as string[]) : null;
  const tolerance = Math.min(100, Math.max(0, options.tolerance));
  const angleLimit = 5 + (tolerance / 100) * 175;
  const colorLimit = 3 + (tolerance / 100) * 90;

  const seedNormalX = cache.normals[seedFace * 3];
  const seedNormalY = cache.normals[seedFace * 3 + 1];
  const seedNormalZ = cache.normals[seedFace * 3 + 2];
  const seedColor = colorData?.[seedFace] ?? -1;
  const useSeedColor = seedColor >= 0;
  const useAngle = options.useAngle;
  const localAngleLimit = angleLimit;
  const localCosLimit = Math.cos((localAngleLimit * Math.PI) / 180);
  const seedCosLimit = Math.cos((angleLimit * Math.PI) / 180);

  if (useSeedColor && colorData && options.contiguous) {
    const regions = getColorRegions(
      mesh,
      cache,
      colorData,
      faceColors as string[],
      Math.round(tolerance),
      colorLimit,
      useAngle,
      localAngleLimit
    );
    const label = regions.labels[seedFace];
    if (label >= 0) {
      const cached = regions.results.get(label);
      if (cached) return cached;
      const result = buildZoneResult(
        mesh,
        cache,
        facesForLabel(regions.labels, label),
        faceColors ?? null
      );
      regions.results.set(label, result);
      return result;
    }
  }

  const allKey = options.contiguous
    ? `all|${Math.round(tolerance)}|${useSeedColor ? 1 : 0}|${
        useAngle ? Math.round(localAngleLimit) : 0
      }`
    : null;
  if (allKey) {
    const cached = zoneResultCaches.get(mesh)?.get(allKey);
    if (cached) return cached;
  }

  const cacheKey = useSeedColor
    ? `${seedColor}|${Math.round(tolerance)}|${
        options.contiguous ? 1 : 0
      }|${useAngle ? Math.round(localAngleLimit) : 0}`
    : null;
  if (cacheKey) {
    const cached = zoneResultCaches.get(mesh)?.get(cacheKey);
    if (cached) return cached;
  }

  const matches = (face: number, fromFace?: number): boolean => {
    if (useSeedColor) {
      const color = colorData?.[face] ?? -1;
      if (color < 0 || colorDistancePacked(seedColor, color) > colorLimit) {
        return false;
      }
    }
    if (useAngle) {
      if (fromFace !== undefined) {
        const dot =
          cache.normals[fromFace * 3] * cache.normals[face * 3] +
          cache.normals[fromFace * 3 + 1] * cache.normals[face * 3 + 1] +
          cache.normals[fromFace * 3 + 2] * cache.normals[face * 3 + 2];
        if (dot < localCosLimit) return false;
      } else {
        const dot =
          seedNormalX * cache.normals[face * 3] +
          seedNormalY * cache.normals[face * 3 + 1] +
          seedNormalZ * cache.normals[face * 3 + 2];
        if (dot < seedCosLimit) return false;
      }
    }
    return true;
  };

  const selected = new Set<number>();
  if (options.contiguous) {
    const queue = [seedFace];
    selected.add(seedFace);
    while (queue.length > 0) {
      const face = queue.pop() as number;
      forEachNeighbor(mesh, cache, face, (neighbor) => {
        if (selected.has(neighbor)) return;
        if (!matches(neighbor, face)) return;
        selected.add(neighbor);
        queue.push(neighbor);
      });
    }
  } else {
    for (let face = 0; face < cache.faceCount; face += 1) {
      if (matches(face)) selected.add(face);
    }
  }

  const result = buildZoneResult(
    mesh,
    cache,
    selected,
    colorData ? faceColors ?? null : null
  );
  if (cacheKey) {
    let map = zoneResultCaches.get(mesh);
    if (!map) {
      map = new Map();
      zoneResultCaches.set(mesh, map);
    }
    if (map.size >= 12) {
      const first = map.keys().next().value;
      if (first !== undefined) map.delete(first);
    }
    map.set(cacheKey, result);
  }
  if (allKey && selected.size >= cache.faceCount * 0.9) {
    let map = zoneResultCaches.get(mesh);
    if (!map) {
      map = new Map();
      zoneResultCaches.set(mesh, map);
    }
    if (map.size >= 12) {
      const first = map.keys().next().value;
      if (first !== undefined) map.delete(first);
    }
    map.set(allKey, result);
  }
  return result;
}

export function zoneFromFaces(
  mesh: MeshData,
  selectedFaces: Iterable<number>,
  faceColors?: string[] | null
): ZoneResult {
  const cache = getZoneCache(mesh);
  const selected = new Set<number>();
  for (const face of selectedFaces) {
    if (Number.isInteger(face) && face >= 0 && face < cache.faceCount) {
      selected.add(face);
    }
  }
  if (selected.size === 0) {
    throw new Error("La zona no tiene caras seleccionadas");
  }
  const hasColors = Boolean(faceColors && faceColors.length === cache.faceCount);
  return buildZoneResult(mesh, cache, selected, hasColors ? faceColors ?? null : null);
}

function buildZoneResult(
  mesh: MeshData,
  cache: ZoneCache,
  selected: Iterable<number>,
  faceColors: string[] | null
): ZoneResult {
  const faces: number[] = Array.isArray(selected)
    ? selected
    : Array.from(selected);
  const boundaryLoops: Vec3[][] = [];
  if (faces.length !== cache.faceCount) {
    const regionEdgeCount = new Map<number, number>();
    for (const face of faces) {
      for (let edge = 0; edge < 3; edge += 1) {
        const first = mesh.faces[face * 3 + edge];
        const second = mesh.faces[face * 3 + ((edge + 1) % 3)];
        const key = edgeKey(first, second, cache.vertexCount);
        regionEdgeCount.set(key, (regionEdgeCount.get(key) ?? 0) + 1);
      }
    }

    const directed: Array<[number, number]> = [];
    for (const face of faces) {
      for (let edge = 0; edge < 3; edge += 1) {
        const first = mesh.faces[face * 3 + edge];
        const second = mesh.faces[face * 3 + ((edge + 1) % 3)];
        const key = edgeKey(first, second, cache.vertexCount);
        if ((regionEdgeCount.get(key) ?? 0) === 1) {
          directed.push([first, second]);
        }
      }
    }

    const byStart = new Map<number, Array<[number, number]>>();
    const used = new Set<number>();
    directed.forEach((edge, index) => {
      const list = byStart.get(edge[0]);
      if (list) list.push([edge[1], index]);
      else byStart.set(edge[0], [[edge[1], index]]);
    });

    for (let index = 0; index < directed.length; index += 1) {
      if (used.has(index)) continue;
      const start = directed[index][0];
      let current = start;
      const vertexLoop: number[] = [];
      let guard = 0;
      while (guard <= directed.length) {
        guard += 1;
        const candidates = byStart.get(current) ?? [];
        const next = candidates.find((candidate) => !used.has(candidate[1]));
        if (!next) break;
        used.add(next[1]);
        vertexLoop.push(current);
        current = next[0];
        if (current === start) break;
      }
      if (vertexLoop.length >= 3) {
        boundaryLoops.push(
          vertexLoop.map((vertex) => {
            const base = vertex * 3;
            return [
              mesh.vertices[base],
              mesh.vertices[base + 1],
              mesh.vertices[base + 2],
            ] as Vec3;
          })
        );
      }
    }
  }

  let area = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const face of faces) {
    const faceArea = cache.areas[face];
    area += faceArea;
    nx += cache.normals[face * 3] * faceArea;
    ny += cache.normals[face * 3 + 1] * faceArea;
    nz += cache.normals[face * 3 + 2] * faceArea;
  }
  const length = Math.hypot(nx, ny, nz) || 1;
  const normal: Vec3 = [nx / length, ny / length, nz / length];

  return {
    faces,
    boundaryLoops,
    area,
    normal,
    axis: dominantAxis(normal),
    color:
      faceColors && faces.length > 0
        ? averageColor(getColorData(faceColors), faces)
        : null,
    triangles: faces.length,
  };
}

function expandRing(ring: Ring2): Ring2 {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of ring) {
    cx += x;
    cy += y;
  }
  cx /= ring.length;
  cy /= ring.length;
  return ring.map(([x, y]) => [cx + (x - cx) * 1.02, cy + (y - cy) * 1.02]);
}

function projectLoops(loops: Vec3[][], axis: CutAxis): Ring2[] {
  const rings: Ring2[] = [];
  for (const loop of loops) {
    const ring: Ring2 = [];
    for (const point of loop) {
      const [x, y] = projectPoint(point, axis);
      const previous = ring[ring.length - 1];
      if (previous && Math.hypot(previous[0] - x, previous[1] - y) < 1e-6) {
        continue;
      }
      ring.push([x, y]);
    }
    if (ring.length < 3) continue;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
      ring.pop();
    }
    if (ring.length >= 3) rings.push(expandRing(ring));
  }
  return rings;
}

export function zoneToPlaneOp(zone: ZoneResult, id: string): PlaneCutOp {
  if (zone.boundaryLoops.length === 0) {
    throw new Error("La zona no tiene un borde cerrado para cortar");
  }
  let loop = zone.boundaryLoops[0];
  for (const candidate of zone.boundaryLoops) {
    if (candidate.length > loop.length) loop = candidate;
  }
  if (loop.length < 3) {
    throw new Error("La zona no tiene un borde válido para cortar");
  }
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const centroid: Vec3 = [0, 0, 0];
  for (let index = 0; index < loop.length; index += 1) {
    const point = loop[index];
    const next = loop[(index + 1) % loop.length];
    nx += (point[1] - next[1]) * (point[2] + next[2]);
    ny += (point[2] - next[2]) * (point[0] + next[0]);
    nz += (point[0] - next[0]) * (point[1] + next[1]);
    centroid[0] += point[0];
    centroid[1] += point[1];
    centroid[2] += point[2];
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-9) {
    throw new Error("La zona no tiene un borde plano para cortar");
  }
  centroid[0] /= loop.length;
  centroid[1] /= loop.length;
  centroid[2] /= loop.length;
  const normal: [number, number, number] = [
    nx / length,
    ny / length,
    nz / length,
  ];
  const offset =
    normal[0] * centroid[0] +
    normal[1] * centroid[1] +
    normal[2] * centroid[2];
  return {
    id,
    kind: "plane",
    axis: dominantAxis(normal),
    normal,
    offset,
    enabled: true,
  };
}

export function zoneToRegionOp(
  zone: ZoneResult,
  bounds: MeshBounds,
  depth: number,
  id: string
): RegionCutOp {
  const rings = projectLoops(zone.boundaryLoops, zone.axis);
  if (rings.length === 0) {
    throw new Error("La zona no tiene un borde cerrado para cortar");
  }
  const axisIndex = zone.axis === "x" ? 0 : zone.axis === "y" ? 1 : 2;
  const points = zone.boundaryLoops.flat();
  const average =
    points.reduce((sum, point) => sum + point[axisIndex], 0) /
    Math.max(1, points.length);
  const margin = Math.max(2, Math.max(...bounds.size) * 0.06);
  const sign = zone.normal[axisIndex] >= 0 ? 1 : -1;
  const outside =
    sign > 0 ? bounds.max[axisIndex] + margin : bounds.min[axisIndex] - margin;
  const inside = Math.min(
    bounds.max[axisIndex],
    Math.max(bounds.min[axisIndex], average - sign * Math.max(0.4, depth))
  );
  return {
    id,
    kind: "region",
    axis: zone.axis,
    rings,
    min: Math.min(outside, inside),
    max: Math.max(outside, inside),
    label: `Zona de ${zone.triangles} caras`,
    enabled: true,
  };
}

export function zoneBounds(mesh: MeshData): MeshBounds {
  return computeBounds(mesh.vertices);
}
