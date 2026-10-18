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
  downloadBlob(new Blob(data, { type: "model/3mf" }), `${filename}.3mf`);
}
