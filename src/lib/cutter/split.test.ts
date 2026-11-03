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

function toMesh(manifold: import("manifold-3d").Manifold): MeshData {
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

function hasFeatureNearPlanePoint(
  mesh: MeshData,
  center: [number, number, number],
  normal: [number, number, number],
  minDepth: number,
  maxDepth: number,
  radius: number
): boolean {
  for (let vertex = 0; vertex < mesh.vertices.length / 3; vertex += 1) {
    const point: [number, number, number] = [
      mesh.vertices[vertex * 3],
      mesh.vertices[vertex * 3 + 1],
      mesh.vertices[vertex * 3 + 2],
    ];
    const relative: [number, number, number] = [
      point[0] - center[0],
      point[1] - center[1],
      point[2] - center[2],
    ];
    const depth =
      relative[0] * normal[0] +
      relative[1] * normal[1] +
      relative[2] * normal[2];
    const tangentLength = Math.sqrt(
      Math.max(
        0,
        relative[0] ** 2 +
          relative[1] ** 2 +
          relative[2] ** 2 -
          depth ** 2
      )
    );
    if (depth >= minDepth && depth <= maxDepth && tangentLength <= radius) {
      return true;
    }
  }
  return false;
}

function patchBoundaryPlane(patch: { vertices: number[]; faces: number[] }) {
  const edges = new Map<string, { count: number; first: number; second: number }>();
  const edgeKey = (first: number, second: number) =>
    first < second ? `${first}:${second}` : `${second}:${first}`;
  for (let face = 0; face < patch.faces.length / 3; face += 1) {
    const a = patch.faces[face * 3];
    const b = patch.faces[face * 3 + 1];
    const c = patch.faces[face * 3 + 2];
    for (const [first, second] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(first, second);
      const edge = edges.get(key);
      if (edge) edge.count += 1;
      else edges.set(key, { count: 1, first, second });
    }
  }
  const boundary = [...edges.values()].filter((edge) => edge.count === 1);
  const next = new Map(boundary.map((edge) => [edge.first, edge.second]));
  const loop: number[] = [];
  const start = boundary[0].first;
  let current = start;
  do {
    loop.push(current);
    current = next.get(current)!;
  } while (current !== start && loop.length <= boundary.length);

  const origin: [number, number, number] = [0, 0, 0];
  const normal: [number, number, number] = [0, 0, 0];
  for (let index = 0; index < loop.length; index += 1) {
    const first = loop[index];
    const second = loop[(index + 1) % loop.length];
    const a = [
      patch.vertices[first * 3],
      patch.vertices[first * 3 + 1],
      patch.vertices[first * 3 + 2],
    ];
    const b = [
      patch.vertices[second * 3],
      patch.vertices[second * 3 + 1],
      patch.vertices[second * 3 + 2],
    ];
    origin[0] += a[0] / loop.length;
    origin[1] += a[1] / loop.length;
    origin[2] += a[2] / loop.length;
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const length = Math.hypot(...normal);
  return { origin, normal: normal.map((value) => value / length) as [number, number, number] };
}

function meshAreaOnPlane(
  mesh: MeshData,
  origin: [number, number, number],
  normal: [number, number, number],
  tolerance: number
) {
  let area = 0;
  for (let face = 0; face < mesh.faces.length / 3; face += 1) {
    const points = [0, 1, 2].map((corner) => {
      const vertex = mesh.faces[face * 3 + corner];
      return [
        mesh.vertices[vertex * 3],
        mesh.vertices[vertex * 3 + 1],
        mesh.vertices[vertex * 3 + 2],
      ];
    });
    const distances = points.map((point) =>
      (point[0] - origin[0]) * normal[0] +
      (point[1] - origin[1]) * normal[1] +
      (point[2] - origin[2]) * normal[2]
    );
    if (Math.max(...distances.map(Math.abs)) > tolerance) continue;
    const [a, b, c] = points;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    area +=
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0]
      ) / 2;
  }
  return area;
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

  it("splits a concave solid with a plane and preserves watertight pieces", () => {
    const body = wasm.Manifold.cube([20, 20, 20], true);
    const hole = wasm.Manifold.cylinder(22, 4, 4, 32, true);
    const concave = body.subtract(hole);
    body.delete();
    hole.delete();
    const originalVolume = concave.volume();
    const mesh = toMesh(concave);
    concave.delete();

    const parts = splitMesh(wasm, mesh, [
      { kind: "plane", normal: [1, 0, 0], offset: 0 },
    ]);

    expect(parts).toHaveLength(2);
    expectSolids(parts);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(
      originalVolume,
      2
    );
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

  it("cuts paired magnet pockets into both planar halves", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "plane",
        normal: [0, 0, 1],
        offset: 0,
        joint: {
          diameter: 6,
          length: 3,
          clearance: 0.2,
          count: 2,
          variant: "magnet",
        },
      },
    ]);

    expect(parts).toHaveLength(2);
    expect(parts.every((part) => part.volume < 4000)).toBe(true);
    expect(parts.every((part) => part.volume > 3700)).toBe(true);
    expect(Math.abs(parts[0].volume - parts[1].volume)).toBeLessThan(0.1);
    expectSolids(parts);
  });

  it("places manual plane connectors at the clicked face coordinates", () => {
    const parts = splitMesh(wasm, cubeMesh(20), [
      {
        kind: "plane",
        normal: [0, 0, 1],
        offset: 0,
        joint: {
          diameter: 4,
          length: 5,
          clearance: 0.2,
          count: 1,
          variant: "dowel",
          distribution: "manual",
          positions: [
            [6, 6, 0],
            [-6, -6, 0],
          ],
        },
      },
    ]);
    const averageZ = (part: (typeof parts)[number]) => {
      const vertices = part.mesh.vertices;
      let sum = 0;
      for (let index = 2; index < vertices.length; index += 3) {
        sum += vertices[index];
      }
      return sum / (vertices.length / 3);
    };
    const [positiveHalf, negativeHalf] = [...parts].sort(
      (first, second) => averageZ(second) - averageZ(first)
    );
    if (!positiveHalf || !negativeHalf) {
      throw new Error("El plano no generó sus dos mitades");
    }
    for (const position of [
      [6, 6, 0],
      [-6, -6, 0],
    ] as [number, number, number][]) {
      expect(
        hasFeatureNearPlanePoint(
        positiveHalf.mesh,
        position,
        [0, 0, 1],
        -5.6,
        -0.2,
        2.1
        )
      ).toBe(true);
      expect(
        hasFeatureNearPlanePoint(
          negativeHalf.mesh,
          position,
          [0, 0, 1],
          -5.6,
          -0.2,
          2.3
        )
      ).toBe(true);
    }
    expectSolids(parts);
  });

  it("does not fall back to automatic joints when manual placement is empty", () => {
    const mesh = cubeMesh(20);
    const baseline = splitMesh(wasm, mesh, [
      { kind: "plane", normal: [0, 0, 1], offset: 0 },
    ]);
    const manual = splitMesh(wasm, mesh, [
      {
        kind: "plane",
        normal: [0, 0, 1],
        offset: 0,
        joint: {
          diameter: 4,
          length: 5,
          clearance: 0.2,
          count: 1,
          variant: "dowel",
          distribution: "manual",
          positions: [],
        },
      },
    ]);

    expect(manual.map((part) => part.volume)).toEqual(
      baseline.map((part) => part.volume)
    );
  });

  it("places manual magnet pockets at a planar surface anchor", () => {
    const sphere = wasm.Manifold.sphere(10, 24);
    const mesh = toMesh(sphere);
    sphere.delete();
    const selectedFaces = Array.from(
      { length: mesh.faces.length / 3 },
      (_, face) => face
    ).filter((face) =>
      [0, 1, 2].every(
        (corner) =>
          mesh.vertices[mesh.faces[face * 3 + corner] * 3 + 2] >= 5
      )
    );
    const patch = surfacePatch(mesh, selectedFaces);
    const plane = patchBoundaryPlane(patch);
    const patchCenter: [number, number, number] = [0, 0, 0];
    const vertexCount = patch.vertices.length / 3;
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      patchCenter[0] += patch.vertices[vertex * 3] / vertexCount;
      patchCenter[1] += patch.vertices[vertex * 3 + 1] / vertexCount;
      patchCenter[2] += patch.vertices[vertex * 3 + 2] / vertexCount;
    }
    const towardPatch = [
      patchCenter[0] - plane.origin[0],
      patchCenter[1] - plane.origin[1],
      patchCenter[2] - plane.origin[2],
    ];
    if (
      towardPatch[0] * plane.normal[0] +
        towardPatch[1] * plane.normal[1] +
        towardPatch[2] * plane.normal[2] <
      0
    ) {
      plane.normal = plane.normal.map((value) => -value) as [
        number,
        number,
        number,
      ];
    }
    const tangentOffset: [number, number, number] = [3.5, 2.2, 0];
    const normalOffset =
      tangentOffset[0] * plane.normal[0] +
      tangentOffset[1] * plane.normal[1] +
      tangentOffset[2] * plane.normal[2];
    const anchor = plane.origin.map(
      (coordinate, axis) =>
        coordinate + tangentOffset[axis] - plane.normal[axis] * normalOffset
    ) as [number, number, number];
    const parts = splitMesh(wasm, mesh, [
      {
        kind: "surface",
        mode: "piece",
        capMode: "planar",
        partId: "0",
        patch,
        depth: 4,
        joint: {
          diameter: 2,
          length: 2,
          clearance: 0.1,
          variant: "magnet",
          distribution: "manual",
          positions: [anchor],
        },
      },
    ]);

    expect(parts).toHaveLength(2);
    expect(
      parts.some((part) =>
        hasFeatureNearPlanePoint(
          part.mesh,
          anchor,
          plane.normal,
          0.2,
          2.5,
          1.4
        )
      )
    ).toBe(true);
    expect(
      parts.some((part) =>
        hasFeatureNearPlanePoint(
          part.mesh,
          anchor,
          plane.normal.map((value) => -value) as [number, number, number],
          0.2,
          2.5,
          1.4
        )
      )
    ).toBe(true);
    expectSolids(parts);
  });

  it("rejects an out-of-face manual connector without partial geometry", () => {
    const warnings: string[] = [];
    const mesh = cubeMesh(20);
    const baseline = splitMesh(wasm, mesh, [
      { kind: "plane", normal: [0, 0, 1], offset: 0 },
    ]);
    const parts = splitMesh(
      wasm,
      mesh,
      [
        {
          kind: "plane",
          normal: [0, 0, 1],
          offset: 0,
          joint: {
            diameter: 4,
            length: 4,
            clearance: 0.2,
            variant: "dowel",
            distribution: "manual",
            positions: [[30, 30, 0]],
          },
        },
      ],
      undefined,
      (warning) => warnings.push(warning)
    );

    expect(parts.map((part) => part.volume)).toEqual(
      baseline.map((part) => part.volume)
    );
    expect(warnings[0]).toMatch(/posición|superficie|conector/i);
    expectSolids(parts);
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
    expect(parts.some((part) => Math.abs(part.volume - 400) < 1e-6)).toBe(
      false
    );
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
          rings: [
            [
              [0, 0],
              [1, 1],
              [2, 2],
            ],
          ],
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

describe("surface cuts", () => {
  it("extracts the full solid behind a curved painted region", () => {
    const sphere = wasm.Manifold.sphere(10, 24);
    const originalVolume = sphere.volume();
    const mesh = toMesh(sphere);
    sphere.delete();
    const selectedFaces = Array.from(
      { length: mesh.faces.length / 3 },
      (_, face) => face
    ).filter((face) =>
      [0, 1, 2].every(
        (corner) =>
          mesh.vertices[mesh.faces[face * 3 + corner] * 3 + 2] >= 5
      )
    );
    const patch = surfacePatch(mesh, selectedFaces);
    const parts = splitMesh(wasm, mesh, [
      {
        kind: "surface",
        mode: "piece",
        capMode: "follow",
        partId: "0",
        patch,
        depth: 0.5,
      },
    ]);
    const extracted = parts.reduce((smallest, part) =>
      part.volume < smallest.volume ? part : smallest
    );

    expect(parts).toHaveLength(2);
    expect(extracted.volume).toBeGreaterThan(500);
    expectExactTriangles(extracted.mesh, patch);
    expectSolids(parts);
    const totalVolume = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(Math.abs(totalVolume - originalVolume)).toBeLessThanOrEqual(
      originalVolume * 0.005
    );
  });

  it("closes an oblique painted region with a flat cut plane", () => {
    const sphere = wasm.Manifold.sphere(10, 24);
    const originalVolume = sphere.volume();
    const mesh = toMesh(sphere);
    sphere.delete();
    const cutDirection = [0.8, 0.35, 0.4];
    const selectedFaces = Array.from(
      { length: mesh.faces.length / 3 },
      (_, face) => face
    ).filter((face) =>
      [0, 1, 2].every((corner) => {
        const vertex = mesh.faces[face * 3 + corner];
        return (
          mesh.vertices[vertex * 3] * cutDirection[0] +
            mesh.vertices[vertex * 3 + 1] * cutDirection[1] +
            mesh.vertices[vertex * 3 + 2] * cutDirection[2] >=
          3
        );
      })
    );
    const patch = surfacePatch(mesh, selectedFaces);
    const capPlane = patchBoundaryPlane(patch);
    const expectedVolumes = splitMesh(wasm, mesh, [
      {
        kind: "plane",
        normal: capPlane.normal,
        offset:
          capPlane.normal[0] * capPlane.origin[0] +
          capPlane.normal[1] * capPlane.origin[1] +
          capPlane.normal[2] * capPlane.origin[2],
      },
    ])
      .map((part) => part.volume)
    const parts = splitMesh(wasm, mesh, [
      {
        kind: "surface",
        mode: "piece",
        capMode: "planar" as const,
        partId: "0",
        patch,
        depth: 0.5,
      },
    ]);
    const extracted = parts.reduce((smallest, part) =>
      part.volume < smallest.volume ? part : smallest
    );

    expect(parts).toHaveLength(2);
    expect(meshAreaOnPlane(extracted.mesh, capPlane.origin, capPlane.normal, 0.01)).toBeGreaterThan(10);
    expectSolids(parts);
    const actualVolumes = parts
      .map((part) => part.volume);
    expect(actualVolumes).toHaveLength(expectedVolumes.length);
    actualVolumes.forEach((volume, index) => {
      expect(
        Math.abs(volume - expectedVolumes[index]) / expectedVolumes[index]
      ).toBeLessThanOrEqual(0.005);
    });
    const totalVolume = parts.reduce((sum, part) => sum + part.volume, 0);
    expect(Math.abs(totalVolume - originalVolume)).toBeLessThanOrEqual(
      originalVolume * 0.005
    );
  });

  it("extracts the selected flat faces to the requested depth", () => {
    const mesh = cubeMesh(20);
    const faces = topFaceIds(mesh);
    const patch = surfacePatch(mesh, faces);
    const parts = splitMesh(wasm, mesh, [
      { kind: "surface", partId: "0", patch, depth: 4 },
    ]);

    expect(parts).toHaveLength(2);
    const extracted = parts.reduce((smallest, part) =>
      part.volume < smallest.volume ? part : smallest
    );
    expect(extracted.volume).toBeCloseTo(1600, 1);
    expectExactTriangles(extracted.mesh, patch);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(
      8000,
      2
    );
    expectSolids(parts);
  });

  it("extracts a curved patch without flattening its exterior surface", () => {
    const sphere = wasm.Manifold.sphere(10, 24);
    const originalVolume = sphere.volume();
    const mesh = toMesh(sphere);
    sphere.delete();
    const firstFace = 0;
    const patch = surfacePatch(mesh, [firstFace]);
    const parts = splitMesh(wasm, mesh, [
      { kind: "surface", partId: "0", patch, depth: 1 },
    ]);

    expect(parts).toHaveLength(2);
    const extracted = parts.reduce((smallest, part) =>
      part.volume < smallest.volume ? part : smallest
    );
    expectExactTriangles(extracted.mesh, patch);
    expectSolids(parts);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(
      originalVolume,
      2
    );
  });

  it("applies a captured patch only to its selected result piece", () => {
    const mesh = cubeMesh(20);
    const plane = {
      kind: "plane" as const,
      normal: [1, 0, 0] as [number, number, number],
      offset: 0,
    };
    const initial = splitMesh(wasm, mesh, [plane]);
    const target = initial[0];
    const patch = surfacePatch(target.mesh, topFaceIds(target.mesh));
    const parts = splitMesh(wasm, mesh, [
      plane,
      { kind: "surface", partId: target.id, patch, depth: 2 },
    ]);

    expect(parts).toHaveLength(3);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(
      8000,
      2
    );
    expectSolids(parts);
  });

  it.each(["dowel", "keyed", "dovetail"] as const)(
    "adds matching %s connectors to a surface separation",
    (variant) => {
      const mesh = cubeMesh(20);
      const faces = topFaceIds(mesh);
      const patch = surfacePatch(mesh, faces);
      const parts = splitMesh(wasm, mesh, [
        {
          kind: "surface",
          partId: "0",
          patch,
          depth: 4,
          joint: {
            diameter: 4,
            length: 5,
            clearance: 0.2,
            count: 1,
            variant,
          },
        },
      ]);

      expect(parts).toHaveLength(2);
      expectSolids(parts);
      expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeGreaterThan(
        7900
      );
      expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeLessThan(
        8000
      );
    }
  );

  it("cuts paired magnet pockets into both halves of a planar contour split", () => {
    const sphere = wasm.Manifold.sphere(10, 24);
    const mesh = toMesh(sphere);
    sphere.delete();
    const selectedFaces = Array.from(
      { length: mesh.faces.length / 3 },
      (_, face) => face
    ).filter((face) =>
      [0, 1, 2].every(
        (corner) =>
          mesh.vertices[mesh.faces[face * 3 + corner] * 3 + 2] >= 5
      )
    );
    const patch = surfacePatch(mesh, selectedFaces);
    const operation = {
      kind: "surface" as const,
      mode: "piece" as const,
      capMode: "planar" as const,
      partId: "0",
      patch,
      depth: 4,
    };
    const baseline = splitMesh(wasm, mesh, [operation]);
    const parts = splitMesh(wasm, mesh, [
      {
        ...operation,
        joint: {
          diameter: 2,
          length: 2,
          clearance: 0.1,
          count: 1,
          variant: "magnet" as const,
        },
      },
    ]);
    const baselineVolumes = baseline
      .map((part) => part.volume)
      .sort((first, second) => first - second);
    const jointVolumes = parts
      .map((part) => part.volume)
      .sort((first, second) => first - second);
    const removedVolumes = baselineVolumes.map(
      (volume, index) => volume - jointVolumes[index]
    );

    expect(parts).toHaveLength(2);
    expect(removedVolumes.every((volume) => volume > 0.5)).toBe(true);
    expect(Math.abs(removedVolumes[0] - removedVolumes[1])).toBeLessThan(0.5);
    expectSolids(parts);
  });

  it.each(["dowel", "keyed", "dovetail"] as const)(
    "adds a matching %s connector to a complete contour piece",
    (variant) => {
      const sphere = wasm.Manifold.sphere(10, 24);
      const mesh = toMesh(sphere);
      sphere.delete();
      const selectedFaces = Array.from(
        { length: mesh.faces.length / 3 },
        (_, face) => face
      ).filter((face) =>
        [0, 1, 2].every(
          (corner) =>
            mesh.vertices[mesh.faces[face * 3 + corner] * 3 + 2] >= 5
        )
      );
      const patch = surfacePatch(mesh, selectedFaces);
      const parts = splitMesh(wasm, mesh, [
        {
          kind: "surface",
          mode: "piece",
          partId: "0",
          patch,
          depth: 4,
          joint: {
            diameter: 2,
            length: 3,
            clearance: 0.1,
            count: 1,
            variant,
          },
        },
      ]);

      expect(parts).toHaveLength(2);
      expectSolids(parts);
    }
  );

  it("splits a closed surface into a shell and core, and rejects invalid depth", () => {
    const mesh = cubeMesh(20);
    const allFaces = surfacePatch(
      mesh,
      Array.from({ length: mesh.faces.length / 3 }, (_, index) => index)
    );
    const parts = splitMesh(wasm, mesh, [
      {
        kind: "surface",
        mode: "shell",
        partId: "0",
        patch: allFaces,
        depth: 2,
      },
    ]);
    expect(parts).toHaveLength(2);
    expectSolids(parts);
    expect(parts.reduce((sum, part) => sum + part.volume, 0)).toBeCloseTo(
      8000,
      2
    );

    const oneFace = surfacePatch(mesh, [0]);
    expect(() =>
      splitMesh(wasm, mesh, [
        { kind: "surface", partId: "0", patch: oneFace, depth: 0 },
      ])
    ).toThrow(/profundidad/);
  });

  it("requires an open painted perimeter to extract a complete piece", () => {
    const mesh = cubeMesh(20);
    const allFaces = surfacePatch(
      mesh,
      Array.from({ length: mesh.faces.length / 3 }, (_, index) => index)
    );

    expect(() =>
      splitMesh(wasm, mesh, [
        {
          kind: "surface",
          mode: "piece",
          partId: "0",
          patch: allFaces,
          depth: 4,
        },
      ])
    ).toThrow(/contorno abierto/);
  });

  it("rejects an encastre that does not fit without returning partial pieces", () => {
    const mesh = cubeMesh(20);
    const patch = surfacePatch(mesh, topFaceIds(mesh));
    expect(() =>
      splitMesh(wasm, mesh, [
        {
          kind: "surface",
          partId: "0",
          patch,
          depth: 4,
          joint: {
            diameter: 30,
            length: 5,
            clearance: 0.2,
            count: 4,
            variant: "dowel",
          },
        },
      ])
    ).toThrow(/no cabe/);
  });
});

function surfacePatch(mesh: MeshData, selectedFaces: number[]) {
  const remap = new Map<number, number>();
  const vertices: number[] = [];
  const faces: number[] = [];
  for (const face of selectedFaces) {
    for (let corner = 0; corner < 3; corner += 1) {
      const sourceVertex = mesh.faces[face * 3 + corner];
      let targetVertex = remap.get(sourceVertex);
      if (targetVertex === undefined) {
        targetVertex = remap.size;
        remap.set(sourceVertex, targetVertex);
        vertices.push(
          mesh.vertices[sourceVertex * 3],
          mesh.vertices[sourceVertex * 3 + 1],
          mesh.vertices[sourceVertex * 3 + 2]
        );
      }
      faces.push(targetVertex);
    }
  }
  return { vertices, faces };
}

function topFaceIds(mesh: MeshData): number[] {
  return Array.from(
    { length: mesh.faces.length / 3 },
    (_, face) => face
  ).filter((face) =>
    [0, 1, 2].every(
      (corner) => mesh.vertices[mesh.faces[face * 3 + corner] * 3 + 2] === 10
    )
  );
}

function expectExactTriangles(
  mesh: MeshData,
  patch: { vertices: number[]; faces: number[] }
) {
  const keys = new Set<string>();
  for (let face = 0; face < mesh.faces.length / 3; face += 1) {
    keys.add(
      Array.from({ length: 3 }, (_, corner) => {
        const vertex = mesh.faces[face * 3 + corner];
        return [0, 1, 2]
          .map((axis) => mesh.vertices[vertex * 3 + axis].toFixed(5))
          .join(",");
      })
        .sort()
        .join("|")
    );
  }
  for (let face = 0; face < patch.faces.length / 3; face += 1) {
    const expected = Array.from({ length: 3 }, (_, corner) => {
      const vertex = patch.faces[face * 3 + corner];
      return [0, 1, 2]
        .map((axis) => patch.vertices[vertex * 3 + axis].toFixed(5))
        .join(",");
    })
      .sort()
      .join("|");
    expect(keys.has(expected)).toBe(true);
  }
}
