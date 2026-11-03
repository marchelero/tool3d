import type { IndexedMesh, PathPoint, Vec3 } from '../core/types';
import type { MeshContext } from '../core/MeshContext';
import { MeshTopology } from '../core/MeshTopology';
import { GeometryError, NULL_CONTEXT, type TaskContext } from '../core/TaskContext';
import { computeFaceNormals, signedVolume } from '../core/geometry';
import { embedPaths, type EmbedResult } from './CurveEmbedder';
import { type CapSurface, type CutMethod } from './CutSurfaceGenerator';
import { generateCapWithClearance } from './CapClearance';
import { validateSolid, type ValidationReport } from '../validation/MeshValidator';
import { distanceToPolyline } from './polygon2d';

export interface SplitParams {
  method: CutMethod;
  bulge?: number;
  /** Caras originales seleccionadas: definen qué lado se extrae. */
  selection?: Uint8Array | null;
  /** Invertir el lado extraído. */
  flip?: boolean;
  /** Tapas previas de la pieza (por cara original): se conservan en las piezas resultantes. */
  previousCapMask?: Uint8Array | null;
  /**
   * Profundidad del corte en mm (0 = por la superficie). Con profundidad, la
   * superficie de corte se hunde en el cuerpo: pared recta desde el perímetro
   * y fondo paralelo a la tapa. La pieza extraída gana ese espesor y en el
   * cuerpo queda el hueco donde encaja.
   */
  depth?: number;
}

/** Información de la unión entre dos piezas, usada para los encastres. */
export interface SeamInfo {
  center: Vec3;
  /** Normal unitaria que apunta desde el cuerpo hacia la pieza extraída. */
  normal: Vec3;
  u: Vec3;
  v: Vec3;
  /** Contorno proyectado en (u, v) relativo a `center`. */
  outlineX: number[];
  outlineY: number[];
  /** Radio del mayor círculo inscripto aproximado y su centro (u, v). */
  inradius: number;
  incenter: [number, number];
  planar: boolean;
  maxDeviation: number;
  area: number;
  /** Profundidad del corte (mm): `center` ya está en el fondo del hueco. */
  depth: number;
}

export interface SplitResult {
  extracted: IndexedMesh;
  remainder: IndexedMesh;
  extractedCapMask: Uint8Array;
  remainderCapMask: Uint8Array;
  /** Tapa, unión y contorno del primer perímetro (los de todos están en `caps`, `seams` y `loops`). */
  cap: CapSurface;
  seam: SeamInfo;
  loopPositions: Float64Array;
  /** Una tapa, una unión y un contorno por perímetro, en el orden de los caminos. */
  caps: CapSurface[];
  seams: SeamInfo[];
  loops: Float64Array[];
  /** Partes desconectadas de la pieza extraída (una por zona extraída). */
  extractedComponents: number;
  validation: { extracted: ValidationReport; remainder: ValidationReport };
  volumes: { original: number; extracted: number; remainder: number; relativeError: number };
  issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string; code?: string }>;
  /** Centroides (xyz) de caras con problemas, para marcarlas en el visor. */
  problems: { extracted: number[]; remainder: number[] };
  valid: boolean;
  /**
   * Inválido solo por triángulos que se cruzan en la superficie de corte (las
   * piezas están cerradas, orientadas y con el volumen correcto): se puede
   * aplicar igual, bajo responsabilidad del usuario.
   */
  forceable: boolean;
  /** Pares de triángulos que se cruzan (si `forceable`). */
  crossingPairs: number;
  stats: { touchedFaces: number; loopVertices: number; capTriangles: number; capMinAngle: number };
}

/**
 * Perímetros incrustados y las zonas de superficie que delimitan. Cada lazo
 * separa dos zonas; las zonas unidas por lazos forman un grafo que se colorea
 * en dos clases (pieza extraída / resto). Con un solo lazo es lo de siempre:
 * dos zonas, una de cada lado.
 */
export interface LoopAnalysis {
  embed: EmbedResult;
  topo: MeshTopology;
  /** Zona de cada cara (componente de superficie entre perímetros). */
  region: Int32Array;
  regionCount: number;
  /** Por lazo: zona del lado de la semiarista L0→L1 y zona del lado opuesto. */
  sides: Array<[number, number]>;
  /** Primer lazo que tiene la misma zona de los dos lados (no separa), o -1. */
  failedLoop: number;
  /** Clase (0/1) de cada zona que toca algún lazo; -1 si no toca ninguno. */
  color: Int8Array;
  /** Grupo conexo (zonas unidas por lazos) de cada zona; -1 si no toca ninguno. */
  part: Int32Array;
  partCount: number;
  /** false si los lazos no permiten repartir las zonas en dos piezas. */
  bipartite: boolean;
}

/** Incrusta los lazos y reparte la superficie en zonas. */
export function analyzeLoops(ctx: MeshContext, paths: PathPoint[][]): LoopAnalysis {
  const embed = embedPaths(ctx, paths);
  const mesh = embed.mesh;
  const nV = mesh.positions.length / 3;
  const topo = MeshTopology.build(mesh.indices, nV);
  const barrier = new Uint8Array(topo.nE);
  const label = (k: number) => (paths.length > 1 ? `El perímetro ${k + 1}` : 'El perímetro');
  embed.loops.forEach((loop, k) => {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const e = topo.edgeBetween(a, b);
      if (e < 0) throw new GeometryError(`${label(k)} no quedó formado por aristas de la malla.`, 'split-loop-edge', `${a}-${b}`);
      barrier[e] = 1;
    }
  });
  // Zonas: componentes de caras sin cruzar ningún lazo.
  const region = new Int32Array(topo.nF).fill(-1);
  let regionCount = 0;
  const stack: number[] = [];
  for (let f0 = 0; f0 < topo.nF; f0++) {
    if (region[f0] >= 0) continue;
    const r = regionCount++;
    region[f0] = r;
    stack.push(f0);
    while (stack.length) {
      const f = stack.pop()!;
      for (let k = 0; k < 3; k++) {
        const h = 3 * f + k;
        if (barrier[topo.heEdge[h]]) continue;
        const t = topo.twin[h];
        if (t < 0) continue;
        const g = (t / 3) | 0;
        if (region[g] < 0) {
          region[g] = r;
          stack.push(g);
        }
      }
    }
  }
  const sides: Array<[number, number]> = [];
  let failedLoop = -1;
  embed.loops.forEach((loop, k) => {
    const h0 = topo.halfedgeFromTo(loop[0], loop[1]);
    const h1 = topo.halfedgeFromTo(loop[1], loop[0]);
    if (h0 < 0 || h1 < 0) throw new GeometryError(`${label(k)} pasa por un borde abierto de la malla.`, 'split-open');
    const a = region[(h0 / 3) | 0];
    const b = region[(h1 / 3) | 0];
    sides.push([a, b]);
    if (a === b && failedLoop < 0) failedLoop = k;
  });
  // Coloreo en dos clases del grafo zonas–lazos.
  const color = new Int8Array(regionCount).fill(-1);
  const part = new Int32Array(regionCount).fill(-1);
  const adj: number[][] = Array.from({ length: regionCount }, () => []);
  for (const [a, b] of sides) {
    adj[a].push(b);
    adj[b].push(a);
  }
  let partCount = 0;
  let bipartite = failedLoop < 0;
  for (const [a0] of sides) {
    if (part[a0] >= 0) continue;
    const p = partCount++;
    part[a0] = p;
    color[a0] = 0;
    const queue = [a0];
    for (let qi = 0; qi < queue.length; qi++) {
      const r = queue[qi];
      for (const s of adj[r]) {
        if (part[s] < 0) {
          part[s] = p;
          color[s] = (1 - color[r]) as 0 | 1;
          queue.push(s);
        } else if (color[s] === color[r]) bipartite = false;
      }
    }
  }
  return { embed, topo, region, regionCount, sides, failedLoop, color, part, partCount, bipartite };
}

/** Verificación rápida de que los perímetros separen la pieza (sin construir las tapas). */
export function checkLoops(ctx: MeshContext, paths: PathPoint[][]): { separates: boolean; message?: string } {
  const an = analyzeLoops(ctx, paths);
  if (an.failedLoop >= 0) {
    return {
      separates: false,
      message:
        paths.length > 1
          ? `El perímetro ${an.failedLoop + 1} no divide la pieza: rodea un agujero o un asa. Volvé a pedir la sugerencia o movelo alrededor de la parte que querés separar.`
          : 'El perímetro no divide la pieza en dos partes: rodea un agujero o un asa. Volvé a pedir la sugerencia o movelo alrededor de la parte que querés separar.',
    };
  }
  if (!an.bipartite) {
    return { separates: false, message: 'Los perímetros no delimitan una pieza consistente: alguno queda adentro de otro de manera ambigua. Volvé a pedir la sugerencia.' };
  }
  return { separates: true };
}

/** Compatibilidad: verificación de un solo perímetro. */
export function checkSeparation(ctx: MeshContext, path: PathPoint[]): { separates: boolean; message?: string } {
  return checkLoops(ctx, [path]);
}

/**
 * Qué zonas forman la pieza extraída. Cada lazo vota por uno de sus lados (el
 * de mayor fracción seleccionada; sin selección, el más chico) y en cada grupo
 * conexo gana la clase con más votos. `flip` invierte la elección.
 */
function chooseExtracted(an: LoopAnalysis, areas: Float64Array, faceOrigin: Int32Array, selection: Uint8Array | null | undefined, flip: boolean): Uint8Array {
  const R = an.regionCount;
  const area = new Float64Array(R);
  const sel = new Float64Array(R);
  for (let f = 0; f < an.region.length; f++) {
    const r = an.region[f];
    area[r] += areas[f];
    if (selection && selection[faceOrigin[f]]) sel[r] += areas[f];
  }
  const score = new Float64Array(an.partCount);
  for (const [a, b] of an.sides) {
    let prefA: boolean;
    if (selection && sel[a] + sel[b] > 0) prefA = sel[a] / Math.max(area[a], 1e-300) >= sel[b] / Math.max(area[b], 1e-300);
    else prefA = area[a] <= area[b];
    const pref = prefA ? a : b;
    score[an.part[pref]] += an.color[pref] === 0 ? 1 : -1;
  }
  const areaC = Array.from({ length: an.partCount }, () => [0, 0]);
  for (let r = 0; r < R; r++) if (an.part[r] >= 0) areaC[an.part[r]][an.color[r]] += area[r];
  const extractedColor = new Int8Array(an.partCount);
  for (let p = 0; p < an.partCount; p++) {
    let c = score[p] > 0 ? 0 : score[p] < 0 ? 1 : areaC[p][0] <= areaC[p][1] ? 0 : 1;
    if (flip) c = 1 - c;
    extractedColor[p] = c;
  }
  const out = new Uint8Array(R);
  for (let r = 0; r < R; r++) if (an.part[r] >= 0 && an.color[r] === extractedColor[an.part[r]]) out[r] = 1;
  return out;
}

/** Separa la pieza por un perímetro (ver `splitByPerimeters`). */
export async function splitByPerimeter(ctx: MeshContext, path: PathPoint[], params: SplitParams, task: TaskContext = NULL_CONTEXT): Promise<SplitResult> {
  return splitByPerimeters(ctx, [path], params, task);
}

/**
 * Separa la pieza por uno o más perímetros: los incrusta, reparte la
 * superficie en zonas, construye una superficie de corte por perímetro y
 * cierra ambos sólidos con las mismas superficies (orientadas en sentidos
 * opuestos), de modo que las piezas encastran exactamente.
 *
 * Con varios perímetros (por ejemplo, dos dientes elegidos con Ctrl+clic) las
 * zonas extraídas forman una sola pieza con varias partes: se imprimen juntas,
 * del mismo color.
 */
export async function splitByPerimeters(ctx: MeshContext, paths: PathPoint[][], params: SplitParams, task: TaskContext = NULL_CONTEXT): Promise<SplitResult> {
  await task.checkpoint('Incrustando el perímetro en la malla', 0.1);
  const multi = paths.length > 1;
  const an = analyzeLoops(ctx, paths);
  if (an.failedLoop >= 0) {
    throw new GeometryError(
      multi
        ? `El perímetro ${an.failedLoop + 1} no separa la superficie en dos partes (rodea un agujero o un asa del modelo).`
        : 'El perímetro no separa la superficie en dos partes (rodea un agujero o un asa del modelo).',
      'split-not-separating',
    );
  }
  if (!an.bipartite) {
    throw new GeometryError('Los perímetros no delimitan una pieza consistente: alguno queda adentro de otro de manera ambigua.', 'split-not-bipartite');
  }
  const { embed, topo, region } = an;
  const mesh = embed.mesh;
  const nF = mesh.indices.length / 3;

  const { areas } = computeFaceNormals(mesh);
  const extractedRegion = chooseExtracted(an, areas, embed.faceOrigin, params.selection, !!params.flip);
  const inX = (f: number) => extractedRegion[region[f]] === 1;
  let nRegionsX = 0;
  for (let r = 0; r < an.regionCount; r++) if (extractedRegion[r]) nRegionsX++;

  // Una superficie de corte por lazo.
  const caps: CapSurface[] = [];
  const capFlippedForX: boolean[] = [];
  const loopsPos: Float64Array[] = [];
  const intersections: number[] = [];
  for (let k = 0; k < embed.loops.length; k++) {
    await task.checkpoint('Construyendo la superficie de corte', 0.15 + (0.4 * k) / embed.loops.length);
    const loop = embed.loops[k];
    const loopPositions = new Float64Array(loop.length * 3);
    for (let i = 0; i < loop.length; i++) {
      loopPositions[3 * i] = mesh.positions[3 * loop[i]];
      loopPositions[3 * i + 1] = mesh.positions[3 * loop[i] + 1];
      loopPositions[3 * i + 2] = mesh.positions[3 * loop[i] + 2];
    }
    // Orientación: la tapa generada contiene las semiaristas L_i→L_{i+1}.
    const hf = topo.halfedgeFromTo(loop[0], loop[1]);
    const forwardOnX = inX((hf / 3) | 0);
    // La pieza que contiene L_i→L_{i+1} necesita la tapa invertida; su normal
    // exterior en la tapa es entonces -n, así que el material extraído queda del lado +n.
    const flipped = forwardOnX;
    const xRegion = forwardOnX ? an.sides[k][0] : an.sides[k][1];
    const extractedFaces = new Uint8Array(nF);
    for (let f = 0; f < nF; f++) if (region[f] === xRegion) extractedFaces[f] = 1;
    const clearance = generateCapWithClearance(
      { mesh, loop, loopPositions, extractedFaces, extractedOnPositiveSide: flipped },
      {
        method: params.method,
        bulge: params.bulge,
        forbidDiagonal: (i, j) => topo.edgeBetween(loop[i], loop[j]) >= 0,
      },
    );
    caps.push(clearance.cap);
    capFlippedForX.push(flipped);
    loopsPos.push(loopPositions);
    intersections.push(clearance.intersections);
  }

  await task.checkpoint('Cerrando las piezas', 0.58);
  const depth = Math.max(0, params.depth ?? 0);
  // Normal de cada unión desde el cuerpo hacia la pieza extraída: si la tapa de X
  // está invertida, su normal exterior es -n → hacia el cuerpo es -n → hacia X es +n.
  const towards: Vec3[] = caps.map((cap, k) => {
    const n = cap.plane.normal;
    const sign = capFlippedForX[k] ? 1 : -1;
    return [sign * n[0], sign * n[1], sign * n[2]];
  });
  // Con profundidad, la tapa se traslada hacia adentro del cuerpo y una pared
  // recta une el perímetro con su copia trasladada.
  const shifts: Vec3[] = towards.map((t) => [-t[0] * depth, -t[1] * depth, -t[2] * depth]);
  const nV = mesh.positions.length / 3;
  let extraTotal = 0;
  for (const cap of caps) extraTotal += cap.positions.length / 3 - cap.boundaryCount + (depth > 0 ? cap.boundaryCount : 0);
  const allPos = new Float64Array((nV + extraTotal) * 3);
  allPos.set(mesh.positions);
  const capBase: number[] = []; // interiores de la tapa (trasladados si hay profundidad)
  const wallBase: number[] = []; // copia trasladada del perímetro (solo con profundidad)
  let next = nV;
  caps.forEach((cap, k) => {
    const sh = shifts[k];
    const nInterior = cap.positions.length / 3 - cap.boundaryCount;
    capBase.push(next);
    for (let i = 0; i < nInterior; i++) {
      const src = (cap.boundaryCount + i) * 3;
      allPos[3 * (next + i)] = cap.positions[src] + sh[0];
      allPos[3 * (next + i) + 1] = cap.positions[src + 1] + sh[1];
      allPos[3 * (next + i) + 2] = cap.positions[src + 2] + sh[2];
    }
    next += nInterior;
    wallBase.push(next);
    if (depth > 0) {
      const loop = embed.loops[k];
      for (let i = 0; i < loop.length; i++) {
        allPos[3 * (next + i)] = mesh.positions[3 * loop[i]] + sh[0];
        allPos[3 * (next + i) + 1] = mesh.positions[3 * loop[i] + 1] + sh[1];
        allPos[3 * (next + i) + 2] = mesh.positions[3 * loop[i] + 2] + sh[2];
      }
      next += loop.length;
    }
  });
  let nCapTotal = 0;
  for (const cap of caps) nCapTotal += cap.triangles.length / 3 + (depth > 0 ? 2 * cap.boundaryCount : 0);

  const prevCap = params.previousCapMask ?? null;
  const buildPiece = (extracted: boolean) => {
    const idx: number[] = [];
    const capMask: number[] = [];
    for (let f = 0; f < nF; f++) {
      if (inX(f) !== extracted) continue;
      idx.push(mesh.indices[3 * f], mesh.indices[3 * f + 1], mesh.indices[3 * f + 2]);
      capMask.push(prevCap && prevCap[embed.faceOrigin[f]] ? 1 : 0);
    }
    caps.forEach((cap, k) => {
      const loop = embed.loops[k];
      const base = capBase[k];
      // Sin profundidad el fondo es la tapa misma, apoyada en el perímetro; con
      // profundidad, el fondo apoya en la copia trasladada del perímetro.
      const rim = (i: number) => (depth > 0 ? wallBase[k] + i : loop[i]);
      const vid = (local: number) => (local < cap.boundaryCount ? rim(local) : base + (local - cap.boundaryCount));
      const flip = extracted ? capFlippedForX[k] : !capFlippedForX[k];
      const tri = (a: number, b: number, c: number) => {
        if (flip) idx.push(a, c, b);
        else idx.push(a, b, c);
        capMask.push(1);
      };
      const T = cap.triangles;
      for (let t = 0; t < T.length / 3; t++) tri(vid(T[3 * t]), vid(T[3 * t + 1]), vid(T[3 * t + 2]));
      if (depth > 0) {
        // Pared: contiene las semiaristas L_i→L_{i+1}, como la tapa, así que se
        // invierte junto con ella y queda coherente con el fondo (que recorre la
        // copia del perímetro en el sentido opuesto al de la pared).
        const n = loop.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          tri(loop[i], loop[j], rim(j));
          tri(loop[i], rim(j), rim(i));
        }
      }
    });
    return compactWithMask(allPos, idx, capMask);
  };
  const X = buildPiece(true);
  const R = buildPiece(false);

  await task.checkpoint('Validando los sólidos', 0.7);
  const vX = validateSolid(X.mesh, { selfIntersections: 'subset', faceSubset: X.mask, expectedComponents: nRegionsX });
  await task.checkpoint('Validando los sólidos', 0.85);
  const vR = validateSolid(R.mesh, { selfIntersections: 'subset', faceSubset: R.mask, expectedComponents: an.regionCount - nRegionsX });

  const vOrig = signedVolume(ctx.mesh);
  const vx = signedVolume(X.mesh);
  const vr = signedVolume(R.mesh);
  const relErr = Math.abs(vx + vr - vOrig) / Math.max(Math.abs(vOrig), 1e-300);

  const problemCentroids = (m: IndexedMesh, rep: ValidationReport): number[] => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (const is of rep.issues) {
      if (is.severity !== 'error' || !is.faces) continue;
      for (const f of is.faces) {
        if (seen.has(f) || seen.size >= 300) continue;
        seen.add(f);
        const a = m.indices[3 * f], b = m.indices[3 * f + 1], c = m.indices[3 * f + 2];
        for (let k = 0; k < 3; k++) out.push((m.positions[3 * a + k] + m.positions[3 * b + k] + m.positions[3 * c + k]) / 3);
      }
    }
    return out;
  };
  const problems = { extracted: problemCentroids(X.mesh, vX), remainder: problemCentroids(R.mesh, vR) };
  const issues: SplitResult['issues'] = [];
  const which = (ks: number[]) => (ks.length === 1 ? `del perímetro ${ks[0] + 1}` : `de los perímetros ${ks.slice(0, -1).map((k) => k + 1).join(', ')} y ${ks[ks.length - 1] + 1}`);
  const crossing = intersections.map((n, k) => (n > 0 ? k : -1)).filter((k) => k >= 0);
  if (crossing.length) {
    issues.push({
      severity: 'error',
      code: 'cap-skin',
      message: `La superficie de corte${multi ? ` ${which(crossing)}` : ''} atraviesa la pieza cerca del perímetro (marcas rojas). Suele pasar cuando un tramo sube a un saliente: mové esos puntos hacia la base de la pieza.`,
    });
  }
  if (depth > 0 && (vX.selfIntersectionPairs > 0 || vR.selfIntersectionPairs > 0) && !crossing.length) {
    issues.push({
      severity: 'info',
      code: 'depth-crossing',
      message: `Con ${depth.toLocaleString('es-AR', { maximumFractionDigits: 2 })} mm de profundidad el hueco se cruza con la superficie (marcas rojas): probá con menos profundidad, o con más si la pieza tiene relieve hacia adentro.`,
    });
  }
  // Defectos que ya traía el modelo (por ejemplo, superficies que se tocan en
  // un punto) no son culpa del corte: se informan como heredados.
  const originalPinches = ctx.topo.nonManifoldVertexCount();
  const countOf = (code: string) => vX.issues.concat(vR.issues).reduce((acc, i) => acc + (i.code === code ? i.count ?? 0 : 0), 0);
  const pinchesAfter = countOf('non-manifold-vertices');
  // Aristas compartidas por más de dos caras que ya traía el modelo (por ejemplo,
  // dos cuerpos pegados por una arista): el corte no las crea ni las toca. La
  // pieza se puede exportar igual, aunque el encastre automático no va a poder
  // calcularse sobre esa pieza.
  const inheritedNonManifold = ctx.topo.nonManifoldEdgeCount > 0 && countOf('non-manifold-edges') <= ctx.topo.nonManifoldEdgeCount;
  for (const [name, rep] of [['La pieza extraída', vX], ['El cuerpo', vR]] as const) {
    for (const is of rep.issues) {
      if (is.code === 'unexpected-components' && name === 'El cuerpo') continue;
      if (is.code === 'non-manifold-edges' && inheritedNonManifold) {
        const n = is.count ?? 0;
        issues.push({
          severity: 'warning',
          code: 'inherited-non-manifold',
          message: `${name} conserva ${n} arista${n === 1 ? '' : 's'} compartida${n === 1 ? '' : 's'} por más de dos caras que ya traía el modelo (el corte no las toca). Se puede exportar, pero no se va a poder calcular un encastre automático en esa pieza; conviene reparar el modelo en el laminador o en Meshmixer.`,
        });
        continue;
      }
      if (is.code === 'non-manifold-vertices') {
        const n = is.count ?? 0;
        const what = n === 1 ? 'un vértice donde dos superficies se tocan' : `${n} vértices donde dos superficies se tocan`;
        issues.push(
          pinchesAfter <= originalPinches
            ? { severity: 'info', code: 'inherited-pinches', message: `${name} conserva ${what} en un solo punto: ${n === 1 ? 'ya estaba' : 'ya estaban'} en el modelo original y no impide${n === 1 ? '' : 'n'} imprimir.` }
            : { severity: 'warning', code: 'new-pinches', message: `${name}: el corte dejó ${what} en un solo punto. No impide imprimir, pero conviene revisar el perímetro.` },
        );
        continue;
      }
      issues.push({ severity: is.severity === 'error' ? 'error' : is.severity === 'info' ? 'info' : 'warning', message: `${name}: ${is.message}` });
    }
  }
  if (vx <= 0 || vr <= 0) issues.push({ severity: 'error', message: 'Una de las piezas quedó con volumen nulo o negativo.' });
  if (relErr > 1e-6) {
    issues.push({ severity: 'error', message: `La suma de volúmenes no coincide con el original (error relativo ${relErr.toExponential(1)}).` });
  }
  caps.forEach((cap, k) => {
    const who = multi ? `Perímetro ${k + 1}: ` : '';
    if (cap.method === 'planar' && cap.planarity.relative > 0.08) {
      issues.push({
        severity: 'warning',
        code: 'not-planar',
        message: `${who}el perímetro no es plano (desvío máximo ${cap.planarity.maxDeviation.toFixed(2)} mm): la tapa sigue el contorno. Considerá el cierre curvo o ajustar el perímetro al plano.`.replace(/^el/, 'El'),
      });
    }
    if (cap.tiltDeg > 0 && cap.method === 'planar') {
      issues.push({
        severity: 'info',
        message: `${who}visto desde su normal media el perímetro se superpone consigo mismo; la superficie de corte se inclinó ${cap.tiltDeg}° respecto del plano medio para poder cerrarlo.`.replace(/^visto/, 'Visto'),
      });
    }
    if (cap.obstacle.moved > 0 && intersections[k] === 0) {
      issues.push({
        severity: 'info',
        message: `${who}la superficie de corte se separó de la piel en ${cap.obstacle.moved} puntos para no atravesarla (el perímetro pasa cerca del fondo de un valle).`.replace(/^la/, 'La'),
      });
    }
    if (cap.quality.minAngleDeg < 1) {
      issues.push({ severity: 'info', message: `${who}la superficie de corte tiene triángulos finos (ángulo mínimo ${cap.quality.minAngleDeg.toFixed(1)}°).`.replace(/^la/, 'La') });
    }
  });
  if (nRegionsX > 1) {
    issues.push({
      severity: 'info',
      code: 'multi-part',
      message: `La pieza extraída tiene ${nRegionsX} partes separadas: se exportan juntas, en un mismo archivo y del mismo color.`,
    });
  }

  // Uniones (seams) para encastres: normal desde el cuerpo hacia la pieza
  // extraída; con profundidad, la unión está en el fondo del hueco.
  const seams = caps.map((cap, k) => buildSeam(cap, towards[k], depth));

  await task.checkpoint('Listo', 1);
  const valid = vX.valid && vR.valid && vx > 0 && vr > 0 && relErr <= 1e-6;
  // Solo cruces de triángulos (tapa contra piel): todo lo demás está bien. Los
  // vértices donde dos superficies se tocan (heredados del modelo) no cuentan:
  // son informativos y no abren la pieza.
  const onlyCrossings = (rep: ValidationReport) =>
    rep.closed &&
    rep.consistentOrientation &&
    rep.issues.every((i) => i.severity !== 'error' || i.code === 'self-intersections' || (i.code === 'non-manifold-edges' && inheritedNonManifold));
  const crossingPairs = vX.selfIntersectionPairs + vR.selfIntersectionPairs;
  const forceable = !valid && onlyCrossings(vX) && onlyCrossings(vR) && vx > 0 && vr > 0 && relErr <= 1e-6;
  let loopVertices = 0;
  for (const l of embed.loops) loopVertices += l.length;
  return {
    extracted: X.mesh,
    remainder: R.mesh,
    extractedCapMask: X.mask,
    remainderCapMask: R.mask,
    cap: caps[0],
    seam: seams[0],
    loopPositions: loopsPos[0],
    caps,
    seams,
    loops: loopsPos,
    extractedComponents: nRegionsX,
    validation: { extracted: vX, remainder: vR },
    volumes: { original: vOrig, extracted: vx, remainder: vr, relativeError: relErr },
    issues,
    problems,
    valid,
    forceable,
    crossingPairs,
    stats: {
      touchedFaces: embed.touchedFaces,
      loopVertices,
      capTriangles: nCapTotal,
      capMinAngle: Math.min(...caps.map((c) => c.quality.minAngleDeg)),
    },
  };
}

function compactWithMask(positions: Float64Array, idx: number[], mask: number[]): { mesh: IndexedMesh; mask: Uint8Array } {
  const nV = positions.length / 3;
  const remap = new Int32Array(nV).fill(-1);
  let count = 0;
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (remap[v] < 0) remap[v] = count++;
    out[i] = remap[v];
  }
  const pos = new Float64Array(count * 3);
  for (let v = 0; v < nV; v++) {
    const r = remap[v];
    if (r >= 0) {
      pos[3 * r] = positions[3 * v];
      pos[3 * r + 1] = positions[3 * v + 1];
      pos[3 * r + 2] = positions[3 * v + 2];
    }
  }
  return { mesh: { positions: pos, indices: out }, mask: Uint8Array.from(mask) };
}

/** Datos de la unión en el plano del corte (para ubicar encastres). */
export function buildSeam(cap: CapSurface, toward: Vec3, depth = 0): SeamInfo {
  const { plane } = cap;
  // Orientar la base para que normal = toward
  const flip = plane.normal[0] * toward[0] + plane.normal[1] * toward[1] + plane.normal[2] * toward[2] < 0;
  const u = plane.u;
  const v: Vec3 = flip ? [-plane.v[0], -plane.v[1], -plane.v[2]] : plane.v;
  const ox = cap.outline2D.x;
  const oy = cap.outline2D.y.map((y) => (flip ? -y : y));
  // Centroide del área del contorno proyectado
  let A = 0, cx = 0, cy = 0;
  const n = ox.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cr = ox[i] * oy[j] - ox[j] * oy[i];
    A += cr;
    cx += (ox[i] + ox[j]) * cr;
    cy += (oy[i] + oy[j]) * cr;
  }
  A /= 2;
  if (Math.abs(A) > 1e-300) {
    cx /= 6 * A;
    cy /= 6 * A;
  }
  // Círculo inscripto aproximado: muestreo de puntos interiores de la tapa
  let best = 0;
  let bestC: [number, number] = [cx, cy];
  const P = cap.positions;
  const o = plane.origin;
  for (let i = cap.boundaryCount; i < P.length / 3; i++) {
    const dx = P[3 * i] - o[0], dy = P[3 * i + 1] - o[1], dz = P[3 * i + 2] - o[2];
    const x = dx * u[0] + dy * u[1] + dz * u[2];
    const y = dx * v[0] + dy * v[1] + dz * v[2];
    const d = distanceToPolyline(x, y, ox, oy);
    if (d > best) {
      best = d;
      bestC = [x, y];
    }
  }
  const dcent = distanceToPolyline(cx, cy, ox, oy);
  // Preferir el centroide si es casi tan bueno (encastre centrado)
  if (dcent >= 0.85 * best) {
    best = dcent;
    bestC = [cx, cy];
  }
  return {
    center: [o[0] - toward[0] * depth, o[1] - toward[1] * depth, o[2] - toward[2] * depth],
    normal: toward,
    u,
    v,
    outlineX: Array.from(ox),
    outlineY: Array.from(oy),
    inradius: best,
    incenter: bestC,
    planar: cap.planarity.relative <= 0.08,
    maxDeviation: cap.planarity.maxDeviation,
    area: cap.area,
    depth,
  };
}
