import type { MeshData } from "@/lib/mesh/types";
import type {
  ComputeCutResult,
  CutterResponse,
  CutSpec,
  SeparateResult,
  SuggestResult,
} from "./types";

export class CutterProcessor {
  private worker: Worker | null = null;
  private rejectCurrent: ((reason?: unknown) => void) | null = null;
  private nextId = 1;

  cut(
    mesh: MeshData,
    ops: CutSpec[],
    wasmUrl: string,
    onProgress?: (progress: number, phase: string) => void
  ): Promise<ComputeCutResult> {
    this.cancel();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<ComputeCutResult>((resolve, reject) => {
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
      worker.onmessage = (event: MessageEvent<CutterResponse>) => {
        const message = event.data;
        if (!message || message.id !== id) return;
        if (message.type === "progress") {
          onProgress?.(message.progress, message.phase);
          return;
        }
        if (message.type === "cut-result") {
          cleanup();
          resolve(message.result);
          return;
        }
        if (
          message.type === "suggest-result" ||
          message.type === "separate-result"
        ) {
          return;
        }
        cleanup();
        reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || "No se pudo cortar la pieza"));
      };
      try {
        worker.postMessage({
          type: "cut",
          id,
          wasmUrl,
          mesh,
          ops,
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  suggest(
    mesh: MeshData,
    wasmUrl: string,
    onProgress?: (progress: number, phase: string) => void
  ): Promise<SuggestResult> {
    this.cancel();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<SuggestResult>((resolve, reject) => {
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
      worker.onmessage = (event: MessageEvent<CutterResponse>) => {
        const message = event.data;
        if (!message || message.id !== id) return;
        if (message.type === "progress") {
          onProgress?.(message.progress, message.phase);
          return;
        }
        if (message.type === "suggest-result") {
          cleanup();
          resolve(message.result);
          return;
        }
        if (message.type === "cut-result" || message.type === "separate-result") {
          return;
        }
        cleanup();
        reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || "No se pudo analizar la pieza"));
      };
      try {
        worker.postMessage({ type: "suggest", id, wasmUrl, mesh });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  separate(
    mesh: MeshData,
    wasmUrl: string,
    onProgress?: (progress: number, phase: string) => void
  ): Promise<SeparateResult> {
    this.cancel();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<SeparateResult>((resolve, reject) => {
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
      worker.onmessage = (event: MessageEvent<CutterResponse>) => {
        const message = event.data;
        if (!message || message.id !== id) return;
        if (message.type === "progress") {
          onProgress?.(message.progress, message.phase);
          return;
        }
        if (message.type === "separate-result") {
          cleanup();
          resolve(message.result);
          return;
        }
        if (message.type === "cut-result" || message.type === "suggest-result") {
          return;
        }
        cleanup();
        reject(new Error(message.message));
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(event.message || "No se pudo separar la pieza"));
      };
      try {
        worker.postMessage({ type: "separate", id, wasmUrl, mesh });
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



