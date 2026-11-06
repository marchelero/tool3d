import { describe, expect, it } from "vitest";
import { MeshContext } from "../core/MeshContext";
import type { TaskContext } from "../core/TaskContext";
import { CancelledError } from "../core/TaskContext";
import { suggestPerimeters } from "./BoundarySuggestionEngine";

function boxContext(size: number, divisions: number): MeshContext {
  const sides = [
    { origin: [size, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { origin: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { origin: [0, size, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { origin: [0, 0, size], u: [1, 0, 0], v: [0, 1, 0] },
    { origin: [0, 0, 0], u: [0, 1, 0], v: [1, 0, 0] },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const vertices = new Map<string, number>();
  const addVertex = (point: number[]) => {
    const key = point.join(",");
    const existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(...point);
    vertices.set(key, index);
    return index;
  };
  const pointAt = (side: (typeof sides)[number], i: number, j: number) => {
    const step = size / divisions;
    return side.origin.map((value, axis) => value + side.u[axis] * i * step + side.v[axis] * j * step);
  };

  for (const side of sides) {
    for (let i = 0; i < divisions; i++) {
      for (let j = 0; j < divisions; j++) {
        const a = addVertex(pointAt(side, i, j));
        const b = addVertex(pointAt(side, i + 1, j));
        const c = addVertex(pointAt(side, i + 1, j + 1));
        const d = addVertex(pointAt(side, i, j + 1));
        indices.push(a, b, c, a, c, d);
      }
    }
  }
  return new MeshContext({ positions: Float64Array.from(positions), indices: Uint32Array.from(indices) });
}

class CancelAtCheckpoint implements TaskContext {
  calls = 0;
  readonly cancelled = false;

  progress(): void {}

  async checkpoint(): Promise<void> {
    this.calls++;
    if (this.calls === 4) throw new CancelledError();
  }

  throwIfCancelled(): void {}
}

class RecordingTask implements TaskContext {
  readonly cancelled = false;
  readonly fractions: number[] = [];
  readonly messages: string[] = [];
  notifications = 0;

  progress(fraction: number, message?: string): void {
    this.notifications++;
    this.fractions.push(fraction);
    if (message) this.messages.push(message);
  }

  async checkpoint(message?: string, fraction?: number): Promise<void> {
    if (message !== undefined || fraction !== undefined) this.notifications++;
    if (fraction !== undefined) this.fractions.push(fraction);
    if (message) this.messages.push(message);
  }

  throwIfCancelled(): void {}
}

class CancelAtMessage extends RecordingTask {
  constructor(private readonly target: string) {
    super();
  }

  override async checkpoint(message?: string, fraction?: number): Promise<void> {
    await super.checkpoint(message, fraction);
    if (message === this.target) throw new CancelledError();
  }
}

function upperSelection(ctx: MeshContext): Uint8Array {
  const selection = new Uint8Array(ctx.nF);
  for (let face = 0; face < ctx.nF; face++) {
    const z = (ctx.P[3 * ctx.I[3 * face] + 2] + ctx.P[3 * ctx.I[3 * face + 1] + 2] + ctx.P[3 * ctx.I[3 * face + 2] + 2]) / 3;
    if (z > 20) selection[face] = 1;
  }
  return selection;
}

describe("BoundarySuggestionEngine", () => {
  it("propaga cancelación recibida durante el cálculo y no devuelve candidatos parciales", async () => {
    const ctx = boxContext(30, 3);
    const selection = new Uint8Array(ctx.nF);
    for (let face = 0; face < ctx.nF; face++) {
      const z = (ctx.P[3 * ctx.I[3 * face] + 2] + ctx.P[3 * ctx.I[3 * face + 1] + 2] + ctx.P[3 * ctx.I[3 * face + 2] + 2]) / 3;
      if (z > 20) selection[face] = 1;
    }
    const task = new CancelAtCheckpoint();

    await expect(suggestPerimeters(ctx, selection, task)).rejects.toBeInstanceOf(CancelledError);
    expect(task.calls).toBe(4);
  });

  it("mantiene el resultado determinista y el progreso monótono", async () => {
    const ctx = boxContext(30, 3);
    const selection = new Uint8Array(ctx.nF);
    for (let face = 0; face < ctx.nF; face++) {
      const z = (ctx.P[3 * ctx.I[3 * face] + 2] + ctx.P[3 * ctx.I[3 * face + 1] + 2] + ctx.P[3 * ctx.I[3 * face + 2] + 2]) / 3;
      if (z > 20) selection[face] = 1;
    }
    const task = new RecordingTask();

    const actual = await suggestPerimeters(ctx, selection, task);
    const repeated = await suggestPerimeters(ctx, selection);

    expect(actual).toEqual(repeated);
    expect(actual.suggestions.length + (actual.selectionBoundary ? 1 : 0)).toBeGreaterThan(0);
    expect(task.fractions.length).toBeGreaterThan(0);
    expect(task.fractions.every((fraction, index, all) => index === 0 || fraction >= all[index - 1])).toBe(true);
    expect(task.fractions.at(-1)).toBeLessThanOrEqual(1);
    expect(task.messages).toContain("Perímetro suave: resolviendo el corte mínimo");
  });

  it("cede durante los cálculos largos sin inundar el canal de progreso", async () => {
    const ctx = boxContext(30, 20);
    const selection = new Uint8Array(ctx.nF);
    for (let face = 0; face < ctx.nF; face++) {
      const z = (ctx.P[3 * ctx.I[3 * face] + 2] + ctx.P[3 * ctx.I[3 * face + 1] + 2] + ctx.P[3 * ctx.I[3 * face + 2] + 2]) / 3;
      if (z > 20) selection[face] = 1;
    }
    const task = new RecordingTask();

    await suggestPerimeters(ctx, selection, task);

    expect(task.notifications).toBeGreaterThan(0);
    expect(task.notifications).toBeLessThan(250);
  });

  it.each([
    "Buscando componentes seleccionados",
    "Rellenando huecos de la selección",
    "Extrayendo lazos del perímetro",
  ])("permite cancelar durante el recorrido: %s", async (phase) => {
    const ctx = boxContext(30, 20);
    const task = new CancelAtMessage(phase);

    await expect(suggestPerimeters(ctx, upperSelection(ctx), task)).rejects.toBeInstanceOf(CancelledError);
    expect(task.messages).toContain(phase);
  }, 30_000);
});
