import { beforeAll, describe, expect, it } from "vitest";
import Module from "manifold-3d";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { MeshData } from "@/lib/mesh/types";
import { suggestCuts } from "./suggest";

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
}, 30000);

function toMesh(
  vertices: Float32Array,
  faces: Uint32Array
): MeshData {
  return { vertices, faces };
}

function manifoldToMesh(manifold: Manifold): MeshData {
  const mesh = manifold.getMesh();
  const count = mesh.vertProperties.length / mesh.numProp;
  const vertices = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const base = index * mesh.numProp;
    vertices[index * 3] = mesh.vertProperties[base];
    vertices[index * 3 + 1] = mesh.vertProperties[base + 1];
    vertices[index * 3 + 2] = mesh.vertProperties[base + 2];
  }
  return toMesh(vertices, new Uint32Array(mesh.triVerts));
}

describe("suggestCuts", () => {
  it("detects the neck of a dumbbell shape", () => {
    const left = wasm.Manifold.cube([20, 20, 20], true).translate([-20, 0, 0]);
    const right = wasm.Manifold.cube([20, 20, 20], true).translate([20, 0, 0]);
    const bridge = wasm.Manifold.cylinder(40, 4, 4, 32, true).rotate([0, 90, 0]);
    const union = left.add(right).add(bridge);
    const mesh = manifoldToMesh(union);
    const suggestions = suggestCuts(wasm, mesh);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(
      suggestions.some(
        (suggestion) =>
          suggestion.axis === "x" && Math.abs(suggestion.offset) < 8
      )
    ).toBe(true);
    union.delete();
    bridge.delete();
    left.delete();
    right.delete();
  });

  it("returns no suggestions for a plain cube", () => {
    const cube = wasm.Manifold.cube([20, 20, 20], true);
    const suggestions = suggestCuts(wasm, manifoldToMesh(cube));
    expect(suggestions).toHaveLength(0);
    cube.delete();
  });
});
