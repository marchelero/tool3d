/// <reference lib="webworker" />
import { getManifoldWasmUrl } from '../wasm';
import { EngineService } from '../engine/service/EngineService';
import { CancelledError, GeometryError, WorkerTaskContext } from '../engine/core/TaskContext';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const service = new EngineService(() => getManifoldWasmUrl());
const tasks = new Map<number, WorkerTaskContext>();

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

/** Recolecta los buffers de los arreglos tipados del resultado para transferirlos sin copiar. */
function transferables(value: unknown, out: Set<ArrayBuffer> = new Set(), depth = 0): Set<ArrayBuffer> {
  if (!value || typeof value !== 'object' || depth > 6) return out;
  if (ArrayBuffer.isView(value)) {
    const buf = value.buffer;
    if (buf instanceof ArrayBuffer && value.byteOffset === 0 && value.byteLength === buf.byteLength) out.add(buf);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) transferables(v, out, depth + 1);
    return out;
  }
  for (const v of Object.values(value as Record<string, unknown>)) transferables(v, out, depth + 1);
  return out;
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    tasks.get(msg.id)?.cancel();
    return;
  }
  const { id, method, args } = msg;
  const task = new WorkerTaskContext((fraction, message) => post({ type: 'progress', id, fraction, message }));
  tasks.set(id, task);
  try {
    const fn = (service as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
    if (typeof fn !== 'function') throw new Error(`Método desconocido: ${method}`);
    const result = await fn.call(service, ...args, task);
    post({ type: 'result', id, result }, [...transferables(result)]);
  } catch (e) {
    if (e instanceof CancelledError) {
      post({ type: 'error', id, error: { name: 'CancelledError', message: e.message, cancelled: true } });
    } else if (e instanceof GeometryError) {
      post({ type: 'error', id, error: { name: e.name, message: e.message, code: e.code, details: e.details } });
    } else {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(err);
      post({ type: 'error', id, error: { name: err.name, message: 'Ocurrió un error inesperado en el motor geométrico.', details: err.message } });
    }
  } finally {
    tasks.delete(id);
  }
};
