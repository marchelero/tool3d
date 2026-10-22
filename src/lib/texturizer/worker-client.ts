import type { ProcessOptions, ProcessResult, WorkerResponse } from "./types";

export class TexturizerProcessor {
  private worker: Worker | null = null;
  private rejectCurrent: ((reason?: unknown) => void) | null = null;
  private nextId = 1;

  process(
    positions: Float32Array,
    options: ProcessOptions,
    onProgress?: (progress: number, phase: string) => void
  ): Promise<ProcessResult> {
    this.cancel();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<ProcessResult>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL("./worker", import.meta.url));
      } catch (error) {
        reject(error);
        return;
      }
      this.worker = worker;
      this.rejectCurrent = reject;
      const cleanup = () => {
        worker.terminate();
        if (this.worker === worker) this.worker = null;
        if (this.rejectCurrent === reject) this.rejectCurrent = null;
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (!message || message.id !== id) return;
        if (message.type === "progress") {
          onProgress?.(message.progress, message.phase);
          return;
        }
        if (message.type === "result") {
          cleanup();
          resolve(message.result);
          return;
        }
        cleanup();
        reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || "No se pudo procesar la malla"));
      };
      try {
        worker.postMessage({ type: "process", id, positions, options });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  cancel(): void {
    const worker = this.worker;
    const reject = this.rejectCurrent;
    this.worker = null;
    this.rejectCurrent = null;
    if (worker) worker.terminate();
    if (reject) reject(new Error("cancelado"));
  }
}
