import { beforeAll, describe, expect, it } from "vitest";
import Module from "manifold-3d";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { MeshData } from "@/lib/mesh/types";
import { analyzeMesh } from "@/lib/mesh/topology";
import { detectSeparationPlanes } from "./seams";
import { splitMesh } from "./split";

let wasm: ManifoldToplevel;

function toMeshData(manifold: Manifold): MeshData {
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

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
}, 30000);

describe("detectSeparationPlanes", () => {
  it("does not propose seams on a convex cube", () => {
    const cube = wasm.Manifold.cube([20, 20, 20], true);
    const mesh = toMeshData(cube);
    cube.delete();
    expect(detectSeparationPlanes(wasm, mesh)).toHaveLength(0);
  });

  it("finds the junction between a sphere and a fused cylinder", () => {
    const sphere = wasm.Manifold.sphere(10, 64);
    const cylinder = wasm.Manifold.cylinder(30, 5, 5, 64, true)
      .rotate([0, 90, 0])
      .translate([15, 0, 0]);
    const union = sphere.add(cylinder);
    sphere.delete();
    cylinder.delete();
    const mesh = toMeshData(union);
    const planes = detectSeparationPlanes(wasm, mesh);
    union.delete();

    expect(planes.length).toBeGreaterThan(0);
    const alongX = planes.find((plane) => Math.abs(plane.normal[0]) > 0.7);
    expect(alongX).toBeDefined();
    expect(Math.abs(alongX!.offset)).toBeGreaterThan(4);
    expect(Math.abs(alongX!.offset)).toBeLessThan(14);

    const parts = splitMesh(wasm, mesh, [
      {
        kind: "plane",
        normal: alongX!.normal,
        offset: alongX!.offset,
      },
    ]);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const part of parts) {
      expect(part.volume).toBeGreaterThan(0);
      expect(analyzeMesh(part.mesh).watertight).toBe(true);
    }
  });
});
