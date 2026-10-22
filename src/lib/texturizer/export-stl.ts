import { downloadBlob } from "@/lib/image/download";

export function estimateStlBytes(triangles: number): number {
  return 84 + Math.max(0, triangles) * 50;
}

function writeNormalAndTriangle(
  view: DataView,
  offset: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): number {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length > 1e-12) {
    nx /= length;
    ny /= length;
    nz /= length;
  } else {
    nx = 0;
    ny = 0;
    nz = 0;
  }
  view.setFloat32(offset, nx, true);
  view.setFloat32(offset + 4, ny, true);
  view.setFloat32(offset + 8, nz, true);
  view.setFloat32(offset + 12, ax, true);
  view.setFloat32(offset + 16, ay, true);
  view.setFloat32(offset + 20, az, true);
  view.setFloat32(offset + 24, bx, true);
  view.setFloat32(offset + 28, by, true);
  view.setFloat32(offset + 32, bz, true);
  view.setFloat32(offset + 36, cx, true);
  view.setFloat32(offset + 40, cy, true);
  view.setFloat32(offset + 44, cz, true);
  view.setUint16(offset + 48, 0, true);
  return offset + 50;
}

export function stlFromSoup(positions: Float32Array): ArrayBuffer {
  const triangles = Math.floor(positions.length / 9);
  const buffer = new ArrayBuffer(estimateStlBytes(triangles));
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  let offset = 84;
  for (let index = 0; index < positions.length; index += 9) {
    offset = writeNormalAndTriangle(
      view,
      offset,
      positions[index],
      positions[index + 1],
      positions[index + 2],
      positions[index + 3],
      positions[index + 4],
      positions[index + 5],
      positions[index + 6],
      positions[index + 7],
      positions[index + 8]
    );
  }
  return buffer;
}

export function stlFromMesh(
  positions: Float32Array,
  indices: Uint32Array
): ArrayBuffer {
  const triangles = Math.floor(indices.length / 3);
  const buffer = new ArrayBuffer(estimateStlBytes(triangles));
  const view = new DataView(buffer);
  view.setUint32(80, triangles, true);
  let offset = 84;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    offset = writeNormalAndTriangle(
      view,
      offset,
      positions[a],
      positions[a + 1],
      positions[a + 2],
      positions[b],
      positions[b + 1],
      positions[b + 2],
      positions[c],
      positions[c + 1],
      positions[c + 2]
    );
  }
  return buffer;
}

export function downloadStl(buffer: ArrayBuffer, filename: string): void {
  downloadBlob(new Blob([buffer], { type: "model/stl" }), filename);
}
