import { zipSync } from "fflate";
import { computeBounds } from "@/lib/mesh/bounds";
import type { MeshData } from "@/lib/mesh/types";
import { downloadBlob } from "@/lib/image/download";
import type { CutterPartView } from "./types";

const BED_WIDTH = 220;
const BED_GAP = 8;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatFloat(value: number): string {
  return parseFloat(value.toFixed(5)).toString();
}

export function buildBinaryStl(mesh: MeshData): ArrayBuffer {
  const triangleCount = Math.floor(mesh.faces.length / 3);
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode("tool3d cortador");
  new Uint8Array(buffer, 0, 80).set(header.slice(0, 80));
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ia = mesh.faces[triangle * 3];
    const ib = mesh.faces[triangle * 3 + 1];
    const ic = mesh.faces[triangle * 3 + 2];
    const ax = mesh.vertices[ia * 3];
    const ay = mesh.vertices[ia * 3 + 1];
    const az = mesh.vertices[ia * 3 + 2];
    const bx = mesh.vertices[ib * 3];
    const by = mesh.vertices[ib * 3 + 1];
    const bz = mesh.vertices[ib * 3 + 2];
    const cx = mesh.vertices[ic * 3];
    const cy = mesh.vertices[ic * 3 + 1];
    const cz = mesh.vertices[ic * 3 + 2];
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
    if (length > 0) {
      nx /= length;
      ny /= length;
      nz /= length;
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
    offset += 50;
  }
  return buffer;
}

interface LaidOutPart {
  part: CutterPartView;
  offset: [number, number, number];
}

function layoutParts(parts: CutterPartView[]): LaidOutPart[] {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  return parts.map((part) => {
    const bounds = computeBounds(part.mesh.vertices);
    const sizeX = bounds.size[0];
    const sizeY = bounds.size[1];
    if (cursorX > 0 && cursorX + sizeX > BED_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + BED_GAP;
      rowHeight = 0;
    }
    const offset: [number, number, number] = [
      cursorX - bounds.min[0],
      cursorY - bounds.min[1],
      -bounds.min[2],
    ];
    cursorX += sizeX + BED_GAP;
    rowHeight = Math.max(rowHeight, sizeY);
    return { part, offset };
  });
}

function meshXml(mesh: MeshData, offset: [number, number, number], colorIndex: number): {
  vertices: string;
  triangles: string;
} {
  const [ox, oy, oz] = offset;
  let vertices = "";
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    vertices += `<vertex x="${formatFloat(
      mesh.vertices[index] + ox
    )}" y="${formatFloat(mesh.vertices[index + 1] + oy)}" z="${formatFloat(
      mesh.vertices[index + 2] + oz
    )}"/>`;
  }
  let triangles = "";
  for (let index = 0; index < mesh.faces.length; index += 3) {
    triangles += `<triangle v1="${mesh.faces[index]}" v2="${
      mesh.faces[index + 1]
    }" v3="${mesh.faces[index + 2]}" pid="1" p1="${colorIndex}"/>`;
  }
  return { vertices, triangles };
}

export function buildCutter3mf(
  parts: CutterPartView[],
  filename: string,
  layout = true
): Uint8Array {
  const laidOut = layout
    ? layoutParts(parts)
    : parts.map((part) => ({ part, offset: [0, 0, 0] as [number, number, number] }));

  const materials = laidOut
    .map(
      ({ part }) =>
        `<base name="${escapeXml(part.name)}" displaycolor="${part.color.toUpperCase()}"/>`
    )
    .join("");
  const objects = laidOut
    .map(({ part, offset }, index) => {
      const { vertices, triangles } = meshXml(part.mesh, offset, index);
      return `<object id="${index + 2}" type="model" name="${escapeXml(
        part.name
      )}" pid="1" pindex="${index}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
    })
    .join("");
  const items = laidOut
    .map((_, index) => `<item objectid="${index + 2}"/>`)
    .join("");

  const modelXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="es-AR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${escapeXml(filename)}</metadata>` +
    `<metadata name="Application">tool3d</metadata>` +
    `<resources><basematerials id="1">${materials}</basematerials>${objects}</resources>` +
    `<build>${items}</build>` +
    `</model>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Override PartName="/3D/3dmodel.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  const encoder = new TextEncoder();
  return zipSync(
    {
      "[Content_Types].xml": encoder.encode(contentTypes),
      "_rels/.rels": encoder.encode(rels),
      "3D/3dmodel.model": encoder.encode(modelXml),
    },
    { level: 6 }
  );
}

export function downloadPartStl(part: CutterPartView, base: string): void {
  const buffer = buildBinaryStl(part.mesh);
  downloadBlob(
    new Blob([buffer], { type: "model/stl" }),
    `${base}-${part.name.toLowerCase().replace(/\s+/g, "-")}.stl`
  );
}

export function downloadAllStl(
  parts: CutterPartView[],
  base: string
): Promise<void> {
  return import("jszip").then(async ({ default: JSZip }) => {
    const zip = new JSZip();
    for (const part of parts) {
      zip.file(
        `${base}-${part.name.toLowerCase().replace(/\s+/g, "-")}.stl`,
        buildBinaryStl(part.mesh)
      );
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${base}-piezas.zip`);
  });
}

export function downloadCutter3mf(
  parts: CutterPartView[],
  base: string,
  layout: boolean
): void {
  const archive = buildCutter3mf(parts, base, layout);
  const buffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(buffer).set(archive);
  downloadBlob(new Blob([buffer], { type: "model/3mf" }), `${base}.3mf`);
}
