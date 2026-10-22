import { processMesh } from "./displace";
import type { ProcessRequest, WorkerResponse } from "./types";

interface WorkerScope {
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<ProcessRequest>) => void
  ) => void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (!request || request.type !== "process") return;
  const { id, positions, options } = request;
  try {
    const result = processMesh(positions, options, (progress, phase) => {
      scope.postMessage({ type: "progress", id, progress, phase });
    });
    scope.postMessage({ type: "result", id, result }, [
      result.positions.buffer,
      result.indices.buffer,
      result.normals.buffer,
    ]);
  } catch (error) {
    scope.postMessage({
      type: "error",
      id,
      message:
        error instanceof Error ? error.message : "No se pudo procesar la malla",
    });
  }
});
