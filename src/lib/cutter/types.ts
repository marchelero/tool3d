import type { MeshBounds, MeshData, MeshDiagnostics } from "@/lib/mesh/types";
import type { KeychainShape } from "@/lib/3d/shapes";

export type CutAxis = "x" | "y" | "z";
export type CurveAxis = "x" | "y";
export type Ring2 = [number, number][];

interface CutOpBase {
  id: string;
  enabled: boolean;
}

export interface JointOptions {
  diameter: number;
  length: number;
  clearance: number;
  count?: number;
  variant?: "dowel" | "keyed" | "dovetail";
}

export interface PlaneCutOp extends CutOpBase {
  kind: "plane";
  axis: CutAxis;
  offset: number;
  normal?: [number, number, number];
  joint?: JointOptions;
}

export interface CurveCutOp extends CutOpBase {
  kind: "curve";
  axis: CurveAxis;
  offset: number;
  amplitude: number;
  wavelength: number;
  phase: number;
}

export interface ShapeCutOp extends CutOpBase {
  kind: "shape";
  shape: KeychainShape;
  width: number;
  height: number;
  rotationDeg: number;
  offsetX: number;
  offsetY: number;
}

export interface RegionCutOp extends CutOpBase {
  kind: "region";
  axis: CutAxis;
  rings: Ring2[];
  min: number;
  max: number;
  label: string;
}

export interface ComponentCutOp extends CutOpBase {
  kind: "components";
}

export type CutOp =
  | PlaneCutOp
  | CurveCutOp
  | ShapeCutOp
  | RegionCutOp
  | ComponentCutOp;

export interface PlaneSpec {
  kind: "plane";
  normal: [number, number, number];
  offset: number;
  joint?: JointOptions;
}

export interface CurveSpec {
  kind: "curve";
  axis: CurveAxis;
  offset: number;
  amplitude: number;
  wavelength: number;
  phase: number;
}

export interface ShapeSpec {
  kind: "shape";
  ring: [number, number][];
  zMin: number;
  zMax: number;
}

export interface RegionSpec {
  kind: "region";
  axis: CutAxis;
  rings: Ring2[];
  min: number;
  max: number;
}

export interface ComponentSpec {
  kind: "components";
}

export type CutSpec =
  | PlaneSpec
  | CurveSpec
  | ShapeSpec
  | RegionSpec
  | ComponentSpec;

export interface CutPart {
  id: string;
  name: string;
  mesh: MeshData;
  volume: number;
  color: string;
}

export interface LoadedModel {
  fileName: string;
  fileSize: number;
  format: "stl" | "3mf";
  mesh: MeshData;
  bounds: MeshBounds;
  diagnostics: MeshDiagnostics;
  faceColors: string[] | null;
  hasColors: boolean;
  warnings: string[];
}

export interface ComputeCutResult {
  parts: CutPart[];
  ms: number;
  warnings?: string[];
}

export interface CutterProgress {
  type: "progress";
  id: number;
  progress: number;
  phase: string;
}

export interface CutterCutResult {
  type: "cut-result";
  id: number;
  result: ComputeCutResult;
}

export interface CutterError {
  type: "error";
  id: number;
  message: string;
}

export type CutterResponse =
  | CutterProgress
  | CutterCutResult
  | CutterSuggestResult
  | CutterSeparateResult
  | CutterError;

export interface CutterCutRequest {
  type: "cut";
  id: number;
  wasmUrl: string;
  mesh: MeshData;
  ops: CutSpec[];
}

export type CutterRequest =
  | CutterCutRequest
  | CutterSuggestRequest
  | CutterSeparateRequest;

export interface CutterPartView {
  id: string;
  name: string;
  mesh: MeshData;
  color: string;
  volume: number;
  diagnostics: MeshDiagnostics;
}

export interface CutSuggestion {
  axis: CutAxis;
  offset: number;
  ratio: number;
}

export interface SuggestResult {
  suggestions: CutSuggestion[];
  ms: number;
}

export interface CutterSuggestResult {
  type: "suggest-result";
  id: number;
  result: SuggestResult;
}

export interface CutterSuggestRequest {
  type: "suggest";
  id: number;
  wasmUrl: string;
  mesh: MeshData;
}

export interface SeparationPlane {
  normal: [number, number, number];
  offset: number;
  label: string;
  source: "seam" | "neck";
  score: number;
}

export interface SeparateResult {
  planes: SeparationPlane[];
  ms: number;
}

export interface CutterSeparateResult {
  type: "separate-result";
  id: number;
  result: SeparateResult;
}

export interface CutterSeparateRequest {
  type: "separate";
  id: number;
  wasmUrl: string;
  mesh: MeshData;
}
