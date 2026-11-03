import type { ManifoldToplevel } from 'manifold-3d';
import type { IndexedMesh, Vec3 } from '../core/types';
import { GeometryError } from '../core/TaskContext';
import { checkExportSafety, weldForExport } from '../validation/MeshValidator';

export type ManifoldModule = ManifoldToplevel;
export type ManifoldObj = InstanceType<ManifoldModule['Manifold']>;
export type CrossSectionObj = InstanceType<ManifoldModule['CrossSection']>;

/** De dónde sale el WebAssembly de Manifold: una URL o los bytes ya cargados. */
export interface WasmSource {
  locateFile?: () => string;
  wasmBinary?: Uint8Array;
}

/** Reparación aplicada para que la malla sea segura en float32. */
export interface ExportRepair {
  kind: 'weld' | 'simplify';
  /** Tolerancia de la simplificación (mm); 0 para la unión de vértices coincidentes. */
  tolerance: number;
  removedTriangles: number;
}

/** Matriz 4×4 en orden columna (Manifold usa las 3 primeras filas). */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

/**
 * BooleanGeometryEngine: envoltorio de Manifold (WASM). Manifold garantiza
 * resultados manifold y booleanas robustas; no se implementa un motor
 * booleano propio. Todos los objetos WASM se liberan con `scope`.
 */
export class BooleanGeometryEngine {
  private constructor(readonly wasm: ManifoldModule) {}

  static fromWasm(wasm: ManifoldModule): BooleanGeometryEngine {
    return new BooleanGeometryEngine(wasm);
  }

  static async create(source?: WasmSource | (() => string)): Promise<BooleanGeometryEngine> {
    const src: WasmSource = typeof source === 'function' ? { locateFile: source } : source ?? {};
    const opts: Record<string, unknown> = {};
    if (src.locateFile) opts.locateFile = src.locateFile;
    if (src.wasmBinary) opts.wasmBinary = src.wasmBinary;
    const { default: Module } = await import('manifold-3d');
    const wasm = await Module(Object.keys(opts).length ? (opts as Parameters<typeof Module>[0]) : undefined);
    wasm.setup();
    return new BooleanGeometryEngine(wasm);
  }

  /** Ejecuta fn liberando al final todo objeto registrado con `track`. */
  scope<T>(fn: (track: <M extends { delete(): void }>(m: M) => M) => T): T {
    const owned: Array<{ delete(): void }> = [];
    const track = <M extends { delete(): void }>(m: M): M => {
      owned.push(m);
      return m;
    };
    try {
      return fn(track);
    } finally {
      for (const o of owned) {
        try {
          o.delete();
        } catch {
          /* ya liberado */
        }
      }
    }
  }

  toManifold(mesh: IndexedMesh): ManifoldObj {
    const { Manifold, Mesh } = this.wasm;
    const vp = new Float32Array(mesh.positions.length);
    for (let i = 0; i < vp.length; i++) vp[i] = mesh.positions[i];
    try {
      const m = new Manifold(new Mesh({ numProp: 3, vertProperties: vp, triVerts: Uint32Array.from(mesh.indices) }));
      const st = m.status();
      if (st !== 'NoError') {
        m.delete();
        throw new GeometryError('La pieza no es un sólido cerrado válido.', 'manifold-status', st);
      }
      return m;
    } catch (e) {
      if (e instanceof GeometryError) throw e;
      throw new GeometryError('La pieza no es un sólido cerrado válido (no manifold).', 'manifold-invalid', String(e));
    }
  }

  fromManifold(m: ManifoldObj): IndexedMesh {
    return meshFromGL(m.getMesh());
  }

  /**
   * Convierte a Manifold marcando el origen de cada cara: un id original
   * propio y faceID = 1 en las caras de superficies de corte. Así, después de
   * una booleana se puede saber qué caras son interiores (corte o encastre).
   */
  toManifoldTagged(mesh: IndexedMesh, capMask?: Uint8Array): { manifold: ManifoldObj; id: number } {
    const { Manifold, Mesh } = this.wasm;
    const nTri = mesh.indices.length / 3;
    const id = Manifold.reserveIDs(1);
    const vp = new Float32Array(mesh.positions.length);
    for (let i = 0; i < vp.length; i++) vp[i] = mesh.positions[i];
    const faceID = new Uint32Array(nTri);
    if (capMask) for (let t = 0; t < nTri; t++) faceID[t] = capMask[t] ? 1 : 0;
    try {
      const m = new Manifold(
        new Mesh({
          numProp: 3,
          vertProperties: vp,
          triVerts: Uint32Array.from(mesh.indices),
          runIndex: Uint32Array.from([0, nTri * 3]),
          runOriginalID: Uint32Array.from([id]),
          faceID,
        }),
      );
      if (m.status() !== 'NoError') {
        const st = m.status();
        m.delete();
        throw new GeometryError('La pieza no es un sólido cerrado válido.', 'manifold-status', st);
      }
      return { manifold: m, id };
    } catch (e) {
      if (e instanceof GeometryError) throw e;
      throw new GeometryError('La pieza no es un sólido cerrado válido (no manifold).', 'manifold-invalid', String(e));
    }
  }

  /** Malla + máscara de caras interiores (de otro origen o marcadas como corte). */
  fromManifoldTagged(m: ManifoldObj, ownId: number): { mesh: IndexedMesh; capMask: Uint8Array } {
    const g = m.getMesh();
    const mesh = meshFromGL(g);
    const nTri = g.triVerts.length / 3;
    const capMask = new Uint8Array(nTri);
    const runs = g.runOriginalID?.length ?? 0;
    for (let r = 0; r < runs; r++) {
      const t0 = g.runIndex[r] / 3;
      const t1 = (r + 1 < g.runIndex.length ? g.runIndex[r + 1] : g.triVerts.length) / 3;
      const foreign = g.runOriginalID[r] !== ownId;
      for (let t = t0; t < t1; t++) capMask[t] = foreign || (g.faceID && g.faceID[t] === 1) ? 1 : 0;
    }
    return { mesh, capMask };
  }

  /**
   * Igual que `fromManifoldTagged`, pero garantiza que la malla siga siendo
   * válida al guardarse con coordenadas float32 (STL/3MF). Las booleanas
   * pueden dejar vértices a menos de una millonésima de milímetro entre sí:
   * primero se unen los que ya coinciden en float32 (colapso de aristas de
   * longitud nula, sin cambio geométrico); si no alcanza, se simplifica con
   * una tolerancia de micrones, que no cambia la forma imprimible.
   */
  fromManifoldTaggedSafe(m: ManifoldObj, ownId: number): { mesh: IndexedMesh; capMask: Uint8Array; safe: boolean; repair: ExportRepair | null } {
    const first = this.fromManifoldTagged(m, ownId);
    if (checkExportSafety(first.mesh).ok) return { ...first, safe: true, repair: null };
    const weld = (r: { mesh: IndexedMesh; capMask: Uint8Array }) => {
      const w = weldForExport(r.mesh, r.capMask);
      return w && checkExportSafety(w.mesh).ok ? w : null;
    };
    const w0 = weld(first);
    if (w0) return { mesh: w0.mesh, capMask: w0.capMask, safe: true, repair: { kind: 'weld', tolerance: 0, removedTriangles: w0.removedTriangles } };
    const bb = m.boundingBox();
    const diag = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;
    for (const k of [1e-6, 1e-5, 1e-4]) {
      const tol = k * diag;
      const s = m.simplify(tol);
      try {
        if (s.status() !== 'NoError' || s.isEmpty()) continue;
        const res = this.fromManifoldTagged(s, ownId);
        const removed = first.mesh.indices.length / 3 - res.mesh.indices.length / 3;
        if (checkExportSafety(res.mesh).ok) return { ...res, safe: true, repair: { kind: 'simplify', tolerance: tol, removedTriangles: removed } };
        const w = weld(res);
        if (w) return { mesh: w.mesh, capMask: w.capMask, safe: true, repair: { kind: 'simplify', tolerance: tol, removedTriangles: removed + w.removedTriangles } };
      } finally {
        s.delete();
      }
    }
    return { ...first, safe: false, repair: null };
  }

  /** Verificación independiente con Manifold. */
  check(mesh: IndexedMesh): { ok: boolean; status: string; genus: number; volume: number } {
    return this.scope((track) => {
      try {
        const m = track(this.toManifold(mesh));
        return { ok: true, status: m.status(), genus: m.genus(), volume: m.volume() };
      } catch (e) {
        return { ok: false, status: e instanceof GeometryError ? e.details ?? e.code : String(e), genus: 0, volume: 0 };
      }
    });
  }
}

function meshFromGL(mesh: { numProp: number; vertProperties: Float32Array; triVerts: Uint32Array }): IndexedMesh {
  const np = mesh.numProp;
  const nV = mesh.vertProperties.length / np;
  const positions = new Float64Array(nV * 3);
  for (let v = 0; v < nV; v++) {
    positions[3 * v] = mesh.vertProperties[np * v];
    positions[3 * v + 1] = mesh.vertProperties[np * v + 1];
    positions[3 * v + 2] = mesh.vertProperties[np * v + 2];
  }
  return { positions, indices: Uint32Array.from(mesh.triVerts) };
}

/** Marco local: X = u, Y = z × u, Z = z (dirección), origen o. */
export function frameMatrix(origin: Vec3, zAxis: Vec3, uHint: Vec3): Mat4 {
  const z = normalize(zAxis);
  // u ortogonal a z
  let ux = uHint[0], uy = uHint[1], uz = uHint[2];
  const d = ux * z[0] + uy * z[1] + uz * z[2];
  ux -= d * z[0];
  uy -= d * z[1];
  uz -= d * z[2];
  let u = normalize([ux, uy, uz]);
  if (!Number.isFinite(u[0]) || Math.hypot(...u) < 0.5) {
    u = normalize(Math.abs(z[0]) < 0.9 ? [0, z[2], -z[1]] : [-z[2], 0, z[0]]);
  }
  const y: Vec3 = [z[1] * u[2] - z[2] * u[1], z[2] * u[0] - z[0] * u[2], z[0] * u[1] - z[1] * u[0]];
  return [u[0], u[1], u[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, origin[0], origin[1], origin[2], 1];
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}
