import { splitMesh } from "./split";
import { suggestCuts } from "./suggest";
import { detectSeparationPlanes } from "./seams";
import { loadManifold } from "./manifold";
import type {
  CutterRequest,
  CutterResponse,
  SeparationPlane,
} from "./types";

interface WorkerScope {
  postMessage: (message: CutterResponse, transfer?: Transferable[]) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<CutterRequest>) => void
  ) => void;
}

const scope = self as unknown as WorkerScope;

async function runCut(
  request: Extract<CutterRequest, { type: "cut" }>,
  started: number
) {
  const wasm = await loadManifold(request.wasmUrl);
  const warnings: string[] = [];
  const parts = splitMesh(
    wasm,
    request.mesh,
    request.ops,
    (progress) => {
      scope.postMessage({
        type: "progress",
        id: request.id,
        progress,
        phase: "Cortando la pieza",
      });
    },
    (warning) => warnings.push(warning)
  );

  const transfer: Transferable[] = [];
  for (const part of parts) {
    transfer.push(part.mesh.vertices.buffer, part.mesh.faces.buffer);
  }

  scope.postMessage(
    {
      type: "cut-result",
      id: request.id,
      result: { parts, ms: performance.now() - started, warnings },
    },
    transfer
  );
}

async function runSuggest(
  request: Extract<CutterRequest, { type: "suggest" }>,
  started: number
) {
  const wasm = await loadManifold(request.wasmUrl);
  const suggestions = suggestCuts(wasm, request.mesh, (progress) => {
    scope.postMessage({
      type: "progress",
      id: request.id,
      progress,
      phase: "Analizando la forma de la pieza",
    });
  });
  scope.postMessage({
    type: "suggest-result",
    id: request.id,
    result: { suggestions, ms: performance.now() - started },
  });
}

async function runSeparate(
  request: Extract<CutterRequest, { type: "separate" }>,
  started: number
) {
  const wasm = await loadManifold(request.wasmUrl);
  const onProgress = (progress: number) => {
    scope.postMessage({
      type: "progress",
      id: request.id,
      progress,
      phase: "Buscando uniones entre formas",
    });
  };
  let planes: SeparationPlane[] = detectSeparationPlanes(
    wasm,
    request.mesh,
    onProgress
  );
  if (planes.length === 0) {
    const suggestions = suggestCuts(wasm, request.mesh, onProgress);
    planes = suggestions.map((suggestion) => ({
      normal:
        suggestion.axis === "x"
          ? [1, 0, 0]
          : suggestion.axis === "y"
            ? [0, 1, 0]
            : [0, 0, 1],
      offset: suggestion.offset,
      label: "Estrechamiento de la pieza",
      source: "neck",
      score: 1 - suggestion.ratio,
    }));
  }
  scope.postMessage({
    type: "separate-result",
    id: request.id,
    result: { planes, ms: performance.now() - started },
  });
}

scope.addEventListener("message", (event) => {
  const request = event.data as CutterRequest | undefined;
  if (
    !request ||
    (request.type !== "cut" &&
      request.type !== "suggest" &&
      request.type !== "separate")
  ) {
    return;
  }

  const started = performance.now();
  scope.postMessage({
    type: "progress",
    id: request.id,
    progress: 0.05,
    phase:
      request.type === "cut"
        ? "Preparando el motor"
        : request.type === "separate"
          ? "Buscando uniones entre formas"
          : "Buscando cortes naturales",
  });

  const task =
    request.type === "cut"
      ? runCut(request, started)
      : request.type === "separate"
        ? runSeparate(request, started)
        : runSuggest(request, started);

  task.catch((error: unknown) => {
    scope.postMessage({
      type: "error",
      id: request.id,
      message:
        error instanceof Error ? error.message : "No se pudo procesar la pieza",
    });
  });
});

