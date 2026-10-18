import {
  booleans,
  colors,
  extrusions,
  geometries,
  primitives,
  transforms,
} from "@jscad/modeling";
import type { HandoffLayer } from "./handoff";
import { mergeBounds, svgToDesign, type DesignBounds } from "./svg";

type Geom2 = ReturnType<typeof geometries.geom2.fromPoints>;
type Geom3 = ReturnType<typeof extrusions.extrudeLinear>;
type Rgba = [number, number, number, number];

export type CoasterShape = "round" | "rounded-square";
export type CoasterPlacement = "top" | "bottom" | "full";

export interface CoasterSettings {
  shape: CoasterShape;
  widthMm: number;
  cornerMm: number;
  layers: number;
  layerHeightMm: number;
  placement: CoasterPlacement;
  bandLayers: number;
  marginMm: number;
  scalePercent: number;
  baseColor: string;
}

export const DEFAULT_COASTER_SETTINGS: CoasterSettings = {
  shape: "round",
  widthMm: 90,
  cornerMm: 14,
  layers: 12,
  layerHeightMm: 0.2,
  placement: "top",
  bandLayers: 4,
  marginMm: 6,
  scalePercent: 100,
  baseColor: "#d8dce3",
};

export interface CoasterPiece {
  name: string;
  color: Rgba;
  geometry: Geom3;
}

export interface CoasterModel {
  pieces: CoasterPiece[];
  totalHeightMm: number;
  bandMm: number;
  designWidthMm: number;
  designHeightMm: number;
  colors: string[];
}

function parseColor(input: string): [number, number, number] {
  const rgbMatch = input.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  let hex = input.trim().replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (hex.length < 6) return [0, 0, 0];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

export function colorToRgba(input: string): Rgba {
  const [r, g, b] = parseColor(input);
  return [r / 255, g / 255, b / 255, 1];
}

function buildBaseGeom2(settings: CoasterSettings): Geom2 {
  const width = Math.max(10, settings.widthMm);
  if (settings.shape === "round") {
    return primitives.circle({ radius: width / 2, segments: 180 });
  }
  const radius = Math.max(0.5, Math.min(settings.cornerMm, width / 2 - 0.01));
  return primitives.roundedRectangle({
    size: [width, width],
    roundRadius: radius,
    segments: 32,
  });
}

export function buildCoaster(
  settings: CoasterSettings,
  layers: HandoffLayer[]
): CoasterModel {
  const totalLayers = Math.max(1, Math.round(settings.layers));
  const layerHeight = Math.max(0.02, settings.layerHeightMm);
  const totalHeightMm = totalLayers * layerHeight;

  const bandLayers =
    settings.placement === "full"
      ? totalLayers
      : Math.max(1, Math.min(Math.round(settings.bandLayers), totalLayers));
  const bandMm = bandLayers * layerHeight;
  const bandZ =
    settings.placement === "bottom"
      ? 0
      : settings.placement === "top"
        ? totalHeightMm - bandMm
        : 0;

  const baseGeom2 = buildBaseGeom2(settings);

  const designLayers: { color: string; polygons: Geom2[] }[] = [];
  let bounds: DesignBounds | null = null;
  let hasDesign = false;

  for (const layer of layers) {
    const { polygons: layerPolygons, bounds: layerBounds } = svgToDesign(
      layer.svg
    );
    if (layerPolygons.length === 0) continue;
    designLayers.push({ color: layer.color, polygons: layerPolygons });
    hasDesign = true;
    bounds = mergeBounds(bounds, layerBounds);
  }

  const available =
    settings.shape === "round"
      ? settings.widthMm / Math.SQRT2
      : settings.widthMm;
  const targetSize = Math.max(1, available - settings.marginMm * 2);

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let designWidthMm = 0;
  let designHeightMm = 0;

  if (bounds && hasDesign) {
    const designWidth = Math.max(0.001, bounds.maxX - bounds.minX);
    const designHeight = Math.max(0.001, bounds.maxY - bounds.minY);
    const fit = Math.min(targetSize / designWidth, targetSize / designHeight);
    scale = fit * (settings.scalePercent / 100);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    offsetX = -centerX * scale;
    offsetY = -centerY * scale;
    designWidthMm = designWidth * scale;
    designHeightMm = designHeight * scale;
  }

  const place = (geometry: Geom2): Geom2 =>
    transforms.translate([offsetX, offsetY], transforms.scale([scale, scale], geometry));

  // Se extruye cada contorno por separado y se combina en 3D: las uniones 2D
  // con muchos polígonos generan ruido numérico y rompen el contorno.
  const extrudePlaced = (polygon: Geom2): Geom3 | null => {
    try {
      const placed = place(polygon);
      return transforms.translate(
        [0, 0, bandZ],
        extrusions.extrudeLinear({ height: bandMm }, placed)
      );
    } catch {
      return null;
    }
  };

  const baseSolid = extrusions.extrudeLinear({ height: totalHeightMm }, baseGeom2);
  const pieces: CoasterPiece[] = [];
  const colorList: string[] = [];
  const designSolids: Geom3[] = [];

  if (bounds && hasDesign) {
    designLayers.forEach((layer, index) => {
      const layerSolids: Geom3[] = [];
      for (const polygon of layer.polygons) {
        const solid = extrudePlaced(polygon);
        if (solid) layerSolids.push(solid);
      }
      if (layerSolids.length === 0) return;

      let mergedSolid = layerSolids[0];
      for (let position = 1; position < layerSolids.length; position += 1) {
        try {
          mergedSolid = booleans.union(mergedSolid, layerSolids[position]);
        } catch {
          // Se conserva la unión parcial.
        }
      }

      designSolids.push(mergedSolid);
      const rgba = colorToRgba(layer.color);
      colorList.push(layer.color);
      pieces.push({
        name: `Color ${index + 1}`,
        color: rgba,
        geometry: colors.colorize(rgba, mergedSolid),
      });
    });

    let baseCut = baseSolid;
    for (const designSolid of designSolids) {
      try {
        baseCut = booleans.subtract(baseCut, designSolid);
      } catch {
        // Si un relieve no se puede restar, la base queda sólida.
      }
    }

    pieces.unshift({
      name: "Base",
      color: colorToRgba(settings.baseColor),
      geometry: colors.colorize(colorToRgba(settings.baseColor), baseCut),
    });
  } else {
    pieces.push({
      name: "Base",
      color: colorToRgba(settings.baseColor),
      geometry: colors.colorize(colorToRgba(settings.baseColor), baseSolid),
    });
  }

  return {
    pieces,
    totalHeightMm,
    bandMm,
    designWidthMm,
    designHeightMm,
    colors: colorList,
  };
}
