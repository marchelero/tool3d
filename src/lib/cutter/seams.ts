import type { ManifoldToplevel } from "manifold-3d";
import { computeBounds } from "@/lib/mesh/bounds";
import { edgeKey, signedVolume } from "@/lib/mesh/topology";
import type { MeshData, Vec3 } from "@/lib/mesh/types";
import { splitMesh } from "./split";
import type { SeparationPlane } from "./types";

interface SeamEdge {
  a: number;
  b: number;
}

const MIN_DIHEDRAL = (32 * Math.PI) / 180;
const MIN_CONCAVITY = 0.03;
const MAX_CANDIDATES = 6;

function triangleNormal(
  vertices: Float32Array,
  faces: Uint32Array,
  face: number
): Vec3 {
  const a = faces[face * 3] * 3;
  const b = faces[face * 3 + 1] * 3;
  const c = faces[face * 3 + 2] * 3;
  const abx = vertices[b] - vertices[a];
  const aby = vertices[b + 1] - vertices[a + 1];
  const abz = vertices[b + 2] - vertices[a + 2];
  const acx = vertices[c] - vertices[a];
  const acy = vertices[c + 1] - vertices[a + 1];
  const acz = vertices[c + 2] - vertices[a + 2];
  const x = aby * acz - abz * acy;
  const y = abz * acx - abx * acz;
  const z = abx * acy - aby * acx;
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function findSeamEdges(mesh: MeshData): SeamEdge[] {
  const faceCount = mesh.faces.length / 3;
  const vertexCount = mesh.vertices.length / 3;
  const normals = new Array<Vec3>(faceCount);
  for (let face = 0; face < faceCount; face += 1) {
    normals[face] = triangleNormal(mesh.vertices, mesh.faces, face);
  }

  const edges = new Map<
    number,
    { a: number; b: number; faces: number[] }
  >();
  for (let face = 0; face < faceCount; face += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const a = mesh.faces[face * 3 + corner];
      const b = mesh.faces[face * 3 + ((corner + 1) % 3)];
      const key = edgeKey(a, b, vertexCount);
      const record = edges.get(key);
      if (record) record.faces.push(face);
      else edges.set(key, { a, b, faces: [face] });
    }
  }

  const seams: SeamEdge[] = [];
  for (const edge of edges.values()) {
    if (edge.faces.length !== 2) continue;
    const first = edge.faces[0];
    const second = edge.faces[1];
    const nA = normals[first];
    const nB = normals[second];
    const dot = Math.max(-1, Math.min(1, nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2]));
    const dihedral = Math.acos(dot);
    if (dihedral < MIN_DIHEDRAL) continue;

    const ax = mesh.vertices[edge.a * 3];
    const ay = mesh.vertices[edge.a * 3 + 1];
    const az = mesh.vertices[edge.a * 3 + 2];
    const ex = mesh.vertices[edge.b * 3] - ax;
    const ey = mesh.vertices[edge.b * 3 + 1] - ay;
    const ez = mesh.vertices[edge.b * 3 + 2] - az;
    const length = Math.hypot(ex, ey, ez) || 1;
    const cx = nA[1] * nB[2] - nA[2] * nB[1];
    const cy = nA[2] * nB[0] - nA[0] * nB[2];
    const cz = nA[0] * nB[1] - nA[1] * nB[0];
    const concavity = (cx * ex + cy * ey + cz * ez) / length;
    if (concavity > -MIN_CONCAVITY) continue;
    seams.push({ a: edge.a, b: edge.b });
  }
  return seams;
}

function groupLoops(seams: SeamEdge[]): number[][] {
  const adjacency = new Map<number, number[]>();
  seams.forEach((edge, index) => {
    const fromA = adjacency.get(edge.a);
    if (fromA) fromA.push(index);
    else adjacency.set(edge.a, [index]);
    const fromB = adjacency.get(edge.b);
    if (fromB) fromB.push(index);
    else adjacency.set(edge.b, [index]);
  });

  const used = new Set<number>();
  const loops: number[][] = [];
  for (let index = 0; index < seams.length; index += 1) {
    if (used.has(index)) continue;
    used.add(index);
    const start = seams[index].a;
    let current = seams[index].b;
    const loop = [start, current];
    let closed = false;
    for (let step = 0; step < seams.length + 2; step += 1) {
      if (current === start) {
        closed = true;
        break;
      }
      const candidates = (adjacency.get(current) ?? []).filter(
        (candidate) => !used.has(candidate)
      );
      if (candidates.length === 0) break;
      const nextIndex = candidates[0];
      used.add(nextIndex);
      const edge = seams[nextIndex];
      const next = edge.a === current ? edge.b : edge.a;
      current = next;
      loop.push(current);
    }
    if (closed && loop.length - 1 >= 8) {
      loop.pop();
      if (new Set(loop).size === loop.length) loops.push(loop);
    }
  }
  return loops;
}

function fitPlane(
  mesh: MeshData,
  loop: number[],
  modelDiagonal: number
): { normal: Vec3; offset: number; score: number } | null {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const vertex of loop) {
    cx += mesh.vertices[vertex * 3];
    cy += mesh.vertices[vertex * 3 + 1];
    cz += mesh.vertices[vertex * 3 + 2];
  }
  cx /= loop.length;
  cy /= loop.length;
  cz /= loop.length;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let index = 0; index < loop.length; index += 1) {
    const first = loop[index];
    const second = loop[(index + 1) % loop.length];
    const ax = mesh.vertices[first * 3];
    const ay = mesh.vertices[first * 3 + 1];
    const az = mesh.vertices[first * 3 + 2];
    const bx = mesh.vertices[second * 3];
    const by = mesh.vertices[second * 3 + 1];
    const bz = mesh.vertices[second * 3 + 2];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-9) return null;
  nx /= length;
  ny /= length;
  nz /= length;

  let deviation = 0;
  let span = 0;
  for (const vertex of loop) {
    const px = mesh.vertices[vertex * 3] - cx;
    const py = mesh.vertices[vertex * 3 + 1] - cy;
    const pz = mesh.vertices[vertex * 3 + 2] - cz;
    deviation = Math.max(deviation, Math.abs(px * nx + py * ny + pz * nz));
    span = Math.max(span, Math.hypot(px, py, pz));
  }
  if (span < modelDiagonal * 0.04) return null;
  if (deviation > Math.max(0.6, modelDiagonal * 0.02)) return null;

  return {
    normal: [nx, ny, nz],
    offset: nx * cx + ny * cy + nz * cz,
    score: (span / modelDiagonal) * (1 - deviation / Math.max(0.6, modelDiagonal)),
  };
}

function planeKey(plane: SeparationPlane): string {
  return `${plane.normal.map((value) => value.toFixed(2)).join(",")}:${plane.offset.toFixed(1)}`;
}

export function detectSeparationPlanes(
  wasm: ManifoldToplevel,
  mesh: MeshData,
  onProgress?: (progress: number) => void
): SeparationPlane[] {
  const bounds = computeBounds(mesh.vertices);
  const diagonal = Math.max(1e-3, Math.hypot(...bounds.size));
  onProgress?.(0.1);
  const seams = findSeamEdges(mesh);
  onProgress?.(0.25);
  if (seams.length === 0) return [];

  const loops = groupLoops(seams);
  onProgress?.(0.4);
  const candidates: SeparationPlane[] = [];
  for (const loop of loops) {
    const plane = fitPlane(mesh, loop, diagonal);
    if (!plane) continue;
    if (candidates.some((item) => planeKey(item) === planeKey({
      normal: plane.normal,
      offset: plane.offset,
      label: "",
      source: "seam",
      score: plane.score,
    }))) {
      continue;
    }
    candidates.push({
      normal: plane.normal,
      offset: plane.offset,
      label: "Unión entre formas",
      source: "seam",
      score: plane.score,
    });
  }
  candidates.sort((left, right) => right.score - left.score);
  const shortlist = candidates.slice(0, MAX_CANDIDATES);
  if (shortlist.length === 0) return [];

  const totalVolume = Math.abs(signedVolume(mesh));
  const valid: SeparationPlane[] = [];
  shortlist.forEach((plane, index) => {
    try {
      const parts = splitMesh(wasm, mesh, [
        {
          kind: "plane",
          normal: plane.normal,
          offset: plane.offset,
        },
      ]);
      const meaningful = parts.filter(
        (part) => part.volume > Math.max(1, totalVolume * 0.01)
      );
      if (meaningful.length >= 2) valid.push(plane);
    } catch {
      return;
    }
    onProgress?.(0.4 + (0.55 * (index + 1)) / shortlist.length);
  });
  return valid.slice(0, 4);
}
