import { describe, expect, it } from "vitest";
import type { CutterPartView } from "./types";
import { buildAssemblyReport } from "./report";

const parts: CutterPartView[] = [
  {
    id: "a",
    name: "Pieza 1",
    mesh: { vertices: new Float32Array(), faces: new Uint32Array() },
    color: "#ff0000",
    volume: 4000,
    diagnostics: {
      vertices: 8,
      triangles: 12,
      openEdges: 0,
      nonManifoldEdges: 0,
      boundaryLoops: 0,
      components: 1,
      volume: 4000,
      watertight: true,
      outward: true,
    },
  },
  {
    id: "b",
    name: "Pieza 2",
    mesh: { vertices: new Float32Array(), faces: new Uint32Array() },
    color: "#00ff00",
    volume: 3900,
    diagnostics: {
      vertices: 8,
      triangles: 12,
      openEdges: 0,
      nonManifoldEdges: 0,
      boundaryLoops: 0,
      components: 1,
      volume: 3900,
      watertight: true,
      outward: true,
    },
  },
];

describe("buildAssemblyReport", () => {
  it("lists pieces, cuts and joint measurements", () => {
    const report = buildAssemblyReport({
      fileName: "cascanueces.stl",
      parts,
      ops: [
        {
          id: "p1",
          kind: "plane",
          axis: "z",
          offset: 0,
          enabled: true,
          joint: { diameter: 5, length: 6, clearance: 0.15, count: 2 },
        },
      ],
      totalVolume: 7900,
      generatedAt: new Date("2026-10-24T12:00:00Z"),
    });
    expect(report).toContain("Pieza 1");
    expect(report).toContain("Pieza 2");
    expect(report).toContain("Ø5,0 mm");
    expect(report).toContain("×2");
    expect(report).toContain("7,90 cm³");
  });
});
