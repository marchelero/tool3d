import { geometries } from "@jscad/modeling";
import { zipSync } from "fflate";
import type { CoasterPiece } from "./coaster";

type Geom3 = CoasterPiece["geometry"];
type Rgba = CoasterPiece["color"];

export function rgbaToHex(color: Rgba): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`;
}

/**
 * Código `paint_color` por filamento que espera Bambu Studio / Orca. El índice
 * N corresponde al filamento N (1-based); el filamento 1 se codifica como "4".
 */
const FILAMENT_PAINT_CODES = [
  "",
  "4",
  "8",
  "0C",
  "1C",
  "2C",
  "3C",
  "4C",
  "5C",
  "6C",
  "7C",
  "8C",
  "9C",
  "AC",
  "BC",
  "CC",
  "DC",
];

const BAMBU_APPLICATION = "BambuStudio-02.00.00.00";

function formatFloat(value: number): string {
  return parseFloat(value.toFixed(6)).toString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface WeldedMesh {
  vertices: number[];
  triangles: number[];
}

/**
 * Convierte un geom3 a triángulos con vértices soldados (índice único por
 * coordenada). Sin soldar, los laminadores ven todas las aristas abiertas.
 */
function weldGeometry(geom3: Geom3): WeldedMesh {
  const polygons = geometries.geom3.toPolygons(geom3);
  const indexByKey = new Map<string, number>();
  const vertices: number[] = [];
  const triangles: number[] = [];

  const vertexIndex = (vertex: number[]): number => {
    const key = `${vertex[0].toFixed(6)},${vertex[1].toFixed(
      6
    )},${vertex[2].toFixed(6)}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length / 3;
    indexByKey.set(key, index);
    vertices.push(vertex[0], vertex[1], vertex[2]);
    return index;
  };

  for (const polygon of polygons) {
    const vs = polygon.vertices;
    for (let i = 1; i < vs.length - 1; i += 1) {
      triangles.push(
        vertexIndex(vs[0]),
        vertexIndex(vs[i]),
        vertexIndex(vs[i + 1])
      );
    }
  }
  return { vertices, triangles };
}

/**
 * 3MF compatible con Bambu Studio / Orca: un objeto por pieza con color por
 * triángulo (`paint_color`) y los sidecars Metadata que precargan los
 * filamentos. El serializer de JSCAD no sirve (escribe vértices por triángulo y
 * omite el namespace core del modelo).
 */
export function build3mf(pieces: CoasterPiece[], filename: string): Uint8Array {
  const title = escapeXml(filename);

  const objects: string[] = [];
  const objectSettings: string[] = [];
  const filamentColours: string[] = [];

  pieces.forEach((piece, index) => {
    const { vertices, triangles } = weldGeometry(piece.geometry);
    const paint = FILAMENT_PAINT_CODES[index + 1] ?? "4";

    let vertexXml = "";
    for (let i = 0; i < vertices.length; i += 3) {
      vertexXml += `<vertex x="${formatFloat(vertices[i])}" y="${formatFloat(
        vertices[i + 1]
      )}" z="${formatFloat(vertices[i + 2])}" />`;
    }

    let triangleXml = "";
    for (let i = 0; i < triangles.length; i += 3) {
      triangleXml += `<triangle v1="${triangles[i]}" v2="${
        triangles[i + 1]
      }" v3="${triangles[i + 2]}" paint_color="${paint}" />`;
    }

    const pieceName = escapeXml(piece.name);
    objects.push(
      `<object id="${index + 1}" type="model" name="${pieceName}"><mesh><vertices>${vertexXml}</vertices><triangles>${triangleXml}</triangles></mesh></object>`
    );
    objectSettings.push(
      `<object id="${index + 1}"><metadata key="name" value="${pieceName}"/><metadata key="extruder" value="${
        index + 1
      }"/></object>`
    );
    filamentColours.push(rgbaToHex(piece.color));
  });

  const items = pieces
    .map((_, index) => `<item objectid="${index + 1}" />`)
    .join("");

  const creationDate = new Date().toISOString().slice(0, 10);

  const modelXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${title}</metadata>` +
    `<metadata name="Designer">tool3d</metadata>` +
    `<metadata name="CreationDate">${creationDate}</metadata>` +
    `<metadata name="Application">${BAMBU_APPLICATION}</metadata>` +
    `<metadata name="BambuStudio:3mfVersion">1</metadata>` +
    `<resources>${objects.join("")}</resources>` +
    `<build>${items}</build>` +
    `</model>`;

  const modelSettingsXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<config>${objectSettings.join("")}` +
    `</config>`;

  const projectSettings = JSON.stringify(
    {
      version: "2.0.0.0",
      name: "project_settings",
      from: "tool3d",
      filament_colour: filamentColours,
      use_relative_e_distances: "1",
      layer_change_gcode: "G92 E0 ; Reset extruder for accurate multi-material\n",
    },
    null,
    2
  );

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />` +
    `<Override PartName="/3D/3dmodel.model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />` +
    `</Relationships>`;

  const encoder = new TextEncoder();
  return zipSync(
    {
      "[Content_Types].xml": encoder.encode(contentTypes),
      "_rels/.rels": encoder.encode(rels),
      "3D/3dmodel.model": encoder.encode(modelXml),
      "Metadata/model_settings.config": encoder.encode(modelSettingsXml),
      "Metadata/project_settings.config": encoder.encode(projectSettings),
    },
    { level: 6 }
  );
}
