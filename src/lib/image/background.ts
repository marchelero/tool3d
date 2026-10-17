export type ProgressCallback = (
  key: string,
  current: number,
  total: number
) => void;

export interface RemoveBackgroundOptions {
  model?: "isnet" | "isnet_fp16" | "isnet_quint8";
  onProgress?: ProgressCallback;
}

export async function removeBackgroundClient(
  source: Blob,
  options: RemoveBackgroundOptions = {}
): Promise<Blob> {
  const { removeBackground } = await import("@imgly/background-removal");
  return removeBackground(source, {
    model: options.model ?? "isnet_fp16",
    output: { format: "image/png" },
    progress: (key: string, current: number, total: number) => {
      options.onProgress?.(key, current, total);
    },
  });
}
