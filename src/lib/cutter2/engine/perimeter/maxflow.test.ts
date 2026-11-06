import { describe, expect, it } from "vitest";
import { CancelledError, type TaskContext } from "../core/TaskContext";
import { MaxFlow } from "./maxflow";

class CancelAtCheckpoint implements TaskContext {
  calls = 0;
  readonly cancelled = false;

  progress(): void {}

  async checkpoint(): Promise<void> {
    this.calls++;
    if (this.calls === 3) throw new CancelledError();
  }

  throwIfCancelled(): void {}
}

describe("MaxFlow", () => {
  it("resuelve el flujo máximo y conserva la parte residual", async () => {
    const flow = new MaxFlow(4);
    flow.addEdge(0, 1, 3);
    flow.addEdge(0, 2, 2);
    flow.addEdge(1, 2, 1);
    flow.addEdge(1, 3, 2);
    flow.addEdge(2, 3, 3);

    await expect(flow.solve(0, 3)).resolves.toBe(5);
    expect(await flow.sourceSide(0)).toHaveLength(4);
  });

  it("cede entre bloques de trabajo para poder cancelar antes de terminar", async () => {
    const size = 2048;
    const flow = new MaxFlow(size);
    for (let node = 0; node < size - 1; node++) flow.addEdge(node, node + 1, 1);
    const task = new CancelAtCheckpoint();

    await expect(flow.solve(0, size - 1, 1e-12, task)).rejects.toBeInstanceOf(CancelledError);
    expect(task.calls).toBe(3);
  });
});
