import type { MeshContext } from '../core/MeshContext';
import { MinHeap } from '../core/heap';
import { computeCurvature } from '../analysis/curvature';
import { MaxFlow } from './maxflow';

export type SuggestionKind = 'ajustado' | 'suave' | 'amplio' | 'seleccion';

/** Un lazo de una sugerencia (hay uno por parte seleccionada). */
export interface SuggestionLoop {
  /** Lazo cerrado de vértices de la malla. */
  loop: number[];
  /** Vértices del lazo usados como puntos de control. */
  controlVertices: number[];
  /** Tramos fijos entre puntos de control (vértices intermedios). */
  locked: Record<number, number[]>;
  length: number;
  /** Concavidad media a lo largo del lazo (0..1). */
  meanValley: number;
}

export interface PerimeterSuggestion {
  id: string;
  kind: SuggestionKind;
  label: string;
  description: string;
  /** Todos los lazos (uno por parte seleccionada, salvo que dos queden dentro del mismo). */
  loops: SuggestionLoop[];
  /** Primer lazo (compatibilidad con un solo perímetro). */
  loop: number[];
  controlVertices: number[];
  locked: Record<number, number[]>;
  /** Concavidad media a lo largo de todos los lazos (0..1). */
  meanValley: number;
  /** Longitud total. */
  length: number;
  confidence: number;
}

export interface SuggestionResult {
  suggestions: PerimeterSuggestion[];
  /** Mensaje cuando no hay un límite natural confiable. */
  message?: string;
  reliable: boolean;
  /** Borde de la selección como alternativa explícita (no es una sugerencia geométrica). */
  selectionBoundary?: PerimeterSuggestion;
}

const BIG = 1e18;
/** Partes separadas que se pueden cortar juntas. */
export const MAX_REGIONS = 16;

interface Region {
  faces: number[];
  area: number;
  Wb: number;
  Wout: number;
}

/**
 * BoundarySuggestionEngine: propone perímetros cerrados alrededor de la
 * selección a partir de la geometría real. Cada propuesta es el corte mínimo
 * en el grafo dual dentro de una banda alrededor de la selección, con costos
 * que favorecen valles de concavidad, cuellos (lazos cortos) y transiciones
 * de curvatura.
 *
 * La selección puede tener varias partes separadas (por ejemplo, dos dientes
 * elegidos con Ctrl+clic): se resuelve un único corte mínimo para todas, que
 * devuelve un lazo alrededor de cada una. Los lazos nunca se cruzan.
 */
export function suggestPerimeters(ctx: MeshContext, selection: Uint8Array): SuggestionResult {
  const { topo, faceAreas, P, I } = ctx;
  const nF = topo.nF;
  const nV = topo.nV;
  const curv = computeCurvature(ctx);

  // 1) Partes seleccionadas (sin motas sueltas) con sus agujeros rellenos.
  let parts = selectedComponents(ctx, selection);
  if (!parts.length) return { suggestions: [], reliable: false, message: 'Seleccioná primero la pieza que querés separar.' };
  const largest = parts[0].area;
  parts = parts.filter((p) => p.area >= 0.01 * largest);
  if (parts.length > MAX_REGIONS) {
    return { suggestions: [], reliable: false, message: `Elegiste ${parts.length} partes separadas; en un mismo corte entran hasta ${MAX_REGIONS}. Hacé el resto en otro corte.` };
  }
  const inR = new Uint8Array(nF);
  const activeComp = new Uint8Array(ctx.componentCount);
  for (const p of parts) for (const f of p.faces) {
    inR[f] = 1;
    activeComp[ctx.faceComponent[f]] = 1;
  }
  fillHoles(ctx, inR, activeComp);
  const compArea = new Float64Array(ctx.componentCount);
  const compSel = new Float64Array(ctx.componentCount);
  for (let f = 0; f < nF; f++) {
    const c = ctx.faceComponent[f];
    if (!activeComp[c]) continue;
    compArea[c] += faceAreas[f];
    if (inR[f]) compSel[c] += faceAreas[f];
  }
  for (let c = 0; c < ctx.componentCount; c++) {
    if (activeComp[c] && compSel[c] >= compArea[c] * 0.999) {
      return { suggestions: [], reliable: false, message: 'La selección cubre toda una pieza. Si ya es un componente independiente, podés extraerla sin cortar.' };
    }
  }
  // Borde de la selección. Si ya sigue un valle (la varita lo deja justo en la
  // cresta de concavidad: valle medio ≈ 0,9), el usuario marcó dónde termina la
  // pieza y la sugerencia solo lo afina en una banda angosta; si es un trazo
  // aproximado (pincel: valle medio ≈ 0–0,6), busca el valle más lejos. Sin
  // esto, en una pieza grande el corte mínimo se iba a cualquier cuello o
  // surco más corto dentro de la selección (el tobillo de una bota en vez de
  // la caña, donde la bota termina).
  const selLoops = extractLoops(ctx, inR);
  if (selLoops && selLoops.length === 0) {
    // Superficie cerrada unida al resto solo por aristas no-manifold o vértices
    // (por ejemplo, un cuerpo pegado por una arista): no hay borde que cortar.
    return {
      suggestions: [],
      reliable: false,
      message:
        'La selección no tiene borde: es una superficie cerrada, pegada al resto solo por aristas o vértices defectuosos. Ahí no hay nada que cortar: si es una parte independiente, extraela sin cortar; si no, sumá con el pincel la zona vecina del cuerpo.',
    };
  }
  const prior = selLoops ? loopsValley(ctx, selLoops, curv.valley) : 0;
  const tight = Math.max(0, Math.min(1, (prior - 0.5) / 0.3));
  const fIn = 0.6 - 0.45 * tight;
  const fOut = 0.85 - 0.6 * tight;

  // Zonas definitivas (después de rellenar) y su tamaño.
  const regionOf = new Int32Array(nF).fill(-1);
  const regions: Region[] = [];
  for (const comp of selectedComponents(ctx, inR)) {
    const r = regions.length;
    for (const f of comp.faces) regionOf[f] = r;
    const rR = Math.sqrt(comp.area / Math.PI);
    regions.push({ faces: comp.faces, area: comp.area, Wb: Math.max(4 * ctx.avgEdge, fIn * rR), Wout: Math.max(5 * ctx.avgEdge, fOut * rR) });
  }
  const rRef = Math.max(...regions.map((r) => Math.sqrt(r.area / Math.PI)));

  // 2) Distancia geodésica con signo al borde de la selección, con la zona más cercana.
  const vIn = new Uint8Array(nV);
  const vOut = new Uint8Array(nV);
  const vZone = new Int32Array(nV).fill(-1);
  for (let f = 0; f < nF; f++) {
    if (!activeComp[ctx.faceComponent[f]]) continue;
    for (let k = 0; k < 3; k++) {
      const v = I[3 * f + k];
      if (inR[f]) {
        vIn[v] = 1;
        vZone[v] = regionOf[f];
      } else vOut[v] = 1;
    }
  }
  const dist = new Float64Array(nV).fill(Infinity);
  const zone = new Int32Array(nV).fill(-1);
  const heap = new MinHeap(1024);
  for (let v = 0; v < nV; v++) {
    if (vIn[v] && vOut[v]) {
      dist[v] = 0;
      zone[v] = vZone[v];
      heap.push(0, v);
    }
  }
  const limitOf = regions.map((r) => Math.max(r.Wb, r.Wout) * 1.2);
  while (heap.size) {
    const v = heap.pop();
    const dv = heap.lastKey;
    if (dv > dist[v] || dv > limitOf[zone[v]]) continue;
    for (let i = topo.vOutStart[v]; i < topo.vOutStart[v + 1]; i++) {
      const w = topo.dest(topo.vOut[i]);
      const nd = dv + Math.hypot(P[3 * w] - P[3 * v], P[3 * w + 1] - P[3 * v + 1], P[3 * w + 2] - P[3 * v + 2]);
      if (nd < dist[w]) {
        dist[w] = nd;
        zone[w] = zone[v];
        heap.push(nd, w);
      }
    }
  }
  const sd = (v: number) => (vIn[v] && !vOut[v] ? -dist[v] : dist[v]);

  // 3) Banda, fuentes (núcleo de cada parte) y sumidero (exterior).
  const role = new Int8Array(nF).fill(-2); // -2 ajeno, -1 fuente, 0 banda, 1 sumidero
  const deepest = new Int32Array(regions.length).fill(-1);
  const deepestVal = new Float64Array(regions.length).fill(Infinity);
  const hasSource = new Uint8Array(regions.length);
  for (let f = 0; f < nF; f++) {
    if (!activeComp[ctx.faceComponent[f]]) continue;
    let mn = Infinity, mx = -Infinity, z = -1, zd = Infinity;
    for (let k = 0; k < 3; k++) {
      const v = I[3 * f + k];
      const s = sd(v);
      mn = Math.min(mn, s);
      mx = Math.max(mx, s);
      if (zone[v] >= 0 && Math.abs(s) < zd) {
        zd = Math.abs(s);
        z = zone[v];
      }
    }
    const Wb = z >= 0 ? regions[z].Wb : 0;
    const Wout = z >= 0 ? regions[z].Wout : 0;
    if (inR[f] && mx < -Wb) role[f] = -1;
    else if (!inR[f] && mn > Wout) role[f] = 1;
    else if (!Number.isFinite(mn) || !Number.isFinite(mx)) role[f] = inR[f] ? -1 : 1;
    else role[f] = 0;
    if (inR[f]) {
      const r = regionOf[f];
      if (role[f] === -1) hasSource[r] = 1;
      if (mx < deepestVal[r]) {
        deepestVal[r] = mx;
        deepest[r] = f;
      }
    }
  }
  regions.forEach((_, r) => {
    if (!hasSource[r] && deepest[r] >= 0) role[deepest[r]] = -1;
  });
  // Cada parte del exterior (incluidos los agujeros grandes de un anillo)
  // necesita al menos un sumidero: si ninguna cara quedó lo bastante lejos, la más lejana.
  {
    const outer = new Uint8Array(nF);
    for (let f = 0; f < nF; f++) if (!inR[f] && activeComp[ctx.faceComponent[f]]) outer[f] = 1;
    const faceMin = (f: number) => Math.min(sd(I[3 * f]), sd(I[3 * f + 1]), sd(I[3 * f + 2]));
    for (const comp of selectedComponents(ctx, outer)) {
      if (comp.faces.some((f) => role[f] === 1)) continue;
      let best = -1, bestD = -Infinity;
      for (const f of comp.faces) {
        const d = faceMin(f);
        if (d > bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best >= 0) role[best] = 1;
    }
  }
  if (!role.some((r) => r === 1)) {
    return { suggestions: [], reliable: false, message: 'La selección es demasiado grande respecto de la pieza para sugerir un borde.' };
  }

  const valleyEdge = (a: number, b: number) => (curv.valley[a] + curv.valley[b]) / 2;
  const kAbs = (a: number, b: number) => Math.abs(curv.kmin[a] + curv.kmin[b]) / 2 / curv.reference;
  const adj = ctx.faceAdj;

  const runCut = (allowed: (f: number) => boolean, isSource: (f: number) => boolean, isSink: (f: number) => boolean, costFactor: (a: number, b: number) => number) => {
    const local = new Int32Array(nF).fill(-1);
    let n = 2;
    for (let f = 0; f < nF; f++) if (allowed(f)) local[f] = n++;
    const S = 0, T = 1;
    const mf = new MaxFlow(n);
    const link = (f: number, lf: number, g: number, c: number) => {
      if (local[g] >= 0) {
        if (g > f) mf.addEdge(lf, local[g], c, c);
      } else if (isSource(g)) {
        mf.addEdge(S, lf, BIG, 0);
      } else if (isSink(g)) {
        mf.addEdge(lf, T, BIG, 0);
      }
    };
    for (let f = 0; f < nF; f++) {
      const lf = local[f];
      if (lf < 0) continue;
      for (let k = 0; k < 3; k++) {
        const h = 3 * f + k;
        const g = adj[h];
        if (g < 0 && topo.twin[h] !== -2) continue;
        const a = I[h];
        const b = I[k === 2 ? h - 2 : h + 1];
        const len = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
        const c = len * costFactor(a, b);
        if (g >= 0) link(f, lf, g, c);
        else {
          // Arista no-manifold: la superficie sigue por la cara que la continúa de forma mutua
          // (no por una aleta ni por otro cuerpo que cuelgue de la arista), y cortar ahí cuesta
          // lo mismo que en cualquier otra arista.
          const g2 = ctx.mutualAcross(h);
          if (g2 >= 0) link(f, lf, g2, c);
        }
      }
      if (isSource(f)) mf.addEdge(S, lf, BIG, 0);
      if (isSink(f)) mf.addEdge(lf, T, BIG, 0);
    }
    const flow = mf.solve(S, T);
    if (flow >= BIG / 2) return null;
    const side = mf.sourceSide(S);
    // Lado S en caras: núcleo + caras de la banda alcanzadas
    const sFaces = new Uint8Array(nF);
    for (let f = 0; f < nF; f++) {
      if (local[f] >= 0 ? side[local[f]] : isSource(f)) sFaces[f] = 1;
    }
    return { sFaces, cost: flow };
  };

  const suggestions: PerimeterSuggestion[] = [];
  const multi = regions.length > 1;
  const selSug = selLoops?.length ? makeSuggestion(ctx, selLoops, 'seleccion', curv.valley, multi) : undefined;
  // Sin borde de la selección utilizable no queda de dónde partir: hay que retocar la selección.
  const fallback = selSug
    ? ''
    : ctx.topo.inconsistentEdgeCount > 0
      ? ` La malla tiene ${ctx.topo.inconsistentEdgeCount} aristas con normales invertidas y el borde no cierra: repará las normales (en el slicer o en Meshmixer) y volvé a cargar el modelo.`
      : ' Ampliá o achicá un poco la selección con los pinceles y volvé a pedir la sugerencia.';
  const eps = 0.04;
  const suave = runCut(
    (f) => role[f] === 0,
    (f) => role[f] === -1,
    (f) => role[f] === 1,
    (a, b) => eps + (1 - valleyEdge(a, b)) ** 2,
  );
  if (!suave) return { suggestions: [], reliable: false, message: `No encontramos un límite natural alrededor de la selección.${fallback}`, selectionBoundary: selSug };
  const loopsSuave = extractLoops(ctx, suave.sFaces);
  if (!loopsSuave?.length) {
    return { suggestions: [], reliable: false, message: `No encontramos un límite natural confiable.${fallback}`, selectionBoundary: selSug };
  }
  const main = makeSuggestion(ctx, loopsSuave, 'suave', curv.valley, multi);
  // Confiabilidad: hace falta un valle real a lo largo del lazo.
  const reliable = main.meanValley >= 0.12;
  main.confidence = Math.max(0, Math.min(1, (main.meanValley - 0.08) / 0.4));
  if (!reliable) {
    return {
      suggestions: [],
      reliable: false,
      message: `No detectamos un valle o cuello claro alrededor de la selección.${fallback}`,
      selectionBoundary: selSug,
    };
  }
  suggestions.push(main);

  // Transiciones de curvatura dentro y fuera del valle.
  const inner = runCut(
    (f) => role[f] === 0 && suave.sFaces[f] === 1,
    (f) => role[f] === -1,
    (f) => role[f] === 0 && suave.sFaces[f] === 0,
    (a, b) => 0.3 + kAbs(a, b) + 0.3 * valleyEdge(a, b),
  );
  const outer = runCut(
    (f) => role[f] === 0 && suave.sFaces[f] === 0,
    (f) => role[f] === -1 || (role[f] === 0 && suave.sFaces[f] === 1),
    (f) => role[f] === 1,
    (a, b) => 0.3 + kAbs(a, b) + 0.3 * valleyEdge(a, b),
  );
  const tol = Math.max(2.5 * ctx.avgEdge, 0.06 * rRef);
  for (const [res, kind] of [[inner, 'ajustado'], [outer, 'amplio']] as const) {
    if (!res) continue;
    const loops = extractLoops(ctx, res.sFaces);
    if (!loops?.length) continue;
    const sug = makeSuggestion(ctx, loops, kind, curv.valley, multi);
    sug.confidence = main.confidence;
    // Solo alternativas reales y razonables: distintas de las demás, pero no
    // lazos que se van lejos del valle (por ejemplo, rodeando otros detalles).
    const ratio = sug.length / main.length;
    const far = loopDistance(ctx, allVertices(main), allVertices(sug));
    const plausible = ratio > 0.45 && ratio < 1.7 && far < 0.75 * rRef;
    if (plausible && suggestions.every((s) => loopDistance(ctx, allVertices(s), allVertices(sug)) > tol)) suggestions.push(sug);
  }
  // Orden: ajustado, suave, amplio
  const order: Record<SuggestionKind, number> = { ajustado: 0, suave: 1, amplio: 2, seleccion: 3 };
  suggestions.sort((a, b) => order[a.kind] - order[b.kind]);
  return { suggestions, reliable: true, selectionBoundary: selSug };
}

/** Componentes conexas (por aristas) de las caras marcadas, de mayor a menor área. */
function selectedComponents(ctx: MeshContext, sel: Uint8Array): Array<{ faces: number[]; area: number }> {
  const nF = ctx.nF;
  const adj = ctx.faceAdj;
  const seen = new Uint8Array(nF);
  const out: Array<{ faces: number[]; area: number }> = [];
  for (let f = 0; f < nF; f++) {
    if (!sel[f] || seen[f]) continue;
    const faces: number[] = [];
    let area = 0;
    const stack = [f];
    seen[f] = 1;
    while (stack.length) {
      const x = stack.pop()!;
      faces.push(x);
      area += ctx.faceAreas[x];
      for (let k = 0; k < 3; k++) {
        const g = adj[3 * x + k];
        if (g >= 0 && sel[g] && !seen[g]) {
          seen[g] = 1;
          stack.push(g);
        }
      }
    }
    out.push({ faces, area });
  }
  return out.sort((a, b) => b.area - a.area);
}

/**
 * Rellena los agujeros chicos de la selección (motas sin seleccionar): en
 * cada componente, las partes del complemento que no son la mayor y que
 * miden menos de un cuarto de la selección. Un agujero grande (por ejemplo,
 * la cúpula dentro de un anillo seleccionado) se respeta: entonces la pieza
 * tiene un borde interior y otro exterior, y salen dos perímetros.
 *
 * Solo cuenta como agujero lo que está rodeado por la selección a través de
 * aristas normales. Una "isla" aislada por aristas no-manifold o abiertas
 * (una cara repetida, una aleta, el borde de una malla abierta) no es un
 * agujero aunque sea chica: puede estar en cualquier parte del modelo y
 * sumarla metería en la selección caras sin vecinos.
 */
function fillHoles(ctx: MeshContext, inR: Uint8Array, activeComp: Uint8Array): void {
  let selArea = 0;
  for (let f = 0; f < ctx.nF; f++) if (inR[f]) selArea += ctx.faceAreas[f];
  const nF = ctx.nF;
  const adj = ctx.faceAdj;
  const seen = new Uint8Array(nF);
  const parts = new Map<number, Array<{ faces: number[]; area: number; enclosed: boolean }>>();
  for (let f = 0; f < nF; f++) {
    const comp = ctx.faceComponent[f];
    if (inR[f] || seen[f] || !activeComp[comp]) continue;
    const faces: number[] = [];
    let area = 0;
    let enclosed = true;
    const stack = [f];
    seen[f] = 1;
    while (stack.length) {
      const x = stack.pop()!;
      faces.push(x);
      area += ctx.faceAreas[x];
      for (let k = 0; k < 3; k++) {
        const g = adj[3 * x + k];
        if (g < 0) enclosed = false;
        else if (!inR[g] && !seen[g]) {
          seen[g] = 1;
          stack.push(g);
        }
      }
    }
    let l = parts.get(comp);
    if (!l) parts.set(comp, (l = []));
    l.push({ faces, area, enclosed });
  }
  for (const l of parts.values()) {
    l.sort((a, b) => b.area - a.area);
    for (let i = 1; i < l.length; i++) {
      if (l[i].enclosed && l[i].area < 0.25 * selArea) for (const f of l[i].faces) inR[f] = 1;
    }
  }
}

const MAX_PINCH_ROUNDS = 30;

/**
 * Lazos de borde (vértices) del conjunto de caras marcado, uno por cada
 * borde cerrado. Si dos partes se tocan en un vértice (pellizco), se suman
 * las caras alrededor para que los lazos queden simples y separados.
 *
 * El borde se calcula como frontera de cadena: una semiarista marcada es de
 * borde cuando del otro lado no hay una cara marcada. En una arista abierta
 * no hay nada del otro lado; en una no-manifold se compensan las semiaristas
 * marcadas de un sentido con las del otro. Así una aleta o una cara repetida
 * cerca de la selección no impiden cerrar el lazo.
 *
 * Devuelve null si el borde no cierra (orientación incoherente) o si los
 * pellizcos no se resuelven.
 */
export function extractLoops(ctx: MeshContext, mark: Uint8Array): number[][] | null {
  const { topo } = ctx;
  const work = mark.slice();
  const nonManifold = topo.nonManifoldEdgeCount > 0 ? topo.nonManifoldHalfedges() : null;
  for (let iter = 0; iter < MAX_PINCH_ROUNDS; iter++) {
    const nextOf = new Map<number, number[]>();
    const add = (a: number, b: number) => {
      let l = nextOf.get(a);
      if (!l) nextOf.set(a, (l = []));
      l.push(b);
    };
    const doneEdge = new Set<number>();
    for (let h = 0; h < topo.nH; h++) {
      const f = (h / 3) | 0;
      if (!work[f]) continue;
      const t = topo.twin[h];
      if (t >= 0) {
        if (!work[(t / 3) | 0]) add(topo.origin(h), topo.dest(h));
        continue;
      }
      if (t === -1 || !nonManifold) {
        add(topo.origin(h), topo.dest(h));
        continue;
      }
      const e = topo.heEdge[h];
      if (doneEdge.has(e)) continue;
      doneEdge.add(e);
      const v0 = topo.edgeV0[e];
      const v1 = topo.edgeV1[e];
      let net = 0;
      for (const g of nonManifold.get(e) ?? []) {
        if (work[(g / 3) | 0]) net += topo.origin(g) === v0 ? 1 : -1;
      }
      if (net > 0) add(v0, v1);
      else if (net < 0) add(v1, v0);
    }
    const pinches = [...nextOf].filter(([, outs]) => outs.length > 1).map(([v]) => v);
    if (pinches.length) {
      for (const v of pinches) {
        // Caras alrededor del vértice conectadas a las marcadas por aristas normales:
        // ni islas (caras repetidas, aletas) ni el otro lado de una arista no-manifold.
        const around = new Set<number>();
        for (let i = topo.vOutStart[v]; i < topo.vOutStart[v + 1]; i++) around.add((topo.vOut[i] / 3) | 0);
        const stack = [...around].filter((f) => work[f]);
        const added = new Set(stack);
        while (stack.length) {
          const f = stack.pop()!;
          for (let k = 0; k < 3; k++) {
            const t = topo.twin[3 * f + k];
            if (t < 0) continue;
            const g = (t / 3) | 0;
            if (around.has(g) && !added.has(g)) {
              added.add(g);
              stack.push(g);
            }
          }
        }
        for (const f of added) work[f] = 1;
      }
      continue;
    }
    const used = new Set<number>();
    const loops: number[][] = [];
    for (const start of nextOf.keys()) {
      if (used.has(start)) continue;
      const cyc: number[] = [];
      let cur = start;
      let guard = 0;
      while (!used.has(cur) && guard++ < 1e7) {
        used.add(cur);
        cyc.push(cur);
        const nx = nextOf.get(cur);
        if (!nx) return null;
        cur = nx[0];
      }
      if (cur !== start) return null;
      if (cyc.length >= 3) loops.push(cyc);
    }
    // Orden estable: por posición (x, luego y, luego z) del centro de cada lazo.
    const P = ctx.P;
    const key = (l: number[]) => {
      let x = 0, y = 0, z = 0;
      for (const v of l) {
        x += P[3 * v];
        y += P[3 * v + 1];
        z += P[3 * v + 2];
      }
      return [x / l.length, y / l.length, z / l.length];
    };
    const keyed = loops.map((l) => ({ l, k: key(l) }));
    keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]);
    return keyed.map((x) => x.l);
  }
  return null;
}

/** Compatibilidad: el lazo más largo del borde de las caras marcadas de un componente. */
export function extractLoop(ctx: MeshContext, mark: Uint8Array, comp: number): number[] | null {
  const only = new Uint8Array(mark.length);
  for (let f = 0; f < mark.length; f++) if (mark[f] && ctx.faceComponent[f] === comp) only[f] = 1;
  const loops = extractLoops(ctx, only);
  if (!loops?.length) return null;
  return loops.reduce((a, b) => (b.length > a.length ? b : a));
}

/** Concavidad media (ponderada por longitud) a lo largo de varios lazos. */
function loopsValley(ctx: MeshContext, loops: number[][], valley: Float32Array): number {
  const P = ctx.P;
  let length = 0;
  let vsum = 0;
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      const l = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
      length += l;
      vsum += l * (valley[a] + valley[b]) / 2;
    }
  }
  return length > 0 ? vsum / length : 0;
}

function makeLoop(ctx: MeshContext, loop: number[], valley: Float32Array): SuggestionLoop {
  const P = ctx.P;
  const n = loop.length;
  const segLen = new Float64Array(n);
  let length = 0;
  let vsum = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const l = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
    segLen[i] = l;
    length += l;
    vsum += l * (valley[a] + valley[b]) / 2;
  }
  const meanValley = length > 0 ? vsum / length : 0;
  // Pocos puntos de control (fáciles de editar); el camino exacto queda fijo en los tramos.
  const K = Math.max(6, Math.min(12, Math.round(length / (4 * ctx.avgEdge))));
  const control: number[] = [];
  const idxs: number[] = [];
  let acc = 0;
  let nextMark = 0;
  for (let i = 0; i < n && control.length < K; i++) {
    if (acc >= nextMark) {
      control.push(loop[i]);
      idxs.push(i);
      nextMark = (control.length * length) / K;
    }
    acc += segLen[i];
  }
  const locked: Record<number, number[]> = {};
  for (let c = 0; c < idxs.length; c++) {
    const i0 = idxs[c];
    const i1 = c + 1 < idxs.length ? idxs[c + 1] : idxs[0] + n;
    const mid: number[] = [];
    for (let i = i0 + 1; i < i1; i++) mid.push(loop[i % n]);
    locked[c] = mid;
  }
  return { loop, controlVertices: control, locked, length, meanValley };
}

function makeSuggestion(ctx: MeshContext, loops: number[][], kind: SuggestionKind, valley: Float32Array, multi: boolean): PerimeterSuggestion {
  const parts = loops.map((l) => makeLoop(ctx, l, valley));
  const length = parts.reduce((a, p) => a + p.length, 0);
  const meanValley = length > 0 ? parts.reduce((a, p) => a + p.meanValley * p.length, 0) / length : 0;
  const labels: Record<SuggestionKind, [string, string, string]> = {
    ajustado: ['Perímetro ajustado', 'Pegado a la pieza, donde termina su volumen convexo.', 'Pegados a cada parte, donde termina su volumen convexo.'],
    suave: ['Perímetro suave', 'Sigue el fondo del valle entre la pieza y el cuerpo.', 'Siguen el fondo del valle alrededor de cada parte.'],
    amplio: ['Perímetro amplio', 'Incluye toda la transición hacia el cuerpo.', 'Incluyen toda la transición hacia el cuerpo.'],
    seleccion: ['Borde de tu selección', 'Contorno de las caras seleccionadas (no es un límite geométrico detectado).', 'Contorno de cada parte seleccionada (no es un límite geométrico detectado).'],
  };
  return {
    id: `${kind}-${loops.map((l) => `${l[0]}.${l.length}`).join('-')}`,
    kind,
    label: labels[kind][0],
    description: multi || loops.length > 1 ? labels[kind][2] : labels[kind][1],
    loops: parts,
    loop: parts[0].loop,
    controlVertices: parts[0].controlVertices,
    locked: parts[0].locked,
    meanValley,
    length,
    confidence: 0,
  };
}

function allVertices(s: PerimeterSuggestion): number[] {
  return s.loops.flatMap((l) => l.loop);
}

/** Distancia media simétrica entre dos conjuntos de lazos (aproximada por vértices). */
function loopDistance(ctx: MeshContext, A: number[], B: number[]): number {
  const P = ctx.P;
  const one = (X: number[], Y: number[]) => {
    let sum = 0;
    const step = Math.max(1, Math.floor(X.length / 200));
    let n = 0;
    for (let i = 0; i < X.length; i += step) {
      const a = X[i];
      let best = Infinity;
      for (const b of Y) {
        const d = Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);
        if (d < best) best = d;
      }
      sum += best;
      n++;
    }
    return sum / Math.max(1, n);
  };
  return Math.max(one(A, B), one(B, A));
}
