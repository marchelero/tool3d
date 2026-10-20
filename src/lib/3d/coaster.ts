import { geometries, primitives } from "@jscad/modeling";
import type { HandoffLayer } from "./handoff";
import { buildMosaicSvg, type TileKind } from "./mosaic";
import { patternToSvg, type PatternKind } from "./patterns";
import { difference, intersection, union, unionSolid, type Ring } from "./clip2";
import { buildSolid, extrudeRegion, meshQuality, type Geom3, type Slab } from "./extrude";
import { mergeBounds, svgToDesign, type DesignBounds } from "./svg";

type Geom2 = ReturnType<typeof geometries.geom2.fromPoints>;
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
  shape: "round",
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

/** Convierte una geometría 2D de JSCAD en un contorno normalizado (CCW). */
function geom2ToRings(geom2: Geom2): Ring[] {
  const points = geometries.geom2.toPoints(geom2);
  const ring: Ring = points.map((point) => [point[0], point[1]]);
  return union([ring]);
}

function transformRings(
  rings: Ring[],
  scale: number,
  offsetX: number,
  offsetY: number,
  rotation: number
): Ring[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return rings.map((ring) =>
    ring.map(([x, y]) => {
      const px = x * scale + offsetX;
      const py = y * scale + offsetY;
      return [px * cos - py * sin, px * sin + py * cos] as [number, number];
    })
  );
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

interface Level {
  z: number;
  region: Ring[];
}

function levelsToSlabs(levels: Level[]): Slab[] {
  const slabs: Slab[] = [];
  for (let index = 0; index + 1 < levels.length; index += 1) {
    const height = levels[index + 1].z - levels[index].z;
    if (height <= 1e-9) continue;
    slabs.push({
      zBottom: levels[index].z,
      zTop: levels[index + 1].z,
      region: levels[index].region,
    });
  }
  return slabs;
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

  const baseRings = geom2ToRings(buildBaseGeom2(settings));
  const clipRings =
    borderWidthMm > 0
      ? geom2ToRings(buildInnerGeom2(settings, borderWidthMm))
      : baseRings;

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
  let designWidthMm = 0;
  let designHeightMm = 0;
  let reportedBandMm = 0;
  let levels: Level[] | null = null;

  const processSet = (set: DesignSet) => {
    const designLayers: { color: string; contours: Ring[] }[] = [];
    let bounds: DesignBounds | null = null;

    for (const layer of set.input) {
      const { contours, bounds: layerBounds } = svgToDesign(layer.svg);
      if (contours.length === 0) continue;
      designLayers.push({ color: layer.color, contours });
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
    const bandZ = set.placement === "bottom" ? 0 : totalHeightMm - bandMm;

    const raise = set.mode === "raise";
    const through = set.mode === "through";
    // Invertir solo tiene sentido con patrones (una sola "red" de material).
    const invert = set.invert && !through;

    const placedAll: Ring[] = [];
    const placedPerLayer: Ring[][] = [];
    for (const layer of designLayers) {
      const placedRaw = transformRings(
        layer.contours,
        scale,
        offsetX,
        offsetY,
        rotation
      );
      const placed =
        set.placement === "bottom"
          ? placedRaw.map((ring) =>
              ring.map(([x, y]) => [-x, y] as [number, number])
            )
          : placedRaw;
      placedPerLayer.push(placed);
      placedAll.push(...placed);
    }

    const design = intersection(unionSolid(placedAll), clipRings);
    if (design.length === 0) return;

    if (through) {
      levels = [
        { z: 0, region: difference(baseRings, design) },
        { z: totalHeightMm, region: difference(baseRings, design) },
      ];
      return;
    }

    const network = invert ? difference(clipRings, design) : [];
    const bandRegion = invert
      ? difference(baseRings, network)
      : difference(baseRings, design);
    let colorZBottom: number;
    let colorZTop: number;

    if (raise) {
      // En relieve el color sobresale de una cara: la ubicación elige cuál.
      if (set.placement === "full") {
        colorZBottom = 0;
        colorZTop = totalHeightMm;
        levels = [
          { z: 0, region: bandRegion },
          { z: totalHeightMm, region: bandRegion },
        ];
      } else if (set.placement === "bottom") {
        colorZBottom = -bandMm;
        colorZTop = 0;
        levels = [
          { z: 0, region: baseRings },
          { z: totalHeightMm, region: baseRings },
        ];
      } else {
        colorZBottom = totalHeightMm;
        colorZTop = totalHeightMm + bandMm;
        levels = [
          { z: 0, region: baseRings },
          { z: totalHeightMm, region: baseRings },
        ];
      }
    } else {
      colorZBottom = bandZ;
      colorZTop = bandZ + bandMm;
      if (set.placement === "bottom") {
        levels = [
          { z: 0, region: bandRegion },
          { z: bandMm, region: baseRings },
          { z: totalHeightMm, region: baseRings },
        ];
      } else if (set.placement === "full") {
        levels = [
          { z: 0, region: bandRegion },
          { z: totalHeightMm, region: bandRegion },
        ];
      } else {
        levels = [
          { z: 0, region: baseRings },
          { z: bandZ, region: bandRegion },
          { z: totalHeightMm, region: bandRegion },
        ];
      }
    }

    if (invert) {
      if (raise) {
        const color = designLayers[0].color;
        colorList.push(color);
        colorPieces.push({
          name: "Relieve 1",
          color: colorToRgba(color),
          geometry: extrudeRegion(network, colorZBottom, colorZTop - colorZBottom),
        });
      }
      return;
    }

    designLayers.forEach((_, index) => {
      const region = intersection(unionSolid(placedPerLayer[index]), clipRings);
      if (region.length === 0) return;
      const color = designLayers[index].color;
      colorList.push(color);
      colorPieces.push({
        name: `Color ${index + 1}`,
        color: colorToRgba(color),
        geometry: extrudeRegion(region, colorZBottom, colorZTop - colorZBottom),
      });
    });
  };

  sets.forEach(processSet);

  if (!levels) {
    levels = [
      { z: 0, region: baseRings },
      { z: totalHeightMm, region: baseRings },
    ];
  }

  if (borderWidthMm > 0) {
    const ringRegion = difference(baseRings, clipRings);
    levels = [
      ...levels,
      { z: totalHeightMm, region: ringRegion },
      { z: totalHeightMm + borderHeightMm, region: ringRegion },
    ];
  }

  const baseColor = colorToRgba(settings.baseColor);
  const pieces: CoasterPiece[] = [
    {
      name: "Base",
      color: baseColor,
      geometry: buildSolid(levelsToSlabs(levels)),
    },
    ...colorPieces,
  ];

  // Validación de malla: `open > 0` significa que el sólido no cierra y el
  // laminador lo rechazará; `over > 0` es no-manifold puntual (pinch points del
  // dibujo) y se tolera.
  for (const piece of pieces) {
    const quality = meshQuality(piece.geometry);
    if (quality.open > 0) {
      console.warn(
        `[posavasos] "${piece.name}" no cierra: ${quality.open} aristas abiertas`
      );
    }
  }

  return {
    pieces,
    totalHeightMm,
    bandMm: reportedBandMm,
    designWidthMm,
    designHeightMm,
    colors: colorList,
  };
}
