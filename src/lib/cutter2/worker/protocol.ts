import type { Vec3 } from '../engine/core/types';
import type { ModelAnalysis } from '../engine/analysis/MeshAnalyzer';
import type { ModelFormat } from '../engine/import/ModelImporter';
import type { CapSurface, CutMethod } from '../engine/cut/CutSurfaceGenerator';
import type { SeamInfo } from '../engine/cut/SplitOperation';
import type { PerimeterInput, PerimeterIssue } from '../engine/perimeter/SurfaceSplineEngine';
import type { SuggestionKind } from '../engine/perimeter/BoundarySuggestionEngine';
import type { JointIssue, JointParams, ToleranceProfile } from '../engine/joints/JointGenerator';
import type { ValidationIssue, ValidationReport } from '../engine/validation/MeshValidator';
import type { ExportFile, ExportFormat, Placement } from '../engine/export/ExportManager';

export type { ModelAnalysis, ModelFormat, CapSurface, CutMethod, SeamInfo, PerimeterInput, PerimeterIssue, SuggestionKind, JointIssue, JointParams, ToleranceProfile, ValidationIssue, ValidationReport, ExportFile, ExportFormat, Placement };

export type { Vec3 };

export type PieceRole = 'model' | 'extracted' | 'remainder' | 'component';

export interface PieceMeta {
  id: string;
  name: string;
  color: string;
  role: PieceRole;
  triangleCount: number;
  volume: number;
  bboxMin: Vec3;
  bboxMax: Vec3;
  valid: boolean;
  issues: string[];
  hasJoint: boolean;
  componentCount: number;
}

export interface PieceGeometry {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
  capMask: Uint8Array;
}

export interface SeamView {
  id: string;
  extractedId: string;
  remainderId: string;
  info: SeamInfo;
  joint: JointParams | null;
  loop: Float32Array;
  method: CutMethod;
  parentName: string;
  cutId: string;
}

export interface DocumentView {
  pieces: PieceMeta[];
  seams: SeamView[];
  geometries: PieceGeometry[];
  canUndo: boolean;
  canRedo: boolean;
  activePieceId: string | null;
}

export interface ModelInfo {
  fileName: string;
  format: ModelFormat;
  fileTriangleCount: number;
  warnings: string[];
  objectNames: string[];
}

export interface SelectionData {
  pieceId: string;
  faceAdj: Int32Array;
  faceComponent: Int32Array;
  componentCount: number;
  faceAreas: Float32Array;
  faceRegion: Int32Array;
  regionCount: number;
  merges: Float64Array;
  valleyFace: Float32Array;
}

export interface PerimeterView {
  key: string;
  positions: Float32Array;
  segIndex: Int32Array;
  segmentOk: boolean[];
  issues: PerimeterIssue[];
  closed: boolean;
  valid: boolean;
  length: number;
  controlPositions: Vec3[];
  controlNormals: Vec3[];
}

export interface AnchorPoint {
  face: number;
  bary: Vec3;
}

export interface SuggestionLoopView {
  controlPoints: AnchorPoint[];
  locked: Record<number, number[]>;
  length: number;
  polyline: Float32Array;
}

export interface SuggestionView {
  id: string;
  kind: SuggestionKind;
  label: string;
  description: string;
  loops: SuggestionLoopView[];
  controlPoints: AnchorPoint[];
  locked: Record<number, number[]>;
  meanValley: number;
  confidence: number;
  length: number;
  polyline: Float32Array;
}

export interface SuggestionsResult {
  suggestions: SuggestionView[];
  reliable: boolean;
  message?: string;
  selectionBoundary?: SuggestionView;
}

export interface PlaneFitResult {
  view: PerimeterView;
  fixedPathId: string;
  controlPoints: AnchorPoint[];
  maxShift: number;
  meanShift: number;
}

export interface CutParams {
  method: CutMethod;
  depth: number;
  bulge?: number;
  flip?: boolean;
  selection?: Uint8Array | null;
}

export interface CutCapInfo {
  method: CutMethod;
  planar: boolean;
  maxDeviation: number;
  relativeDeviation: number;
  projectionSimple: boolean;
  tiltDeg: number;
  area: number;
  minAngleDeg: number;
  triangles: number;
}

export interface CutPreviewGeometry {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
  capMask: Uint8Array;
  volume: number;
  triangleCount: number;
}

export interface CutIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
}

export interface CutPreview {
  previewId: string;
  color: string;
  depth: number;
  extracted: CutPreviewGeometry;
  remainder: CutPreviewGeometry;
  seam: SeamInfo;
  seams: SeamInfo[];
  loop: Float32Array;
  loops: Float32Array[];
  extractedComponents: number;
  cap: {
    method: CutMethod;
    planar: boolean;
    maxDeviation: number;
    relativeDeviation: number;
    projectionSimple: boolean;
    tiltDeg: number;
    area: number;
    minAngleDeg: number;
    triangles: number;
  };
  caps: CutCapInfo[];
  issues: CutIssue[];
  problems: { extracted: Float32Array; remainder: Float32Array };
  valid: boolean;
  forceable: boolean;
  crossingPairs: number;
  volumes: { original: number; extracted: number; remainder: number; relativeError: number };
  stats: { touchedFaces: number; loopVertices: number; capTriangles: number; capMinAngle: number; ms: number };
  manifoldCheck: { extracted: boolean; remainder: boolean };
}

export interface JointMetrics {
  interferenceVolume: number;
  wallExcessVolume: number;
  maleExcessVolume: number;
  assemblyClear: boolean;
  maleVolume: number;
}

export interface JointPreview {
  previewId: string;
  seamId: string;
  extracted: PieceGeometry;
  remainder: PieceGeometry;
  valid: boolean;
  issues: JointIssue[];
  metrics: JointMetrics;
}

export interface ExportRequest {
  pieceIds: string[];
  format: ExportFormat;
  placement: Placement;
  baseName: string;
  allowWarnings?: boolean;
}

export interface ExportResult {
  files: ExportFile[];
  skipped: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Contrato del motor. Corre completo dentro del Web Worker; `EngineClient`
 * replica esta interfaz en el hilo principal agregando progreso y cancelación.
 */
export interface EngineApi {
  init(): Promise<{ ready: true }>;
  loadModel(fileName: string, buffer: ArrayBuffer): Promise<{ model: ModelInfo; doc: DocumentView }>;
  analyzeModel(opts?: { selfIntersections?: boolean }): Promise<ModelAnalysis>;
  undo(): Promise<DocumentView>;
  redo(): Promise<DocumentView>;
  setActivePiece(pieceId: string): Promise<DocumentView>;
  orientModel(rotation: number[]): Promise<DocumentView>;
  updatePiece(pieceId: string, patch: { name?: string; color?: string }): Promise<DocumentView>;
  getSelectionData(pieceId: string): Promise<SelectionData>;
  computePerimeter(pieceId: string, input: PerimeterInput & { fixedPathId?: string }): Promise<PerimeterView>;
  fitPerimeterToPlane(pieceId: string, key: string): Promise<PlaneFitResult>;
  checkSeparation(pieceId: string, keys: string | string[]): Promise<{ separates: boolean; message?: string }>;
  suggestPerimeters(pieceId: string, selection: Uint8Array): Promise<SuggestionsResult>;
  previewCut(pieceId: string, keys: string | string[], params: CutParams): Promise<CutPreview>;
  discardPreview(previewId: string): Promise<void>;
  commitCut(previewId: string, names: { extracted: string; remainder: string }, force?: boolean): Promise<DocumentView>;
  extractComponent(pieceId: string, component: number, trim: boolean): Promise<DocumentView>;
  toleranceProfiles(): Promise<ToleranceProfile[]>;
  suggestJoint(seamId: string, profileId: string): Promise<{ params: JointParams | null; reason?: string }>;
  previewJoint(seamId: string, params: JointParams): Promise<JointPreview>;
  commitJoint(previewId: string): Promise<DocumentView>;
  validatePiece(pieceId: string): Promise<ValidationReport & { manifold: boolean }>;
  exportFiles(req: ExportRequest): Promise<ExportResult>;
}

export type EngineMethod = keyof EngineApi;

export type WorkerRequest =
  | { type: 'call'; id: number; method: EngineMethod; args: unknown[] }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; fraction: number; message?: string }
  | { type: 'result'; id: number; result: unknown }
  | {
      type: 'error';
      id: number;
      error: { name: string; message: string; code?: string; details?: string; cancelled?: boolean };
    };
