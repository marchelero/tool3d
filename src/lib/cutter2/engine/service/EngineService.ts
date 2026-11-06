import type { IndexedMesh, Vec3 } from '../core/types';
import { MeshContext } from '../core/MeshContext';
import { GeometryError, NULL_CONTEXT, type TaskContext } from '../core/TaskContext';
import { computeBBox, signedVolume } from '../core/geometry';
import { importModel } from '../import/ModelImporter';
import { subMesh } from '../import/weld';
import { analyzeMesh, type ModelAnalysis } from '../analysis/MeshAnalyzer';
import { computeCurvatureCooperative } from '../analysis/curvature';
import { segmentMesh } from '../selection/SmartSelection';
import { SurfaceSplineEngine, type PerimeterInput, type PerimeterResult } from '../perimeter/SurfaceSplineEngine';
import { suggestPerimeters, type PerimeterSuggestion } from '../perimeter/BoundarySuggestionEngine';
import { distanceToLoop, planeSectionLoops } from '../perimeter/PlaneSection';
import { fitLoopPlane } from '../cut/CutSurfaceGenerator';
import { checkLoops, splitByPerimeters, type SeamInfo, type SplitResult } from '../cut/SplitOperation';
import { BooleanGeometryEngine, type WasmSource } from '../boolean/BooleanGeometryEngine';
import type { CapSurface, CutMethod } from '../cut/CutSurfaceGenerator';
import { applyJoint, suggestJoint, TOLERANCE_PROFILES, type JointParams, type JointResult } from '../joints/JointGenerator';
import { checkExportSafety, validateSolid, weldForExport, type ValidationReport } from '../validation/MeshValidator';
import { exportPieces } from '../export/ExportManager';
import type {
  CutParams, CutPreview, DocumentView, EngineApi, ExportRequest, ExportResult, JointPreview, ModelInfo,
  PerimeterView, PieceGeometry, PieceMeta, PieceRole, SelectionData, SuggestionView, SuggestionsResult,
} from '../../worker/protocol';

/** Paleta para piezas nuevas (filamentos habituales). */
const PALETTE = ['#d63a2f', '#2f7dd6', '#2fa65a', '#e3b52c', '#8e44ad', '#1f1f1f', '#e67e22', '#16a085'];
const MODEL_COLOR = '#ece8e1';

interface PieceRecord {
  id: string;
  name: string;
  color: string;
  role: PieceRole;
  mesh: IndexedMesh;
  capMask: Uint8Array;
  /** Dirección exterior de la cara de unión principal (para imprimir apoyada). */
  downDirection: Vec3 | null;
  hasJoint: boolean;
  /** Avisos que acompañan a la pieza (por ejemplo, un corte aplicado a la fuerza). */
  notes?: string[];
}

interface SeamRecord {
  id: string;
  extractedId: string;
  remainderId: string;
  info: SeamInfo;
  joint: JointParams | null;
  loop: Float32Array;
  /** Cómo se cerró el corte y de qué pieza salió (para el historial). */
  method: CutMethod;
  parentName: string;
  /** Corte al que pertenece: un corte con varios perímetros deja varias uniones. */
  cutId: string;
}

interface DocState {
  pieces: PieceRecord[];
  seams: SeamRecord[];
  activePieceId: string | null;
}

type WithCtx<F> = F extends (...a: infer A) => infer R ? (...a: [...A, TaskContext?]) => R : never;
export type EngineServiceApi = { [K in keyof EngineApi]: WithCtx<EngineApi[K]> };

let idCounter = 0;
const newId = (prefix: string) => `${prefix}${++idCounter}`;

/**
 * Fachada del motor: documento (piezas, uniones, historial), cachés por
 * pieza y operaciones de alto nivel. Corre dentro del Web Worker; también se
 * puede usar directamente (pruebas, otras integraciones como AreaMaker).
 */
export class EngineService implements EngineServiceApi {
  private booleans: BooleanGeometryEngine | null = null;
  private originalMesh: IndexedMesh | null = null;
  /** Aristas compartidas por más de dos caras que ya traía el modelo cargado (defectos heredados). */
  private originalNonManifold = 0;
  private modelInfo: ModelInfo | null = null;
  private analysis: ModelAnalysis | null = null;
  private state: DocState = { pieces: [], seams: [], activePieceId: null };
  private undoStack: DocState[] = [];
  private redoStack: DocState[] = [];
  private sentGeometry = new Set<string>();
  private contexts = new Map<string, MeshContext>();
  private splines = new Map<string, SurfaceSplineEngine>();
  private perimeters = new Map<string, { pieceId: string; result: PerimeterResult }>();
  private cutPreviews = new Map<string, { pieceId: string; result: SplitResult; params: CutParams }>();
  private jointPreviews = new Map<string, { seamId: string; params: JointParams; result: JointResult }>();
  private validations = new Map<string, ValidationReport>();
  private fixedPaths = new Map<string, import('../core/types').PathPoint[]>();
  private colorIndex = 0;

  constructor(private readonly locateWasm?: WasmSource | (() => string)) {}

  // ---------------------------------------------------------------- base

  async init(): Promise<{ ready: true }> {
    if (!this.booleans) this.booleans = await BooleanGeometryEngine.create(this.locateWasm);
    return { ready: true };
  }

  private async engine(): Promise<BooleanGeometryEngine> {
    await this.init();
    return this.booleans!;
  }

  async loadModel(fileName: string, buffer: ArrayBuffer, task: TaskContext = NULL_CONTEXT): Promise<{ model: ModelInfo; doc: DocumentView }> {
    await task.checkpoint('Leyendo el archivo', 0.05);
    const imported = importModel(fileName, buffer);
    await task.checkpoint('Preparando la malla', 0.6);
    this.reset();
    // Copia inmutable del modelo original.
    this.originalMesh = { positions: imported.mesh.positions.slice(), indices: imported.mesh.indices.slice() };
    Object.freeze(this.originalMesh);
    this.modelInfo = {
      fileName,
      format: imported.format,
      fileTriangleCount: imported.fileTriangleCount,
      warnings: imported.warnings,
      objectNames: imported.objectNames,
    };
    const name = fileName.replace(/\.(stl|3mf)$/i, '') || 'Modelo';
    const piece = this.makePiece(name, MODEL_COLOR, 'model', imported.mesh, new Uint8Array(imported.mesh.indices.length / 3), null);
    this.state = { pieces: [piece], seams: [], activePieceId: piece.id };
    this.originalNonManifold = this.context(piece).topo.nonManifoldEdgeCount;

    task.progress(1, 'Modelo cargado');
    return { model: this.modelInfo, doc: this.view() };
  }

  /**
   * Diagnóstico del modelo original. En modelos de más de 800.000 triángulos
   * la búsqueda de autointersecciones se omite salvo que se pida.
   */
  async analyzeModel(opts: { selfIntersections?: boolean } = {}, task: TaskContext = NULL_CONTEXT): Promise<ModelAnalysis> {
    if (!this.originalMesh) throw new GeometryError('No hay un modelo cargado.', 'no-model');
    const needCheck = opts.selfIntersections === true && this.analysis !== null && !this.analysis.selfIntersections.checked;
    if (!this.analysis || needCheck) {
      this.analysis = await analyzeMesh(this.originalMesh, task, opts.selfIntersections ? { checkSelfIntersections: true } : {});
    }
    // Las medidas siguen al documento actual (por ejemplo, después de orientar o deshacer).
    if (this.state.pieces.length) {
      let a0 = Infinity, b0 = Infinity, d0 = Infinity, a1 = -Infinity, b1 = -Infinity, d1 = -Infinity;
      for (const p of this.state.pieces) {
        const P = p.mesh.positions;
        for (let i = 0; i < P.length; i += 3) {
          if (P[i] < a0) a0 = P[i];
          if (P[i] > a1) a1 = P[i];
          if (P[i + 1] < b0) b0 = P[i + 1];
          if (P[i + 1] > b1) b1 = P[i + 1];
          if (P[i + 2] < d0) d0 = P[i + 2];
          if (P[i + 2] > d1) d1 = P[i + 2];
        }
      }
      this.analysis = { ...this.analysis, bboxMin: [a0, b0, d0], bboxMax: [a1, b1, d1], dimensions: [a1 - a0, b1 - b0, d1 - d0] };
    }
    return this.analysis;
  }

  private reset(): void {
    this.state = { pieces: [], seams: [], activePieceId: null };
    this.undoStack = [];
    this.redoStack = [];
    this.sentGeometry.clear();
    this.contexts.clear();
    this.splines.clear();
    this.perimeters.clear();
    this.cutPreviews.clear();
    this.jointPreviews.clear();
    this.validations.clear();
    this.analysis = null;
    this.colorIndex = 0;
  }

  private makePiece(name: string, color: string, role: PieceRole, mesh: IndexedMesh, capMask: Uint8Array, downDirection: Vec3 | null, hasJoint = false): PieceRecord {
    return { id: newId('p'), name, color, role, mesh, capMask, downDirection, hasJoint };
  }

  private nextColor(): string {
    return PALETTE[this.colorIndex++ % PALETTE.length];
  }

  private piece(id: string): PieceRecord {
    const p = this.state.pieces.find((x) => x.id === id);
    if (!p) throw new GeometryError('La pieza ya no existe.', 'no-piece', id);
    return p;
  }

  private context(p: PieceRecord): MeshContext {
    let c = this.contexts.get(p.id);
    if (!c) {
      c = new MeshContext(p.mesh);
      this.contexts.set(p.id, c);
    }
    return c;
  }

  private spline(p: PieceRecord): SurfaceSplineEngine {
    let s = this.splines.get(p.id);
    if (!s) {
      s = new SurfaceSplineEngine(this.context(p));
      this.splines.set(p.id, s);
    }
    return s;
  }

  private validation(p: PieceRecord): ValidationReport {
    let v = this.validations.get(p.id);
    if (!v) {
      v = validateSolid(p.mesh, { selfIntersections: 'none' });
      this.validations.set(p.id, v);
    }
    return v;
  }

  /**
   * ¿La pieza arrastra aristas compartidas por más de dos caras que ya tenía el
   * modelo original? El corte no las toca: no invalidan la pieza para exportar,
   * aunque impiden los encastres (Manifold no acepta esa malla).
   */
  private inheritedDefects(p: PieceRecord): boolean {
    if (this.originalNonManifold === 0) return false;
    const nm = this.validation(p).issues.find((i) => i.code === 'non-manifold-edges');
    return !!nm && (nm.count ?? 0) <= this.originalNonManifold;
  }

  /** Errores de validación que sí son de la pieza (sin los defectos heredados del modelo). */
  private pieceErrors(p: PieceRecord): ValidationReport['issues'] {
    const inherited = this.inheritedDefects(p);
    return this.validation(p).issues.filter((i) => i.severity === 'error' && !(inherited && i.code === 'non-manifold-edges'));
  }

  private meta(p: PieceRecord): PieceMeta {
    const v = this.validation(p);
    const b = computeBBox(p.mesh.positions);
    const inherited = this.inheritedDefects(p);
    const issues = v.issues.map((i) =>
      inherited && i.code === 'non-manifold-edges'
        ? `Conserva ${i.count} arista${i.count === 1 ? '' : 's'} compartida${i.count === 1 ? '' : 's'} por más de dos caras que ya traía el modelo: se exporta igual, sin encastre automático.`
        : i.message,
    );
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      role: p.role,
      triangleCount: p.mesh.indices.length / 3,
      volume: v.volume,
      bboxMin: b.min,
      bboxMax: b.max,
      valid: v.valid || this.pieceErrors(p).length === 0,
      issues: [...issues, ...(p.notes ?? [])],
      hasJoint: p.hasJoint,
      componentCount: v.components,
    };
  }

  private geometry(p: PieceRecord): PieceGeometry {
    return { id: p.id, positions: Float32Array.from(p.mesh.positions), indices: p.mesh.indices.slice(), capMask: p.capMask.slice() };
  }

  private view(): DocumentView {
    const geometries: PieceGeometry[] = [];
    for (const p of this.state.pieces) {
      if (!this.sentGeometry.has(p.id)) {
        geometries.push(this.geometry(p));
        this.sentGeometry.add(p.id);
      }
    }
    return {
      pieces: this.state.pieces.map((p) => this.meta(p)),
      seams: this.state.seams.map((s) => ({
        id: s.id, extractedId: s.extractedId, remainderId: s.remainderId, info: s.info, joint: s.joint, loop: s.loop.slice(), method: s.method, parentName: s.parentName, cutId: s.cutId,
      })),
      geometries,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      activePieceId: this.state.activePieceId,
    };
  }

  private commit(next: DocState): DocumentView {
    this.undoStack.push(this.state);
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
    this.state = next;
    this.gc();
    return this.view();
  }

  /** Libera cachés de piezas que ya no están en el documento ni en el historial. */
  private gc(): void {
    const alive = new Set<string>();
    for (const s of [this.state, ...this.undoStack, ...this.redoStack]) for (const p of s.pieces) alive.add(p.id);
    for (const map of [this.contexts, this.splines, this.validations] as Array<Map<string, unknown>>) {
      for (const k of [...map.keys()]) if (!alive.has(k)) map.delete(k);
    }
  }

  async undo(): Promise<DocumentView> {
    const prev = this.undoStack.pop();
    if (prev) {
      this.redoStack.push(this.state);
      this.state = prev;
    }
    return this.view();
  }

  async redo(): Promise<DocumentView> {
    const next = this.redoStack.pop();
    if (next) {
      this.undoStack.push(this.state);
      this.state = next;
    }
    return this.view();
  }

  async setActivePiece(pieceId: string): Promise<DocumentView> {
    this.piece(pieceId);
    this.state = { ...this.state, activePieceId: pieceId };
    return this.view();
  }

  /**
   * Orienta el modelo: aplica una rotación (matriz 3×3 por filas) a todas las
   * piezas y uniones, alrededor del centro del conjunto, conservando la altura
   * del punto más bajo (lo que estaba apoyado en la cama sigue apoyado) y el
   * centro en planta. Se puede deshacer.
   */
  async orientModel(rotation: number[]): Promise<DocumentView> {
    if (rotation.length !== 9 || rotation.some((x) => !Number.isFinite(x))) throw new GeometryError('Rotación inválida.', 'bad-rotation');
    const R = rotation;
    const det =
      R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    if (Math.abs(det - 1) > 1e-6) throw new GeometryError('La orientación debe ser una rotación pura.', 'bad-rotation', `det=${det}`);
    if (!this.state.pieces.length) throw new GeometryError('No hay un modelo cargado.', 'no-model');
    // Centro de la caja del conjunto y punto más bajo, antes y después de rotar.
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const p of this.state.pieces) {
      const P = p.mesh.positions;
      for (let i = 0; i < P.length; i += 3) {
        if (P[i] < x0) x0 = P[i];
        if (P[i] > x1) x1 = P[i];
        if (P[i + 1] < y0) y0 = P[i + 1];
        if (P[i + 1] > y1) y1 = P[i + 1];
        if (P[i + 2] < z0) z0 = P[i + 2];
        if (P[i + 2] > z1) z1 = P[i + 2];
      }
    }
    const c: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const rot = (x: number, y: number, z: number): Vec3 => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
    let zMin = Infinity;
    for (const p of this.state.pieces) {
      const P = p.mesh.positions;
      for (let i = 0; i < P.length; i += 3) {
        const z = R[6] * (P[i] - c[0]) + R[7] * (P[i + 1] - c[1]) + R[8] * (P[i + 2] - c[2]);
        if (z < zMin) zMin = z;
      }
    }
    const t: Vec3 = [c[0], c[1], z0 - zMin];
    const point = (q: Vec3): Vec3 => {
      const r = rot(q[0] - c[0], q[1] - c[1], q[2] - c[2]);
      return [r[0] + t[0], r[1] + t[1], r[2] + t[2]];
    };
    const ids = new Map<string, string>();
    const pieces = this.state.pieces.map((p) => {
      const P = p.mesh.positions;
      const out = new Float64Array(P.length);
      for (let i = 0; i < P.length; i += 3) {
        const q = point([P[i], P[i + 1], P[i + 2]]);
        out[i] = q[0];
        out[i + 1] = q[1];
        out[i + 2] = q[2];
      }
      const np = this.makePiece(p.name, p.color, p.role, { positions: out, indices: p.mesh.indices }, p.capMask, p.downDirection ? rot(...p.downDirection) : null, p.hasJoint);
      np.notes = p.notes;
      ids.set(p.id, np.id);
      return np;
    });
    const seams = this.state.seams.map((sm) => {
      const L = new Float32Array(sm.loop.length);
      for (let i = 0; i < L.length; i += 3) {
        const q = point([sm.loop[i], sm.loop[i + 1], sm.loop[i + 2]]);
        L[i] = q[0];
        L[i + 1] = q[1];
        L[i + 2] = q[2];
      }
      return {
        ...sm,
        extractedId: ids.get(sm.extractedId) ?? sm.extractedId,
        remainderId: ids.get(sm.remainderId) ?? sm.remainderId,
        loop: L,
        info: { ...sm.info, center: point(sm.info.center), normal: rot(...sm.info.normal), u: rot(...sm.info.u), v: rot(...sm.info.v) },
      };
    });
    const active = this.state.activePieceId ? ids.get(this.state.activePieceId) ?? null : null;
    return this.commit({ pieces, seams, activePieceId: active });
  }

  async updatePiece(pieceId: string, patch: { name?: string; color?: string }): Promise<DocumentView> {
    const p = this.piece(pieceId);
    const updated: PieceRecord = { ...p, name: patch.name?.trim() || p.name, color: patch.color ?? p.color };
    // El cambio de nombre/color no geométrico no pasa por el historial de cortes.
    this.state = { ...this.state, pieces: this.state.pieces.map((x) => (x.id === pieceId ? updated : x)) };
    return this.view();
  }

  // ------------------------------------------------------------ selección

  async getSelectionData(pieceId: string, task: TaskContext = NULL_CONTEXT): Promise<SelectionData> {
    const p = this.piece(pieceId);
    await task.checkpoint('Analizando curvatura', 0.1);
    const ctx = this.context(p);
    const curv = await computeCurvatureCooperative(ctx, 0.012, task, { start: 0.1, end: 0.48 });
    await task.checkpoint('Segmentando regiones', 0.5);
    const seg = segmentMesh(ctx);
    task.progress(1);
    return {
      pieceId,
      faceAdj: ctx.faceAdj.slice(),
      faceComponent: ctx.faceComponent.slice(),
      componentCount: ctx.componentCount,
      faceAreas: Float32Array.from(ctx.faceAreas),
      faceRegion: seg.faceRegion.slice(),
      regionCount: seg.regionCount,
      merges: seg.merges.slice(),
      valleyFace: curv.valleyFace.slice(),
    };
  }

  // ------------------------------------------------------------ perímetro

  async computePerimeter(pieceId: string, input: PerimeterInput & { fixedPathId?: string }): Promise<PerimeterView> {
    const p = this.piece(pieceId);
    const fixed = input.fixedPathId ? this.fixedPaths.get(input.fixedPathId) : undefined;
    const res = fixed ? this.spline(p).computeFixed(fixed) : this.spline(p).compute(input);
    const key = newId('per');
    this.perimeters.set(key, { pieceId, result: res });
    // Varios perímetros por corte: se conservan los últimos (cada edición crea una clave nueva).
    if (this.perimeters.size > 64) this.perimeters.delete(this.perimeters.keys().next().value!);
    const ctx = this.context(p);
    return this.perimeterView(p, key, res, input.points.map((cp) => ctx.surfacePt(cp.face, cp.bary[0], cp.bary[1], cp.bary[2])));
  }

  private perimeterView(p: PieceRecord, key: string, res: PerimeterResult, controls: Array<{ face: number; b0: number; b1: number; b2: number; x: number; y: number; z: number }>): PerimeterView {
    const n = res.path.length;
    const closedExtra = res.closed && n > 1 ? 1 : 0;
    const positions = new Float32Array((n + closedExtra) * 3);
    const segIndex = new Int32Array(n + closedExtra);
    for (let i = 0; i < n + closedExtra; i++) {
      const q = res.path[i % n];
      positions[3 * i] = q.x;
      positions[3 * i + 1] = q.y;
      positions[3 * i + 2] = q.z;
      segIndex[i] = i === n ? res.path[n - 1].seg : q.seg;
    }
    const ctx = this.context(p);
    const controlNormals = controls.map((sp) => ctx.interpolatedNormal(sp));
    return {
      key,
      positions,
      segIndex,
      segmentOk: res.segmentOk,
      issues: res.issues,
      closed: res.closed,
      valid: res.valid,
      length: res.length,
      controlPositions: res.controlPositions,
      controlNormals,
    };
  }

  /**
   * Aproximación controlada: reemplaza el perímetro por la sección de la
   * malla con su plano medio, de modo que la tapa quede exactamente plana.
   * Informa el desplazamiento máximo para que el usuario decida.
   */
  async fitPerimeterToPlane(pieceId: string, key: string, task: TaskContext = NULL_CONTEXT): Promise<PlaneFitResult> {
    const entry = this.perimeters.get(key);
    if (!entry || entry.pieceId !== pieceId) throw new GeometryError('El perímetro cambió; volvé a confirmarlo.', 'stale-perimeter');
    const p = this.piece(pieceId);
    const ctx = this.context(p);
    await task.checkpoint('Buscando la sección plana del perímetro', 0.2);
    const orig = entry.result.path;
    const loopPos = new Float64Array(orig.length * 3);
    orig.forEach((q, i) => loopPos.set([q.x, q.y, q.z], 3 * i));
    // Plano medio del perímetro actual (mismo criterio que el cierre plano) y
    // búsqueda de la sección más cercana desplazando el plano a lo largo de su normal.
    const plane = fitLoopPlane(loopPos);
    let dev = 0;
    for (const q of orig) {
      dev = Math.max(dev, Math.abs((q.x - plane.origin[0]) * plane.normal[0] + (q.y - plane.origin[1]) * plane.normal[1] + (q.z - plane.origin[2]) * plane.normal[2]));
    }
    const step = Math.max(1, Math.floor(orig.length / 80));
    const evaluate = (loop: import('../core/types').PathPoint[]) => {
      let maxShift = 0;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < orig.length; i += step) {
        const dd = distanceToLoop(orig[i].x, orig[i].y, orig[i].z, loop);
        maxShift = Math.max(maxShift, dd);
        sum += dd;
        n++;
      }
      const s2 = Math.max(1, Math.floor(loop.length / 80));
      for (let i = 0; i < loop.length; i += s2) maxShift = Math.max(maxShift, distanceToLoop(loop[i].x, loop[i].y, loop[i].z, orig));
      return { maxShift, mean: sum / n };
    };
    let best: { loop: import('../core/types').PathPoint[]; maxShift: number; mean: number } | null = null;
    const offsets = dev > 0 ? Array.from({ length: 17 }, (_, i) => -2 * dev + (4 * dev * i) / 16) : [0];
    for (const off of offsets) {
      const origin: Vec3 = [plane.origin[0] + off * plane.normal[0], plane.origin[1] + off * plane.normal[1], plane.origin[2] + off * plane.normal[2]];
      const loops = planeSectionLoops(ctx, origin, plane.normal);
      for (const loop of loops) {
        const ev = evaluate(loop);
        if (!best || ev.maxShift < best.maxShift) best = { loop, ...ev };
      }
      await task.checkpoint();
    }
    if (!best) throw new GeometryError('El plano medio no corta la pieza en un lazo cerrado.', 'plane-no-loop');
    const loop = best.loop;
    const maxShift = best.maxShift;
    const bestScore = best.mean;
    const eqRadius = entry.result.length / (2 * Math.PI);
    if (maxShift > Math.max(1.5, 0.3 * eqRadius)) {
      throw new GeometryError(
        `No hay una sección plana cerca del perímetro: se desplazaría hasta ${maxShift.toFixed(1)} mm. Usá el cierre curvo o redibujá el perímetro.`,
        'plane-too-far',
      );
    }
    // Puntos de control repartidos a lo largo del lazo.
    const K = Math.min(12, Math.max(6, Math.round(loop.length / 8)));
    const marked = loop.map((q, i) => ({ ...q, pinned: i % Math.max(1, Math.floor(loop.length / K)) === 0 }));
    const res = this.spline(p).computeFixed(marked);
    const newKey = newId('per');
    this.perimeters.set(newKey, { pieceId, result: res });
    this.fixedPaths.set(newKey, marked);
    const view = this.perimeterView(p, newKey, res, res.path.filter((q) => q.pinned).map((q) => ctx.toSurfacePt(q)));
    return {
      view,
      fixedPathId: newKey,
      controlPoints: res.path.filter((q) => q.pinned).map((q) => {
        const sp = ctx.toSurfacePt(q);
        return { face: sp.face, bary: [sp.b0, sp.b1, sp.b2] as Vec3 };
      }),
      maxShift,
      meanShift: bestScore,
    };
  }

  /** Perímetros guardados para estas claves (en el orden recibido). */
  private perimeterPaths(pieceId: string, keys: string | string[], requireValid: boolean): import('../core/types').PathPoint[][] {
    const list = Array.isArray(keys) ? keys : [keys];
    if (!list.length) throw new GeometryError('Todavía no hay un perímetro.', 'no-perimeter');
    return list.map((key, k) => {
      const entry = this.perimeters.get(key);
      if (!entry || entry.pieceId !== pieceId) throw new GeometryError('El perímetro cambió; volvé a confirmarlo.', 'stale-perimeter');
      if (requireValid && !entry.result.valid) {
        throw new GeometryError(list.length > 1 ? `El perímetro ${k + 1} no es válido todavía.` : 'El perímetro no es válido todavía.', 'invalid-perimeter');
      }
      return entry.result.path;
    });
  }

  /** ¿Los perímetros (uno o varios, del mismo corte) separan la pieza? */
  async checkSeparation(pieceId: string, keys: string | string[], task: TaskContext = NULL_CONTEXT): Promise<{ separates: boolean; message?: string }> {
    const paths = this.perimeterPaths(pieceId, keys, false);
    const p = this.piece(pieceId);
    await task.checkpoint('Verificando que el perímetro separe la pieza', 0.2);
    try {
      return checkLoops(this.context(p), paths);
    } catch (e) {
      return { separates: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  async suggestPerimeters(pieceId: string, selection: Uint8Array, task: TaskContext = NULL_CONTEXT): Promise<SuggestionsResult> {
    const p = this.piece(pieceId);
    await task.checkpoint('Buscando límites naturales', 0.2);
    const ctx = this.context(p);
    const res = await suggestPerimeters(ctx, selection, task);
    await task.checkpoint('Preparando sugerencias para el visor', 0.995);
    const polylineOf = (loop: number[]) => {
      const P = ctx.P;
      const polyline = new Float32Array((loop.length + 1) * 3);
      for (let i = 0; i <= loop.length; i++) {
        const v = loop[i % loop.length];
        polyline[3 * i] = P[3 * v];
        polyline[3 * i + 1] = P[3 * v + 1];
        polyline[3 * i + 2] = P[3 * v + 2];
      }
      return polyline;
    };
    const toView = (s: PerimeterSuggestion): SuggestionView => {
      const loops = s.loops.map((l) => ({
        controlPoints: l.controlVertices.map((v) => vertexAnchor(ctx, v)),
        locked: l.locked,
        length: l.length,
        polyline: polylineOf(l.loop),
      }));
      return {
        id: s.id,
        kind: s.kind,
        label: s.label,
        description: s.description,
        loops,
        controlPoints: loops[0].controlPoints,
        locked: loops[0].locked,
        meanValley: s.meanValley,
        confidence: s.confidence,
        length: s.length,
        polyline: loops[0].polyline,
      };
    };
    const result = {
      suggestions: res.suggestions.map(toView),
      reliable: res.reliable,
      message: res.message,
      selectionBoundary: res.selectionBoundary ? toView(res.selectionBoundary) : undefined,
    };
    await task.checkpoint('Sugerencias listas', 1);
    return result;
  }

  // ---------------------------------------------------------------- corte

  /**
   * Vista previa del corte por uno o más perímetros. Con varios (por ejemplo,
   * dos dientes elegidos con Ctrl+clic) se extrae una sola pieza con varias
   * partes y queda una unión por perímetro.
   */
  async previewCut(pieceId: string, keys: string | string[], params: CutParams, task: TaskContext = NULL_CONTEXT): Promise<CutPreview> {
    const paths = this.perimeterPaths(pieceId, keys, true);
    const p = this.piece(pieceId);
    const t0 = Date.now();
    const depth = Math.max(0, Math.min(500, Number(params.depth) || 0));
    const result = await splitByPerimeters(this.context(p), paths, { method: params.method, bulge: params.bulge, flip: params.flip, selection: params.selection ?? null, previousCapMask: p.capMask, depth }, task);
    await task.checkpoint('Verificación independiente con Manifold', 0.92);
    const eng = await this.engine();
    const mx = eng.check(result.extracted);
    const mr = eng.check(result.remainder);
    // Con aristas defectuosas heredadas del modelo, Manifold rechaza la pieza
    // por ese motivo: el corte se puede aplicar igual (sin encastre automático).
    const inherited = result.forceable && result.issues.some((i) => i.code === 'inherited-non-manifold');
    if (!mx.ok) result.issues.push({ severity: inherited ? 'info' : 'error', message: `Manifold rechaza la pieza extraída (${mx.status}).` });
    if (!mr.ok) result.issues.push({ severity: inherited ? 'info' : 'error', message: `Manifold rechaza el cuerpo (${mr.status}).` });
    // Seguridad en float32: si dos vértices coinciden al guardar, colapsar esas
    // aristas de longitud nula (sin cambio de forma) y volver a verificar.
    for (const side of ['extracted', 'remainder'] as const) {
      const label = side === 'extracted' ? 'Pieza extraída' : 'Cuerpo';
      const maskKey = side === 'extracted' ? 'extractedCapMask' : 'remainderCapMask';
      let safe = checkExportSafety(result[side]);
      if (!safe.ok) {
        const w = weldForExport(result[side], result[maskKey]);
        if (w && checkExportSafety(w.mesh).ok && eng.check(w.mesh).ok && validateSolid(w.mesh, { selfIntersections: 'none' }).valid) {
          result[side] = w.mesh;
          result[maskKey] = w.capMask;
          result.issues.push({ severity: 'info', message: `${label}: se unieron vértices que coincidían al guardar en STL (${w.removedTriangles} triángulos de área nula eliminados).` });
          safe = { ok: true };
        }
      }
      if (!safe.ok) {
        result.issues.push({ severity: 'error', message: `${label}: ${safe.message}` });
        result.valid = false;
        result.forceable = false;
      }
    }
    if ((!mx.ok || !mr.ok) && !inherited) result.forceable = false;
    const previewId = newId('cut');
    this.cutPreviews.clear();
    this.cutPreviews.set(previewId, { pieceId, result, params });
    const geo = (mesh: IndexedMesh, mask: Uint8Array, id: string) => ({
      id,
      positions: Float32Array.from(mesh.positions),
      indices: mesh.indices.slice(),
      capMask: mask.slice(),
      volume: signedVolume(mesh),
      triangleCount: mesh.indices.length / 3,
    });
    const capInfo = (cap: CapSurface, seam: SeamInfo) => ({
      method: cap.method,
      planar: seam.planar,
      maxDeviation: cap.planarity.maxDeviation,
      relativeDeviation: cap.planarity.relative,
      projectionSimple: cap.projectionSimple,
      tiltDeg: cap.tiltDeg,
      area: cap.area,
      minAngleDeg: cap.quality.minAngleDeg,
      triangles: cap.triangles.length / 3,
    });
    const caps = result.caps.map((c, k) => capInfo(c, result.seams[k]));
    return {
      previewId,
      color: PALETTE[this.colorIndex % PALETTE.length],
      depth,
      extracted: geo(result.extracted, result.extractedCapMask, `${previewId}-x`),
      remainder: geo(result.remainder, result.remainderCapMask, `${previewId}-r`),
      seam: result.seam,
      seams: result.seams,
      loop: Float32Array.from(result.loopPositions),
      loops: result.loops.map((l) => Float32Array.from(l)),
      extractedComponents: result.extractedComponents,
      cap: {
        method: caps[0].method,
        planar: caps.every((c) => c.planar),
        maxDeviation: Math.max(...caps.map((c) => c.maxDeviation)),
        relativeDeviation: Math.max(...caps.map((c) => c.relativeDeviation)),
        projectionSimple: caps.every((c) => c.projectionSimple),
        tiltDeg: Math.max(...caps.map((c) => c.tiltDeg)),
        area: caps.reduce((a, c) => a + c.area, 0),
        minAngleDeg: Math.min(...caps.map((c) => c.minAngleDeg)),
        triangles: caps.reduce((a, c) => a + c.triangles, 0),
      },
      caps,
      issues: result.issues,
      problems: { extracted: Float32Array.from(result.problems.extracted), remainder: Float32Array.from(result.problems.remainder) },
      valid: result.valid && mx.ok && mr.ok,
      forceable: result.forceable,
      crossingPairs: result.crossingPairs,
      volumes: result.volumes,
      stats: { ...result.stats, ms: Date.now() - t0 },
      manifoldCheck: { extracted: mx.ok, remainder: mr.ok },
    };
  }

  async discardPreview(previewId: string): Promise<void> {
    this.cutPreviews.delete(previewId);
    this.jointPreviews.delete(previewId);
  }

  async commitCut(previewId: string, names: { extracted: string; remainder: string }, force = false): Promise<DocumentView> {
    const prev = this.cutPreviews.get(previewId);
    if (!prev) throw new GeometryError('La vista previa ya no está disponible.', 'no-preview');
    const forced = !prev.result.valid && force && prev.result.forceable;
    if (!prev.result.valid && !forced) throw new GeometryError('No se puede confirmar un corte inválido.', 'invalid-cut');
    const forcedNote = forced && prev.result.crossingPairs > 0
      ? `Corte aplicado con ${prev.result.crossingPairs} par${prev.result.crossingPairs === 1 ? '' : 'es'} de triángulos que se cruzan en la superficie de corte. Revisá la pieza en el laminador.`
      : null;
    const old = this.piece(prev.pieceId);
    const r = prev.result;
    // Dirección de apoyo de la pieza extraída: promedio de sus caras de unión (pesado por área).
    let dx = 0, dy = 0, dz = 0;
    for (const sm of r.seams) {
      const w = Math.max(sm.area, 1e-9);
      dx -= sm.normal[0] * w;
      dy -= sm.normal[1] * w;
      dz -= sm.normal[2] * w;
    }
    const dl = Math.hypot(dx, dy, dz);
    const N = r.seams[0].normal;
    const down: Vec3 = dl > 1e-9 * r.seams.reduce((a, sm) => a + Math.max(sm.area, 1e-9), 0) ? [dx / dl, dy / dl, dz / dl] : [-N[0], -N[1], -N[2]];
    const extracted = this.makePiece(names.extracted || 'Pieza', this.nextColor(), 'extracted', r.extracted, r.extractedCapMask, down);
    const remainder = this.makePiece(names.remainder || old.name, old.color, old.role === 'extracted' ? 'extracted' : 'remainder', r.remainder, r.remainderCapMask, old.downDirection);
    if (forcedNote) {
      if (r.validation.extracted.selfIntersectionPairs > 0) extracted.notes = [forcedNote];
      if (r.validation.remainder.selfIntersectionPairs > 0) remainder.notes = [...(old.notes ?? []), forcedNote];
      else if (old.notes) remainder.notes = old.notes;
    } else if (old.notes) remainder.notes = old.notes;
    // Reasignar uniones previas de la pieza dividida a la parte que las contiene.
    const seams = this.state.seams.map((s) => {
      if (s.extractedId !== old.id && s.remainderId !== old.id) return s;
      const target = this.containsSeam(r.extracted, s.loop) ? extracted.id : remainder.id;
      return {
        ...s,
        extractedId: s.extractedId === old.id ? target : s.extractedId,
        remainderId: s.remainderId === old.id ? target : s.remainderId,
      };
    });
    // Una unión por perímetro, todas del mismo corte.
    const cutId = newId('c');
    r.seams.forEach((info, k) => {
      seams.push({
        id: newId('s'), extractedId: extracted.id, remainderId: remainder.id, info, joint: null, loop: Float32Array.from(r.loops[k]),
        method: prev.params.method, parentName: old.role === 'model' ? '' : old.name, cutId,
      });
    });
    const pieces = this.state.pieces.flatMap((p) => (p.id === old.id ? [remainder, extracted] : [p]));
    this.cutPreviews.delete(previewId);
    return this.commit({ pieces, seams, activePieceId: remainder.id });
  }

  /** ¿Los vértices del lazo de una unión están en la malla dada? */
  private containsSeam(mesh: IndexedMesh, loop: Float32Array): boolean {
    const P = mesh.positions;
    const keys = new Set<string>();
    for (let i = 0; i < P.length; i += 3) keys.add(`${Math.fround(P[i])},${Math.fround(P[i + 1])},${Math.fround(P[i + 2])}`);
    let hit = 0;
    const n = loop.length / 3;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20))) {
      if (keys.has(`${loop[3 * i]},${loop[3 * i + 1]},${loop[3 * i + 2]}`)) hit++;
    }
    return hit > 0;
  }

  async extractComponent(pieceId: string, component: number, trim: boolean, task: TaskContext = NULL_CONTEXT): Promise<DocumentView> {
    const p = this.piece(pieceId);
    const ctx = this.context(p);
    if (component < 0 || component >= ctx.componentCount) throw new GeometryError('Componente inexistente.', 'no-component');
    if (ctx.componentCount < 2) throw new GeometryError('La pieza tiene un solo componente.', 'single-component');
    const facesA: number[] = [];
    const facesB: number[] = [];
    for (let f = 0; f < ctx.nF; f++) (ctx.faceComponent[f] === component ? facesA : facesB).push(f);
    let partA = subMesh(p.mesh, facesA);
    let maskA: Uint8Array = new Uint8Array(partA.indices.length / 3);
    const partB = subMesh(p.mesh, facesB);
    if (trim) {
      await task.checkpoint('Recortando el componente contra el cuerpo', 0.3);
      const eng = await this.engine();
      const res = eng.scope((track) => {
        const a = eng.toManifoldTagged(partA);
        track(a.manifold);
        const b = track(eng.toManifoldTagged(partB).manifold);
        const d = track(a.manifold.subtract(b));
        if (d.isEmpty()) throw new GeometryError('El componente queda completamente dentro del cuerpo.', 'trim-empty');
        // Las caras que vienen del cuerpo son la superficie de contacto (interior).
        return eng.fromManifoldTaggedSafe(d, a.id);
      });
      if (!res.safe) throw new GeometryError('El recorte dejó triángulos degenerados al guardar en STL.', 'trim-unsafe');
      partA = res.mesh;
      maskA = res.capMask;
    }
    const extracted = this.makePiece(`Componente ${component + 1}`, this.nextColor(), 'component', partA, maskA, null);
    const remainder = this.makePiece(p.name, p.color, p.role, partB, new Uint8Array(partB.indices.length / 3), p.downDirection);
    const pieces = this.state.pieces.flatMap((x) => (x.id === p.id ? [remainder, extracted] : [x]));
    return this.commit({ pieces, seams: this.state.seams, activePieceId: remainder.id });
  }

  // ------------------------------------------------------------ encastres

  async toleranceProfiles() {
    return TOLERANCE_PROFILES;
  }

  async suggestJoint(seamId: string, profileId: string): Promise<{ params: JointParams | null; reason?: string }> {
    const s = this.state.seams.find((x) => x.id === seamId);
    if (!s) throw new GeometryError('La unión ya no existe.', 'no-seam');
    const profile = TOLERANCE_PROFILES.find((t) => t.id === profileId) ?? TOLERANCE_PROFILES[1];
    const params = suggestJoint(s.info, profile, this.piece(s.extractedId).mesh, this.piece(s.remainderId).mesh);
    return params ? { params } : { params: null, reason: 'La superficie de unión es demasiado chica para un encastre imprimible.' };
  }

  async previewJoint(seamId: string, params: JointParams, task: TaskContext = NULL_CONTEXT): Promise<JointPreview> {
    const s = this.state.seams.find((x) => x.id === seamId);
    if (!s) throw new GeometryError('La unión ya no existe.', 'no-seam');
    const x = this.piece(s.extractedId);
    const r = this.piece(s.remainderId);
    if (!this.validation(x).valid || !this.validation(r).valid) {
      if (this.inheritedDefects(x) || this.inheritedDefects(r)) {
        throw new GeometryError(
          'Esta pieza conserva aristas compartidas por más de dos caras que ya traía el modelo, y el motor de encastres no puede operar sobre ella. Exportá las piezas sin encastre, o repará el modelo (laminador o Meshmixer) y volvé a cargarlo.',
          'joint-inherited-defects',
        );
      }
      throw new GeometryError('No se agregan encastres sobre piezas con defectos. Revisá la validación de las piezas.', 'joint-invalid-pieces');
    }
    const eng = await this.engine();
    const result = await applyJoint(eng, x.mesh, r.mesh, s.info, params, task, { extracted: x.capMask, remainder: r.capMask });
    for (const [label, m] of [[x.name, result.extracted], [r.name, result.remainder]] as const) {
      const safe = checkExportSafety(m);
      if (!safe.ok) {
        result.issues.push({ severity: 'error', code: 'stl-unsafe', message: `${label}: ${safe.message}` });
        result.valid = false;
      }
    }
    const previewId = newId('joint');
    this.jointPreviews.clear();
    this.jointPreviews.set(previewId, { seamId, params, result });
    return {
      previewId,
      seamId,
      extracted: { id: `${previewId}-x`, positions: Float32Array.from(result.extracted.positions), indices: result.extracted.indices.slice(), capMask: result.extractedCapMask.slice() },
      remainder: { id: `${previewId}-r`, positions: Float32Array.from(result.remainder.positions), indices: result.remainder.indices.slice(), capMask: result.remainderCapMask.slice() },
      valid: result.valid,
      issues: result.issues,
      metrics: result.metrics,
    };
  }

  async commitJoint(previewId: string): Promise<DocumentView> {
    const prev = this.jointPreviews.get(previewId);
    if (!prev) throw new GeometryError('La vista previa del encastre ya no está disponible.', 'no-preview');
    if (!prev.result.valid) throw new GeometryError('El encastre no es válido.', 'invalid-joint');
    const s = this.state.seams.find((x) => x.id === prev.seamId)!;
    const x = this.piece(s.extractedId);
    const r = this.piece(s.remainderId);
    const nx = this.makePiece(x.name, x.color, x.role, prev.result.extracted, prev.result.extractedCapMask, x.downDirection, true);
    const nr = this.makePiece(r.name, r.color, r.role, prev.result.remainder, prev.result.remainderCapMask, r.downDirection, true);
    nx.notes = x.notes;
    nr.notes = r.notes;
    const swap = (id: string) => (id === x.id ? nx.id : id === r.id ? nr.id : id);
    const pieces = this.state.pieces.map((p) => (p.id === x.id ? nx : p.id === r.id ? nr : p));
    const seams = this.state.seams.map((t) =>
      t.id === s.id ? { ...t, extractedId: nx.id, remainderId: nr.id, joint: prev.params } : { ...t, extractedId: swap(t.extractedId), remainderId: swap(t.remainderId) },
    );
    this.jointPreviews.delete(previewId);
    return this.commit({ pieces, seams, activePieceId: this.state.activePieceId === r.id ? nr.id : this.state.activePieceId === x.id ? nx.id : this.state.activePieceId });
  }

  // ------------------------------------------------------- validación/exportación

  async validatePiece(pieceId: string, task: TaskContext = NULL_CONTEXT): Promise<ValidationReport & { manifold: boolean }> {
    const p = this.piece(pieceId);
    await task.checkpoint('Validando la pieza', 0.1);
    const rep = validateSolid(p.mesh, { selfIntersections: 'all', expectedComponents: undefined });
    const eng = await this.engine();
    const m = eng.check(p.mesh);
    return { ...rep, manifold: m.ok };
  }

  async exportFiles(req: ExportRequest, task: TaskContext = NULL_CONTEXT): Promise<ExportResult> {
    const skipped: ExportResult['skipped'] = [];
    const chosen: PieceRecord[] = [];
    const eng = await this.engine();
    let i = 0;
    for (const id of req.pieceIds) {
      const p = this.piece(id);
      await task.checkpoint(`Validando ${p.name}`, (i++ / Math.max(1, req.pieceIds.length)) * 0.8);
      const v = this.validation(p);
      const m = eng.check(p.mesh);
      const safe = checkExportSafety(p.mesh);
      const errors = this.pieceErrors(p);
      // Con defectos heredados del modelo, Manifold rechaza la pieza por ese motivo; el STL se escribe igual.
      const manifoldOk = m.ok || this.inheritedDefects(p);
      if (errors.length || !manifoldOk || !safe.ok) {
        skipped.push({ id, name: p.name, reason: errors[0]?.message ?? (!manifoldOk ? `Manifold rechaza la pieza (${m.status}).` : safe.message ?? 'No es apta para STL.') });
        continue;
      }
      if (!req.allowWarnings && v.issues.some((x) => x.severity === 'warning')) {
        skipped.push({ id, name: p.name, reason: `Tiene advertencias: ${v.issues.find((x) => x.severity === 'warning')!.message}` });
        continue;
      }
      chosen.push(p);
    }
    await task.checkpoint('Generando archivos', 0.85);
    const files = chosen.length
      ? exportPieces(
          chosen.map((p) => ({ name: p.name, mesh: p.mesh, color: p.color, downDirection: p.downDirection })),
          { format: req.format, placement: req.placement, baseName: req.baseName },
        )
      : [];
    return { files, skipped };
  }
}

export interface PlaneFitResult {
  view: PerimeterView;
  fixedPathId: string;
  controlPoints: Array<{ face: number; bary: Vec3 }>;
  maxShift: number;
  meanShift: number;
}

function vertexAnchor(ctx: MeshContext, v: number): { face: number; bary: Vec3 } {
  const h = ctx.topo.vOut[ctx.topo.vOutStart[v]];
  const f = (h / 3) | 0;
  const bary: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) if (ctx.I[3 * f + i] === v) bary[i] = 1;
  return { face: f, bary };
}
