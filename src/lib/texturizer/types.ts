export const TEXTURE_IDS = [
  "grid",
  "brick",
  "dots",
  "honeycomb",
  "scales",
  "waves",
  "stripes",
  "weave",
  "knurl",
  "noise",
  "chevron",
  "carbon",
  "bubbles",
  "wood",
  "marble",
  "topography",
  "circuit",
  "triangles",
  "voronoi",
  "ripple",
  "crosshatch",
  "stipple",
  "truchet",
  "bark",
] as const;

export type TextureId = (typeof TEXTURE_IDS)[number];
export type TextureSelection = TextureId | "custom";

export type ProjectionMode = "triplanar" | "xy" | "xz" | "yz";
export type MaskAction = "include" | "exclude";
export type MaskFaces = "top" | "bottom" | "both";
export type AmplitudeUnit = "mm" | "percent";

export type Vec3Tuple = [number, number, number];

export interface MeshBounds {
  min: Vec3Tuple;
  max: Vec3Tuple;
  size: Vec3Tuple;
  center: Vec3Tuple;
}

export interface MaskSettings {
  enabled: boolean;
  action: MaskAction;
  faces: MaskFaces;
  maxAngleDeg: number;
  excludeBase: boolean;
  feather: number;
}

export interface TexturizerSettings {
  texture: TextureSelection | null;
  projection: ProjectionMode;
  scaleU: number;
  scaleV: number;
  lockAspect: boolean;
  offsetU: number;
  offsetV: number;
  rotationDeg: number;
  amplitude: number;
  amplitudeUnit: AmplitudeUnit;
  symmetric: boolean;
  smoothing: number;
  resolutionMm: number;
  previewEnabled: boolean;
  repairMesh: boolean;
  surfaceSmoothing: number;
  mask: MaskSettings;
}

export const DEFAULT_TEXTURIZER_SETTINGS: TexturizerSettings = {
  texture: null,
  projection: "triplanar",
  scaleU: 1,
  scaleV: 1,
  lockAspect: true,
  offsetU: 0,
  offsetV: 0,
  rotationDeg: 0,
  amplitude: 0.6,
  amplitudeUnit: "mm",
  symmetric: true,
  smoothing: 0,
  resolutionMm: 0.6,
  previewEnabled: true,
  repairMesh: true,
  surfaceSmoothing: 0,
  mask: {
    enabled: false,
    action: "exclude",
    faces: "bottom",
    maxAngleDeg: 45,
    excludeBase: false,
    feather: 1,
  },
};

export interface TextureTile {
  size: number;
  data: Float32Array;
  name?: string;
}

export interface StlData {
  fileName: string;
  fileSize: number;
  positions: Float32Array;
  triangles: number;
  bounds: MeshBounds;
  openEdges: number;
  nonManifoldEdges: number;
}

export interface ProcessOptions {
  targetEdgeMm: number;
  maxTriangles: number;
  amplitudeMm: number;
  symmetric: boolean;
  projection: ProjectionMode;
  scaleU: number;
  scaleV: number;
  offsetU: number;
  offsetV: number;
  rotationDeg: number;
  smoothing: number;
  repairMesh: boolean;
  surfaceSmoothing: number;
  mask: MaskSettings;
  tile: TextureTile;
}

export interface ProcessResult {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  triangles: number;
  sourceTriangles: number;
  maskedTriangles: number;
  openEdges: number;
  nonManifoldEdges: number;
  capped: boolean;
  completed: boolean;
  elapsedMs: number;
  bounds: MeshBounds;
}

export interface ProcessRequest {
  type: "process";
  id: number;
  positions: Float32Array;
  options: ProcessOptions;
}

export type WorkerResponse =
  | { type: "progress"; id: number; progress: number; phase: string }
  | { type: "result"; id: number; result: ProcessResult }
  | { type: "error"; id: number; message: string };

export const PROJECTION_LABELS: Record<ProjectionMode, string> = {
  triplanar: "Triplanar",
  xy: "Plano XY",
  xz: "Plano XZ",
  yz: "Plano YZ",
};
