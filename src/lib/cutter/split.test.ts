import { beforeAll, describe, expect, it } from "vitest";
import Module from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";
import type { MeshData } from "@/lib/mesh/types";
import { computeBounds } from "@/lib/mesh/bounds";
import { analyzeMesh } from "@/lib/mesh/topology";
import { splitMesh } from "./split";
import type { CutPart, Ring2 } from "./types";

let wasm: ManifoldToplevel;

function cubeMesh(size: number): MeshData {
  const cube = wasm.Manifold.cube([size, size, size], true);
  const mesh = cube.getMesh();
  const vertexCount = mesh.vertProperties.length / mesh.numProp;
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * mesh.numProp;
    vertices[index * 3] = mesh.vertProperties[base];
    vertices[index * 3 + 1] = mesh.vertProperties[base + 1];
    vertices[index * 3 + 2] = mesh.vertProperties[base + 2];
  }
  const result = { vertices, faces: new Uint32Array(mesh.triVerts) };
  cube.delete();
  return result;
}

function boxMesh(x: number, y: number, z: number): MeshData {
  const box = wasm.Manifold.cube([x, y, z], true);
  const mesh = box.getMesh();
  const vertexCount = mesh.vertProperties.length / mesh.numProp;
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * mesh.numProp;
    vertices[index * 3] = mesh.vertProperties[base];
    vertices[index * 3 + 1] = mesh.vertProperties[base + 1];
    vertices[index * 3 + 2] = mesh.vertProperties[base + 2];
  }
  const result = { vertices, faces: new Uint32Array(mesh.triVerts) };
  box.delete();
  return result;
}

function squareRing(half: number): Ring2 {
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ];
}

function expectSolids(parts: CutPart[]) {
  for (const part of parts) {
    expect(part.volume).toBeGreaterThan(1e-6);
    const diagnostics = analyzeMesh(part.mesh);
    expect(diagnostics.openEdges).toBe(0);
    expect(diagnostics.nonManifoldEdges).toBe(0);
    expect(diagnostics.watertight).toBe(true);
  }
}

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
}, 30000);

describe("splitMesh", () => {
  it("keeps the solid intact without planes", () => {
    const parts = splitMesh(wasm, cubeMesh(20), []);
    expect(parts).toHaveLength(1);
    expect(parts[0].volume).toBeCloseTo(8000, 3);
  });

  it("splits a cube into four equal parts", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      { kind: "plane" as const, normal: [1, 0, 0], offset: 0 },
      { kind: "plane" as const, normal: [0, 0, 1], offset: 0 },
    ]);
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part.volume).toBeCloseTo(2000, 3);
      expect(part.mesh.faces.length).toBeGreaterThan(0);
    }
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
  });

  it("splits a cube with a curved cut", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "curve",
        axis: "x",
        offset: 0,
        amplitude: 3,
        wavelength: 20,
        phase: 0,
      },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
  });

  it("splits a cube with a shape cutter", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "shape",
        ring: [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, 5],
        ],
        zMin: -20,
        zMax: 20,
      },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
    const volumes = parts
      .map((part) => part.volume)
      .sort((first, second) => first - second);
    expect(volumes[0]).toBeCloseTo(2000, 3);
    expect(volumes[1]).toBeCloseTo(6000, 3);
  });

  it("adds a peg and a matching hole when a joint is enabled", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "plane",
        normal: [0, 0, 1],
        offset: 0,
        joint: { diameter: 5, length: 6, clearance: 0.2 },
      },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeGreaterThan(7800);
    expect(total).toBeLessThan(8100);
    expect(parts[0].volume).toBeGreaterThan(parts[1].volume);
    for (const part of parts) {
      const diagnostics = analyzeMesh(part.mesh);
      expect(diagnostics.openEdges).toBe(0);
      expect(diagnostics.nonManifoldEdges).toBe(0);
      expect(diagnostics.watertight).toBe(true);
    }
  });

  it("keeps keyed joints watertight", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "plane",
        normal: [0, 0, 1],
        offset: 0,
        joint: {
          diameter: 5,
          length: 6,
          clearance: 0.15,
          variant: "keyed",
        },
      },
    ]);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      const diagnostics = analyzeMesh(part.mesh);
      expect(diagnostics.openEdges).toBe(0);
      expect(diagnostics.nonManifoldEdges).toBe(0);
      expect(diagnostics.watertight).toBe(true);
    }
  });

  it("keeps dovetail joints watertight and interlocking", () => {
    const parts = splitMesh(wasm, boxMesh(20, 20, 20), [
      {
        kind: "plane",
        normal: [1, 0, 0],
        offset: 0,
        joint: {
          diameter: 5,
          length: 6,
          clearance: 0.15,
          variant: "dovetail",
        },
      },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeGreaterThan(7600);
    expect(total).toBeLessThan(8200);
    expect(parts.every((part) => part.volume < 8000)).toBe(true);
    for (const part of parts) {
      const diagnostics = analyzeMesh(part.mesh);
      expect(diagnostics.openEdges).toBe(0);
      expect(diagnostics.nonManifoldEdges).toBe(0);
      expect(diagnostics.watertight).toBe(true);
    }
    const tabbed = parts
      .map((part) => computeBounds(part.mesh.vertices))
      .find((box) => box.min[0] < -1);
    if (!tabbed) throw new Error("El tetón no sobresale hacia la otra pieza");
  });

  it("warns instead of failing when a joint does not fit", () => {
    const warnings: string[] = [];
    const parts = splitMesh(
      wasm,
      boxMesh(40, 2, 20),
      [
        {
          kind: "plane",
          normal: [0, 0, 1],
          offset: 0,
          joint: { diameter: 5, length: 6, clearance: 0.15 },
        },
      ],
      undefined,
      (warning) => warnings.push(warning)
    );
    expect(parts).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("encastre");
  });

  it("places multiple joints across a wide cut", () => {
    const parts = splitMesh(wasm, boxMesh(60, 20, 20), [
      {
        kind: "plane",
        normal: [0, 0, 1],
        offset: 0,
        joint: { diameter: 5, length: 6, clearance: 0.15, count: 3 },
      },
    ]);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      const diagnostics = analyzeMesh(part.mesh);
      expect(diagnostics.openEdges).toBe(0);
      expect(diagnostics.nonManifoldEdges).toBe(0);
      expect(diagnostics.watertight).toBe(true);
    }
  });

  it("separates disjoint components into pieces", () => {
    const first = wasm.Manifold.cube([10, 10, 10], true);
    const second = wasm.Manifold.cube([10, 10, 10], true).translate([30, 0, 0]);
    const union = first.add(second);
    first.delete();
    second.delete();
    const raw = union.getMesh();
    union.delete();
    const vertexCount = raw.vertProperties.length / raw.numProp;
    const vertices = new Float32Array(vertexCount * 3);
    for (let index = 0; index < vertexCount; index += 1) {
      const base = index * raw.numProp;
      vertices[index * 3] = raw.vertProperties[base];
      vertices[index * 3 + 1] = raw.vertProperties[base + 1];
      vertices[index * 3 + 2] = raw.vertProperties[base + 2];
    }
    const parts = splitMesh(
      wasm,
      { vertices, faces: new Uint32Array(raw.triVerts) },
      [{ kind: "components" }]
    );
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.volume).toBeCloseTo(1000, 3);
      expect(analyzeMesh(part.mesh).watertight).toBe(true);
    }
  });

  it("ignores a plane that does not intersect the solid", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      { kind: "plane" as const, normal: [0, 0, 1], offset: 40 },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0].volume).toBeCloseTo(8000, 3);
  });
});

describe("region cuts", () => {
  it("spans a Z region exactly and keeps both pieces watertight", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      { kind: "region", axis: "z", rings: [squareRing(5)], min: 6, max: 10 },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
    const cap = parts.find((part) => Math.abs(part.volume - 400) < 1e-6);
    if (!cap) throw new Error("No se generó la tapa de 400 mm³");
    const bounds = computeBounds(cap.mesh.vertices);
    expect(bounds.min[2]).toBeCloseTo(6, 3);
    expect(bounds.max[2]).toBeCloseTo(10, 3);
    expectSolids(parts);
  });

  it("maps an X region onto the YZ profile", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      { kind: "region", axis: "x", rings: [squareRing(5)], min: 6, max: 10 },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
    const cap = parts.find((part) => Math.abs(part.volume - 400) < 1e-6);
    if (!cap) throw new Error("No se generó la tapa de 400 mm³");
    const bounds = computeBounds(cap.mesh.vertices);
    expect(bounds.min[0]).toBeCloseTo(6, 3);
    expect(bounds.max[0]).toBeCloseTo(10, 3);
    expect(bounds.min[1]).toBeCloseTo(-5, 3);
    expect(bounds.max[1]).toBeCloseTo(5, 3);
    expect(bounds.min[2]).toBeCloseTo(-5, 3);
    expect(bounds.max[2]).toBeCloseTo(5, 3);
    expectSolids(parts);
  });

  it("maps a Y region onto the XZ profile", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      { kind: "region", axis: "y", rings: [squareRing(5)], min: 6, max: 10 },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
    const cap = parts.find((part) => Math.abs(part.volume - 400) < 1e-6);
    if (!cap) throw new Error("No se generó la tapa de 400 mm³");
    const bounds = computeBounds(cap.mesh.vertices);
    expect(bounds.min[1]).toBeCloseTo(6, 3);
    expect(bounds.max[1]).toBeCloseTo(10, 3);
    expect(bounds.min[0]).toBeCloseTo(-5, 3);
    expect(bounds.max[0]).toBeCloseTo(5, 3);
    expect(bounds.min[2]).toBeCloseTo(-5, 3);
    expect(bounds.max[2]).toBeCloseTo(5, 3);
    expectSolids(parts);
  });

  it("preserves a nested hole instead of filling it", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "region",
        axis: "z",
        rings: [squareRing(5), squareRing(2)],
        min: 6,
        max: 10,
      },
    ]);
    expect(parts).toHaveLength(2);
    const total = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(total).toBeCloseTo(8000, 3);
    const cap = parts.find((part) => Math.abs(part.volume - 336) < 1e-6);
    if (!cap) throw new Error("La tapa con hueco debería medir 336 mm³");
    expect(parts.some((part) => Math.abs(part.volume - 400) < 1e-6)).toBe(false);
    expectSolids(parts);
  });

  it("rejects empty, degenerate, and zero-depth regions", () => {
    expect(() =>
      splitMesh(wasm, cubeMesh(20), [
        { kind: "region", axis: "z", rings: [], min: 0, max: 1 },
      ])
    ).toThrow(/borde cerrado/);
    expect(() =>
      splitMesh(wasm, cubeMesh(20), [
        {
          kind: "region",
          axis: "z",
          rings: [[[0, 0], [1, 1], [2, 2]]],
          min: 0,
          max: 1,
        },
      ])
    ).toThrow(/borde cerrado/);
    expect(() =>
      splitMesh(wasm, cubeMesh(20), [
        { kind: "region", axis: "z", rings: [squareRing(5)], min: 4, max: 4 },
      ])
    ).toThrow(/profundidad/);
  });
});

