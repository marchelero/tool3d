import { geometries } from "@jscad/modeling";
import { BufferAttribute, BufferGeometry } from "three";
import type { CoasterPiece } from "./coaster";
import { downloadBlob } from "@/lib/image/download";

type Geom3 = CoasterPiece["geometry"];
type Rgba = CoasterPiece["color"];

export interface MeshPiece {
  name: string;
  hex: string;
  geometry: BufferGeometry;
}

export function rgbaToHex(color: Rgba): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

/** 3MF espera #RRGGBBAA en los materiales. */
function rgbaToHexA(color: Rgba): string {
  return `${rgbaToHex(color)}FF`.toUpperCase();
}

export function geom3ToBufferGeometry(geom3: Geom3): BufferGeometry {
  const polygons = geometries.geom3.toPolygons(geom3);
  let triangles = 0;
  for (const polygon of polygons) {
    triangles += Math.max(0, polygon.vertices.length - 2);
  }

  const positions = new Float32Array(triangles * 9);
  let cursor = 0;
  for (const polygon of polygons) {
    const vertices = polygon.vertices;
    for (let index = 1; index < vertices.length - 1; index += 1) {
      const triangle = [
        vertices[0],
        vertices[index],
        vertices[index + 1],
      ];
      for (const vertex of triangle) {
        positions[cursor] = vertex[0];
        positions[cursor + 1] = vertex[1];
        positions[cursor + 2] = vertex[2];
        cursor += 3;
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function piecesToMeshes(pieces: CoasterPiece[]): MeshPiece[] {
  return pieces.map((piece) => ({
    name: piece.name,
    hex: rgbaToHex(piece.color),
    geometry: geom3ToBufferGeometry(piece.geometry),
  }));
}

export async function exportStl(
  pieces: CoasterPiece[],
  filename: string
): Promise<void> {
  const { serialize } = await import("@jscad/stl-serializer");
  const data = serialize(
    { binary: true },
    ...pieces.map((piece) => piece.geometry)
  );
  downloadBlob(
    new Blob(data, { type: "application/sla" }),
    `${filename}.stl`
  );
}

export async function export3mf(
  pieces: CoasterPiece[],
  filename: string
): Promise<void> {
  const { serialize } = await import("@jscad/3mf-serializer");
  const data = serialize(
    { unit: "millimeter" },
    ...pieces.map((piece) => piece.geometry)
  );
  const bytes = await addTriangleColors(
    data[0],
    pieces.map((piece) => rgbaToHexA(piece.color))
  );
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(new Blob([buffer], { type: "model/3mf" }), `${filename}.3mf`);
}

/**
 * Los laminadores ignoran el color asignado a nivel de objeto, así que se
 * agrega el material por triángulo (pid/p1) al XML del modelo dentro del ZIP.
 * Además se reescriben los colores del catálogo: `colors.rgbToHex` de JSCAD no
 * redondea y devuelve hex corruptos para colores casi enteros.
 */
async function addTriangleColors(
  data: ArrayBuffer,
  colorsHex: string[]
): Promise<Uint8Array> {
  const { unzipSync, zipSync } = await import("fflate");
  const original = new Uint8Array(data);
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(original);
  } catch {
    return original;
  }

  const modelPath = Object.keys(files).find((name) =>
    name.toLowerCase().endsWith("3dmodel.model")
  );
  if (!modelPath) return original;

  const xml = new TextDecoder().decode(files[modelPath]);

  let colorIndex = 0;
  const withColors = xml.replace(
    /<base\b[^>]*\/>/g,
    (base: string) => {
      const hex = colorsHex[colorIndex];
      colorIndex += 1;
      if (!hex) return base;
      return base.replace(/displaycolor="[^"]*"/, `displaycolor="${hex}"`);
    }
  );

  const patched = withColors.replace(
    /<object\b([^>]*)>([\s\S]*?)<\/object>/g,
    (block: string, attributes: string, body: string) => {
      const index = /pindex="(\d+)"/.exec(attributes)?.[1];
      if (index === undefined) return block;
      const pid = /pid="(\d+)"/.exec(attributes)?.[1] ?? "0";
      const mesh = body.replace(
        /<triangle\b([^>]*?)\s*\/>/g,
        (triangle: string, triangleAttributes: string) =>
          triangle.includes("p1=")
            ? triangle
            : `<triangle${triangleAttributes} pid="${pid}" p1="${index}"/>`
      );
      return `<object${attributes}>${mesh}</object>`;
    }
  );

  files[modelPath] = new TextEncoder().encode(patched);
  return zipSync(files, { level: 6 });
}
