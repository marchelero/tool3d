import type { HandoffLayer } from "./handoff";
import { difference, intersection, offset, union, unionSolid, type Ring } from "./clip2";
import { buildSolid, extrudeRegion, meshQuality, type Geom3, type Slab } from "./extrude";
import { mergeBounds, svgToDesign, type DesignBounds } from "./svg";
import { buildShapeRings, type KeychainShape } from "./shapes";
import { pointInRegion } from "./triangulate";
import { colorToRgba } from "./coaster";

type Rgba = [number, number, number, number];

export type KeychainDesignKind = "none" | "image" | "text";
export type KeychainDesignMode = "flat" | "engrave" | "raise" | "layered";

export interface KeychainTextLine {
  text: string;
  sizeMm: number;
  color: string;
}

export interface KeychainSettings {
  shape: KeychainShape;
  widthMm: number;
  heightMm: number;
  cornerMm: number;
  starPoints: number;
  starInnerRatio: number;
  layers: number;
  layerHeightMm: number;
  baseColor: string;
  designKind: KeychainDesignKind;
  designMode: KeychainDesignMode;
  fillHoles: boolean;
  scalePercent: number;
  designRotation: number;
  bandLayers: number;
  silhouetteOffsetMm: number;
  ringEnabled: boolean;
  ringPlacement: "inside" | "tab";
  ringHoleMm: number;
  ringWallMm: number;
  ringBoss: boolean;
  ringBossLayers: number;
  ringPosX: number | null;
  ringPosY: number | null;
  borderEnabled: boolean;
  borderWidthMm: number;
  borderLayers: number;
  fontId: string;
  textLines: KeychainTextLine[];
  textLetterSpacingMm: number;
  textLineGapMm: number;
}

export const DEFAULT_KEYCHAIN_SETTINGS: KeychainSettings = {
  shape: "round",
  widthMm: 50,
  heightMm: 30,
  cornerMm: 6,
  starPoints: 5,
  starInnerRatio: 0.45,
  layers: 12,
  layerHeightMm: 0.2,
  baseColor: "#d8dce3",
  designKind: "none",
  designMode: "flat",
  fillHoles: false,
  scalePercent: 100,
  designRotation: 0,
  bandLayers: 3,
  silhouetteOffsetMm: 3,
  ringEnabled: true,
  ringPlacement: "inside",
  ringHoleMm: 5,
  ringWallMm: 3,
  ringBoss: false,
  ringBossLayers: 2,
  ringPosX: null,
  ringPosY: null,
  borderEnabled: false,
  borderWidthMm: 3,
  borderLayers: 3,
  fontId: "lato-black",
  textLines: [{ text: "Nombre", sizeMm: 12, color: "#2b3440" }],
  textLetterSpacingMm: 0,
  textLineGapMm: 1,
};

const DESIGN_CLEARANCE_MM = 3;

export interface KeychainPiece {
  name: string;
  color: Rgba;
  geometry: Geom3;
}

export interface KeychainModel {
  pieces: KeychainPiece[];
  totalHeightMm: number;
  designWidthMm: number;
  designHeightMm: number;
  colors: string[];
  ringCenter: { x: number; y: number } | null;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface Level {
  z: number;
  region: Ring[];
}

function circleRing(cx: number, cy: number, radius: number, segments: number): Ring {
  const ring: Ring = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (2 * Math.PI * index) / segments;
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return ring;
}

function ringsBounds(rings: Ring[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
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

function keepOuterContours(contours: Ring[]): Ring[] {
  return contours.filter((ring) => {
    const [px, py] = ring[0];
    let depth = 0;
    for (const other of contours) {
      if (other === ring) continue;
      if (pointInRegion([other], px, py)) depth += 1;
    }
    return depth % 2 === 0;
  });
}

/**
 * Construye la geometría de un llavero plano. `layers` ya viene convertido a
 * capas SVG (imagen desde el handoff, o texto vía `text.ts`).
 */
export function buildKeychain(
  settings: KeychainSettings,
  layers: HandoffLayer[]
): KeychainModel {
  const totalLayers = Math.max(1, Math.round(settings.layers));
  const layerHeight = Math.max(0.02, settings.layerHeightMm);
  const totalHeightMm = totalLayers * layerHeight;
  const bandMm = Math.max(
    layerHeight,
    Math.min(Math.max(1, Math.round(settings.bandLayers)), totalLayers) * layerHeight
  );

  const shapeParams = {
    widthMm: settings.widthMm,
    heightMm: settings.heightMm,
    cornerMm: settings.cornerMm,
    starPoints: settings.starPoints,
    starInnerRatio: settings.starInnerRatio,
  };

  const rotation =
    settings.designRotation !== 0 ? (settings.designRotation * Math.PI) / 180 : 0;
  const userScale = Math.max(0.01, settings.scalePercent / 100);

  // 1) Contornos del diseño (imagen o texto ya convertidos a capas SVG).
  const designLayers: { color: string; contours: Ring[] }[] = [];
  let bounds: DesignBounds | null = null;
  for (const layer of layers) {
    const parsed = svgToDesign(layer.svg);
    if (parsed.contours.length === 0) continue;
    const contours = settings.fillHoles
      ? keepOuterContours(parsed.contours)
      : parsed.contours;
    designLayers.push({ color: layer.color, contours });
    bounds = mergeBounds(bounds, parsed.bounds);
  }
  const silhouette = settings.shape === "silhouette";
  const hasDesign =
    settings.designKind !== "none" && designLayers.length > 0 && bounds !== null;

  // 2) Región base y colocación del diseño.
  let baseRings: Ring[];
  let scale = userScale;
  let offsetX = 0;
  let offsetY = 0;

  if (silhouette && hasDesign && bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    offsetX = -cx * scale;
    offsetY = -cy * scale;
    const placed = designLayers.flatMap((layer) =>
      transformRings(layer.contours, scale, offsetX, offsetY, rotation)
    );
    baseRings = offset(union(placed), Math.max(0.5, settings.silhouetteOffsetMm), "round");
  } else {
    baseRings = buildShapeRings(silhouette ? "round" : settings.shape, shapeParams);
  }

  const baseBounds = ringsBounds(baseRings);

  // 3) Anilla (agujero + aro elevado opcional; puede ir dentro o en asa externa).
  const holeR = Math.max(0.5, settings.ringHoleMm / 2);
  const ringWall = Math.max(1, settings.ringWallMm);
  const tabR = holeR + ringWall;
  let holeRing: Ring | null = null;
  let ringCenter: { x: number; y: number } | null = null;
  let bodyRegion: Ring[] = baseRings;
  if (settings.ringEnabled) {
    const tab = settings.ringPlacement === "tab";
    let cx = 0;
    let cy = tab
      ? baseBounds.maxY + holeR + ringWall * 0.5
      : baseBounds.maxY - ringWall - holeR;
    if (settings.ringPosX !== null && settings.ringPosY !== null) {
      cx = Math.min(Math.max(settings.ringPosX, baseBounds.minX), baseBounds.maxX);
      cy = Math.min(
        Math.max(settings.ringPosY, baseBounds.minY),
        baseBounds.maxY + tabR * 0.6
      );
    }
    ringCenter = { x: cx, y: cy };
    holeRing = circleRing(cx, cy, holeR, 64);
    const body = tab
      ? unionSolid([...baseRings, circleRing(cx, cy, tabR, 64)])
      : baseRings;
    bodyRegion = difference(body, [holeRing]);
  }

  // 4) Borde/rim.
  const borderWidthMm = settings.borderEnabled
    ? Math.max(0.5, Math.min(settings.borderWidthMm, settings.widthMm / 2 - 1))
    : 0;
  const borderHeightMm = settings.borderEnabled
    ? Math.max(
        layerHeight,
        Math.max(1, Math.round(settings.borderLayers)) * layerHeight
      )
    : 0;
  const innerRegion =
    borderWidthMm > 0 ? offset(baseRings, -borderWidthMm, "round") : baseRings;
  const clipRegion = holeRing
    ? difference(borderWidthMm > 0 ? innerRegion : baseRings, [holeRing])
    : borderWidthMm > 0
      ? innerRegion
      : baseRings;

  // 5) Encuadre del diseño (la silueta conserva la escala real).
  let designWidthMm = 0;
  let designHeightMm = 0;
  const placedPerLayer: Ring[][] = [];
  let design: Ring[] = [];

  if (hasDesign && bounds) {
    const rawW = Math.max(0.001, bounds.maxX - bounds.minX);
    const rawH = Math.max(0.001, bounds.maxY - bounds.minY);
    const cosR = Math.abs(Math.cos(rotation));
    const sinR = Math.abs(Math.sin(rotation));
    const rotW = rawW * cosR + rawH * sinR;
    const rotH = rawW * sinR + rawH * cosR;

    if (!silhouette) {
      const margin = DESIGN_CLEARANCE_MM;
      const availW = baseBounds.maxX - baseBounds.minX - margin * 2;
      const ringBottom =
        holeRing && ringCenter ? ringCenter.y - holeR : baseBounds.maxY;
      const availTop = Math.min(baseBounds.maxY, ringBottom) - margin;
      const availH = availTop - (baseBounds.minY + margin);
      const target = Math.max(1, Math.min(availW, availH));
      const fit = Math.min(target / rotW, target / rotH);
      scale = fit * userScale;
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      offsetX = -cx * scale;
      offsetY = -cy * scale;
    }

    const placedAll: Ring[] = [];
    for (const layer of designLayers) {
      const placed = transformRings(layer.contours, scale, offsetX, offsetY, rotation);
      placedPerLayer.push(placed);
      placedAll.push(...placed);
    }
    design = intersection(union(placedAll), clipRegion);
    designWidthMm = Math.min(rotW * scale, baseBounds.maxX - baseBounds.minX);
    designHeightMm = Math.min(rotH * scale, baseBounds.maxY - baseBounds.minY);
  }

  // 6) Niveles de la base y piezas de color según el modo.
  const levels: Level[] = [];
  const colorPieces: KeychainPiece[] = [];
  const colorList: string[] = [];

  const mode = settings.designMode;
  const inlay = hasDesign && design.length > 0 && (mode === "flat" || mode === "engrave");

  if (inlay) {
    const pocket = difference(bodyRegion, design);
    levels.push({ z: 0, region: bodyRegion });
    levels.push({ z: totalHeightMm - bandMm, region: pocket });
    levels.push({ z: totalHeightMm, region: pocket });
  } else {
    levels.push({ z: 0, region: bodyRegion });
    levels.push({ z: totalHeightMm, region: bodyRegion });
  }

  if (hasDesign && design.length > 0) {
    const layerRegions: Ring[][] = placedPerLayer.map((placed) =>
      intersection(union(placed), clipRegion)
    );

    if (mode === "layered") {
      // Cada nivel se rellena con el color del nivel: la franja k cubre la
      // unión de las zonas cuyo nivel es >= k, teñida con el color de la zona k.
      const n = layerRegions.length;
      for (let k = 0; k < n; k += 1) {
        const parts: Ring[] = [];
        for (let i = k; i < n; i += 1) parts.push(...layerRegions[i]);
        if (parts.length === 0) continue;
        const region = unionSolid(parts);
        if (region.length === 0) continue;
        const color = designLayers[k].color;
        colorList.push(color);
        colorPieces.push({
          name: `Capa ${k + 1}`,
          color: colorToRgba(color),
          geometry: extrudeRegion(
            region,
            totalHeightMm + k * layerHeight,
            layerHeight
          ),
        });
      }
    } else {
      layerRegions.forEach((region, index) => {
        if (region.length === 0) return;
        const color = designLayers[index].color;
        let zBottom: number;
        let zTop: number;
        if (mode === "flat") {
          zBottom = totalHeightMm - bandMm;
          zTop = totalHeightMm;
        } else if (mode === "engrave") {
          zBottom = totalHeightMm - bandMm;
          zTop = zBottom + layerHeight;
        } else {
          zBottom = totalHeightMm;
          zTop = totalHeightMm + bandMm;
        }
        colorList.push(color);
        colorPieces.push({
          name: `Color ${index + 1}`,
          color: colorToRgba(color),
          geometry: extrudeRegion(region, zBottom, zTop - zBottom),
        });
      });
    }
  }

  // 7) Aro elevado (resalte alrededor del agujero) y borde sobre la base.
  if (settings.ringEnabled && settings.ringBoss && holeRing) {
    const bossW = Math.max(1, Math.min(settings.ringHoleMm * 0.8, ringWall));
    const bossRegion = difference(offset([holeRing], bossW, "round"), [holeRing]);
    const bossH = Math.max(
      layerHeight,
      Math.max(1, Math.round(settings.ringBossLayers)) * layerHeight
    );
    if (bossRegion.length > 0) {
      levels.push({ z: totalHeightMm, region: bossRegion });
      levels.push({ z: totalHeightMm + bossH, region: bossRegion });
    }
  }
  if (borderWidthMm > 0) {
    const ringRegion = difference(bodyRegion, innerRegion);
    if (ringRegion.length > 0) {
      levels.push({ z: totalHeightMm, region: ringRegion });
      levels.push({ z: totalHeightMm + borderHeightMm, region: ringRegion });
    }
  }

  const pieces: KeychainPiece[] = [
    {
      name: "Base",
      color: colorToRgba(settings.baseColor),
      geometry: buildSolid(levelsToSlabs(levels)),
    },
    ...colorPieces,
  ];

  for (const piece of pieces) {
    const quality = meshQuality(piece.geometry);
    if (quality.open > 0) {
      console.warn(
        `[llavero] "${piece.name}" no cierra: ${quality.open} aristas abiertas`
      );
    }
  }

  return {
    pieces,
    totalHeightMm,
    designWidthMm,
    designHeightMm,
    colors: colorList,
    ringCenter,
  };
}
