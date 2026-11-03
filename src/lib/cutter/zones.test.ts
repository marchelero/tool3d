import { beforeAll, describe, expect, it } from "vitest";
import Module from "manifold-3d";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { MeshData } from "@/lib/mesh/types";
import { computeBounds } from "@/lib/mesh/bounds";
import { analyzeMesh } from "@/lib/mesh/topology";
import { splitMesh } from "./split";
import {
  selectZone,
  zoneFromFaces,
  zoneToRegionOp,
  zoneToSurfaceOp,
} from "./zones";

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

  it("captures the selected triangles as a compact, serializable surface patch", () => {
    const mesh = cubeMesh(20);
    const zone = selectZone(mesh, 0, {
      tolerance: 20,
      useAngle: true,
      useColor: false,
      contiguous: true,
    });
    const op = zoneToSurfaceOp(mesh, zone, "0", "zona-1", 4);

    expect(op.kind).toBe("surface");
    expect(op.mode).toBe("piece");
    expect(op.capMode).toBe("planar");
    expect(op.patch.faces).toHaveLength(zone.faces.length * 3);
    expect(op.patch.vertices.length).toBeLessThan(mesh.vertices.length);
    expect(JSON.parse(JSON.stringify(op))).toEqual(op);
    expect(() =>
      zoneToSurfaceOp(mesh, zone, "0", "zona-2", 0, "shell")
    ).toThrow(/profundidad/);
  });

  it("splits selected face fans that only touch at a vertex", () => {
    const mesh = cubeMesh(20);
    let selected: [number, number] | null = null;
    for (let first = 0; first < mesh.faces.length / 3 && !selected; first += 1) {
      for (let second = first + 1; second < mesh.faces.length / 3; second += 1) {
        const firstVertices = [
          mesh.faces[first * 3],
          mesh.faces[first * 3 + 1],
          mesh.faces[first * 3 + 2],
        ];
        const secondVertices = new Set([
          mesh.faces[second * 3],
          mesh.faces[second * 3 + 1],
          mesh.faces[second * 3 + 2],
        ]);
        if (
          firstVertices.filter((vertex) => secondVertices.has(vertex)).length ===
          1
        ) {
          selected = [first, second];
          break;
        }
      }
    }
    expect(selected).not.toBeNull();
    const zone = zoneFromFaces(mesh, selected as [number, number]);
    const op = zoneToSurfaceOp(mesh, zone, "0", "zona-pin", 4, "shell");

    expect(op.patch.vertices).toHaveLength(18);
    const parts = splitMesh(wasm, mesh, [op]);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(8000, 2);
    for (const part of parts) {
      expect(analyzeMesh(part.mesh).watertight).toBe(true);
    }
  });

  it("separates a complete closed surface into a shell and a core", () => {
    const mesh = cubeMesh(20);
    const allFaces = Array.from({ length: mesh.faces.length / 3 }, (_, face) => face);
    const zone = zoneFromFaces(mesh, allFaces);
    const op = zoneToSurfaceOp(mesh, zone, "0", "zona-completa", 2, "shell");
    const parts = splitMesh(wasm, mesh, [op]);

    expect(parts).toHaveLength(2);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(8000, 2);
    for (const part of parts) {
      expect(analyzeMesh(part.mesh).watertight).toBe(true);
    }
  });
});
