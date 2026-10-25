import { describe, expect, it } from "vitest";
import { computeBounds } from "./bounds";
import {
  analyzeMesh,
  boundaryLoops,
  connectedComponents,
  signedVolume,
} from "./topology";
import { weldTriangleSoup } from "./weld";
import { repairMesh } from "./repair";
import type { MeshData } from "./types";

function cubeSoup(size = 20): Float32Array {
  const v = [
    [0, 0, 0],
    [size, 0, 0],
    [size, size, 0],
    [0, size, 0],
    [0, 0, size],
    [size, 0, size],
    [size, size, size],
    [0, size, size],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [3, 7, 6],
    [3, 6, 2],
    [1, 2, 6],
    [1, 6, 5],
    [0, 4, 7],
    [0, 7, 3],
  ];
  const positions = new Float32Array(faces.length * 9);
  let cursor = 0;
  for (const face of faces) {
    for (const index of face) {
      positions[cursor] = v[index][0];
      positions[cursor + 1] = v[index][1];
      positions[cursor + 2] = v[index][2];
      cursor += 3;
    }
  }
  return positions;
}

function openCubeSoup(size = 20): Float32Array {
  const positions = cubeSoup(size);
  return positions.slice(0, (12 - 2) * 9);
}

function makeMesh(positions: Float32Array): MeshData {
  return weldTriangleSoup(positions);
}

function reverseFaces(mesh: MeshData): MeshData {
  const faces = new Uint32Array(mesh.faces);
  for (let index = 0; index < faces.length; index += 3) {
    const second = faces[index + 1];
    faces[index + 1] = faces[index + 2];
    faces[index + 2] = second;
  }
  return { vertices: mesh.vertices, faces };
}

describe("computeBounds", () => {
  it("returns the extents of a triangle soup", () => {
    const bounds = computeBounds(cubeSoup(10));
    expect(bounds.min).toEqual([0, 0, 0]);
    expect(bounds.max).toEqual([10, 10, 10]);
    expect(bounds.size).toEqual([10, 10, 10]);
    expect(bounds.center).toEqual([5, 5, 5]);
  });
});

describe("weld and topology", () => {
  it("welds a cube to 8 vertices and 12 triangles", () => {
    const mesh = makeMesh(cubeSoup());
    expect(mesh.vertices.length / 3).toBe(8);
    expect(mesh.faces.length / 3).toBe(12);
    const diagnostics = analyzeMesh(mesh);
    expect(diagnostics.openEdges).toBe(0);
    expect(diagnostics.nonManifoldEdges).toBe(0);
    expect(diagnostics.boundaryLoops).toBe(0);
    expect(diagnostics.components).toBe(1);
    expect(diagnostics.watertight).toBe(true);
    expect(diagnostics.volume).toBeCloseTo(8000, 6);
  });

  it("detects the boundary loop of an open box", () => {
    const mesh = makeMesh(openCubeSoup());
    const loops = boundaryLoops(mesh);
    const diagnostics = analyzeMesh(mesh);
    expect(diagnostics.openEdges).toBe(4);
    expect(diagnostics.boundaryLoops).toBe(1);
    expect(loops[0]).toHaveLength(4);
  });

  it("counts disconnected components and their volume", () => {
    const first = cubeSoup(10);
    const second = cubeSoup(4);
    const shifted = new Float32Array(second.length);
    for (let index = 0; index < second.length; index += 3) {
      shifted[index] = second[index] + 100;
      shifted[index + 1] = second[index + 1];
      shifted[index + 2] = second[index + 2];
    }
    const joined = new Float32Array(first.length + shifted.length);
    joined.set(first);
    joined.set(shifted, first.length);
    const components = connectedComponents(weldTriangleSoup(joined));
    expect(components.count).toBe(2);
    expect(components.componentVolume[0]).toBeCloseTo(1000, 6);
    expect(components.componentVolume[1]).toBeCloseTo(64, 6);
  });
});

describe("repairMesh", () => {
  it("closes an open box and keeps a positive volume", () => {
    const mesh = makeMesh(openCubeSoup());
    const repaired = repairMesh(mesh);
    expect(repaired.diagnostics.watertight).toBe(true);
    expect(repaired.diagnostics.boundaryLoops).toBe(0);
    expect(repaired.diagnostics.volume).toBeCloseTo(8000, 6);
    expect(repaired.diagnostics.outward).toBe(true);
    expect(repaired.steps.some((step) => step.name === "Cerrar huecos")).toBe(
      true
    );
    expect(signedVolume(repaired.mesh)).toBeCloseTo(8000, 6);
  });

  it("fixes inverted normals", () => {
    const inverted = reverseFaces(makeMesh(cubeSoup()));
    expect(signedVolume(inverted)).toBeCloseTo(-8000, 6);
    const repaired = repairMesh(inverted);
    expect(repaired.diagnostics.watertight).toBe(true);
    expect(repaired.diagnostics.volume).toBeCloseTo(8000, 6);
  });

  it("removes duplicated triangles", () => {
    const mesh = makeMesh(cubeSoup());
    const faces = new Uint32Array(mesh.faces.length + 3);
    faces.set(mesh.faces);
    faces.set(mesh.faces.slice(0, 3), mesh.faces.length);
    const duplicated = { vertices: mesh.vertices, faces };
    const repaired = repairMesh(duplicated);
    expect(repaired.mesh.faces.length / 3).toBe(12);
    expect(repaired.diagnostics.watertight).toBe(true);
  });

  it("removes tiny disconnected dust", () => {
    const first = cubeSoup(20);
    const dust = cubeSoup(0.1);
    const shifted = new Float32Array(dust.length);
    for (let index = 0; index < dust.length; index += 3) {
      shifted[index] = dust[index] + 100;
      shifted[index + 1] = dust[index + 1];
      shifted[index + 2] = dust[index + 2];
    }
    const joined = new Float32Array(first.length + shifted.length);
    joined.set(first);
    joined.set(shifted, first.length);
    const repaired = repairMesh(weldTriangleSoup(joined));
    expect(repaired.mesh.faces.length / 3).toBe(12);
    expect(repaired.diagnostics.components).toBe(1);
  });
});
