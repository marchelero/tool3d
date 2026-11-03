import type { IndexedMesh, Vec3 } from '../core/types';
import { MeshTopology } from '../core/MeshTopology';
import { TriangleBVH } from '../core/TriangleBVH';
import { averageEdgeLength, computeBBox, bboxDiagonal, signedVolume, surfaceArea, trianglesIntersect } from '../core/geometry';
import { NULL_CONTEXT, type TaskContext } from '../core/TaskContext';

export interface ComponentInfo {
  index: number;
  triangleCount: number;
  closed: boolean;
  volume: number;
  area: number;
  bboxMin: Vec3;
  bboxMax: Vec3;
  /** Otros componentes con los que se atraviesa. */
  intersects: number[];
}

export type MeshStatus = 'ok' | 'warning' | 'error';

export interface ModelAnalysis {
  triangleCount: number;
  vertexCount: number;
  bboxMin: Vec3;
  bboxMax: Vec3;
  dimensions: Vec3;
  diagonal: number;
  averageEdge: number;
  area: number;
  volume: number;
  components: ComponentInfo[];
  boundaryEdges: number;
  nonManifoldEdges: number;
  nonManifoldVertices: number;
  inconsistentEdges: number;
  degenerateFaces: number;
  selfIntersections: {
    checked: boolean;
    withinComponent: number;
    betweenComponents: number;
    capped: boolean;
    faces: number[];
  };
  status: MeshStatus;
  /** Mensajes para el usuario, del más grave al más leve. */
  messages: Array<{ severity: 'error' | 'warning' | 'info'; text: string }>;
  /** Puede cortarse con garantías (malla cerrada, manifold y orientada). */
  cuttable: boolean;
}

export interface AnalyzeOptions {
  checkSelfIntersections?: boolean;
  maxPairs?: number;
}

/** MeshAnalyzer: estadísticas, componentes y diagnóstico topológico. */
export async function analyzeMesh(mesh: IndexedMesh, ctx: TaskContext = NULL_CONTEXT, opts: AnalyzeOptions = {}): Promise<ModelAnalysis> {
  const P = mesh.positions;
  const I = mesh.indices;
  const nV = P.length / 3;
  const nF = I.length / 3;
  await ctx.checkpoint('Analizando topología', 0.05);
  const topo = MeshTopology.build(I, nV);
  const nmVerts = topo.nonManifoldVertexCount();
  const comps = topo.components();
  const bbox = computeBBox(P);
  const diag = bboxDiagonal(bbox);

  // Componentes
  const compFaces: number[][] = Array.from({ length: comps.count }, () => []);
  for (let f = 0; f < nF; f++) compFaces[comps.faceComponent[f]].push(f);
  const compOpen = new Uint8Array(comps.count);
  for (let h = 0; h < topo.nH; h++) {
    const e = topo.heEdge[h];
    if (topo.edgeValence[e] !== 2) compOpen[comps.faceComponent[(h / 3) | 0]] = 1;
  }
  const components: ComponentInfo[] = compFaces.map((faces, index) => {
    const idx = new Uint32Array(faces.length * 3);
    faces.forEach((f, i) => {
      idx[3 * i] = I[3 * f];
      idx[3 * i + 1] = I[3 * f + 1];
      idx[3 * i + 2] = I[3 * f + 2];
    });
    const b = computeBBox(P, idx);
    const sub = { positions: P, indices: idx };
    return {
      index,
      triangleCount: faces.length,
      closed: !compOpen[index],
      volume: signedVolume(sub),
      area: surfaceArea(sub),
      bboxMin: b.min,
      bboxMax: b.max,
      intersects: [],
    };
  });
  // Ordenar no: el índice de componente debe coincidir con faceComponent.

  // Caras degeneradas
  let degenerate = 0;
  const areaEps = 1e-14 * diag * diag;
  for (let f = 0; f < nF; f++) {
    const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <= 2 * areaEps) degenerate++;
  }

  // Autointersecciones (por bloques, con progreso y cancelación)
  const si = { checked: false, withinComponent: 0, betweenComponents: 0, capped: false, faces: [] as number[] };
  const check = opts.checkSelfIntersections ?? nF <= 800000;
  if (check) {
    si.checked = true;
    const maxPairs = opts.maxPairs ?? 2000;
    await ctx.checkpoint('Buscando superficies que se atraviesan', 0.15);
    const full = new TriangleBVH(P, I);
    const tb = new Float64Array(nF * 6);
    for (let f = 0; f < nF; f++) {
      const a = I[3 * f] * 3, b = I[3 * f + 1] * 3, c = I[3 * f + 2] * 3;
      for (let k = 0; k < 3; k++) {
        tb[6 * f + k] = Math.min(P[a + k], P[b + k], P[c + k]);
        tb[6 * f + 3 + k] = Math.max(P[a + k], P[b + k], P[c + k]);
      }
    }
    const T1 = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    const T2 = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
    const shared: Array<[number, number]> = [];
    const between = new Set<string>();
    const CHUNK = 40000;
    let stop = false;
    for (let s = 0; s < nF && !stop; s += CHUNK) {
      const faces: number[] = [];
      for (let f = s; f < Math.min(nF, s + CHUNK); f++) faces.push(f);
      const probe = new TriangleBVH(P, I, faces);
      probe.overlapPairs(full, (fa, fb) => {
        if (fb <= fa) return; // cada par una sola vez
        if (
          tb[6 * fa] > tb[6 * fb + 3] || tb[6 * fa + 3] < tb[6 * fb] ||
          tb[6 * fa + 1] > tb[6 * fb + 4] || tb[6 * fa + 4] < tb[6 * fb + 1] ||
          tb[6 * fa + 2] > tb[6 * fb + 5] || tb[6 * fa + 5] < tb[6 * fb + 2]
        ) return;
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
        if (!trianglesIntersect(T1, T2, shared)) return;
        const ca = comps.faceComponent[fa];
        const cb = comps.faceComponent[fb];
        if (ca === cb) si.withinComponent++;
        else {
          si.betweenComponents++;
          between.add(ca < cb ? `${ca}_${cb}` : `${cb}_${ca}`);
        }
        if (si.faces.length < 2000) si.faces.push(fa, fb);
        if (si.withinComponent + si.betweenComponents >= maxPairs) {
          si.capped = true;
          stop = true;
          return true;
        }
      });
      await ctx.checkpoint('Buscando superficies que se atraviesan', 0.15 + 0.8 * Math.min(1, (s + CHUNK) / nF));
    }
    for (const key of between) {
      const [a, b] = key.split('_').map(Number);
      components[a].intersects.push(b);
      components[b].intersects.push(a);
    }
  }

  const messages: ModelAnalysis['messages'] = [];
  if (topo.boundaryEdgeCount > 0) {
    messages.push({ severity: 'error', text: `La malla tiene ${topo.boundaryEdgeCount} bordes abiertos (agujeros). Un corte que pase cerca puede no cerrar.` });
  }
  if (topo.nonManifoldEdgeCount > 0) {
    messages.push({
      severity: 'warning',
      text: `Hay ${topo.nonManifoldEdgeCount} aristas no-manifold (más de dos caras por arista), por ejemplo dos cuerpos pegados por una arista o una pared interna. Se puede cortar y exportar igual; las piezas que las conserven no van a admitir encastres automáticos. Para evitarlo, repará el modelo en el laminador o en Meshmixer antes de cargarlo.`,
    });
  }
  if (nmVerts > 0) {
    messages.push({
      severity: 'warning',
      text: `Hay ${nmVerts} ${nmVerts === 1 ? 'vértice donde dos superficies se tocan' : 'vértices donde dos superficies se tocan'} en un solo punto. No impide cortar ni imprimir; las piezas los conservan.`,
    });
  }
  if (topo.inconsistentEdgeCount > 0) {
    messages.push({ severity: 'error', text: `Hay ${topo.inconsistentEdgeCount} aristas con normales invertidas entre caras vecinas.` });
  }
  if (si.withinComponent > 0) {
    messages.push({ severity: 'warning', text: `Hay ${si.capped ? 'muchas' : si.withinComponent} zonas donde la superficie se atraviesa a sí misma.` });
  }
  if (si.betweenComponents > 0) {
    messages.push({ severity: 'warning', text: 'Hay componentes independientes que se superponen entre sí. Al extraerlos conviene recortarlos contra el cuerpo.' });
  }
  if (degenerate > 0) messages.push({ severity: 'info', text: `${degenerate} caras tienen área nula.` });
  if (!check) {
    messages.push({
      severity: 'info',
      text: `El modelo es grande (${nF.toLocaleString('es-AR')} triángulos): no buscamos superficies que se atraviesen para no demorar la carga. Podés revisarlo desde el diagnóstico.`,
    });
  }
  if (comps.count > 1) {
    messages.push({ severity: 'info', text: `El modelo tiene ${comps.count} componentes independientes. Si la pieza que querés separar ya es uno de ellos, podés extraerla sin cortar.` });
  }
  const cuttable = topo.nonManifoldEdgeCount === 0 && topo.inconsistentEdgeCount === 0;
  const hasError = messages.some((m) => m.severity === 'error');
  const hasWarning = messages.some((m) => m.severity === 'warning');
  if (!hasError && !hasWarning) messages.push({ severity: 'info', text: 'La malla está cerrada y es apta para cortar.' });
  ctx.progress(1, 'Análisis completo');

  return {
    triangleCount: nF,
    vertexCount: nV,
    bboxMin: bbox.min,
    bboxMax: bbox.max,
    dimensions: [bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]],
    diagonal: diag,
    averageEdge: averageEdgeLength(mesh),
    area: surfaceArea(mesh),
    volume: signedVolume(mesh),
    components,
    boundaryEdges: topo.boundaryEdgeCount,
    nonManifoldEdges: topo.nonManifoldEdgeCount,
    nonManifoldVertices: nmVerts,
    inconsistentEdges: topo.inconsistentEdgeCount,
    degenerateFaces: degenerate,
    selfIntersections: si,
    status: hasError ? 'error' : hasWarning ? 'warning' : 'ok',
    messages,
    cuttable,
  };
}
