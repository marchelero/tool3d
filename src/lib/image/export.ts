import { canvasToBlob, createCanvas, get2d } from "./canvas";

function flattenOnWhite(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(canvas.width, canvas.height);
  const ctx = get2d(out, true);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

export function canvasToBmp(canvas: HTMLCanvasElement): Blob {
  const { width, height } = canvas;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);

  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelDataSize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  const flat = flattenOnWhite(canvas);
  const { data } = get2d(flat, true).getImageData(0, 0, width, height);

  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    let rowOffset = offset;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      bytes[rowOffset++] = data[i + 2];
      bytes[rowOffset++] = data[i + 1];
      bytes[rowOffset++] = data[i];
    }
    offset += rowSize;
  }

  return new Blob([buffer], { type: "image/bmp" });
}

export async function canvasToIco(canvas: HTMLCanvasElement): Promise<Blob> {
  const size = 256;
  const out = createCanvas(size, size);
  const ctx = get2d(out, true);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const scale = Math.min(size / canvas.width, size / canvas.height, 1);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  ctx.drawImage(
    canvas,
    Math.round((size - w) / 2),
    Math.round((size - h) / 2),
    w,
    h
  );

  const pngBlob = await canvasToBlob(out, "image/png");
  const png = new Uint8Array(await pngBlob.arrayBuffer());

  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, png.length, true);
  view.setUint32(18, 22, true);

  return new Blob([header, png], { type: "image/x-icon" });
}
