import { describe, expect, it } from "vitest";
import { MeshContext } from "../core/MeshContext";
import { CancelledError, type TaskContext, WorkerTaskContext } from "../core/TaskContext";
import { computeCurvature, computeCurvatureCooperative } from "./curvature";

function gridContext(divisions: number): MeshContext {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= divisions; y++) {
    for (let x = 0; x <= divisions; x++) positions.push(x, y, 0);
  }
  const row = divisions + 1;
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      const a = y * row + x;
      const b = a + 1;
      const d = a + row;
      const c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  return new MeshContext({
    positions: Float64Array.from(positions),
    indices: Uint32Array.from(indices),
  });
}

class CancelAtFirstCheckpoint implements TaskContext {
  readonly cancelled = false;
  calls = 0;
  messages: string[] = [];

  progress(): void {}

  async checkpoint(message?: string): Promise<void> {
    this.calls++;
    if (message) this.messages.push(message);
    throw new CancelledError();
  }

  throwIfCancelled(): void {}
}

class RecordingTask implements TaskContext {
  readonly cancelled = false;
  fractions: number[] = [];

  progress(fraction: number): void {
    this.fractions.push(fraction);
  }

  async checkpoint(_message?: string, fraction?: number): Promise<void> {
    if (fraction !== undefined) this.fractions.push(fraction);
  }

  throwIfCancelled(): void {}
}

describe("computeCurvatureCooperative", () => {
  it("propaga cancelación durante la pasada de aristas sin guardar un campo parcial", async () => {
    const ctx = gridContext(24);
    const task = new CancelAtFirstCheckpoint();

    await expect(computeCurvatureCooperative(ctx, 0.1, task)).rejects.toBeInstanceOf(CancelledError);

    expect(task.calls).toBe(1);
    expect(task.messages[0]).toContain("curvatura");
    expect(ctx.cache.has("curv:0.1")).toBe(false);
  });

  it("cede al event loop para que el worker procese una cancelación real", async () => {
    const ctx = gridContext(24);
    const task = new WorkerTaskContext(() => {});
    const timer = setTimeout(() => task.cancel(), 0);

    await expect(computeCurvatureCooperative(ctx, 0.1, task)).rejects.toBeInstanceOf(CancelledError);
    clearTimeout(timer);
    expect(ctx.cache.has("curv:0.1")).toBe(false);
  });

  it("mantiene arrays numéricamente idénticos y progreso monótono", async () => {
    const expected = computeCurvature(gridContext(12), 0.1);
    const task = new RecordingTask();
    const actual = await computeCurvatureCooperative(gridContext(12), 0.1, task);

    expect(actual.H).toEqual(expected.H);
    expect(actual.kmin).toEqual(expected.kmin);
    expect(actual.valley).toEqual(expected.valley);
    expect(actual.valleyFace).toEqual(expected.valleyFace);
    expect(actual.scale).toBe(expected.scale);
    expect(actual.reference).toBe(expected.reference);
    expect(task.fractions.length).toBeGreaterThan(0);
    expect(task.fractions.every((fraction, index, all) => index === 0 || fraction >= all[index - 1])).toBe(true);
  });
});
