/** URL pública del WebAssembly de Manifold (misma que usa el cortador v1). */
export function getManifoldWasmUrl(): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return `${base}/wasm/manifold.wasm`;
}
