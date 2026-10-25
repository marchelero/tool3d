import { beforeAll, describe, expect, it } from "vitest";
import Module from "manifold-3d";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { MeshData } from "@/lib/mesh/types";
import { computeBounds } from "@/lib/mesh/bounds";
import { splitMesh } from "./split";
import { selectZone, zoneFromFaces, zoneToRegionOp } from "./zones";

let wasm: ManifoldToplevel;

function toMesh(manifold: Manifold): MeshData {
  const mesh = manifold.getMesh();
  const vertexCount = mesh.vertProperties.length / mesh.numProp;
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * mesh.numProp;
    vertices[index * 3] = mesh.vertProperties[base];
    vertices[index * 3 + 1] = mesh.vertProperties[base + 1];
    vertices[index * 3 + 2] = mesh.vertProperties[base + 2];
  }
  return { vertices, faces: new Uint32Array(mesh.triVerts) };
}

function cubeMesh(size: number): MeshData {
  const cube = wasm.Manifold.cube([size, size, size], true);
  const mesh = toMesh(cube);
  cube.delete();
  return mesh;
}

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
}, 30000);

describe("selectZone", () => {
  it("keeps one flat face with a low angle tolerance", () => {
    const mesh = cubeMesh(20);
    const zone = selectZone(mesh, 0, {
      tolerance: 20,
      useAngle: true,
      useColor: false,
      contiguous: true,
    });
    expect(zone.triangles).toBe(2);
    expect(zone.boundaryLoops).toHaveLength(1);
    expect(zone.boundaryLoops[0]).toHaveLength(4);
    expect(zone.area).toBeCloseTo(400, 3);
  });

  it("grows to the whole cube with a high angle tolerance", () => {
    const mesh = cubeMesh(20);
    const zone = selectZone(mesh, 0, {
      tolerance: 100,
      useAngle: true,
      useColor: false,
      contiguous: true,
    });
    expect(zone.triangles).toBe(12);
    expect(zone.boundaryLoops).toHaveLength(0);
  });

  it("combines color with local angles when the 3MF has colors", () => {
    const mesh = cubeMesh(20);
    const colors = Array.from({ length: 12 }, () => "#c98b57");
    const options = {
      useAngle: true,
      useColor: true,
      contiguous: true,
    };
    const tight = selectZone(mesh, 0, { ...options, tolerance: 5 }, colors);
    expect(tight.triangles).toBe(2);
    expect(tight.color).toBe("#c98b57");
    const loose = selectZone(mesh, 0, { ...options, tolerance: 80 }, colors);
    expect(loose.triangles).toBe(12);
  });

  it("wraps curved surfaces using local neighbor angles", () => {
    const sphere = wasm.Manifold.sphere(10, 48);
    const mesh = toMesh(sphere);
    sphere.delete();
    const total = mesh.faces.length / 3;
    const zone = selectZone(mesh, 0, {
      tolerance: 20,
      useAngle: true,
      useColor: false,
      contiguous: true,
    });
    expect(zone.triangles).toBeGreaterThan(total * 0.9);
  });

  it("rebuilds a zone from painted face ids", () => {
    const mesh = cubeMesh(20);
    const zone = zoneFromFaces(mesh, [0, 1, 2]);
    expect(zone.triangles).toBe(3);
    expect(zone.area).toBeGreaterThanOrEqual(400);
    expect(zone.boundaryLoops.length).toBeGreaterThan(0);
    expect(() => zoneFromFaces(mesh, [])).toThrow();
  });

  it("turns a selected face into a watertight cap cut", () => {
    const mesh = cubeMesh(20);
    const zone = selectZone(mesh, 0, {
      tolerance: 20,
      useAngle: true,
      useColor: false,
      contiguous: true,
    });
    const op = zoneToRegionOp(zone, computeBounds(mesh.vertices), 4, "zona-1");
    const parts = splitMesh(wasm, mesh, [
      {
        kind: "region",
        axis: op.axis,
        rings: op.rings,
        min: op.min,
        max: op.max,
      },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
    for (const part of parts) {
      expect(part.volume).toBeGreaterThan(0);
    }
  });
});
