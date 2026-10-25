import type { MeshData, MeshDiagnostics } from "./types";

export interface EdgeRecord {
  a: number;
  b: number;
  count: number;
  f0: number;
  f1: number;
}

export function edgeKey(a: number, b: number, vertexCount: number): number {
  return a < b ? a * vertexCount + b : b * vertexCount + a;
}

export function buildEdgeIndex(mesh: MeshData): Map<number, EdgeRecord> {
  const vertexCount = mesh.vertices.length / 3;
  const edges = new Map<number, EdgeRecord>();
  const faces = mesh.faces;
  for (let face = 0; face < faces.length / 3; face += 1) {
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
      const key = edgeKey(first, second, vertexCount);
      const existing = edges.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.f1 < 0) existing.f1 = face;
      } else {
        edges.set(key, {
          a: first,
          b: second,
          count: 1,
          f0: face,
          f1: -1,
        });
      }
    }
  }
  return edges;
}

export function triangleArea(
  vertices: Float32Array,
  faces: Uint32Array,
  face: number
): number {
  const offset = face * 3;
  const a = faces[offset] * 3;
  const b = faces[offset + 1] * 3;
  const c = faces[offset + 2] * 3;
  const ux = vertices[b] - vertices[a];
  const uy = vertices[b + 1] - vertices[a + 1];
  const uz = vertices[b + 2] - vertices[a + 2];
  const vx = vertices[c] - vertices[a];
  const vy = vertices[c + 1] - vertices[a + 1];
  const vz = vertices[c + 2] - vertices[a + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz) / 2;
}

export function signedVolume(mesh: MeshData): number {
  const vertices = mesh.vertices;
  const faces = mesh.faces;
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

export interface ComponentInfo {
  count: number;
  faceComponent: Uint32Array;
  componentFaces: number[][];
  componentVolume: Float64Array;
}

export function connectedComponents(mesh: MeshData): ComponentInfo {
  const vertexCount = mesh.vertices.length / 3;
  const parent = new Int32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) parent[index] = index;

  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parent[rootRight] = rootLeft;
  };

  const faces = mesh.faces;
  for (let index = 0; index < faces.length; index += 3) {
    union(faces[index], faces[index + 1]);
    union(faces[index + 1], faces[index + 2]);
  }

  const roots = new Map<number, number>();
  const faceComponent = new Uint32Array(faces.length / 3);
  const componentFaces: number[][] = [];
  for (let face = 0; face < faces.length / 3; face += 1) {
    const root = find(faces[face * 3]);
    let component = roots.get(root);
    if (component === undefined) {
      component = componentFaces.length;
      roots.set(root, component);
      componentFaces.push([]);
    }
    faceComponent[face] = component;
    componentFaces[component].push(face);
  }

  const componentVolume = new Float64Array(componentFaces.length);
  for (let component = 0; component < componentFaces.length; component += 1) {
    let volume = 0;
    for (const face of componentFaces[component]) {
      const offset = face * 3;
      const a = faces[offset] * 3;
      const b = faces[offset + 1] * 3;
      const c = faces[offset + 2] * 3;
      const vertices = mesh.vertices;
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
    componentVolume[component] = volume / 6;
  }

  return {
    count: componentFaces.length,
    faceComponent,
    componentFaces,
    componentVolume,
  };
}

export function boundaryLoops(mesh: MeshData): number[][] {
  const edges = buildEdgeIndex(mesh);
  const next = new Map<number, number>();
  const ambiguous = new Set<number>();
  for (const edge of edges.values()) {
    if (edge.count !== 1) continue;
    if (next.has(edge.a)) {
      ambiguous.add(edge.a);
      continue;
    }
    next.set(edge.a, edge.b);
  }

  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of next.keys()) {
    if (visited.has(start) || ambiguous.has(start)) continue;
    const loop: number[] = [];
    let current = start;
    let guard = 0;
    while (guard < next.size + 1) {
      guard += 1;
      if (visited.has(current)) break;
      visited.add(current);
      loop.push(current);
      const following = next.get(current);
      if (following === undefined) {
        loop.length = 0;
        break;
      }
      if (following === start) break;
      current = following;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export interface AnalyzeOptions {
  loops?: number[][];
  components?: ComponentInfo;
}

export function analyzeMesh(
  mesh: MeshData,
  options: AnalyzeOptions = {}
): MeshDiagnostics {
  const edges = buildEdgeIndex(mesh);
  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const edge of edges.values()) {
    if (edge.count === 1) openEdges += 1;
    else if (edge.count > 2) nonManifoldEdges += 1;
  }
  const loops = options.loops ?? boundaryLoops(mesh);
  const components = options.components ?? connectedComponents(mesh);
  const volume = signedVolume(mesh);
  return {
    vertices: mesh.vertices.length / 3,
    triangles: mesh.faces.length / 3,
    openEdges,
    nonManifoldEdges,
    boundaryLoops: loops.length,
    components: components.count,
    volume,
    watertight: openEdges === 0 && nonManifoldEdges === 0,
    outward: volume > 0,
  };
}
