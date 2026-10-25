import type { ManifoldToplevel } from "manifold-3d";

let loadPromise: Promise<ManifoldToplevel> | null = null;

export function getManifoldWasmUrl(): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${basePath}/wasm/manifold.wasm`;
}

export function loadManifold(wasmUrl: string): Promise<ManifoldToplevel> {
  if (!loadPromise) {
    loadPromise = import("manifold-3d")
      .then(async ({ default: Module }) => {
        const wasm = await Module({ locateFile: () => wasmUrl });
        wasm.setup();
        return wasm;
      })
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
  }
  return loadPromise;
}
