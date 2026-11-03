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

  it("describes legacy surface separation depth and connector variant", () => {
    const report = buildAssemblyReport({
      fileName: "pieza.3mf",
      parts,
      ops: [
        {
          id: "surface-1",
          kind: "surface",
          enabled: true,
          partId: "0",
          patch: { vertices: [0, 0, 0], faces: [0, 0, 0] },
          depth: 3.5,
          joint: {
            diameter: 4,
            length: 5,
            clearance: 0.2,
            variant: "dovetail",
          },
        },
      ],
      totalVolume: 7900,
      generatedAt: new Date("2026-10-24T12:00:00Z"),
    });

    expect(report).toContain("Cáscara superficial (3,5 mm)");
    expect(report).toContain("cola de milano");
  });

  it("describes a complete contour extraction and its flat cap", () => {
    const report = buildAssemblyReport({
      fileName: "figura.stl",
      parts,
      ops: [
        {
          id: "surface-piece",
          kind: "surface",
          mode: "piece",
          capMode: "planar",
          enabled: true,
          partId: "0",
          patch: { vertices: [0, 0, 0], faces: [0, 0, 0] },
          depth: 4,
        },
      ],
      totalVolume: 7900,
      generatedAt: new Date("2026-10-24T12:00:00Z"),
    });

    expect(report).toContain("Pieza completa por contorno");
    expect(report).toContain("tapa recta");
    expect(report).not.toContain("Cáscara superficial");
  });

  it("describes a complete contour extraction that follows its 3D rim", () => {
    const report = buildAssemblyReport({
      fileName: "figura.stl",
      parts,
      ops: [
        {
          id: "surface-follow",
          kind: "surface",
          mode: "piece",
          capMode: "follow",
          enabled: true,
          partId: "0",
          patch: { vertices: [0, 0, 0], faces: [0, 0, 0] },
          depth: 4,
        },
      ],
      totalVolume: 7900,
      generatedAt: new Date("2026-10-24T12:00:00Z"),
    });

    expect(report).toContain("contorno 3D");
  });

  it("describes paired magnet pockets and their radial clearance", () => {
    const report = buildAssemblyReport({
      fileName: "figura.stl",
      parts,
      ops: [
        {
          id: "plane-magnets",
          kind: "plane",
          axis: "z",
          offset: 0,
          enabled: true,
          joint: {
            diameter: 6,
            length: 3,
            clearance: 0.2,
            count: 2,
            variant: "magnet",
          },
        },
      ],
      totalVolume: 7900,
      generatedAt: new Date("2026-10-24T12:00:00Z"),
    });

    expect(report).toContain("alojamientos para imanes Ø6,0 mm");
    expect(report).toContain("profundidad 3,0 mm");
    expect(report).toContain("holgura radial 0,20 mm");
    expect(report).toContain("×2");
  });
});
