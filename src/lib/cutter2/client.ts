import type { EngineApi, EngineMethod, WorkerRequest, WorkerResponse } from "./worker/protocol";

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: string,
    readonly cancelled = false
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface CallOptions {
  onProgress?: (fraction: number, message?: string) => void;
  transfer?: Transferable[];
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onProgress?: (fraction: number, message?: string) => void;
}

/**
 * Cliente del motor geométrico: Web Worker persistente con llamadas tipadas,
 * progreso, cancelación y reinicio automático si el worker se cae.
 */
export class Cutter2Client {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./worker/engine.worker", import.meta.url));
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    worker.onerror = (ev) => {
      this.failAll(new EngineError("El motor geométrico se detuvo.", "worker-crash", ev.message));
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private onMessage(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") {
      p.onProgress?.(msg.fraction, msg.message);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === "result") p.resolve(msg.result);
    else p.reject(new EngineError(msg.error.message, msg.error.code, msg.error.details, !!msg.error.cancelled));
  }

  private failAll(error: unknown): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  call<M extends EngineMethod>(
    method: M,
    args: Parameters<EngineApi[M]>,
    opts: CallOptions = {}
  ): { id: number; promise: ReturnType<EngineApi[M]> } {
    const id = this.nextId++;
    const worker = this.ensure();
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress: opts.onProgress });
      const req: WorkerRequest = { type: "call", id, method, args: args as unknown[] };
      worker.postMessage(req, opts.transfer ?? []);
    }) as unknown as ReturnType<EngineApi[M]>;
    return { id, promise };
  }

  run<M extends EngineMethod>(method: M, ...args: Parameters<EngineApi[M]>): ReturnType<EngineApi[M]> {
    return this.call(method, args).promise;
  }

  cancel(id: number): void {
    const req: WorkerRequest = { type: "cancel", id };
    this.worker?.postMessage(req);
  }

  dispose(): void {
    this.failAll(new EngineError("El motor se cerró.", "disposed", undefined, true));
    this.worker?.terminate();
    this.worker = null;
  }
}
