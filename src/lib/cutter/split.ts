import type { Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import { computeBounds } from "@/lib/mesh/bounds";
import type { MeshData, MeshBounds } from "@/lib/mesh/types";
import type {
  CutPart,
  CutSpec,
  SurfaceCapMode,
  SurfaceCutMode,
  SurfacePatch,
} from "./types";

export const PART_COLORS = [
  "#7dd3fc",
  "#fca5a5",
  "#fcd34d",
  "#86efac",
  "#c4b5fd",
  "#fdba74",
  "#f9a8d4",
  "#5eead4",
];

interface WorkingPart {
  manifold: Manifold;
  id: string;
}

function copyManifoldMesh(manifold: Manifold): MeshData {
  const source = manifold.getMesh();
  const vertexCount = source.vertProperties.length / source.numProp;
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * source.numProp;
    vertices[index * 3] = source.vertProperties[base];
    vertices[index * 3 + 1] = source.vertProperties[base + 1];
    vertices[index * 3 + 2] = source.vertProperties[base + 2];
  }
  return { vertices, faces: new Uint32Array(source.triVerts) };
}

function signedArea(points: [number, number][]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ccw(points: [number, number][]): [number, number][] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

function planeSplits(
  vertices: Float32Array,
  normal: [number, number, number],
  offset: number
): boolean {
  const [nx, ny, nz] = normal;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 3) {
    const projection =
      vertices[index] * nx +
      vertices[index + 1] * ny +
      vertices[index + 2] * nz;
    if (projection < minimum) minimum = projection;
    if (projection > maximum) maximum = projection;
  }
  const margin = Math.max(1e-6, (maximum - minimum) * 1e-6);
  return offset > minimum + margin && offset < maximum - margin;
}

function buildCurveCutter(
  wasm: ManifoldToplevel,
  op: Extract<CutSpec, { kind: "curve" }>,
  bounds: MeshBounds
): Manifold {
  const { CrossSection } = wasm;
  const [minX, minY, minZ] = bounds.min;
  const [sizeX, sizeY, sizeZ] = bounds.size;
  const [centerX, centerY] = bounds.center;
  const margin = Math.max(2, Math.max(sizeX, sizeY, sizeZ) * 0.06);
  const amplitude = Math.abs(op.amplitude);
  const wavelength = Math.max(0.5, op.wavelength);
  const bottom = minZ - margin;

  let height: number;
  const points: [number, number][] = [];
  if (op.axis === "x") {
    const start = minX - margin;
    const end = bounds.max[0] + margin;
    const segments = 120;
    for (let index = 0; index <= segments; index += 1) {
      const x = start + ((end - start) * index) / segments;
      const z =
        op.offset +
        amplitude *
          Math.sin(((x - minX) / wavelength) * Math.PI * 2 + op.phase);
      points.push([x, z]);
    }
    points.push([end, bottom], [start, bottom]);
    height = sizeY + margin * 2;
  } else {
    const start = minY - margin;
    const end = bounds.max[1] + margin;
    const segments = 120;
    for (let index = 0; index <= segments; index += 1) {
      const y = start + ((end - start) * index) / segments;
      const z =
        op.offset +
        amplitude *
          Math.sin(((y - minY) / wavelength) * Math.PI * 2 + op.phase);
      points.push([-z, y]);
    }
    points.push([-bottom, end], [-bottom, start]);
    height = sizeX + margin * 2;
  }

  const section = CrossSection.ofPolygons([ccw(points)]);
  const extruded = section.extrude(height, 0, 0, [1, 1], true);
  section.delete();
  const rotated =
    op.axis === "x" ? extruded.rotate([90, 0, 0]) : extruded.rotate([0, 90, 0]);
  extruded.delete();
  const translated =
    op.axis === "x"
      ? rotated.translate([0, centerY, 0])
      : rotated.translate([centerX, 0, 0]);
  rotated.delete();
  return translated;
}

function buildShapeCutter(
  wasm: ManifoldToplevel,
  op: Extract<CutSpec, { kind: "shape" }>
): Manifold {
  const { CrossSection } = wasm;
  if (op.ring.length < 3) {
    throw new Error("La forma del corte no tiene contorno suficiente");
  }
  const section = CrossSection.ofPolygons([ccw(op.ring)]);
  const height = Math.max(1, op.zMax - op.zMin);
  const extruded = section.extrude(height, 0, 0, [1, 1], true);
  section.delete();
  const translated = extruded.translate([0, 0, (op.zMin + op.zMax) / 2]);
  extruded.delete();
  return translated;
}

function affineMatrix(
  xAxis: [number, number, number],
  yAxis: [number, number, number],
  zAxis: [number, number, number],
  origin: [number, number, number]
): Mat4 {
  return [
    xAxis[0],
    xAxis[1],
    xAxis[2],
    0,
    yAxis[0],
    yAxis[1],
    yAxis[2],
    0,
    zAxis[0],
    zAxis[1],
    zAxis[2],
    0,
    origin[0],
    origin[1],
    origin[2],
    1,
  ];
}

function buildRegionCutter(
  wasm: ManifoldToplevel,
  op: Extract<CutSpec, { kind: "region" }>
): Manifold {
  const { CrossSection } = wasm;
  const rings = op.rings.filter(
    (ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-9
  );
  if (rings.length === 0) {
    throw new Error("La zona seleccionada no tiene un borde cerrado");
  }
  const height = op.max - op.min;
  if (!Number.isFinite(height) || height <= 1e-9) {
    throw new Error("La zona seleccionada no tiene una profundidad válida");
  }
  const section = CrossSection.ofPolygons(rings, "EvenOdd");
  if (section.isEmpty() || section.area() <= 1e-9) {
    section.delete();
    throw new Error("La zona seleccionada no tiene una superficie válida");
  }
  const extruded = section.extrude(height, 0, 0, [1, 1], true);
  section.delete();
  const middle = (op.min + op.max) / 2;
  const mapping: Mat4 =
    op.axis === "x"
      ? affineMatrix([0, 1, 0], [0, 0, 1], [1, 0, 0], [middle, 0, 0])
      : op.axis === "y"
        ? affineMatrix([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, middle, 0])
        : affineMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, middle]);
  const positioned = extruded.transform(mapping);
  extruded.delete();
  return positioned;
}

function buildSurfaceCutter(
  wasm: ManifoldToplevel,
  patch: SurfacePatch,
  depth: number
): Manifold {
  if (!Number.isFinite(depth) || depth <= 1e-6) {
    throw new Error("La profundidad debe ser mayor que cero");
  }
  if (
    patch.vertices.length < 9 ||
    patch.vertices.length % 3 !== 0 ||
    patch.faces.length < 3 ||
    patch.faces.length % 3 !== 0 ||
    patch.vertices.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("La zona no contiene una superficie válida");
  }

  const vertexCount = patch.vertices.length / 3;
  const faceCount = patch.faces.length / 3;
  const normalSums = new Float64Array(vertexCount * 3);
  const edgeCounts = new Map<
    string,
    { count: number; first: number; second: number }
  >();
  const edgeKeyOf = (first: number, second: number) =>
    first < second ? `${first}:${second}` : `${second}:${first}`;

  for (let face = 0; face < faceCount; face += 1) {
    const a = patch.faces[face * 3];
    const b = patch.faces[face * 3 + 1];
    const c = patch.faces[face * 3 + 2];
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      a >= vertexCount ||
      b >= vertexCount ||
      c >= vertexCount ||
      a === b ||
      b === c ||
      c === a
    ) {
      throw new Error("La selección contiene triángulos inválidos");
    }
    const ax = patch.vertices[a * 3];
    const ay = patch.vertices[a * 3 + 1];
    const az = patch.vertices[a * 3 + 2];
    const abx = patch.vertices[b * 3] - ax;
    const aby = patch.vertices[b * 3 + 1] - ay;
    const abz = patch.vertices[b * 3 + 2] - az;
    const acx = patch.vertices[c * 3] - ax;
    const acy = patch.vertices[c * 3 + 1] - ay;
    const acz = patch.vertices[c * 3 + 2] - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (Math.hypot(nx, ny, nz) <= 1e-10) {
      throw new Error("La selección contiene una cara degenerada");
    }
    for (const vertex of [a, b, c]) {
      normalSums[vertex * 3] += nx;
      normalSums[vertex * 3 + 1] += ny;
      normalSums[vertex * 3 + 2] += nz;
    }
    for (const [first, second] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = edgeKeyOf(first, second);
      const edge = edgeCounts.get(key);
      if (edge) edge.count += 1;
      else edgeCounts.set(key, { count: 1, first, second });
    }
  }

  const boundary = [...edgeCounts.values()].filter((edge) => edge.count === 1);
  if ([...edgeCounts.values()].some((edge) => edge.count > 2)) {
    throw new Error("El borde de la zona está ramificado y no se puede cerrar");
  }
  const outgoing = new Uint32Array(vertexCount);
  const incoming = new Uint32Array(vertexCount);
  for (const edge of boundary) {
    outgoing[edge.first] += 1;
    incoming[edge.second] += 1;
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (outgoing[vertex] !== incoming[vertex]) {
      throw new Error("El borde de la zona no forma contornos cerrados");
    }
    if (outgoing[vertex] > 1 || incoming[vertex] > 1) {
      throw new Error(
        "El borde de la zona está ramificado y no se puede cerrar"
      );
    }
  }

  const allVertices = new Float32Array(vertexCount * 6);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const x = patch.vertices[vertex * 3];
    const y = patch.vertices[vertex * 3 + 1];
    const z = patch.vertices[vertex * 3 + 2];
    const nx = normalSums[vertex * 3];
    const ny = normalSums[vertex * 3 + 1];
    const nz = normalSums[vertex * 3 + 2];
    const length = Math.hypot(nx, ny, nz);
    if (length <= 1e-10) {
      throw new Error("No se pudo calcular la normal de una cara seleccionada");
    }
    const offset = vertexCount * 3 + vertex * 3;
    allVertices[vertex * 3] = x;
    allVertices[vertex * 3 + 1] = y;
    allVertices[vertex * 3 + 2] = z;
    allVertices[offset] = x - (nx / length) * depth;
    allVertices[offset + 1] = y - (ny / length) * depth;
    allVertices[offset + 2] = z - (nz / length) * depth;
  }

  const triangles: number[] = [];
  const innerOffset = vertexCount;
  for (let face = 0; face < faceCount; face += 1) {
    const a = patch.faces[face * 3];
    const b = patch.faces[face * 3 + 1];
    const c = patch.faces[face * 3 + 2];
    triangles.push(a, b, c, a + innerOffset, c + innerOffset, b + innerOffset);
  }
  for (const edge of boundary) {
    const a = edge.first;
    const b = edge.second;
    triangles.push(a, a + innerOffset, b + innerOffset, a, b + innerOffset, b);
  }

  let cutter: Manifold;
  try {
    cutter = wasm.Manifold.ofMesh(
      new wasm.Mesh({
        numProp: 3,
        vertProperties: allVertices,
        triVerts: new Uint32Array(triangles),
      })
    );
  } catch {
    throw new Error(
      "La profundidad genera una superficie inválida. Reducila o seleccioná una zona más simple."
    );
  }
  if (cutter.status() !== "NoError" || cutter.volume() <= 1e-9) {
    cutter.delete();
    throw new Error(
      "No se pudo cerrar la zona seleccionada. Reducí la profundidad o revisá el contorno."
    );
  }
  return cutter;
}

function surfaceBoundaryLoops(patch: SurfacePatch): number[][] {
  const vertexCount = patch.vertices.length / 3;
  const faceCount = patch.faces.length / 3;
  if (
    vertexCount < 3 ||
    patch.vertices.length % 3 !== 0 ||
    faceCount < 1 ||
    patch.faces.length % 3 !== 0 ||
    patch.vertices.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("La zona no contiene una superficie válida");
  }

  const edges = new Map<
    string,
    { count: number; first: number; second: number }
  >();
  const keyOf = (first: number, second: number) =>
    first < second ? `${first}:${second}` : `${second}:${first}`;

  for (let face = 0; face < faceCount; face += 1) {
    const a = patch.faces[face * 3];
    const b = patch.faces[face * 3 + 1];
    const c = patch.faces[face * 3 + 2];
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      a >= vertexCount ||
      b >= vertexCount ||
      c >= vertexCount ||
      a < 0 ||
      b < 0 ||
      c < 0 ||
      a === b ||
      b === c ||
      c === a
    ) {
      throw new Error("La selección contiene triángulos inválidos");
    }
    const ax = patch.vertices[a * 3];
    const ay = patch.vertices[a * 3 + 1];
    const az = patch.vertices[a * 3 + 2];
    const ab = [
      patch.vertices[b * 3] - ax,
      patch.vertices[b * 3 + 1] - ay,
      patch.vertices[b * 3 + 2] - az,
    ];
    const ac = [
      patch.vertices[c * 3] - ax,
      patch.vertices[c * 3 + 1] - ay,
      patch.vertices[c * 3 + 2] - az,
    ];
    if (
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      ) <= 1e-10
    ) {
      throw new Error("La selección contiene una cara degenerada");
    }
    for (const [first, second] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = keyOf(first, second);
      const edge = edges.get(key);
      if (edge) edge.count += 1;
      else edges.set(key, { count: 1, first, second });
    }
  }

  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  if ([...edges.values()].some((edge) => edge.count > 2)) {
    throw new Error("La selección no es una superficie manifold");
  }
  if (boundary.length === 0) {
    throw new Error(
      "La pieza completa necesita un contorno abierto. Cambiá a cáscara superficial para una selección cerrada."
    );
  }

  const nextVertex = new Map<number, number>();
  const incoming = new Set<number>();
  for (const edge of boundary) {
    if (nextVertex.has(edge.first) || incoming.has(edge.second)) {
      throw new Error("El contorno se cruza o se ramifica en un vértice");
    }
    nextVertex.set(edge.first, edge.second);
    incoming.add(edge.second);
  }
  for (const vertex of nextVertex.keys()) {
    if (!incoming.has(vertex)) {
      throw new Error("El contorno de la selección no está cerrado");
    }
  }
  for (const vertex of incoming) {
    if (!nextVertex.has(vertex)) {
      throw new Error("El contorno de la selección no está cerrado");
    }
  }

  const visited = new Set<number>();
  const loops: number[][] = [];
  for (const start of nextVertex.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(current);
      const next = nextVertex.get(current);
      if (next === undefined) {
        throw new Error("El contorno de la selección no está cerrado");
      }
      current = next;
    }
    if (current !== start || loop.length < 3) {
      throw new Error("El contorno de la selección no está cerrado");
    }
    loops.push(loop);
  }
  return loops;
}

function surfaceBoundaryPlane(patch: SurfacePatch): {
  normal: [number, number, number];
  offset: number;
} {
  const loops = surfaceBoundaryLoops(patch);
  const vertex = (index: number): [number, number, number] => [
    patch.vertices[index * 3],
    patch.vertices[index * 3 + 1],
    patch.vertices[index * 3 + 2],
  ];
  const loopNormal = (loop: number[]) => {
    const normal: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < loop.length; index += 1) {
      const current = vertex(loop[index]);
      const next = vertex(loop[(index + 1) % loop.length]);
      normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
      normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
      normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
    }
    return normal;
  };
  const referenceLoop = loops.reduce((largest, loop) =>
    Math.hypot(...loopNormal(loop)) > Math.hypot(...loopNormal(largest))
      ? loop
      : largest
  );
  const normal = loopNormal(referenceLoop);
  const length = Math.hypot(...normal);
  if (length <= 1e-10) {
    throw new Error("No se pudo orientar el corte plano desde el contorno");
  }
  const origin: [number, number, number] = [0, 0, 0];
  for (const index of referenceLoop) {
    const point = vertex(index);
    origin[0] += point[0] / referenceLoop.length;
    origin[1] += point[1] / referenceLoop.length;
    origin[2] += point[2] / referenceLoop.length;
  }
  const center: [number, number, number] = [0, 0, 0];
  const vertexCount = patch.vertices.length / 3;
  for (let index = 0; index < vertexCount; index += 1) {
    center[0] += patch.vertices[index * 3] / vertexCount;
    center[1] += patch.vertices[index * 3 + 1] / vertexCount;
    center[2] += patch.vertices[index * 3 + 2] / vertexCount;
  }
  const side =
    (center[0] - origin[0]) * normal[0] +
    (center[1] - origin[1]) * normal[1] +
    (center[2] - origin[2]) * normal[2];
  const sign = side >= 0 ? 1 : -1;
  const unitNormal = normal.map((value) => (value * sign) / length) as [
    number,
    number,
    number,
  ];
  return {
    normal: unitNormal,
    offset:
      unitNormal[0] * origin[0] +
      unitNormal[1] * origin[1] +
      unitNormal[2] * origin[2],
  };
}

function buildSurfacePieceCutter(
  wasm: ManifoldToplevel,
  patch: SurfacePatch,
  capMode: SurfaceCapMode
): Manifold {
  const loops = surfaceBoundaryLoops(patch);
  const vertex = (index: number): [number, number, number] => [
    patch.vertices[index * 3],
    patch.vertices[index * 3 + 1],
    patch.vertices[index * 3 + 2],
  ];
  const loopNormal = (loop: number[]) => {
    const normal: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < loop.length; index += 1) {
      const current = vertex(loop[index]);
      const next = vertex(loop[(index + 1) % loop.length]);
      normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
      normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
      normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
    }
    return normal;
  };
  const referenceLoop = loops.reduce((largest, loop) =>
    Math.hypot(...loopNormal(loop)) > Math.hypot(...loopNormal(largest))
      ? loop
      : largest
  );
  const normal = loopNormal(referenceLoop);
  const normalLength = Math.hypot(...normal);
  if (normalLength <= 1e-10) {
    throw new Error("No se pudo orientar el contorno de la selección");
  }
  const zAxis = normal.map((value) => value / normalLength) as [
    number,
    number,
    number,
  ];
  const origin: [number, number, number] = [0, 0, 0];
  for (const index of referenceLoop) {
    const point = vertex(index);
    origin[0] += point[0] / referenceLoop.length;
    origin[1] += point[1] / referenceLoop.length;
    origin[2] += point[2] / referenceLoop.length;
  }
  let xAxis: [number, number, number] | null = null;
  for (let index = 0; index < referenceLoop.length; index += 1) {
    const start = vertex(referenceLoop[index]);
    const end = vertex(referenceLoop[(index + 1) % referenceLoop.length]);
    const edge = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
    const projection = edge[0] * zAxis[0] + edge[1] * zAxis[1] + edge[2] * zAxis[2];
    const planar = [
      edge[0] - projection * zAxis[0],
      edge[1] - projection * zAxis[1],
      edge[2] - projection * zAxis[2],
    ];
    const length = Math.hypot(...planar);
    if (length > 1e-10) {
      xAxis = planar.map((value) => value / length) as [number, number, number];
      break;
    }
  }
  if (!xAxis) {
    throw new Error("No se pudo orientar la tapa del corte");
  }
  const yAxis: [number, number, number] = [
    zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
    zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
    zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0],
  ];
  const projected = loops.map((loop) =>
    loop.map((index) => {
      const point = vertex(index);
      const relative = [
        point[0] - origin[0],
        point[1] - origin[1],
        point[2] - origin[2],
      ];
      return [
        relative[0] * xAxis[0] + relative[1] * xAxis[1] + relative[2] * xAxis[2],
        relative[0] * yAxis[0] + relative[1] * yAxis[1] + relative[2] * yAxis[2],
      ] as [number, number];
    })
  );
  const capTriangles = wasm.triangulate(projected);
  if (capTriangles.length === 0) {
    throw new Error("No se pudo cerrar la zona: revisá el contorno pintado");
  }
  const boundaryIndices = loops.flat();
  const flattenedProjection = projected.flat();
  const vertexCount = patch.vertices.length / 3;
  const capIndexByBoundary = new Map(
    boundaryIndices.map((vertexIndex, index) => [vertexIndex, vertexCount + index])
  );
  const vertices = new Float32Array(
    patch.vertices.length +
      (capMode === "planar" ? boundaryIndices.length * 3 : 0)
  );
  vertices.set(patch.vertices);
  if (capMode === "planar") {
    boundaryIndices.forEach((_, index) => {
      const [x, y] = flattenedProjection[index];
      const offset = patch.vertices.length + index * 3;
      vertices[offset] = origin[0] + xAxis[0] * x + yAxis[0] * y;
      vertices[offset + 1] = origin[1] + xAxis[1] * x + yAxis[1] * y;
      vertices[offset + 2] = origin[2] + xAxis[2] * x + yAxis[2] * y;
    });
  }

  const faces = Array.from(patch.faces);
  if (capMode === "planar") {
    let boundaryOffset = 0;
    for (const loop of loops) {
      for (let index = 0; index < loop.length; index += 1) {
        const a = loop[index];
        const b = loop[(index + 1) % loop.length];
        const capA = vertexCount + boundaryOffset + index;
        const capB =
          vertexCount + boundaryOffset + ((index + 1) % loop.length);
        faces.push(a, capA, capB, a, capB, b);
      }
      boundaryOffset += loop.length;
    }
  }
  for (const triangle of capTriangles) {
    const [boundaryA, boundaryB, boundaryC] = triangle.map(
      (index) => boundaryIndices[index]
    );
    const a =
      capMode === "planar"
        ? capIndexByBoundary.get(boundaryA)
        : boundaryA;
    const b =
      capMode === "planar"
        ? capIndexByBoundary.get(boundaryB)
        : boundaryB;
    const c =
      capMode === "planar"
        ? capIndexByBoundary.get(boundaryC)
        : boundaryC;
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      a === b ||
      b === c ||
      c === a
    ) {
      throw new Error("El contorno no pudo triangularse como una tapa válida");
    }
    faces.push(a, c, b);
  }

  let cutter: Manifold;
  try {
    cutter = wasm.Manifold.ofMesh(
      new wasm.Mesh({
        numProp: 3,
        vertProperties: vertices,
        triVerts: new Uint32Array(faces),
      })
    );
  } catch {
    throw new Error(
      "No se pudo cerrar la pieza por ese contorno. Ajustá la selección para evitar cruces."
    );
  }
  if (cutter.status() !== "NoError" || cutter.volume() <= 1e-9) {
    cutter.delete();
    throw new Error(
      "El contorno no forma una pieza cerrada. Ajustá la selección o usá un corte recto."
    );
  }
  return cutter;
}

function splitSurfacePatchComponents(patch: SurfacePatch): SurfacePatch[] {
  const faceCount = patch.faces.length / 3;
  const parent = Int32Array.from({ length: faceCount }, (_, face) => face);
  const find = (face: number): number => {
    let root = face;
    while (parent[root] !== root) root = parent[root];
    while (parent[face] !== face) {
      const next = parent[face];
      parent[face] = root;
      face = next;
    }
    return root;
  };
  const union = (first: number, second: number) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot;
  };
  const vertexCount = patch.vertices.length / 3;
  const firstFaceByEdge = new Map<number, number>();
  const edgeKeyOf = (first: number, second: number) =>
    first < second
      ? first * vertexCount + second
      : second * vertexCount + first;
  for (let face = 0; face < faceCount; face += 1) {
    const a = patch.faces[face * 3];
    const b = patch.faces[face * 3 + 1];
    const c = patch.faces[face * 3 + 2];
    for (const [first, second] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = edgeKeyOf(first, second);
      const neighbor = firstFaceByEdge.get(key);
      if (neighbor === undefined) firstFaceByEdge.set(key, face);
      else union(face, neighbor);
    }
  }

  const grouped = new Map<number, number[]>();
  for (let face = 0; face < faceCount; face += 1) {
    const root = find(face);
    const faces = grouped.get(root);
    if (faces) faces.push(face);
    else grouped.set(root, [face]);
  }
  if (grouped.size <= 1) return [patch];

  return [...grouped.values()].map((componentFaces) => {
    const remap = new Map<number, number>();
    const vertices: number[] = [];
    const faces: number[] = [];
    for (const face of componentFaces) {
      for (let corner = 0; corner < 3; corner += 1) {
        const source = patch.faces[face * 3 + corner];
        let target = remap.get(source);
        if (target === undefined) {
          target = remap.size;
          remap.set(source, target);
          vertices.push(
            patch.vertices[source * 3],
            patch.vertices[source * 3 + 1],
            patch.vertices[source * 3 + 2]
          );
        }
        faces.push(target);
      }
    }
    return { vertices, faces };
  });
}

interface SurfaceFrame {
  center: [number, number, number];
  outward: [number, number, number];
  xAxis: [number, number, number];
  yAxis: [number, number, number];
  boundary: Array<[[number, number, number], [number, number, number]]>;
}

function surfaceFrame(
  patch: SurfacePatch,
  mode: SurfaceCutMode = "shell"
): SurfaceFrame {
  const faceCount = patch.faces.length / 3;
  let areaSum = 0;
  const center: [number, number, number] = [0, 0, 0];
  const normal: [number, number, number] = [0, 0, 0];
  const edges = new Map<
    string,
    { count: number; first: number; second: number }
  >();
  const edgeKeyOf = (a: number, b: number) =>
    a < b ? `${a}:${b}` : `${b}:${a}`;
  for (let face = 0; face < faceCount; face += 1) {
    const ids = [
      patch.faces[face * 3],
      patch.faces[face * 3 + 1],
      patch.faces[face * 3 + 2],
    ];
    const points = ids.map(
      (id) =>
        [
          patch.vertices[id * 3],
          patch.vertices[id * 3 + 1],
          patch.vertices[id * 3 + 2],
        ] as [number, number, number]
    );
    const [a, b, c] = points;
    const ab: [number, number, number] = [
      b[0] - a[0],
      b[1] - a[1],
      b[2] - a[2],
    ];
    const ac: [number, number, number] = [
      c[0] - a[0],
      c[1] - a[1],
      c[2] - a[2],
    ];
    const faceNormal: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const twiceArea = Math.hypot(...faceNormal);
    areaSum += twiceArea / 2;
    for (let axis = 0; axis < 3; axis += 1) {
      center[axis] += ((a[axis] + b[axis] + c[axis]) / 3) * (twiceArea / 2);
      normal[axis] += faceNormal[axis];
    }
    for (const [first, second] of [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[2], ids[0]],
    ] as const) {
      const key = edgeKeyOf(first, second);
      const edge = edges.get(key);
      if (edge) edge.count += 1;
      else edges.set(key, { count: 1, first, second });
    }
  }
  if (mode === "piece") {
    const loops = surfaceBoundaryLoops(patch);
    const polygonNormal = (loop: number[]) => {
      const result: [number, number, number] = [0, 0, 0];
      for (let index = 0; index < loop.length; index += 1) {
        const first = loop[index];
        const second = loop[(index + 1) % loop.length];
        const a: [number, number, number] = [
          patch.vertices[first * 3],
          patch.vertices[first * 3 + 1],
          patch.vertices[first * 3 + 2],
        ];
        const b: [number, number, number] = [
          patch.vertices[second * 3],
          patch.vertices[second * 3 + 1],
          patch.vertices[second * 3 + 2],
        ];
        result[0] += (a[1] - b[1]) * (a[2] + b[2]);
        result[1] += (a[2] - b[2]) * (a[0] + b[0]);
        result[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      return result;
    };
    const outer = loops.reduce((largest, loop) =>
      Math.hypot(...polygonNormal(loop)) > Math.hypot(...polygonNormal(largest))
        ? loop
        : largest
    );
    const boundaryNormal = polygonNormal(outer);
    if (Math.hypot(...boundaryNormal) <= 1e-9) {
      throw new Error("No se pudo orientar el encastre sobre el contorno");
    }
    normal[0] = boundaryNormal[0];
    normal[1] = boundaryNormal[1];
    normal[2] = boundaryNormal[2];
    center[0] = 0;
    center[1] = 0;
    center[2] = 0;
    for (const vertex of outer) {
      center[0] += patch.vertices[vertex * 3];
      center[1] += patch.vertices[vertex * 3 + 1];
      center[2] += patch.vertices[vertex * 3 + 2];
    }
    center[0] /= outer.length;
    center[1] /= outer.length;
    center[2] /= outer.length;
    areaSum = 1;
  }
  const normalLength = Math.hypot(...normal);
  if (areaSum <= 1e-9 || normalLength <= 1e-9) {
    throw new Error("No se pudo determinar la orientación del encastre");
  }
  for (let axis = 0; axis < 3; axis += 1) center[axis] /= areaSum;
  const outward = normal.map((value) => value / normalLength) as [
    number,
    number,
    number,
  ];
  const direction: [number, number, number] = [
    -outward[0],
    -outward[1],
    -outward[2],
  ];
  const reference: [number, number, number] =
    Math.abs(direction[2]) < 0.85 ? [0, 0, 1] : [0, 1, 0];
  const cross: [number, number, number] = [
    reference[1] * direction[2] - reference[2] * direction[1],
    reference[2] * direction[0] - reference[0] * direction[2],
    reference[0] * direction[1] - reference[1] * direction[0],
  ];
  const crossLength = Math.hypot(...cross);
  const xAxis = cross.map((value) => value / crossLength) as [
    number,
    number,
    number,
  ];
  const yAxis: [number, number, number] = [
    direction[1] * xAxis[2] - direction[2] * xAxis[1],
    direction[2] * xAxis[0] - direction[0] * xAxis[2],
    direction[0] * xAxis[1] - direction[1] * xAxis[0],
  ];
  const boundary = [...edges.values()]
    .filter((edge) => edge.count === 1)
    .map(
      (edge) =>
        [
          [
            patch.vertices[edge.first * 3],
            patch.vertices[edge.first * 3 + 1],
            patch.vertices[edge.first * 3 + 2],
          ],
          [
            patch.vertices[edge.second * 3],
            patch.vertices[edge.second * 3 + 1],
            patch.vertices[edge.second * 3 + 2],
          ],
        ] as [[number, number, number], [number, number, number]]
    );
  return { center, outward, xAxis, yAxis, boundary };
}

function distanceToSegment2d(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 1e-12
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
              lengthSquared
          )
        );
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy);
}

function resolveManualSurfaceAnchors(
  patch: SurfacePatch,
  positions: [number, number, number][],
  frame: SurfaceFrame,
  edgeMargin: number,
  minimumSpacing: number
): [number, number][] | null {
  const project = (point: [number, number, number]): [number, number] => {
    const relative: [number, number, number] = [
      point[0] - frame.center[0],
      point[1] - frame.center[1],
      point[2] - frame.center[2],
    ];
    return [
      relative[0] * frame.xAxis[0] +
        relative[1] * frame.xAxis[1] +
        relative[2] * frame.xAxis[2],
      relative[0] * frame.yAxis[0] +
        relative[1] * frame.yAxis[1] +
        relative[2] * frame.yAxis[2],
    ];
  };
  const loops = surfaceBoundaryLoops(patch).map((loop) =>
    loop.map((vertex) =>
      project([
        patch.vertices[vertex * 3],
        patch.vertices[vertex * 3 + 1],
        patch.vertices[vertex * 3 + 2],
      ])
    )
  );
  const contains = (point: [number, number], loop: [number, number][]) => {
    let inside = false;
    for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index, index += 1) {
      const [x, y] = loop[index];
      const [previousX, previousY] = loop[previous];
      if ((y > point[1]) !== (previousY > point[1])) {
        const crossingX =
          ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
        if (point[0] < crossingX) inside = !inside;
      }
    }
    return inside;
  };
  const distanceToSegment = (
    point: [number, number],
    start: [number, number],
    end: [number, number]
  ) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-12) {
      return Math.hypot(point[0] - start[0], point[1] - start[1]);
    }
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
          lengthSquared
      )
    );
    return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
  };

  const anchors: [number, number][] = [];
  for (const position of positions) {
    if (
      position.length !== 3 ||
      position.some((coordinate) => !Number.isFinite(coordinate))
    ) {
      return null;
    }
    const relative: [number, number, number] = [
      position[0] - frame.center[0],
      position[1] - frame.center[1],
      position[2] - frame.center[2],
    ];
    const planeDistance =
      relative[0] * frame.outward[0] +
      relative[1] * frame.outward[1] +
      relative[2] * frame.outward[2];
    if (Math.abs(planeDistance) > 0.2) return null;

    const anchor = project(position);
    const inside = loops.reduce(
      (isInside, loop) => (contains(anchor, loop) ? !isInside : isInside),
      false
    );
    const edgeDistance = loops.reduce(
      (closest, loop) =>
        Math.min(
          closest,
          ...loop.map((start, index) =>
            distanceToSegment(anchor, start, loop[(index + 1) % loop.length])
          )
        ),
      Number.POSITIVE_INFINITY
    );
    if (!inside || edgeDistance < edgeMargin) return null;
    if (
      anchors.some(
        ([x, y]) => Math.hypot(anchor[0] - x, anchor[1] - y) < minimumSpacing
      )
    ) {
      return null;
    }
    anchors.push(anchor);
  }
  return anchors;
}

function applySurfaceJoint(
  wasm: ManifoldToplevel,
  extracted: Manifold,
  remainder: Manifold,
  op: Extract<CutSpec, { kind: "surface" }>
): [Manifold, Manifold] {
  const joint = op.joint;
  if (!joint) return [extracted, remainder];
  if (
    !Number.isFinite(joint.diameter) ||
    !Number.isFinite(joint.length) ||
    !Number.isFinite(joint.clearance) ||
    joint.diameter <= 0 ||
    joint.length <= 0 ||
    joint.clearance < 0
  ) {
    extracted.delete();
    remainder.delete();
    throw new Error("Las medidas del encastre deben ser válidas");
  }

  let frame: SurfaceFrame;
  try {
    frame = surfaceFrame(op.patch, op.mode ?? "shell");
  } catch (error) {
    extracted.delete();
    remainder.delete();
    throw error;
  }
  const manual = joint.distribution === "manual";
  if (manual && !joint.positions?.length) {
    return [extracted, remainder];
  }
  if (manual && !(op.mode === "piece" && op.capMode === "planar")) {
    extracted.delete();
    remainder.delete();
    throw new Error(
      "La colocación manual solo está disponible en cortes superficiales con tapa plana"
    );
  }
  const requested = Math.max(1, Math.min(4, Math.round(joint.count ?? 1)));
  const halfWidth = joint.diameter / 2;
  const xValues = op.patch.vertices.filter((_, index) => index % 3 === 0);
  const yValues = op.patch.vertices.filter((_, index) => index % 3 === 1);
  const zValues = op.patch.vertices.filter((_, index) => index % 3 === 2);
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < xValues.length; vertex += 1) {
    const relative: [number, number, number] = [
      xValues[vertex] - frame.center[0],
      yValues[vertex] - frame.center[1],
      zValues[vertex] - frame.center[2],
    ];
    const projection =
      relative[0] * frame.xAxis[0] +
      relative[1] * frame.xAxis[1] +
      relative[2] * frame.xAxis[2];
    minimum = Math.min(minimum, projection);
    maximum = Math.max(maximum, projection);
  }
  const edgeMargin = halfWidth + 0.75;
  const low = minimum + edgeMargin;
  const high = maximum - edgeMargin;
  if (
    !manual &&
    high < low ||
    (!manual &&
      requested > 1 &&
      high - low < (requested - 1) * (joint.diameter + 1))
  ) {
    extracted.delete();
    remainder.delete();
    throw new Error(
      "El encastre no cabe dentro de la zona seleccionada; reducí diámetro o cantidad"
    );
  }
  const count = requested;
  const centers = Array.from({ length: count }, (_, index) =>
    count === 1 ? (low + high) / 2 : low + ((high - low) * index) / (count - 1)
  );
  for (const alongX of manual ? [] : centers) {
    const point = [
      frame.center[0] + frame.xAxis[0] * alongX,
      frame.center[1] + frame.xAxis[1] * alongX,
      frame.center[2] + frame.xAxis[2] * alongX,
    ] as [number, number, number];
    const clearanceFromEdge = frame.boundary.reduce((minimumDistance, edge) => {
      const project = (vertex: [number, number, number]): [number, number] => {
        const relative: [number, number, number] = [
          vertex[0] - frame.center[0],
          vertex[1] - frame.center[1],
          vertex[2] - frame.center[2],
        ];
        return [
          relative[0] * frame.xAxis[0] +
            relative[1] * frame.xAxis[1] +
            relative[2] * frame.xAxis[2],
          relative[0] * frame.yAxis[0] +
            relative[1] * frame.yAxis[1] +
            relative[2] * frame.yAxis[2],
        ];
      };
      const center2d: [number, number] = [
        (point[0] - frame.center[0]) * frame.xAxis[0] +
          (point[1] - frame.center[1]) * frame.xAxis[1] +
          (point[2] - frame.center[2]) * frame.xAxis[2],
        (point[0] - frame.center[0]) * frame.yAxis[0] +
          (point[1] - frame.center[1]) * frame.yAxis[1] +
          (point[2] - frame.center[2]) * frame.yAxis[2],
      ];
      return Math.min(
        minimumDistance,
        distanceToSegment2d(center2d, project(edge[0]), project(edge[1]))
      );
    }, Number.POSITIVE_INFINITY);
    if (clearanceFromEdge < edgeMargin) {
      extracted.delete();
      remainder.delete();
      throw new Error(
        "El encastre queda demasiado cerca del borde; reducí diámetro o cantidad"
      );
    }
  }
  const manualLocations = manual
    ? resolveManualSurfaceAnchors(
        op.patch,
        joint.positions ?? [],
        frame,
        edgeMargin,
        joint.diameter + joint.clearance * 2 + 1
      )
    : null;
  if (manual && !manualLocations) {
    extracted.delete();
    remainder.delete();
    throw new Error(
      "La posición manual del conector está fuera de la superficie útil, fuera del plano o demasiado cerca del borde"
    );
  }
  const locations: readonly [number, number][] = manual
    ? manualLocations!
    : centers.map((center) => [center, 0] as const);

  const direction: [number, number, number] = [
    -frame.outward[0],
    -frame.outward[1],
    -frame.outward[2],
  ];
  const base: [number, number, number] =
    op.mode === "piece"
      ? [...frame.center]
      : [
          frame.center[0] - frame.outward[0] * op.depth,
          frame.center[1] - frame.outward[1] * op.depth,
          frame.center[2] - frame.outward[2] * op.depth,
        ];
  const crossAxis: [number, number, number] = [
    direction[1] * frame.xAxis[2] - direction[2] * frame.xAxis[1],
    direction[2] * frame.xAxis[0] - direction[0] * frame.xAxis[2],
    direction[0] * frame.xAxis[1] - direction[1] * frame.xAxis[0],
  ];
  const dovetailCrossAxis: [number, number, number] = [
    frame.xAxis[1] * direction[2] - frame.xAxis[2] * direction[1],
    frame.xAxis[2] * direction[0] - frame.xAxis[0] * direction[2],
    frame.xAxis[0] * direction[1] - frame.xAxis[1] * direction[0],
  ];
  const overlap = Math.min(0.25, joint.length * 0.1);
  const cylinder = (
    radius: number,
    length: number,
    centerAlong: number,
    alongX = 0,
    alongY = 0
  ) => {
    const solid = wasm.Manifold.cylinder(length, radius, radius, 32, true);
    const center: [number, number, number] = [
      base[0] + direction[0] * centerAlong,
      base[1] + direction[1] * centerAlong,
      base[2] + direction[2] * centerAlong,
    ];
    center[0] += frame.xAxis[0] * alongX + frame.yAxis[0] * alongY;
    center[1] += frame.xAxis[1] * alongX + frame.yAxis[1] * alongY;
    center[2] += frame.xAxis[2] * alongX + frame.yAxis[2] * alongY;
    const placed = solid.transform(
      affineMatrix(frame.xAxis, crossAxis, direction, center)
    );
    solid.delete();
    return placed;
  };
  const polygonSolid = (
    baseWidth: number,
    tipWidth: number,
    length: number,
    clearance: number
  ) => {
    const section = wasm.CrossSection.ofPolygons([
      ccw([
        [-baseWidth / 2 - clearance, -overlap],
        [baseWidth / 2 + clearance, -overlap],
        [tipWidth / 2 + clearance, length],
        [-tipWidth / 2 - clearance, length],
      ]),
    ]);
    const extruded = section.extrude(
      Math.max(1, joint.diameter * 0.45 + clearance * 2),
      0,
      0,
      [1, 1],
      true
    );
    section.delete();
    const placed = extruded.transform(
      affineMatrix(frame.xAxis, direction, dovetailCrossAxis, base)
    );
    extruded.delete();
    return placed;
  };

  let nextExtracted = extracted;
  let nextRemainder = remainder;
  let ownsExtracted = false;
  let ownsRemainder = false;
  try {
  for (const [alongX, alongY] of locations) {
    const tangentOffset: [number, number, number] = [
      frame.xAxis[0] * alongX + frame.yAxis[0] * alongY,
      frame.xAxis[1] * alongX + frame.yAxis[1] * alongY,
      frame.xAxis[2] * alongX + frame.yAxis[2] * alongY,
    ];
    const localBase: [number, number, number] = [
      base[0] + tangentOffset[0],
      base[1] + tangentOffset[1],
      base[2] + tangentOffset[2],
    ];
      if (joint.variant === "magnet") {
        const pocketRadius = joint.diameter / 2 + joint.clearance;
const selectedPocket = cylinder(
  pocketRadius,
  joint.length + 0.2,
  -joint.length / 2,
  alongX,
  alongY
);
const remainderPocket = cylinder(
  pocketRadius,
  joint.length + 0.2,
  joint.length / 2,
  alongX,
  alongY
);
        const nextSelected = nextExtracted.subtract(selectedPocket);
        const nextRemainderPart = nextRemainder.subtract(remainderPocket);
        selectedPocket.delete();
        remainderPocket.delete();
        if (
          nextSelected.status() !== "NoError" ||
          nextRemainderPart.status() !== "NoError" ||
          nextSelected.volume() <= 1e-9 ||
          nextRemainderPart.volume() <= 1e-9
        ) {
          nextSelected.delete();
          nextRemainderPart.delete();
          throw new Error(
            "No se pudieron crear los dos alojamientos para imanes; reducÍ el diámetro o la profundidad"
          );
        }
        if (ownsExtracted) nextExtracted.delete();
        if (ownsRemainder) nextRemainder.delete();
        nextExtracted = nextSelected;
        nextRemainder = nextRemainderPart;
        ownsExtracted = true;
        ownsRemainder = true;
        continue;
      }

      let peg: Manifold;
      let cavity: Manifold;
      if (joint.variant === "dovetail") {
        peg = polygonSolid(
          joint.diameter * 0.66,
          joint.diameter,
          joint.length,
          0
        );
        cavity = polygonSolid(
          joint.diameter * 0.66,
          joint.diameter,
          joint.length + joint.clearance * 2,
          joint.clearance
        );
        const translatedPeg = peg.translate(tangentOffset);
        peg.delete();
        peg = translatedPeg;
        const translatedCavity = cavity.translate(tangentOffset);
        cavity.delete();
        cavity = translatedCavity;
      } else {
        const pegBase = cylinder(
          joint.diameter / 2,
          joint.length + overlap,
          (joint.length - overlap) / 2
        );
    peg = pegBase.translate(tangentOffset);
        pegBase.delete();
        const cavityBase = cylinder(
          joint.diameter / 2 + joint.clearance,
          joint.length + overlap + joint.clearance * 2,
          (joint.length + joint.clearance - overlap) / 2
        );
    cavity = cavityBase.translate(tangentOffset);
        cavityBase.delete();
        if (joint.variant === "keyed") {
          const makeKey = (clearance: number) => {
            const size: [number, number, number] = [
              joint.diameter * 3.2 + clearance * 2,
              joint.diameter * 1.1 + clearance * 2,
              joint.length + overlap,
            ];
            const key = wasm.Manifold.cube(size, true);
            const center: [number, number, number] = [
              localBase[0] + direction[0] * ((joint.length - overlap) / 2),
              localBase[1] + direction[1] * ((joint.length - overlap) / 2),
              localBase[2] + direction[2] * ((joint.length - overlap) / 2),
            ];
            const placed = key.transform(
              affineMatrix(frame.xAxis, crossAxis, direction, center)
            );
            key.delete();
            return placed;
          };
          const pegKey = makeKey(0);
          const nextPeg = peg.add(pegKey);
          peg.delete();
          pegKey.delete();
          peg = nextPeg;
          const holeKey = makeKey(joint.clearance);
          const nextCavity = cavity.add(holeKey);
          cavity.delete();
          holeKey.delete();
          cavity = nextCavity;
        }
      }

      const nextUnion = nextExtracted.add(peg);
      const nextDifference = nextRemainder.subtract(cavity);
      peg.delete();
      cavity.delete();
      if (
        nextUnion.status() !== "NoError" ||
        nextDifference.status() !== "NoError" ||
        nextUnion.volume() <= 1e-9 ||
        nextDifference.volume() <= 1e-9
      ) {
        nextUnion.delete();
        nextDifference.delete();
        throw new Error(
          "El motor no pudo formar un encastre cerrado para la zona"
        );
      }
      if (ownsExtracted) nextExtracted.delete();
      if (ownsRemainder) nextRemainder.delete();
      nextExtracted = nextUnion;
      nextRemainder = nextDifference;
      ownsExtracted = true;
      ownsRemainder = true;
    }
    if (ownsExtracted && ownsRemainder) {
      extracted.delete();
      remainder.delete();
    }
    return [nextExtracted, nextRemainder];
  } catch (error) {
    if (ownsExtracted) nextExtracted.delete();
    if (ownsRemainder) nextRemainder.delete();
    extracted.delete();
    remainder.delete();
    throw error;
  }
}

function resolveManualPlaneAnchors(
  positions: [number, number, number][],
  spreadAxis: number,
  crossAxis: number,
  spreadMinimum: number,
  spreadMaximum: number,
  crossMinimum: number,
  crossMaximum: number,
  spreadMargin: number,
  crossMargin: number,
  minimumSpacing: number
): [number, number][] | null {
  const anchors: [number, number][] = [];
  for (const position of positions) {
    if (
      position.length !== 3 ||
      position.some((coordinate) => !Number.isFinite(coordinate))
    ) {
      return null;
    }
    const spread = position[spreadAxis];
    const cross = position[crossAxis];
    if (
      spread === undefined ||
      cross === undefined ||
      spread < spreadMinimum + spreadMargin ||
      spread > spreadMaximum - spreadMargin ||
      cross < crossMinimum + crossMargin ||
      cross > crossMaximum - crossMargin
    ) {
      return null;
    }
    if (
      anchors.some(
        ([existingSpread, existingCross]) =>
          Math.hypot(spread - existingSpread, cross - existingCross) <
          minimumSpacing
      )
    ) {
      return null;
    }
    anchors.push([spread, cross]);
  }
  return anchors;
}

function applyPlaneJoint(
  wasm: ManifoldToplevel,
  positive: Manifold,
  negative: Manifold,
  spec: Extract<CutSpec, { kind: "plane" }>
): [Manifold, Manifold] | null {
  const joint = spec.joint;
  if (!joint) return null;
  if (joint.distribution === "manual" && !joint.positions?.length) {
    return [positive, negative];
  }
  const axis = spec.normal
    .map((value) => Math.abs(value))
    .reduce((best, value, index, all) => (value > all[best] ? index : best), 0);
  if (Math.abs(spec.normal[axis]) < 0.999) return null;
  const otherAxes = [0, 1, 2].filter((index) => index !== axis);
  const positiveBox = positive.boundingBox();
  const negativeBox = negative.boundingBox();
  const overlaps = otherAxes
    .map((index) => ({
      index,
      minimum: Math.max(positiveBox.min[index], negativeBox.min[index]),
      maximum: Math.min(positiveBox.max[index], negativeBox.max[index]),
    }))
    .map((entry) => ({ ...entry, width: entry.maximum - entry.minimum }))
    .sort((left, right) => right.width - left.width);
  if (overlaps[1].width < 2.4) return null;
  const minimumWidth = overlaps[1].width;
  const radius = Math.min(joint.diameter / 2, (minimumWidth - 2.4) / 2);
  if (radius < 1) return null;
  const thickness = Math.min(
    positiveBox.max[axis] - positiveBox.min[axis],
    negativeBox.max[axis] - negativeBox.min[axis]
  );
  const length = Math.min(joint.length, thickness * 0.4, 8);
  if (length < 1.5) return null;

  const spread = overlaps[0];
  const cross = overlaps[1];
  const crossCenter = (cross.minimum + cross.maximum) / 2;
  const direction = spec.normal[axis] >= 0 ? 1 : -1;

  if (joint.variant === "dovetail") {
    const crossThickness = Math.max(1, 2 * radius);
    const availableWidth = spread.width - 2.4;
    const tipWidth = Math.min(joint.diameter * 1.15, availableWidth);
    const baseWidth = tipWidth * 0.66;
    if (tipWidth < 3 || baseWidth < 1.5) return null;
    const edgeWidth = 1.2 + tipWidth / 2;
    const low = spread.minimum + edgeWidth;
    const high = spread.maximum - edgeWidth;
    if (high < low) return null;
    const requested = Math.max(1, Math.min(4, Math.round(joint.count ?? 1)));
    const capacity = Math.max(
      1,
      Math.floor((high - low) / (tipWidth + 1.2)) + 1
    );
    const count = Math.min(requested, capacity);
    const autoCenters: number[] = [];
    for (let index = 0; index < count; index += 1) {
      autoCenters.push(
        count === 1
          ? (low + high) / 2
          : low + ((high - low) * index) / (count - 1)
      );
    }
    const locations =
      joint.distribution === "manual"
        ? resolveManualPlaneAnchors(
            joint.positions ?? [],
        spread.index,
        cross.index,
        spread.minimum,
        spread.maximum,
            cross.minimum,
            cross.maximum,
            edgeWidth,
            edgeWidth,
            tipWidth + 1.2
          )
        : autoCenters.map((center) => [center, crossCenter] as const);
    if (!locations) return null;
    const overlap = Math.min(1, length * 0.25);
    const inset = Math.max(0.6, joint.clearance);
    const slope = (tipWidth - baseWidth) / 2 / length;
    const cavityHalfBase = baseWidth / 2 - slope * inset + joint.clearance;
    const cavityHalfTip = tipWidth / 2 + slope * inset + joint.clearance;

    const buildPrism = (
      halfBase: number,
      halfTip: number,
      start: number,
      end: number,
      depth: number,
      spreadCenter: number,
      crossCenterForPrism: number
    ): Manifold => {
      const points = ccw([
        [-halfBase, start],
        [halfBase, start],
        [halfTip, end],
        [-halfTip, end],
      ]);
      const section = wasm.CrossSection.ofPolygons([points]);
      const extruded = section.extrude(depth, 0, 0, [1, 1], true);
      section.delete();
      const spreadAxis: [number, number, number] = [0, 0, 0];
      spreadAxis[spread.index] = 1;
      const depthAxis: [number, number, number] = [0, 0, 0];
      depthAxis[axis] = -direction;
      const crossAxis: [number, number, number] = [
        spreadAxis[1] * depthAxis[2] - spreadAxis[2] * depthAxis[1],
        spreadAxis[2] * depthAxis[0] - spreadAxis[0] * depthAxis[2],
        spreadAxis[0] * depthAxis[1] - spreadAxis[1] * depthAxis[0],
      ];
      const origin: [number, number, number] = [0, 0, 0];
      origin[axis] = spec.offset;
      origin[spread.index] = spreadCenter;
      origin[cross.index] = crossCenterForPrism;
      const placed = extruded.transform(
        affineMatrix(spreadAxis, depthAxis, crossAxis, origin)
      );
      extruded.delete();
      return placed;
    };

    let union = positive;
    let drilled = negative;
    let ownsUnion = false;
    let ownsDrilled = false;
    for (const [spreadCenter, crossCoordinate] of locations) {
      const tab = buildPrism(
        baseWidth / 2,
        tipWidth / 2,
        -overlap,
        length,
        crossThickness,
        spreadCenter,
        crossCoordinate
      );
      const nextUnion = union.add(tab);
      tab.delete();
      if (ownsUnion) union.delete();
      if (nextUnion.status() !== "NoError" || nextUnion.volume() <= 0) {
        nextUnion.delete();
        if (ownsDrilled) drilled.delete();
        return null;
      }
      union = nextUnion;
      ownsUnion = true;

      const cavity = buildPrism(
        cavityHalfBase,
        cavityHalfTip,
        -inset,
        length + inset,
        crossThickness + joint.clearance * 2,
        spreadCenter,
        crossCoordinate
      );
      const nextDrilled = drilled.subtract(cavity);
      cavity.delete();
      if (ownsDrilled) drilled.delete();
      if (nextDrilled.status() !== "NoError" || nextDrilled.volume() <= 0) {
        nextDrilled.delete();
        if (ownsUnion) union.delete();
        return null;
      }
      drilled = nextDrilled;
      ownsDrilled = true;
    }
    positive.delete();
    negative.delete();
    return [union, drilled];
  }

  const edge = 1.2 + radius;
  const low = spread.minimum + edge;
  const high = spread.maximum - edge;
  if (high < low) return null;
  const requested = Math.max(1, Math.min(4, Math.round(joint.count ?? 1)));
  const capacity = Math.max(
    1,
    Math.floor((high - low) / (3 * Math.max(joint.diameter, 2))) + 1
  );
  const count = Math.min(requested, capacity);
  const autoCenters: number[] = [];
  for (let index = 0; index < count; index += 1) {
    autoCenters.push(
      count === 1
        ? (low + high) / 2
        : low + ((high - low) * index) / (count - 1)
    );
  }
  const locations =
    joint.distribution === "manual"
      ? resolveManualPlaneAnchors(
        joint.positions ?? [],
        spread.index,
        cross.index,
        spread.minimum,
        spread.maximum,
        cross.minimum,
          cross.maximum,
          edge,
          edge,
          3 * Math.max(joint.diameter, 2)
        )
      : autoCenters.map((center) => [center, crossCenter] as const);
  if (!locations) return null;

  const makeSolid = (
    height: number,
    cylinderRadius: number,
    alongAxis: number,
    spreadCenter: number,
    crossCoordinate: number,
    clear: number
  ): Manifold => {
    let solid = wasm.Manifold.cylinder(
      height,
      cylinderRadius,
      cylinderRadius,
      32,
      true
    );
    if (axis === 0) {
      const rotated = solid.rotate([0, 90, 0]);
      solid.delete();
      solid = rotated;
    } else if (axis === 1) {
      const rotated = solid.rotate([90, 0, 0]);
      solid.delete();
      solid = rotated;
    }
    const position: [number, number, number] = [0, 0, 0];
    position[axis] = alongAxis;
    position[spread.index] = spreadCenter;
    position[cross.index] = crossCoordinate;
    if (joint.variant === "keyed") {
      const sizes: [number, number, number] = [0, 0, 0];
      sizes[axis] = height;
      sizes[spread.index] = cylinderRadius * 3.2 + clear * 2;
      sizes[cross.index] = cylinderRadius * 1.1 + clear * 2;
      const key = wasm.Manifold.cube(sizes, true);
      const placed = key.translate(position);
      key.delete();
      const merged = solid.add(placed);
      placed.delete();
      solid.delete();
      solid = merged;
    }
    return solid.translate(position);
  };

  if (joint.variant === "magnet") {
    let positiveResult = positive;
    let negativeResult = negative;
    let ownsPositive = false;
    let ownsNegative = false;
    for (const [spreadCenter, crossCoordinate] of locations) {
      const positivePocket = makeSolid(
        length + 0.2,
        radius + joint.clearance,
        spec.offset + direction * (length / 2),
        spreadCenter,
        crossCoordinate,
        0
      );
      const negativePocket = makeSolid(
        length + 0.2,
        radius + joint.clearance,
        spec.offset - direction * (length / 2),
        spreadCenter,
        crossCoordinate,
        0
      );
      const nextPositive = positiveResult.subtract(positivePocket);
      const nextNegative = negativeResult.subtract(negativePocket);
      positivePocket.delete();
      negativePocket.delete();
      if (
        nextPositive.status() !== "NoError" ||
        nextNegative.status() !== "NoError" ||
        nextPositive.volume() <= 1e-9 ||
        nextNegative.volume() <= 1e-9
      ) {
        nextPositive.delete();
        nextNegative.delete();
        if (ownsPositive) positiveResult.delete();
        if (ownsNegative) negativeResult.delete();
        return null;
      }
      if (ownsPositive) positiveResult.delete();
      if (ownsNegative) negativeResult.delete();
      positiveResult = nextPositive;
      negativeResult = nextNegative;
      ownsPositive = true;
      ownsNegative = true;
    }
    positive.delete();
    negative.delete();
    return [positiveResult, negativeResult];
  }

  let union = positive;
  let drilled = negative;
  let ownsUnion = false;
  let ownsDrilled = false;
  for (const [spreadCenter, crossCoordinate] of locations) {
    const peg = makeSolid(
      length + 1,
      radius,
      spec.offset + length / 2,
      spreadCenter,
      crossCoordinate,
      0
    );
    const nextUnion = union.add(peg);
    peg.delete();
    if (ownsUnion) union.delete();
    if (nextUnion.status() !== "NoError" || nextUnion.volume() <= 0) {
      nextUnion.delete();
      if (ownsDrilled) drilled.delete();
      return null;
    }
    union = nextUnion;
    ownsUnion = true;

    const hole = makeSolid(
      length + 1.2,
      radius + joint.clearance,
      spec.offset - length / 2,
      spreadCenter,
      crossCoordinate,
      joint.clearance
    );
    const nextDrilled = drilled.subtract(hole);
    hole.delete();
    if (ownsDrilled) drilled.delete();
    if (nextDrilled.status() !== "NoError" || nextDrilled.volume() <= 0) {
      nextDrilled.delete();
      union.delete();
      return null;
    }
    drilled = nextDrilled;
    ownsDrilled = true;
  }
  positive.delete();
  negative.delete();
  return [union, drilled];
}

export function cutMesh(
  wasm: ManifoldToplevel,
  input: MeshData,
  ops: CutSpec[],
  onProgress?: (progress: number) => void,
  onWarning?: (message: string) => void
): CutPart[] {
  const { Manifold, Mesh } = wasm;
  const sourceMesh = new Mesh({
    numProp: 3,
    vertProperties: input.vertices,
    triVerts: input.faces,
  });
  const bounds = computeBounds(input.vertices);

  let parts: WorkingPart[];
  try {
    const root = Manifold.ofMesh(sourceMesh);
    if (root.status() !== "NoError") {
      root.delete();
      throw new Error("La malla no es un sólido cerrado y orientado");
    }
    parts = [{ manifold: root, id: "0" }];
  } catch (error) {
    if (error instanceof Error && error.message.includes("cerrado")) {
      throw error;
    }
    throw new Error(
      "El motor no pudo interpretar la malla. Reparala o probá con otro archivo."
    );
  }

  let splitIndex = 0;
  let opIndex = 0;

  try {
    for (const op of ops) {
      if (op.kind === "components") {
        const next: WorkingPart[] = [];
        for (const part of parts) {
          const shells = part.manifold.decompose();
          part.manifold.delete();
          for (const shell of shells) {
            if (shell.numTri() === 0 || shell.volume() <= 1e-9) {
              shell.delete();
              continue;
            }
            splitIndex += 1;
            next.push({ manifold: shell, id: `${part.id}-${splitIndex}` });
          }
        }
        parts = next;
        opIndex += 1;
        onProgress?.(0.45 + (0.45 * opIndex) / Math.max(1, ops.length));
        continue;
      }
      if (op.kind === "surface") {
        if (!parts.some((part) => part.id === op.partId)) {
          throw new Error(
            "La pieza seleccionada ya no está disponible para separar"
          );
        }
        let targetIds = new Set([op.partId]);
        const components = splitSurfacePatchComponents(op.patch);
        for (const component of components) {
          const planarPieceCut =
            (op.mode ?? "shell") === "piece" &&
            (op.capMode ?? "follow") === "planar";
          const cutter = planarPieceCut
            ? null
            : (op.mode ?? "shell") === "piece"
              ? buildSurfacePieceCutter(wasm, component, op.capMode ?? "follow")
              : buildSurfaceCutter(wasm, component, op.depth);
          const targetParts = parts.filter((part) => targetIds.has(part.id));
          const untouchedParts = parts.filter((part) => !targetIds.has(part.id));
          const nextTargets: WorkingPart[] = [];
          try {
            for (const part of targetParts) {
              const originalVolume = part.manifold.volume();
              let positive: Manifold;
              let negative: Manifold;
              if (planarPieceCut) {
                const plane = surfaceBoundaryPlane(component);
                [positive, negative] = part.manifold.splitByPlane(
                  plane.normal,
                  plane.offset
                );
                if (
                  positive.status() !== "NoError" ||
                  negative.status() !== "NoError" ||
                  positive.volume() <= 1e-9 ||
                  negative.volume() <= 1e-9
                ) {
                  positive.delete();
                  negative.delete();
                  throw new Error(
                    "El plano del contorno no divide la pieza en dos. Elegí «Seguir forma 3D» o cambiá la selección."
                  );
                }
                if (op.joint) {
                  [positive, negative] = applySurfaceJoint(
                    wasm,
                    positive,
                    negative,
                    { ...op, patch: component }
                  );
                }
              } else if (op.joint) {
                if (!cutter) {
                  throw new Error("No se pudo construir el cierre del corte");
                }
                const extracted = part.manifold.intersect(cutter);
                const remainder = part.manifold.subtract(cutter);
                if (
                  extracted.status() !== "NoError" ||
                  remainder.status() !== "NoError" ||
                  extracted.volume() <= 1e-9 ||
                  remainder.volume() <= 1e-9
                ) {
                  extracted.delete();
                  remainder.delete();
                  throw new Error(
                    "La zona seleccionada no genera dos piezas para el encastre"
                  );
                }
                [positive, negative] = applySurfaceJoint(
                  wasm,
                  extracted,
                  remainder,
                  { ...op, patch: component }
                );
              } else {
                if (!cutter) {
                  throw new Error("No se pudo construir el cierre del corte");
                }
                [positive, negative] = part.manifold.split(cutter);
              }
              if (
                positive.status() !== "NoError" ||
                negative.status() !== "NoError"
              ) {
                positive.delete();
                negative.delete();
                throw new Error("El motor no pudo completar el corte de zona");
              }
              const resultVolume = positive.volume() + negative.volume();
              if (
                Math.abs(resultVolume - originalVolume) >
                Math.max(originalVolume * 0.005, 1e-6)
              ) {
                positive.delete();
                negative.delete();
                throw new Error(
                  `La separación no conserva el volumen: original ${originalVolume.toFixed(2)} mm³, resultado ${resultVolume.toFixed(2)} mm³. Ajustá el contorno o probá el otro tipo de cierre.`
                );
              }
              for (const piece of [positive, negative]) {
                if (piece.numTri() === 0 || piece.volume() <= 1e-9) {
                  piece.delete();
                  continue;
                }
                splitIndex += 1;
                nextTargets.push({
                  manifold: piece,
                  id: `${part.id}-${splitIndex}`,
                });
              }
            }
          } catch (error) {
            for (const part of nextTargets) part.manifold.delete();
            cutter?.delete();
            throw error;
          }
          cutter?.delete();
          for (const part of targetParts) part.manifold.delete();
          parts = [...untouchedParts, ...nextTargets];
          targetIds = new Set(nextTargets.map((part) => part.id));
        }
        opIndex += 1;
        onProgress?.(0.45 + (0.45 * opIndex) / Math.max(1, ops.length));
        continue;
      }
      let cutter: Manifold | null = null;
      if (op.kind === "curve") {
        cutter = buildCurveCutter(wasm, op, bounds);
      } else if (op.kind === "shape") {
        cutter = buildShapeCutter(wasm, op);
      } else if (op.kind === "region") {
        cutter = buildRegionCutter(wasm, op);
      }

      const next: WorkingPart[] = [];
      for (const part of parts) {
        if (op.kind === "plane") {
          const mesh = part.manifold.getMesh();
          if (!planeSplits(mesh.vertProperties, op.normal, op.offset)) {
            next.push(part);
            continue;
          }
        }

        let positive: Manifold;
        let negative: Manifold;
        if (op.kind === "plane") {
          [positive, negative] = part.manifold.splitByPlane(
            op.normal,
            op.offset
          );
        } else {
          [positive, negative] = part.manifold.split(cutter as Manifold);
        }
        if (
          positive.status() !== "NoError" ||
          negative.status() !== "NoError"
        ) {
          positive.delete();
          negative.delete();
          throw new Error("El motor no pudo completar el corte");
        }
        part.manifold.delete();
        if (op.kind === "plane" && op.joint) {
          const jointed = applyPlaneJoint(wasm, positive, negative, op);
          if (jointed) {
            [positive, negative] = jointed;
          } else {
            const reason =
              op.joint.distribution === "manual"
                ? "La posición manual del conector está fuera del área útil o demasiado cerca del borde."
                : "la pieza es demasiado angosta o fina en esa cara.";
            onWarning?.(
              `No se pudo colocar el encastre del plano ${
                op.normal[0] !== 0 ? "X" : op.normal[1] !== 0 ? "Y" : "Z"
              }: ${reason}`
            );
          }
        }
        for (const piece of [positive, negative]) {
          if (piece.numTri() === 0 || piece.volume() <= 1e-9) {
            piece.delete();
            continue;
          }
          splitIndex += 1;
          next.push({ manifold: piece, id: `${part.id}-${splitIndex}` });
        }
      }
      cutter?.delete();
      parts = next;
      opIndex += 1;
      onProgress?.(0.45 + (0.45 * opIndex) / Math.max(1, ops.length));
    }

    const colored = parts
      .map((part) => ({ part, volume: part.manifold.volume() }))
      .sort((left, right) => right.volume - left.volume);

    return colored.map(({ part, volume }, index) => ({
      id: part.id,
      name: `Pieza ${index + 1}`,
      mesh: copyManifoldMesh(part.manifold),
      volume,
      color: PART_COLORS[index % PART_COLORS.length],
    }));
  } finally {
    for (const part of parts) part.manifold.delete();
  }
}

export { cutMesh as splitMesh };
