import type { MaskSettings, MeshBounds } from "./types";

const MAX_SUBDIVISION_ITERATIONS = 14;

export interface WeldedMesh {
  vertices: Float32Array;
  faces: Uint32Array;
}

export interface MeshDiagnostics {
  openEdges: number;
  nonManifoldEdges: number;
}

export interface SubdivisionResult {
  vertices: number[];
  faces: number[];
  capped: boolean;
  completed: boolean;
}

export function computeBounds(positions: Float32Array): MeshBounds {
  if (positions.length < 3) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      size: [0, 0, 0],
      center: [0, 0, 0],
    };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

export function weldTriangleSoup(positions: Float32Array): WeldedMesh {
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

export function analyzeMesh(mesh: WeldedMesh): MeshDiagnostics {
  const edgeCounts = new Map<string, number>();
  const faces = mesh.faces;
  for (let index = 0; index < faces.length; index += 3) {
    const a = faces[index];
    const b = faces[index + 1];
    const c = faces[index + 2];
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [first, second] of edges) {
      const key =
        first < second ? `${first}:${second}` : `${second}:${first}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) openEdges += 1;
    else if (count > 2) nonManifoldEdges += 1;
  }
  return { openEdges, nonManifoldEdges };
}

function signedVolume(vertices: Float32Array, faces: Uint32Array): number {
  let volume = 0;
  for (let index = 0; index < faces.length; index += 3) {
    const a = faces[index] * 3;
    const b = faces[index + 1] * 3;
    const c = faces[index + 2] * 3;
    const ax = vertices[a];
    const ay = vertices[a + 1];
    const az = vertices[a + 2];
    const bx = vertices[b];
    const by = vertices[b + 1];
    const bz = vertices[b + 2];
    const cx = vertices[c];
    const cy = vertices[c + 1];
    const cz = vertices[c + 2];
    volume +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
  }
  return volume / 6;
}

export function repairMesh(mesh: WeldedMesh): WeldedMesh {
  const seen = new Set<string>();
  const deduped: number[] = [];
  for (let index = 0; index < mesh.faces.length; index += 3) {
    const a = mesh.faces[index];
    const b = mesh.faces[index + 1];
    const c = mesh.faces[index + 2];
    const key = [a, b, c].sort((left, right) => left - right).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a, b, c);
  }

  const faces = new Uint32Array(deduped);
  const edgeFaces = new Map<
    string,
    { face: number; direction: 1 | -1 }[]
  >();
  const faceCount = faces.length / 3;
  for (let face = 0; face < faceCount; face += 1) {
    const offset = face * 3;
    const a = faces[offset];
    const b = faces[offset + 1];
    const c = faces[offset + 2];
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [first, second] of pairs) {
      const key =
        first < second ? `${first}:${second}` : `${second}:${first}`;
      const entry = { face, direction: first < second ? 1 : -1 } as {
        face: number;
        direction: 1 | -1;
      };
      const list = edgeFaces.get(key);
      if (list) list.push(entry);
      else edgeFaces.set(key, [entry]);
    }
  }

  const flipped = new Uint8Array(faceCount);
  const visited = new Uint8Array(faceCount);
  for (let start = 0; start < faceCount; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    const queue = [start];
    while (queue.length > 0) {
      const face = queue.pop() as number;
      const offset = face * 3;
      const a = faces[offset];
      const b = faces[offset + 1];
      const c = faces[offset + 2];
      const pairs: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (const [first, second] of pairs) {
        const key =
          first < second ? `${first}:${second}` : `${second}:${first}`;
        const list = edgeFaces.get(key);
        if (!list || list.length !== 2) continue;
        const own = list.find((entry) => entry.face === face);
        const other = list.find((entry) => entry.face !== face);
        if (!own || !other || visited[other.face]) continue;
        const ownDirection = own.direction * (flipped[face] ? -1 : 1);
        const otherDirection =
          other.direction * (flipped[other.face] ? -1 : 1);
        if (ownDirection === otherDirection) {
          flipped[other.face] = 1;
        }
        visited[other.face] = 1;
        queue.push(other.face);
      }
    }
  }

  for (let face = 0; face < faceCount; face += 1) {
    if (!flipped[face]) continue;
    const offset = face * 3;
    const b = faces[offset + 1];
    faces[offset + 1] = faces[offset + 2];
    faces[offset + 2] = b;
  }

  const diagnostics = analyzeMesh({ vertices: mesh.vertices, faces });
  if (
    diagnostics.openEdges === 0 &&
    diagnostics.nonManifoldEdges === 0 &&
    signedVolume(mesh.vertices, faces) < 0
  ) {
    for (let face = 0; face < faceCount; face += 1) {
      const offset = face * 3;
      const b = faces[offset + 1];
      faces[offset + 1] = faces[offset + 2];
      faces[offset + 2] = b;
    }
  }

  return { vertices: mesh.vertices, faces };
}

function laplacianStep(
  vertices: Float32Array,
  faces: Uint32Array,
  factor: number
): Float32Array {
  const vertexCount = vertices.length / 3;
  const sums = new Float32Array(vertices.length);
  const counts = new Uint32Array(vertexCount);
  for (let index = 0; index < faces.length; index += 3) {
    const a = faces[index];
    const b = faces[index + 1];
    const c = faces[index + 2];
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [first, second] of pairs) {
      sums[first * 3] += vertices[second * 3];
      sums[first * 3 + 1] += vertices[second * 3 + 1];
      sums[first * 3 + 2] += vertices[second * 3 + 2];
      counts[first] += 1;
      sums[second * 3] += vertices[first * 3];
      sums[second * 3 + 1] += vertices[first * 3 + 1];
      sums[second * 3 + 2] += vertices[first * 3 + 2];
      counts[second] += 1;
    }
  }
  const next = new Float32Array(vertices.length);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const total = counts[vertex];
    if (total === 0) {
      next[vertex * 3] = vertices[vertex * 3];
      next[vertex * 3 + 1] = vertices[vertex * 3 + 1];
      next[vertex * 3 + 2] = vertices[vertex * 3 + 2];
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const offset = vertex * 3 + axis;
      const average = sums[offset] / total;
      next[offset] = vertices[offset] + (average - vertices[offset]) * factor;
    }
  }
  return next;
}

export function smoothVertices(
  vertices: Float32Array,
  faces: Uint32Array,
  iterations: number
): Float32Array {
  const count = Math.max(0, Math.round(iterations));
  if (count <= 0) return vertices;
  let current = vertices;
  for (let iteration = 0; iteration < count; iteration += 1) {
    current = laplacianStep(current, faces, 0.5);
    current = laplacianStep(current, faces, -0.53);
  }
  return current;
}

function smoothScalarField(
  values: Float32Array,
  faces: Uint32Array,
  iterations: number
): Float32Array {
  const count = Math.max(0, Math.round(iterations));
  if (count <= 0) return values;
  const vertexCount = values.length;
  let current = values;
  for (let iteration = 0; iteration < count; iteration += 1) {
    const sums = new Float32Array(vertexCount);
    const counts = new Uint32Array(vertexCount);
    for (let index = 0; index < faces.length; index += 3) {
      const a = faces[index];
      const b = faces[index + 1];
      const c = faces[index + 2];
      const pairs: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (const [first, second] of pairs) {
        sums[first] += current[second];
        counts[first] += 1;
        sums[second] += current[first];
        counts[second] += 1;
      }
    }
    const next = new Float32Array(vertexCount);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const total = counts[vertex];
      next[vertex] =
        total === 0
          ? current[vertex]
          : current[vertex] * 0.5 + (sums[vertex] / total) * 0.5;
    }
    current = next;
  }
  return current;
}

function midpointKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

export function subdivideMesh(
  mesh: WeldedMesh,
  targetEdgeMm: number,
  maxTriangles: number,
  onProgress?: (progress: number, phase: string) => void
): SubdivisionResult {
  const vertices = Array.from(mesh.vertices);
  let faces = Array.from(mesh.faces);
  const target = Math.max(0.01, targetEdgeMm);
  const targetSquared = target * target;
  let capped = false;
  let completed = true;

  for (let iteration = 0; iteration < MAX_SUBDIVISION_ITERATIONS; iteration += 1) {
    const masks = new Uint8Array(faces.length / 3);
    let anySplit = false;
    let nextTriangleCount = 0;

    for (let faceIndex = 0; faceIndex < faces.length / 3; faceIndex += 1) {
      const offset = faceIndex * 3;
      const a = faces[offset];
      const b = faces[offset + 1];
      const c = faces[offset + 2];
      let mask = 0;
      const edges: [number, number][] = [
        [a, b],
        [b, c],
        [c, a],
      ];
      for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
        const [first, second] = edges[edgeIndex];
        const dx = vertices[first * 3] - vertices[second * 3];
        const dy = vertices[first * 3 + 1] - vertices[second * 3 + 1];
        const dz = vertices[first * 3 + 2] - vertices[second * 3 + 2];
        if (dx * dx + dy * dy + dz * dz > targetSquared) {
          mask |= 1 << edgeIndex;
        }
      }
      masks[faceIndex] = mask;
      if (mask !== 0) anySplit = true;
      const splitCount =
        mask === 0 ? 1 : mask === 7 ? 4 : mask === 3 || mask === 5 || mask === 6 ? 3 : 2;
      nextTriangleCount += splitCount;
    }

    if (!anySplit) {
      onProgress?.(1, "Malla lista");
      return { vertices, faces, capped: false, completed: true };
    }
    if (nextTriangleCount > maxTriangles) {
      const longEdges = new Map<
        string,
        { lengthSq: number; count: number }
      >();
      for (let faceIndex = 0; faceIndex < faces.length / 3; faceIndex += 1) {
        const offset = faceIndex * 3;
        const a = faces[offset];
        const b = faces[offset + 1];
        const c = faces[offset + 2];
        const edges: [number, number][] = [
          [a, b],
          [b, c],
          [c, a],
        ];
        for (const [first, second] of edges) {
          const dx = vertices[first * 3] - vertices[second * 3];
          const dy = vertices[first * 3 + 1] - vertices[second * 3 + 1];
          const dz = vertices[first * 3 + 2] - vertices[second * 3 + 2];
          const lengthSq = dx * dx + dy * dy + dz * dz;
          if (lengthSq <= targetSquared) continue;
          const key = midpointKey(first, second);
          const existing = longEdges.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            longEdges.set(key, { lengthSq, count: 1 });
          }
        }
      }

      const remainingBudget = Math.max(
        0,
        maxTriangles - faces.length / 3
      );
      if (remainingBudget <= 0) {
        capped = true;
        completed = false;
        break;
      }

      const selected = new Set<string>();
      let remaining = remainingBudget;
      const ordered = Array.from(longEdges.entries()).sort(
        (left, right) => right[1].lengthSq - left[1].lengthSq
      );
      for (const [key, edge] of ordered) {
        if (edge.count > remaining) continue;
        selected.add(key);
        remaining -= edge.count;
        if (remaining <= 0) break;
      }
      if (selected.size === 0) {
        capped = true;
        completed = false;
        break;
      }

      masks.fill(0);
      for (let faceIndex = 0; faceIndex < faces.length / 3; faceIndex += 1) {
        const offset = faceIndex * 3;
        const a = faces[offset];
        const b = faces[offset + 1];
        const c = faces[offset + 2];
        let mask = 0;
        if (selected.has(midpointKey(a, b))) mask |= 1;
        if (selected.has(midpointKey(b, c))) mask |= 2;
        if (selected.has(midpointKey(c, a))) mask |= 4;
        masks[faceIndex] = mask;
      }
      capped = true;
      completed = false;
    }

    const midpoints = new Map<string, number>();
    const getMidpoint = (first: number, second: number): number => {
      const key = midpointKey(first, second);
      const existing = midpoints.get(key);
      if (existing !== undefined) return existing;
      const index = vertices.length / 3;
      vertices.push(
        (vertices[first * 3] + vertices[second * 3]) / 2,
        (vertices[first * 3 + 1] + vertices[second * 3 + 1]) / 2,
        (vertices[first * 3 + 2] + vertices[second * 3 + 2]) / 2
      );
      midpoints.set(key, index);
      return index;
    };

    const nextFaces: number[] = [];
    for (let faceIndex = 0; faceIndex < masks.length; faceIndex += 1) {
      const offset = faceIndex * 3;
      const a = faces[offset];
      const b = faces[offset + 1];
      const c = faces[offset + 2];
      const mask = masks[faceIndex];
      if (mask === 0) {
        nextFaces.push(a, b, c);
        continue;
      }
      const ab = mask & 1 ? getMidpoint(a, b) : -1;
      const bc = mask & 2 ? getMidpoint(b, c) : -1;
      const ca = mask & 4 ? getMidpoint(c, a) : -1;
      if (mask === 1 && ab >= 0) {
        nextFaces.push(a, ab, c, ab, b, c);
      } else if (mask === 2 && bc >= 0) {
        nextFaces.push(a, b, bc, a, bc, c);
      } else if (mask === 4 && ca >= 0) {
        nextFaces.push(a, b, ca, b, c, ca);
      } else if (mask === 3 && ab >= 0 && bc >= 0) {
        nextFaces.push(a, ab, bc, a, bc, c, ab, b, bc);
      } else if (mask === 5 && ab >= 0 && ca >= 0) {
        nextFaces.push(a, ab, ca, ab, b, c, ab, c, ca);
      } else if (mask === 6 && bc >= 0 && ca >= 0) {
        nextFaces.push(a, b, bc, a, bc, ca, ca, bc, c);
      } else if (mask === 7 && ab >= 0 && bc >= 0 && ca >= 0) {
        nextFaces.push(
          a,
          ab,
          ca,
          ab,
          b,
          bc,
          ca,
          bc,
          c,
          ab,
          bc,
          ca
        );
      } else {
        nextFaces.push(a, b, c);
      }
    }

    faces = nextFaces;
    completed = false;
    onProgress?.(
      Math.min(0.78, 0.16 + (iteration + 1) * 0.1),
      "Subdividiendo"
    );
  }

  return { vertices, faces, capped, completed };
}

export function computeVertexNormals(
  positions: Float32Array,
  faces: Uint32Array
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < faces.length; index += 3) {
    const a = faces[index] * 3;
    const b = faces[index + 1] * 3;
    const c = faces[index + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[a] += nx;
    normals[a + 1] += ny;
    normals[a + 2] += nz;
    normals[b] += nx;
    normals[b + 1] += ny;
    normals[b + 2] += nz;
    normals[c] += nx;
    normals[c + 1] += ny;
    normals[c + 2] += nz;
  }
  for (let index = 0; index < normals.length; index += 3) {
    const x = normals[index];
    const y = normals[index + 1];
    const z = normals[index + 2];
    const length = Math.hypot(x, y, z);
    if (length > 1e-12) {
      normals[index] = x / length;
      normals[index + 1] = y / length;
      normals[index + 2] = z / length;
    } else {
      normals[index] = 0;
      normals[index + 1] = 0;
      normals[index + 2] = 1;
    }
  }
  return normals;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function computeMaskWeights(
  vertices: Float32Array,
  faces: Uint32Array,
  mask: MaskSettings
): { weights: Float32Array; maskedTriangles: number } {
  const vertexCount = vertices.length / 3;
  const selectedMax = new Float32Array(vertexCount);
  const bottomMax = new Float32Array(vertexCount);
  const cosLimit = Math.cos((mask.maxAngleDeg * Math.PI) / 180);
  const soft = 0.08;

  for (let index = 0; index < faces.length; index += 3) {
    const a = faces[index] * 3;
    const b = faces[index + 1] * 3;
    const c = faces[index + 2] * 3;
    const ux = vertices[b] - vertices[a];
    const uy = vertices[b + 1] - vertices[a + 1];
    const uz = vertices[b + 2] - vertices[a + 2];
    const vx = vertices[c] - vertices[a];
    const vy = vertices[c + 1] - vertices[a + 1];
    const vz = vertices[c + 2] - vertices[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length > 1e-12) {
      nx /= length;
      ny /= length;
      nz /= length;
    } else {
      nz = 1;
    }
    const top = smoothstep(cosLimit - soft, cosLimit + soft, nz);
    const bottom = smoothstep(cosLimit - soft, cosLimit + soft, -nz);
    const selected =
      mask.faces === "top"
        ? top
        : mask.faces === "bottom"
          ? bottom
          : Math.max(top, bottom);
    const vertexIndices = [faces[index], faces[index + 1], faces[index + 2]];
    for (const vertex of vertexIndices) {
      if (selected > selectedMax[vertex]) selectedMax[vertex] = selected;
      if (bottom > bottomMax[vertex]) bottomMax[vertex] = bottom;
    }
  }

  const weights = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const selected = selectedMax[vertex];
    const base = mask.excludeBase ? 1 - bottomMax[vertex] : 1;
    const angular = mask.enabled
      ? mask.action === "include"
        ? selected
        : 1 - selected
      : 1;
    weights[vertex] = Math.min(1, Math.max(0, base * angular));
  }

  const feathered =
    mask.feather > 0 && (mask.enabled || mask.excludeBase)
      ? smoothScalarField(weights, faces, mask.feather)
      : weights;

  let maskedTriangles = 0;
  for (let index = 0; index < faces.length; index += 3) {
    const average =
      (feathered[faces[index]] +
        feathered[faces[index + 1]] +
        feathered[faces[index + 2]]) /
      3;
    if (average < 0.9995) maskedTriangles += 1;
  }

  return { weights: feathered, maskedTriangles };
}
