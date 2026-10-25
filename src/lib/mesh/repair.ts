import { fillHoles } from "./holes";
import {
  analyzeMesh,
  buildEdgeIndex,
  connectedComponents,
  signedVolume,
  triangleArea,
} from "./topology";
import {
  DEFAULT_REPAIR_OPTIONS,
  type MeshData,
  type RepairOptions,
  type RepairResult,
  type RepairStep,
} from "./types";

interface EdgeAdjacency {
  other: number;
  ownDir: 1 | -1;
  otherDir: 1 | -1;
}

function edgeDirection(
  faces: Uint32Array,
  face: number,
  a: number,
  b: number
): 1 | -1 {
  const offset = face * 3;
  const first = faces[offset];
  const second = faces[offset + 1];
  const third = faces[offset + 2];
  if (
    (first === a && second === b) ||
    (second === a && third === b) ||
    (third === a && first === b)
  ) {
    return 1;
  }
  return -1;
}

function orientFaces(mesh: MeshData): { mesh: MeshData; flipped: number } {
  const faces = new Uint32Array(mesh.faces);
  const edges = buildEdgeIndex(mesh);
  const adjacency = new Map<number, EdgeAdjacency[]>();
  for (const edge of edges.values()) {
    if (edge.count !== 2 || edge.f1 < 0) continue;
    const dir0 = edgeDirection(faces, edge.f0, edge.a, edge.b);
    const dir1 = edgeDirection(faces, edge.f1, edge.a, edge.b);
    const list0 = adjacency.get(edge.f0);
    if (list0) {
      list0.push({ other: edge.f1, ownDir: dir0, otherDir: dir1 });
    } else {
      adjacency.set(edge.f0, [
        { other: edge.f1, ownDir: dir0, otherDir: dir1 },
      ]);
    }
    const list1 = adjacency.get(edge.f1);
    if (list1) {
      list1.push({ other: edge.f0, ownDir: dir1, otherDir: dir0 });
    } else {
      adjacency.set(edge.f1, [
        { other: edge.f0, ownDir: dir1, otherDir: dir0 },
      ]);
    }
  }

  const faceCount = faces.length / 3;
  const flipped = new Uint8Array(faceCount);
  const visited = new Uint8Array(faceCount);
  for (let start = 0; start < faceCount; start += 1) {
    if (visited[start]) continue;
    visited[start] = 1;
    const queue = [start];
    while (queue.length > 0) {
      const face = queue.pop() as number;
      const links = adjacency.get(face);
      if (!links) continue;
      for (const link of links) {
        const effectiveOwn = link.ownDir * (flipped[face] ? -1 : 1);
        const shouldFlip = effectiveOwn === link.otherDir ? 1 : 0;
        if (visited[link.other]) {
          if (flipped[link.other] !== shouldFlip) {
            continue;
          }
          continue;
        }
        visited[link.other] = 1;
        flipped[link.other] = shouldFlip;
        queue.push(link.other);
      }
    }
  }

  let flippedCount = 0;
  for (let face = 0; face < faceCount; face += 1) {
    if (!flipped[face]) continue;
    flippedCount += 1;
    const offset = face * 3;
    const second = faces[offset + 1];
    faces[offset + 1] = faces[offset + 2];
    faces[offset + 2] = second;
  }
  return { mesh: { vertices: mesh.vertices, faces }, flipped: flippedCount };
}

function sanitize(mesh: MeshData): {
  mesh: MeshData;
  removed: number;
  deduped: number;
} {
  const vertexCount = mesh.vertices.length / 3;
  const seen = new Set<string>();
  const faces: number[] = [];
  let removed = 0;
  let deduped = 0;
  for (let index = 0; index < mesh.faces.length; index += 3) {
    const a = mesh.faces[index];
    const b = mesh.faces[index + 1];
    const c = mesh.faces[index + 2];
    if (
      a >= vertexCount ||
      b >= vertexCount ||
      c >= vertexCount ||
      a === b ||
      b === c ||
      c === a
    ) {
      removed += 1;
      continue;
    }
    if (triangleArea(mesh.vertices, mesh.faces, index / 3) <= 1e-12) {
      removed += 1;
      continue;
    }
    const key =
      a < b
        ? b < c
          ? `${a}:${b}:${c}`
          : a < c
            ? `${a}:${c}:${b}`
            : `${c}:${a}:${b}`
        : a < c
          ? `${b}:${a}:${c}`
          : b < c
            ? `${b}:${c}:${a}`
            : `${c}:${b}:${a}`;
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);
    faces.push(a, b, c);
  }
  return {
    mesh: { vertices: mesh.vertices, faces: new Uint32Array(faces) },
    removed,
    deduped,
  };
}

function removeDust(
  mesh: MeshData,
  threshold: number
): { mesh: MeshData; removed: number } {
  const components = connectedComponents(mesh);
  if (components.count <= 1) {
    return { mesh, removed: 0 };
  }
  let largest = 0;
  for (let index = 1; index < components.count; index += 1) {
    if (
      Math.abs(components.componentVolume[index]) >
      Math.abs(components.componentVolume[largest])
    ) {
      largest = index;
    }
  }
  const keep = new Uint8Array(components.count);
  keep[largest] = 1;
  let removed = 0;
  for (let index = 0; index < components.count; index += 1) {
    if (index === largest) continue;
    if (Math.abs(components.componentVolume[index]) >= threshold) {
      keep[index] = 1;
      continue;
    }
    removed += components.componentFaces[index].length;
  }
  if (removed === 0) return { mesh, removed: 0 };
  const faces: number[] = [];
  for (let face = 0; face < mesh.faces.length / 3; face += 1) {
    if (keep[components.faceComponent[face]]) {
      faces.push(
        mesh.faces[face * 3],
        mesh.faces[face * 3 + 1],
        mesh.faces[face * 3 + 2]
      );
    }
  }
  return {
    mesh: { vertices: mesh.vertices, faces: new Uint32Array(faces) },
    removed,
  };
}

export function repairMesh(
  source: MeshData,
  options: RepairOptions = DEFAULT_REPAIR_OPTIONS
): RepairResult {
  const steps: RepairStep[] = [];
  const warnings: string[] = [];
  const initialTriangles = source.faces.length / 3;

  const sanitized = sanitize(source);
  steps.push({
    name: "Limpiar triángulos",
    before: initialTriangles,
    after: sanitized.mesh.faces.length / 3,
    changed: sanitized.removed + sanitized.deduped,
    note:
      sanitized.removed + sanitized.deduped > 0
        ? `${sanitized.removed} inválidos, ${sanitized.deduped} duplicados`
        : undefined,
  });

  let mesh = sanitized.mesh;
  if (options.removeDust) {
    const dust = removeDust(mesh, options.dustVolumeMm3);
    if (dust.removed > 0) {
      warnings.push(`Se quitaron ${dust.removed} triángulos de polvo.`);
    }
    mesh = dust.mesh;
    steps.push({
      name: "Quitar polvo",
      before: sanitized.mesh.faces.length / 3,
      after: mesh.faces.length / 3,
      changed: dust.removed,
    });
  }

  const oriented = orientFaces(mesh);
  steps.push({
    name: "Orientar caras",
    before: mesh.faces.length / 3,
    after: oriented.mesh.faces.length / 3,
    changed: oriented.flipped,
  });
  mesh = oriented.mesh;

  if (options.fillHoles) {
    const holes = fillHoles(mesh, options.maxHoleEdges);
    if (holes.filled > 0) {
      steps.push({
        name: "Cerrar huecos",
        before: mesh.faces.length / 3,
        after: holes.mesh.faces.length / 3,
        changed: holes.addedTriangles,
        note: `${holes.filled} cerrados${holes.skipped > 0 ? `, ${holes.skipped} omitidos` : ""}`,
      });
    }
    warnings.push(...holes.warnings);
    mesh = holes.mesh;
    const reoriented = orientFaces(mesh);
    mesh = reoriented.mesh;
  }

  if (signedVolume(mesh) < 0) {
    const faces = new Uint32Array(mesh.faces);
    for (let index = 0; index < faces.length; index += 3) {
      const second = faces[index + 1];
      faces[index + 1] = faces[index + 2];
      faces[index + 2] = second;
    }
    mesh = { vertices: mesh.vertices, faces };
    warnings.push("Se invirtió la orientación global (volumen negativo).");
  }

  const diagnostics = analyzeMesh(mesh);
  if (!diagnostics.watertight) {
    warnings.push(
      `La malla sigue abierta: ${diagnostics.openEdges} bordes y ${diagnostics.nonManifoldEdges} aristas no manifold.`
    );
  }
  if (diagnostics.volume <= 0) {
    warnings.push("El volumen final no es positivo.");
  }

  return { mesh, diagnostics, steps, warnings };
}
