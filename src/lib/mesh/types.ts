export type Vec3 = [number, number, number];

export interface MeshBounds {
  min: Vec3;
  max: Vec3;
  size: Vec3;
  center: Vec3;
}

export interface MeshData {
  vertices: Float32Array;
  faces: Uint32Array;
}

export interface MeshDiagnostics {
  vertices: number;
  triangles: number;
  openEdges: number;
  nonManifoldEdges: number;
  boundaryLoops: number;
  components: number;
  volume: number;
  watertight: boolean;
  outward: boolean;
}

export interface RepairOptions {
  fillHoles: boolean;
  removeDust: boolean;
  maxHoleEdges: number;
  dustVolumeMm3: number;
}

export interface RepairStep {
  name: string;
  before: number;
  after: number;
  changed: number;
  note?: string;
}

export interface RepairResult {
  mesh: MeshData;
  diagnostics: MeshDiagnostics;
  steps: RepairStep[];
  warnings: string[];
}

export const DEFAULT_REPAIR_OPTIONS: RepairOptions = {
  fillHoles: true,
  removeDust: true,
  maxHoleEdges: 4000,
  dustVolumeMm3: 0.01,
};

export interface MeshLoadInfo {
  fileName: string;
  fileSize: number;
  format: "stl" | "3mf";
  triangles: number;
  vertices: number;
  bounds: MeshBounds;
  diagnostics: MeshDiagnostics;
  hasColors: boolean;
  warnings: string[];
}
