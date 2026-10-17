export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, type = "image/svg+xml"): void {
  downloadBlob(new Blob([text], { type }), filename);
}

export interface ZipEntry {
  name: string;
  content: Blob | string;
}

export async function downloadZip(
  entries: ZipEntry[],
  filename: string
): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(entry.name, entry.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, filename);
}

export function baseName(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/[^\w-]+/g, "_") || "imagen";
}
