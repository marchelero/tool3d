import {
  booleans,
  colors,
  extrusions,
  geometries,
  primitives,
  transforms,
} from "@jscad/modeling";
import type { HandoffLayer } from "./handoff";
import { buildMosaicSvg, type TileKind } from "./mosaic";
import { patternToSvg, type PatternKind } from "./patterns";
import { mergeBounds, svgToDesign, type DesignBounds } from "./svg";

type Geom2 = ReturnType<typeof geometries.geom2.fromPoints>;
type Geom3 = ReturnType<typeof extrusions.extrudeLinear>;
type Rgba = [number, number, number, number];

export type CoasterShape = "round" | "square" | "hex" | "oct";
export type CoasterPlacement = "top" | "bottom" | "full";
export type DesignKind = "none" | "image" | "pattern" | "mosaic";
export type DesignMode = "engrave" | "raise" | "through";

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
  designRotation: number;
  baseColor: string;
  designKind: DesignKind;
  designMode: DesignMode;
  designInvert: boolean;
  pattern: PatternKind;
  patternCellMm: number;
  patternThicknessMm: number;
  patternColor: string;
  mosaicKind: TileKind;
  mosaicTileMm: number;
  mosaicGapMm: number;
  mosaicRotation: number;
  mosaicMode: DesignMode;
  mosaicPlacement: CoasterPlacement;
  mosaicLayers: number;
  borderEnabled: boolean;
  borderWidthMm: number;
  borderLayers: number;
}

export const DEFAULT_COASTER_SETTINGS: CoasterSettings = {
  shape: "square",
  widthMm: 90,
  cornerMm: 14,
  layers: 12,
  layerHeightMm: 0.2,
  placement: "top",
  bandLayers: 4,
  marginMm: 6,
  scalePercent: 100,
  designRotation: 0,
  baseColor: "#d8dce3",
  designKind: "none",
  designMode: "engrave",
  designInvert: false,
  pattern: "honeycomb",
  patternCellMm: 8,
  patternThicknessMm: 2,
  patternColor: "#2b3440",
  mosaicKind: "grid",
  mosaicTileMm: 16,
  mosaicGapMm: 1.5,
  mosaicRotation: 0,
  mosaicMode: "raise",
  mosaicPlacement: "top",
  mosaicLayers: 4,
  borderEnabled: false,
  borderWidthMm: 5,
  borderLayers: 4,
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

function polygonSides(shape: CoasterShape): number {
  if (shape === "hex") return 6;
  if (shape === "oct") return 8;
  return 0;
}

/** El octógono se gira media celda para apoyarse sobre un lado recto. */
function polygonRotation(sides: number): number {
  return sides === 8 ? Math.PI / sides : 0;
}

function regularPolygonPoints(
  circumradius: number,
  sides: number
): [number, number][] {
  const rotation = polygonRotation(sides);
  const points: [number, number][] = [];
  for (let index = 0; index < sides; index += 1) {
    const angle = (2 * Math.PI * index) / sides + rotation;
    points.push([
      circumradius * Math.cos(angle),
      circumradius * Math.sin(angle),
    ]);
  }
  return points;
}

/** Circunradio para que el ancho total del posavasos sea `2 * halfExtent`. */
function polygonCircumradius(halfExtent: number, sides: number): number {
  return sides === 8 ? halfExtent / Math.cos(Math.PI / sides) : halfExtent;
}

function buildBaseGeom2(settings: CoasterSettings): Geom2 {
  const width = Math.max(10, settings.widthMm);
  if (settings.shape === "round") {
    return primitives.circle({ radius: width / 2, segments: 180 });
  }
  const sides = polygonSides(settings.shape);
  if (sides > 0) {
    return geometries.geom2.fromPoints(
      regularPolygonPoints(polygonCircumradius(width / 2, sides), sides)
    );
  }
  const radius = Math.max(0.5, Math.min(settings.cornerMm, width / 2 - 0.01));
  return primitives.roundedRectangle({
    size: [width, width],
    roundRadius: radius,
    segments: 32,
  });
}

function buildInnerGeom2(settings: CoasterSettings, insetMm: number): Geom2 {
  const width = Math.max(2, settings.widthMm - insetMm * 2);
  if (settings.shape === "round") {
    return primitives.circle({ radius: width / 2, segments: 180 });
  }
  const sides = polygonSides(settings.shape);
  if (sides > 0) {
    const apothemFactor = Math.cos(Math.PI / sides);
    const base = polygonCircumradius(settings.widthMm / 2, sides);
    const apothem = Math.max(0.5, base * apothemFactor - insetMm);
    return geometries.geom2.fromPoints(
      regularPolygonPoints(apothem / apothemFactor, sides)
    );
  }
  const radius = Math.max(
    0.1,
    Math.min(settings.cornerMm - insetMm, width / 2 - 0.01)
  );
  return primitives.roundedRectangle({
    size: [width, width],
    roundRadius: radius,
    segments: 32,
  });
}

interface DesignSet {
  input: HandoffLayer[];
  mode: DesignMode;
  placement: CoasterPlacement;
  bandLayers: number;
  invert: boolean;
  /** Ajusta el diseño a la caja disponible (imágenes) o lo usa a escala real. */
  fitToBox: boolean;
  /** Aplica la escala y la rotación globales del diseño. */
  applyUserTransform: boolean;
}

export function buildCoaster(
  settings: CoasterSettings,
  layers: HandoffLayer[]
): CoasterModel {
  const totalLayers = Math.max(1, Math.round(settings.layers));
  const layerHeight = Math.max(0.02, settings.layerHeightMm);
  const totalHeightMm = totalLayers * layerHeight;

  const borderWidthMm = settings.borderEnabled
    ? Math.max(0.5, Math.min(settings.borderWidthMm, settings.widthMm / 2 - 1))
    : 0;
  const borderHeightMm = settings.borderEnabled
    ? Math.max(layerHeight, Math.round(settings.borderLayers) * layerHeight)
    : 0;

  const baseGeom2 = buildBaseGeom2(settings);

  const available =
    settings.shape === "round"
      ? settings.widthMm / Math.SQRT2
      : settings.widthMm;
  const targetSize = Math.max(
    1,
    available - (settings.marginMm + borderWidthMm) * 2
  );

  // El patrón cubre toda la superficie: se genera con un sobrante de un par de
  // celdas y luego se recorta al contorno del posavasos.
  const overscan = Math.max(4, settings.patternCellMm * 2);
  const patternLayer: HandoffLayer = {
    color: settings.patternColor,
    svg: patternToSvg(settings.pattern, {
      sizeMm: settings.widthMm + overscan * 2,
      cellMm: settings.patternCellMm,
      thicknessMm: settings.patternThicknessMm,
    }),
  };

  const sets: DesignSet[] = [];
  if (settings.designKind === "pattern") {
    sets.push({
      input: [patternLayer],
      mode: settings.designMode,
      placement: settings.placement,
      bandLayers: settings.bandLayers,
      invert: settings.designInvert,
      fitToBox: false,
      applyUserTransform: true,
    });
  } else if (settings.designKind === "image") {
    sets.push({
      input: layers,
      mode: settings.designMode,
      placement: settings.placement,
      bandLayers: settings.bandLayers,
      invert: false,
      fitToBox: true,
      applyUserTransform: true,
    });
  } else if (settings.designKind === "mosaic") {
    if (layers.length > 0) {
      const mosaicOptions = {
        sizeMm: settings.widthMm + overscan * 2,
        tileMm: settings.mosaicTileMm,
        gapMm: settings.mosaicGapMm,
        rotation: settings.mosaicRotation,
        kind: settings.mosaicKind,
      };
      sets.push({
        input: layers.map((layer) => ({
          color: layer.color,
          svg: buildMosaicSvg([layer.svg], mosaicOptions),
        })),
        mode: settings.mosaicMode,
        placement: settings.mosaicPlacement,
        bandLayers: settings.mosaicLayers,
        invert: false,
        fitToBox: false,
        applyUserTransform: false,
      });
    }
  }

  const colorPieces: CoasterPiece[] = [];
  const colorList: string[] = [];
  const designSolids: Geom3[] = [];
  let designWidthMm = 0;
  let designHeightMm = 0;
  let reportedBandMm = 0;

  // La unión por array es ~15x más rápida que encadenar uniones de a pares
  // (con cientos de celdas de patrón la diferencia son segundos de espera).
  const mergeSolids = (solids: Geom3[]): Geom3 => {
    if (solids.length === 1) return solids[0];
    try {
      const merged = booleans.union(solids);
      if (geometries.geom3.isA(merged) && merged.polygons.length > 0) {
        return merged;
      }
    } catch {
      // Se intenta la unión secuencial.
    }
    let partial = solids[0];
    for (let position = 1; position < solids.length; position += 1) {
      try {
        partial = booleans.union(partial, solids[position]);
      } catch {
        // Se conserva la unión parcial.
      }
    }
    return partial;
  };

  // Recorte: si el diseño se agranda más allá del posavasos, se descarta todo
  // lo que quede afuera (incluido el anillo del labio). El volumen de recorte
  // cubre también por debajo de z=0 para el modo calado (huecos pasantes).
  const clipGeom2 =
    borderWidthMm > 0 ? buildInnerGeom2(settings, borderWidthMm) : baseGeom2;
  const clipMargin = Math.min(layerHeight, totalHeightMm) + 1;
  const clipBottomZ = -clipMargin;
  const clipTopZ = totalHeightMm + totalHeightMm + 1;
  const clipSolid = transforms.translate(
    [0, 0, clipBottomZ],
    extrusions.extrudeLinear({ height: clipTopZ - clipBottomZ }, clipGeom2)
  );
  const clip = (geometry: Geom3): Geom3 | null => {
    try {
      const result = booleans.intersect(geometry, clipSolid);
      if (!geometries.geom3.isA(result)) return geometry;
      return result.polygons.length > 0 ? result : null;
    } catch {
      return geometry;
    }
  };

  const processSet = (set: DesignSet) => {
    const designLayers: { color: string; polygons: Geom2[] }[] = [];
    let bounds: DesignBounds | null = null;

    for (const layer of set.input) {
      const { polygons: layerPolygons, bounds: layerBounds } = svgToDesign(
        layer.svg
      );
      if (layerPolygons.length === 0) continue;
      designLayers.push({ color: layer.color, polygons: layerPolygons });
      bounds = mergeBounds(bounds, layerBounds);
    }

    if (!bounds || designLayers.length === 0) return;

    const rawWidth = Math.max(0.001, bounds.maxX - bounds.minX);
    const rawHeight = Math.max(0.001, bounds.maxY - bounds.minY);
    const rotation =
      set.applyUserTransform && settings.designRotation !== 0
        ? (settings.designRotation * Math.PI) / 180
        : 0;
    // El encuadre usa el tamaño ya rotado para que el diseño siga entrando.
    const cosRotation = Math.abs(Math.cos(rotation));
    const sinRotation = Math.abs(Math.sin(rotation));
    const designWidth = rawWidth * cosRotation + rawHeight * sinRotation;
    const designHeight = rawWidth * sinRotation + rawHeight * cosRotation;
    const fit = set.fitToBox
      ? Math.min(targetSize / designWidth, targetSize / designHeight)
      : 1;
    const scale =
      fit * (set.applyUserTransform ? settings.scalePercent / 100 : 1);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const offsetX = -centerX * scale;
    const offsetY = -centerY * scale;

    if (designWidthMm === 0) {
      designWidthMm = Math.min(designWidth * scale, settings.widthMm);
      designHeightMm = Math.min(designHeight * scale, settings.widthMm);
    }

    const setBandLayers =
      set.placement === "full"
        ? totalLayers
        : Math.max(1, Math.min(Math.round(set.bandLayers), totalLayers));
    const bandMm = setBandLayers * layerHeight;
    if (reportedBandMm === 0) reportedBandMm = bandMm;
    const bandZ =
      set.placement === "bottom"
        ? 0
        : set.placement === "top"
          ? totalHeightMm - bandMm
          : 0;

    const raise = set.mode === "raise";
    const through = set.mode === "through";
    // Invertir solo tiene sentido con patrones (una sola "red" de material).
    const invert = set.invert && !through;
    const designZ = raise ? totalHeightMm : bandZ;
    // Anclaje de una capa dentro de la base: si los volúmenes quedan apoyados
    // al ras (caras coplanares) los laminadores los reportan como piezas
    // flotantes o capas vacías. El solape hace que se fusionen de verdad.
    const anchorOverlapMm =
      set.placement === "full" ? 0 : Math.min(layerHeight, bandMm);
    const fillHeightMm = bandMm + anchorOverlapMm;
    const fillZ = raise
      ? totalHeightMm - anchorOverlapMm
      : set.placement === "bottom"
        ? bandZ
        : bandZ - anchorOverlapMm;

    const place = (geometry: Geom2): Geom2 => {
      const scaled = transforms.scale([scale, scale], geometry);
      const centered = transforms.translate([offsetX, offsetY], scaled);
      return rotation === 0
        ? centered
        : transforms.rotateZ(rotation, centered);
    };

    // Se extruye cada contorno por separado y se combina en 3D: las uniones 2D
    // con muchos polígonos generan ruido numérico y rompen el contorno.
    const extrudePlaced = (
      polygon: Geom2,
      heightMm: number,
      zMm: number
    ): Geom3 | null => {
      try {
        const placed = place(polygon);
        return transforms.translate(
          [0, 0, zMm],
          extrusions.extrudeLinear({ height: heightMm }, placed)
        );
      } catch {
        return null;
      }
    };

    const throughMarginMm = anchorOverlapMm + 0.5;
    designLayers.forEach((layer, index) => {
      // Calado: el diseño atraviesa todo el espesor y deja huecos.
      if (through) {
        const cutSolids: Geom3[] = [];
        for (const polygon of layer.polygons) {
          const cut = extrudePlaced(
            polygon,
            totalHeightMm + throughMarginMm * 2,
            -throughMarginMm
          );
          if (cut) cutSolids.push(cut);
        }
        if (cutSolids.length === 0) return;
        const cutSolid = clip(mergeSolids(cutSolids));
        if (cutSolid) designSolids.push(cutSolid);
        return;
      }

      // Relieve invertido: se intercambian material y hueco. Ahora la "red"
      // entre las celdas es la que sobresale (relieve) o la que se rebaja
      // (grabado), y las celdas quedan como huecos.
      if (invert) {
        const slabZ = raise ? fillZ : designZ;
        const slabHeightMm = raise ? fillHeightMm : bandMm;
        const cutMarginMm = anchorOverlapMm + 0.5;
        const cutSolids: Geom3[] = [];
        for (const polygon of layer.polygons) {
          const cut = extrudePlaced(
            polygon,
            slabHeightMm + cutMarginMm * 2,
            slabZ - cutMarginMm
          );
          if (cut) cutSolids.push(cut);
        }
        if (cutSolids.length === 0) return;
        const cutSolid = mergeSolids(cutSolids);
        try {
          const slab = transforms.translate(
            [0, 0, slabZ],
            extrusions.extrudeLinear({ height: slabHeightMm }, clipGeom2)
          );
          const solid = clip(booleans.subtract(slab, cutSolid));
          if (!solid) return;
          if (raise) {
            const rgba = colorToRgba(layer.color);
            colorList.push(layer.color);
            colorPieces.push({
              name: `Relieve ${index + 1}`,
              color: rgba,
              geometry: colors.colorize(rgba, solid),
            });
          } else {
            designSolids.push(solid);
          }
        } catch (error) {
          console.warn("No se pudo invertir el relieve", error);
        }
        return;
      }

      const fillSolids: Geom3[] = [];
      const cavitySolids: Geom3[] = [];
      for (const polygon of layer.polygons) {
        const fill = extrudePlaced(polygon, fillHeightMm, fillZ);
        if (fill) fillSolids.push(fill);
        if (!raise) {
          const cavity = extrudePlaced(polygon, bandMm, designZ);
          if (cavity) cavitySolids.push(cavity);
        }
      }
      if (fillSolids.length === 0) return;

      const colorSolid = clip(mergeSolids(fillSolids));
      const cavitySolid =
        cavitySolids.length > 0 ? clip(mergeSolids(cavitySolids)) : null;
      if (!colorSolid) return;
      if (cavitySolid) designSolids.push(cavitySolid);

      const rgba = colorToRgba(layer.color);
      colorList.push(layer.color);
      colorPieces.push({
        name: `Color ${index + 1}`,
        color: rgba,
        geometry: colors.colorize(rgba, colorSolid),
      });
    });
  };

  sets.forEach(processSet);

  const baseSolid = extrusions.extrudeLinear(
    { height: totalHeightMm },
    baseGeom2
  );
  let baseCut = baseSolid;

  for (const designSolid of designSolids) {
    try {
      baseCut = booleans.subtract(baseCut, designSolid);
    } catch {
      // Si un relieve no se puede restar, la base queda sólida en esa zona.
    }
  }

  if (borderWidthMm > 0) {
    try {
      const ring2 = booleans.subtract(
        baseGeom2,
        buildInnerGeom2(settings, borderWidthMm)
      );
      const ringAnchor = Math.min(layerHeight, borderHeightMm);
      const ring3 = transforms.translate(
        [0, 0, totalHeightMm - ringAnchor],
        extrusions.extrudeLinear(
          { height: borderHeightMm + ringAnchor },
          ring2
        )
      );
      baseCut = booleans.union(baseCut, ring3);
    } catch {
      // Si el labio falla, se conserva la base sin labio.
    }
  }

  const baseColor = colorToRgba(settings.baseColor);
  const pieces: CoasterPiece[] = [
    {
      name: "Base",
      color: baseColor,
      geometry: colors.colorize(baseColor, baseCut),
    },
    ...colorPieces,
  ];

  return {
    pieces,
    totalHeightMm,
    bandMm: reportedBandMm,
    designWidthMm,
    designHeightMm,
    colors: colorList,
  };
}
