import type { IndexedMesh } from '../core/types';
import { MeshTopology } from '../core/MeshTopology';
import { TriangleBVH } from '../core/TriangleBVH';
import { computeBBox, bboxDiagonal, signedVolume, surfaceArea, trianglesIntersect } from '../core/geometry';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  code:
    | 'open-edges'
    | 'non-manifold-edges'
    | 'non-manifold-vertices'
    | 'inconsistent-normals'
    | 'degenerate-faces'
    | 'self-intersections'
    | 'unexpected-components'
    | 'negative-volume'
    | 'empty'
    | 'thin-walls'
    | 'boolean-error'
    | 'joint-interference';
  severity: Severity;
  message: string;
  count?: number;
  /** Algunas caras involucradas, para resaltarlas. */
  faces?: number[];
}

export interface ValidationReport {
  valid: boolean;
  closed: boolean;
  manifold: boolean;
  consistentOrientation: boolean;
  triangleCount: number;
  vertexCount: number;
  components: number;
  volume: number;
  area: number;
  degenerateFaces: number;
  selfIntersectionPairs: number;
  selfIntersectionsChecked: boolean;
  issues: ValidationIssue[];
}

export interface ValidateOptions {
  /** Revisar autointersecciones. 'new' revisa solo pares con caras marcadas. */
  selfIntersections?: 'all' | 'subset' | 'none';
  /** Caras nuevas (1) a revisar contra toda la malla cuando selfIntersections='subset'. */
  faceSubset?: Uint8Array;
  expectedComponents?: number;
  maxPairs?: number;
}

/**
 * MeshValidator: verifica que una malla sea un sólido cerrado, manifold,
 * con orientación coherente, sin caras degeneradas ni autointersecciones.
 */
export function validateSolid(mesh: IndexedMesh, opts: ValidateOptions = {}): ValidationReport {
  const nV = mesh.positions.length / 3;
  const nF = mesh.indices.length / 3;
  const issues: ValidationIssue[] = [];
  if (nF === 0) {
    return {
      valid: false, closed: false, manifold: false, consistentOrientation: false,
      triangleCount: 0, vertexCount: 0, components: 0, volume: 0, area: 0,
      degenerateFaces: 0, selfIntersectionPairs: 0, selfIntersectionsChecked: false,
      issues: [{ code: 'empty', severity: 'error', message: 'La pieza no tiene triángulos.' }],
    };
  }
  const topo = MeshTopology.build(mesh.indices, nV);
  const closed = topo.boundaryEdgeCount === 0;
  const nmVerts = topo.nonManifoldVertexCount();
  const manifold = topo.nonManifoldEdgeCount === 0 && nmVerts === 0;
  const consistentOrientation = topo.inconsistentEdgeCount === 0;
  if (!closed) {
    issues.push({ code: 'open-edges', severity: 'error', count: topo.boundaryEdgeCount, message: `La malla tiene ${topo.boundaryEdgeCount} bordes abiertos.`, faces: facesOfEdges(topo, (e) => topo.edgeValence[e] === 1) });
  }
  if (topo.nonManifoldEdgeCount > 0) {
    issues.push({ code: 'non-manifold-edges', severity: 'error', count: topo.nonManifoldEdgeCount, message: `Hay ${topo.nonManifoldEdgeCount} aristas compartidas por más de dos caras.`, faces: facesOfEdges(topo, (e) => topo.edgeValence[e] > 2) });
  }
  if (nmVerts > 0) {
    // Dos superficies que se tocan en un solo vértice no abren la malla ni
    // cambian su volumen: los laminadores y Manifold las aceptan. Se informa,
    // pero no invalida la pieza.
    issues.push({
      code: 'non-manifold-vertices',
      severity: 'info',
      count: nmVerts,
      message: `Hay ${nmVerts} ${nmVerts === 1 ? 'vértice donde dos superficies se tocan' : 'vértices donde dos superficies se tocan'} en un solo punto (no impide imprimir).`,
    });
  }
  if (!consistentOrientation) {
    issues.push({ code: 'inconsistent-normals', severity: 'error', count: topo.inconsistentEdgeCount, message: `Hay ${topo.inconsistentEdgeCount} aristas con normales inconsistentes.`, faces: facesOfEdges(topo, (e) => topo.edgeFlipped[e] === 1) });
  }

  const bbox = computeBBox(mesh.positions);
  const diag = bboxDiagonal(bbox);
  const areaEps = 1e-14 * diag * diag;
  const P = mesh.positions;
  const I = mesh.indices;
  let degenerate = 0;
  const degFaces: number[] = [];
  for (let f = 0; f < nF; f++) {
    const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (area2 <= 2 * areaEps) {
      degenerate++;
      if (degFaces.length < 50) degFaces.push(f);
    }
  }
  if (degenerate > 0) {
    issues.push({ code: 'degenerate-faces', severity: 'warning', count: degenerate, message: `Hay ${degenerate} caras de área nula.`, faces: degFaces });
  }

  const comps = topo.components();
  if (opts.expectedComponents !== undefined && comps.count !== opts.expectedComponents) {
    issues.push({ code: 'unexpected-components', severity: 'warning', count: comps.count, message: `La pieza tiene ${comps.count} partes desconectadas (se esperaba ${opts.expectedComponents}).` });
  }

  const volume = signedVolume(mesh);
  const area = surfaceArea(mesh);
  if (closed && consistentOrientation && volume <= 0) {
    issues.push({ code: 'negative-volume', severity: 'error', message: 'Las normales apuntan hacia adentro (volumen negativo).' });
  }

  let pairs = 0;
  let checked = false;
  const mode = opts.selfIntersections ?? 'all';
  if (mode !== 'none') {
    checked = true;
    const found = findSelfIntersections(mesh, mode === 'subset' ? opts.faceSubset : undefined, opts.maxPairs ?? 200);
    pairs = found.pairs;
    if (pairs > 0) {
      issues.push({
        code: 'self-intersections',
        severity: 'error',
        count: pairs,
        message: found.capped ? `Hay más de ${pairs} pares de triángulos que se atraviesan.` : `Hay ${pairs} pares de triángulos que se atraviesan.`,
        faces: found.faces,
      });
    }
  }

  const valid = issues.every((i) => i.severity !== 'error');
  return {
    valid, closed, manifold, consistentOrientation,
    triangleCount: nF, vertexCount: nV, components: comps.count,
    volume, area, degenerateFaces: degenerate,
    selfIntersectionPairs: pairs, selfIntersectionsChecked: checked, issues,
  };
}

function facesOfEdges(topo: MeshTopology, pred: (e: number) => boolean, limit = 200): number[] {
  const out: number[] = [];
  for (let h = 0; h < topo.nH && out.length < limit; h++) {
    if (pred(topo.heEdge[h])) out.push((h / 3) | 0);
  }
  return out;
}

/**
 * Busca pares de triángulos que se atraviesan. Ignora los contactos en
 * vértices o aristas compartidas por índice (adyacencia legítima).
 */
export function findSelfIntersections(
  mesh: IndexedMesh,
  subset?: Uint8Array,
  maxPairs = 200,
): { pairs: number; capped: boolean; faces: number[] } {
  const P = mesh.positions;
  const I = mesh.indices;
  const full = new TriangleBVH(P, I);
  let probe = full;
  if (subset) {
    const faces: number[] = [];
    for (let f = 0; f < subset.length; f++) if (subset[f]) faces.push(f);
    if (faces.length === 0) return { pairs: 0, capped: false, faces: [] };
    probe = new TriangleBVH(P, I, faces);
  }
  let pairs = 0;
  let capped = false;
  const faces: number[] = [];
  const seen = new Set<string>();
  const T1: Float64Array[] = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const T2: Float64Array[] = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const shared: Array<[number, number]> = [];
  probe.overlapPairs(full, (fa, fb) => {
    if (fa === fb) return;
    if (subset && probe !== full) {
      // Evitar contar dos veces pares nuevo-nuevo.
      if (subset[fb] && fb < fa) return;
    }
    shared.length = 0;
    for (let i = 0; i < 3; i++) {
      const va = I[3 * fa + i];
      for (let j = 0; j < 3; j++) if (I[3 * fb + j] === va) shared.push([i, j]);
    }
    for (let k = 0; k < 3; k++) {
      const a = I[3 * fa + k] * 3;
      const b = I[3 * fb + k] * 3;
      T1[k][0] = P[a]; T1[k][1] = P[a + 1]; T1[k][2] = P[a + 2];
      T2[k][0] = P[b]; T2[k][1] = P[b + 1]; T2[k][2] = P[b + 2];
    }
    if (trianglesIntersect(T1, T2, shared)) {
      const key = fa < fb ? `${fa}_${fb}` : `${fb}_${fa}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs++;
      if (faces.length < 400) faces.push(fa, fb);
      if (pairs >= maxPairs) {
        capped = true;
        return true;
      }
    }
  });
  return { pairs, capped, faces };
}

/**
 * Simula lo que verá el laminador: coordenadas en float32 (STL) y vértices
 * unidos por posición. Si al soldar aparecen aristas no-manifold o bordes,
 * la pieza no es apta para exportar aunque su topología indexada lo sea.
 */
export function checkExportSafety(mesh: IndexedMesh): { ok: boolean; message?: string } {
  const P = mesh.positions;
  const I = mesh.indices;
  const nV = P.length / 3;
  const map = new Map<string, number>();
  const remap = new Int32Array(nV);
  let n = 0;
  for (let v = 0; v < nV; v++) {
    const key = `${Math.fround(P[3 * v])},${Math.fround(P[3 * v + 1])},${Math.fround(P[3 * v + 2])}`;
    let id = map.get(key);
    if (id === undefined) {
      id = n++;
      map.set(key, id);
    }
    remap[v] = id;
  }
  const idx = new Uint32Array(I.length);
  let degenerate = 0;
  for (let t = 0; t < I.length / 3; t++) {
    const a = remap[I[3 * t]], b = remap[I[3 * t + 1]], c = remap[I[3 * t + 2]];
    if (a === b || b === c || a === c) degenerate++;
    idx[3 * t] = a;
    idx[3 * t + 1] = b;
    idx[3 * t + 2] = c;
  }
  if (degenerate) return { ok: false, message: `${degenerate} triángulos colapsan al guardar en STL (vértices demasiado cercanos).` };
  if (n === nV) return { ok: true };
  // Vértices compartidos en un solo punto (pellizcos) no abren la malla: solo
  // importan las aristas que quedarían abiertas o compartidas por más de dos caras.
  const topo = MeshTopology.build(idx, n);
  if (topo.nonManifoldEdgeCount || topo.boundaryEdgeCount) {
    return { ok: false, message: 'Al guardar en STL, vértices distintos coinciden en posición y la malla deja de ser manifold.' };
  }
  return { ok: true };
}

/**
 * Reparación sin cambio geométrico para exportar: une los vértices que ya
 * coinciden en float32 (lo mismo que hará el laminador al leer el STL) y
 * descarta los triángulos que colapsan. Equivale a colapsar aristas de
 * longitud nula, así que la forma no cambia. Devuelve null si el resultado no
 * es un sólido cerrado y manifold con los mismos componentes.
 */
export function weldForExport(mesh: IndexedMesh, capMask?: Uint8Array): { mesh: IndexedMesh; capMask: Uint8Array; removedTriangles: number } | null {
  const P = mesh.positions;
  const I = mesh.indices;
  const nV = P.length / 3;
  const nT = I.length / 3;
  const map = new Map<string, number>();
  const remap = new Int32Array(nV);
  const firstOf: number[] = [];
  for (let v = 0; v < nV; v++) {
    const key = `${Math.fround(P[3 * v])},${Math.fround(P[3 * v + 1])},${Math.fround(P[3 * v + 2])}`;
    let id = map.get(key);
    if (id === undefined) {
      id = firstOf.length;
      firstOf.push(v);
      map.set(key, id);
    }
    remap[v] = id;
  }
  const keep: number[] = [];
  for (let t = 0; t < nT; t++) {
    const a = remap[I[3 * t]], b = remap[I[3 * t + 1]], c = remap[I[3 * t + 2]];
    if (a !== b && b !== c && a !== c) keep.push(t);
  }
  // Compactar vértices usados
  const used = new Int32Array(firstOf.length).fill(-1);
  let nNew = 0;
  const indices = new Uint32Array(keep.length * 3);
  const mask = new Uint8Array(keep.length);
  for (let k = 0; k < keep.length; k++) {
    const t = keep[k];
    for (let j = 0; j < 3; j++) {
      const id = remap[I[3 * t + j]];
      if (used[id] < 0) used[id] = nNew++;
      indices[3 * k + j] = used[id];
    }
    mask[k] = capMask ? capMask[t] : 0;
  }
  const positions = new Float64Array(nNew * 3);
  for (let id = 0; id < firstOf.length; id++) {
    if (used[id] < 0) continue;
    const v = firstOf[id];
    positions[3 * used[id]] = Math.fround(P[3 * v]);
    positions[3 * used[id] + 1] = Math.fround(P[3 * v + 1]);
    positions[3 * used[id] + 2] = Math.fround(P[3 * v + 2]);
  }
  const before = MeshTopology.build(I, nV).components().count;
  const topo = MeshTopology.build(indices, nNew);
  if (topo.boundaryEdgeCount || topo.nonManifoldEdgeCount) return null;
  if (topo.components().count !== before) return null;
  return { mesh: { positions, indices }, capMask: mask, removedTriangles: nT - keep.length };
}
