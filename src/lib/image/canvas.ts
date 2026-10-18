export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function get2d(
  canvas: HTMLCanvasElement,
  readFrequently = false
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", {
    willReadFrequently: readFrequently,
  });
  if (!ctx) {
    throw new Error("No se pudo obtener el contexto 2D del canvas");
  }
  return ctx;
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo cargar la imagen"));
    };
    image.src = url;
  });
}

export async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const image = await loadImageFromFile(file);
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
  get2d(canvas).drawImage(image, 0, 0);
  return canvas;
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const file = new File([blob], "result.png", { type: blob.type || "image/png" });
  return imageFileToCanvas(file);
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("No se pudo exportar el canvas"));
        }
      },
      type,
      quality
    );
  });
}

export function extractRegion(
  src: ImageData,
  x: number,
  y: number,
  width: number,
  height: number
): ImageData {
  const out = new ImageData(width, height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const srcIndex = ((y + row) * src.width + (x + col)) * 4;
      const dstIndex = (row * width + col) * 4;
      out.data[dstIndex] = src.data[srcIndex];
      out.data[dstIndex + 1] = src.data[srcIndex + 1];
      out.data[dstIndex + 2] = src.data[srcIndex + 2];
      out.data[dstIndex + 3] = src.data[srcIndex + 3];
    }
  }
  return out;
}
