import { describe, expect, it } from "vitest";
import { EngineService } from "./engine/service/EngineService";

/** Cubo subdividido (n×n por cara) como sopa de triángulos orientados hacia afuera. */
function boxTriangles(s: number, n: number): number[][] {
  const faces: Array<{ o: number[]; u: number[]; v: number[] }> = [
    { o: [s, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { o: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { o: [0, s, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { o: [0, 0, s], u: [1, 0, 0], v: [0, 1, 0] },
    { o: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  const tris: number[][] = [];
  const p = (f: { o: number[]; u: number[]; v: number[] }, i: number, j: number): number[] => {
    const t = s / n;
    return [f.o[0] + f.u[0] * i * t + f.v[0] * j * t, f.o[1] + f.u[1] * i * t + f.v[1] * j * t, f.o[2] + f.u[2] * i * t + f.v[2] * j * t];
  };
  for (const f of faces) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const a = p(f, i, j), b = p(f, i + 1, j), c = p(f, i + 1, j + 1), d = p(f, i, j + 1);
        tris.push([...a, ...b, ...c], [...a, ...c, ...d]);
      }
    }
  }
  return tris;
}

function toAsciiStl(tris: number[][]): ArrayBuffer {
  const lines: string[] = ["solid cubo"];
  for (const t of tris) {
    lines.push(" facet normal 0 0 0", "  outer loop");
    for (let k = 0; k < 9; k += 3) lines.push(`   vertex ${t[k]} ${t[k + 1]} ${t[k + 2]}`);
    lines.push("  endloop", " endfacet");
  }
  lines.push("endsolid cubo");
  return new TextEncoder().encode(lines.join("\n")).buffer as ArrayBuffer;
}

describe("motor cutter2", () => {
  it("carga, selecciona, sugiere perímetro, corta, encastra y exporta", async () => {
    const service = new EngineService();
    const S = 30;
    const { model, doc } = await service.loadModel("cubo.stl", toAsciiStl(boxTriangles(S, 3)));
    expect(model.format).toBe("stl-ascii");
    expect(doc.pieces).toHaveLength(1);
    const piece = doc.pieces[0];
    expect(piece.valid).toBe(true);
    expect(piece.triangleCount).toBe(108);
    expect(piece.volume).toBeCloseTo(S ** 3, 3);

    const analysis = await service.analyzeModel();
    expect(analysis.status).toBe("ok");
    expect(analysis.cuttable).toBe(true);

    const geom = doc.geometries[0];
    const P = geom.positions;
    const I = geom.indices;
    const nF = I.length / 3;
    const selection = new Uint8Array(nF);
    let picked = 0;
    for (let f = 0; f < nF; f++) {
      const z = (P[3 * I[3 * f] + 2] + P[3 * I[3 * f + 1] + 2] + P[3 * I[3 * f + 2] + 2]) / 3;
      if (z > 20) { selection[f] = 1; picked++; }
    }
    expect(picked).toBeGreaterThan(18);

    const sel = await service.getSelectionData(piece.id);
    expect(sel.faceRegion.length).toBe(nF);
    expect(sel.merges.length % 3).toBe(0);

    const suggestions = await service.suggestPerimeters(piece.id, selection);
    expect(suggestions.suggestions.length + (suggestions.selectionBoundary ? 1 : 0)).toBeGreaterThan(0);
    const best = suggestions.suggestions[0] ?? suggestions.selectionBoundary!;
    expect(best.controlPoints.length).toBeGreaterThanOrEqual(6);

    const per = await service.computePerimeter(piece.id, {
      points: best.controlPoints, closed: true, magnet: 1, smoothing: 0.4, locked: best.locked,
    });
    expect(per.closed).toBe(true);
    expect(per.valid).toBe(true);
    expect(per.length).toBeGreaterThan(90);
    expect(per.length).toBeLessThan(160);

    const sep = await service.checkSeparation(piece.id, per.key);
    expect(sep.separates).toBe(true);

    const cut = await service.previewCut(piece.id, per.key, { method: "planar", depth: 0, selection });
    expect(cut.valid).toBe(true);
    expect(cut.volumes.relativeError).toBeLessThan(1e-3);
    expect(cut.extracted.volume).toBeGreaterThan(7000);
    expect(cut.remainder.volume).toBeGreaterThan(15000);

    const afterCut = await service.commitCut(cut.previewId, { extracted: "Tapa", remainder: "Cuerpo" });
    expect(afterCut.pieces).toHaveLength(2);
    expect(afterCut.seams).toHaveLength(1);
    expect(afterCut.seams[0].info.inradius).toBeGreaterThan(10);
    expect(afterCut.seams[0].info.planar).toBe(true);

    const seam = afterCut.seams[0];
    const profile = (await service.toleranceProfiles())[1];
    const suggested = await service.suggestJoint(seam.id, profile.id);
    expect(suggested.params?.type).toBe("peg");
    const joint = await service.previewJoint(seam.id, suggested.params!);
    expect(joint.valid).toBe(true);
    expect(joint.metrics.assemblyClear).toBe(true);
    const afterJoint = await service.commitJoint(joint.previewId);
    expect(afterJoint.pieces.every((p) => p.hasJoint)).toBe(true);

    const exported = await service.exportFiles({
      pieceIds: afterJoint.pieces.map((p) => p.id), format: "stl", placement: "print", baseName: "cubo",
    });
    expect(exported.files).toHaveLength(2);
    expect(exported.files[0].data.length).toBeGreaterThan(84);
    expect(exported.skipped).toHaveLength(0);

    const three = await service.exportFiles({
      pieceIds: afterJoint.pieces.map((p) => p.id), format: "3mf", placement: "original", baseName: "cubo",
    });
    expect(three.files[0].name).toBe("cubo.3mf");
    expect(three.files[0].data.length).toBeGreaterThan(1000);

    const undone = await service.undo();
    expect(undone.pieces.some((p) => !p.hasJoint)).toBe(true);
    const redone = await service.redo();
    expect(redone.pieces.every((p) => p.hasJoint)).toBe(true);
  }, 180_000);
});

