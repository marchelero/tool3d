import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EngineService } from "./engine/service/EngineService";
import { WorkerTaskContext } from "./engine/core/TaskContext";

const sourcePath = "C:/Users/Marcelo/Downloads/Pokemon+mini+Toys_stls/obj_2_Charmander mini.stl";
const sourceName = "obj_2_Charmander mini.stl";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function makeUpperSelection(positions: Float32Array, indices: Uint32Array): Uint8Array {
  const faceCount = indices.length / 3;
  const selection = new Uint8Array(faceCount);
  for (let face = 0; face < faceCount; face++) {
    const a = indices[face * 3] * 3;
    const b = indices[face * 3 + 1] * 3;
    const c = indices[face * 3 + 2] * 3;
    const centerZ = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    if (centerZ > 20) selection[face] = 1;
  }
  return selection;
}

describe("Charmander real async cooperative smoke", () => {
  it("keeps selection, suggestions, cut and exports valid", async () => {
    const progress: Array<{ fraction: number; message?: string }> = [];
    const task = new WorkerTaskContext((fraction, message) => progress.push({ fraction, message }));
    const source = await readFile(sourcePath);
    const service = new EngineService();
    const loaded = await service.loadModel(sourceName, arrayBuffer(source), task);
    const piece = loaded.doc.pieces[0];
    const geometry = loaded.doc.geometries[0];

    expect(loaded.model.fileTriangleCount).toBe(303_090);
    expect(piece).toBeDefined();
    expect(geometry).toBeDefined();

    const selection = makeUpperSelection(geometry.positions, geometry.indices);
    expect(selection.reduce((sum, value) => sum + value, 0)).toBe(106_061);
    const selectionData = await service.getSelectionData(piece.id, task);
    expect(selectionData.faceAreas).toHaveLength(303_090);

    const progressStart = progress.length;
    const suggestions = await service.suggestPerimeters(piece.id, selection, task);
    const suggestionProgress = progress.slice(progressStart);
    expect(suggestions.suggestions).toHaveLength(2);
    expect(suggestions.selectionBoundary).toBeDefined();
    expect(suggestionProgress.length).toBeGreaterThan(10);
    expect(suggestionProgress.length).toBeLessThan(1_500);
    const progressRegression = suggestionProgress.slice(1).find((item, index) =>
      item.fraction < suggestionProgress[index].fraction
    );
    if (progressRegression) {
      const regressionIndex = suggestionProgress.indexOf(progressRegression);
      const previous = suggestionProgress[regressionIndex - 1];
      throw new Error(`Progress retrocedió: ${JSON.stringify({ previous, current: progressRegression })}`);
    }
    expect(suggestionProgress.at(-1)?.fraction).toBe(1);

    const candidates = [
      ...suggestions.suggestions,
      ...(suggestions.selectionBoundary ? [suggestions.selectionBoundary] : []),
    ];
    let cutPreview: Awaited<ReturnType<typeof service.previewCut>> | null = null;
    for (const candidate of candidates) {
      const perimeter = await service.computePerimeter(piece.id, {
        points: candidate.controlPoints,
        closed: true,
        magnet: 1,
        smoothing: 0.4,
        locked: candidate.locked,
      });
      if (!perimeter.valid) continue;
      const separation = await service.checkSeparation(piece.id, perimeter.key, task);
      if (!separation.separates) continue;
      const preview = await service.previewCut(piece.id, perimeter.key, {
        method: "planar",
        depth: 0,
        selection,
      }, task);
      if (!preview.valid) continue;
      cutPreview = preview;
      break;
    }

    expect(cutPreview).not.toBeNull();
    const committed = await service.commitCut(cutPreview!.previewId, {
      extracted: "Parte seleccionada",
      remainder: "Resto",
    });
    expect(committed.pieces).toHaveLength(2);

    const pieceIds = committed.pieces.map((item) => item.id);
    const stl = await service.exportFiles({
      pieceIds,
      format: "stl",
      placement: "print",
      baseName: "Charmander smoke",
    }, task);
    const threeMf = await service.exportFiles({
      pieceIds,
      format: "3mf",
      placement: "original",
      baseName: "Charmander smoke",
    }, task);
    expect(stl.files).toHaveLength(2);
    expect(stl.files.every((file) => file.data.byteLength > 0)).toBe(true);
    expect(threeMf.files).toHaveLength(1);
    expect(threeMf.files[0].data.byteLength).toBeGreaterThan(0);

    for (const file of stl.files) {
      const roundTrip = new EngineService();
      const imported = await roundTrip.loadModel(file.name, arrayBuffer(file.data), task);
      expect(imported.model.fileTriangleCount).toBeGreaterThan(0);
      const report = await roundTrip.analyzeModel({}, task);
      expect(report.cuttable).toBe(true);
      expect(report.boundaryEdges).toBe(0);
    }

    const roundTrip3mf = new EngineService();
    const imported3mf = await roundTrip3mf.loadModel(threeMf.files[0].name, arrayBuffer(threeMf.files[0].data), task);
    expect(imported3mf.model.fileTriangleCount).toBe(
      committed.pieces.reduce((sum, item) => sum + item.triangleCount, 0)
    );
    expect((await roundTrip3mf.analyzeModel({}, task)).cuttable).toBe(true);
  }, 300_000);
});
