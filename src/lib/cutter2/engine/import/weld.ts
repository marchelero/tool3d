import type { IndexedMesh } from '../core/types';

export interface WeldResult {
  mesh: IndexedMesh;
  /** Triángulos descartados por tener vértices repetidos (área nula topológica). */
  droppedDegenerate: number;
  /** Triángulos con coordenadas no finitas. */
  droppedNonFinite: number;
}

/**
 * Suelda una "sopa" de triángulos (9 valores por triángulo) uniendo vértices
 * con coordenadas exactamente iguales. No aplica tolerancias: dos vértices
 * se unen solo si representan el mismo punto, para no alterar la morfología.
 */
export function weldTriangleSoup(soup: Float32Array | Float64Array): WeldResult {
  const nT = Math.floor(soup.length / 9);
  const nIn = nT * 3;
  let cap = 1;
  while (cap < nIn * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const pos = new Float64Array(nIn * 3);
  const idx = new Uint32Array(nIn);
  let nV = 0;
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  const hashCoord = (x: number): number => {
    f64[0] = x === 0 ? 0 : x; // normaliza -0
    return (u32[0] ^ Math.imul(u32[1], 0x9e3779b1)) >>> 0;
  };

  let outT = 0;
  let droppedDegenerate = 0;
  let droppedNonFinite = 0;
  const tri = [0, 0, 0];
  for (let t = 0; t < nT; t++) {
    let finite = true;
    for (let k = 0; k < 9; k++) {
      if (!Number.isFinite(soup[9 * t + k])) {
        finite = false;
        break;
      }
    }
    if (!finite) {
      droppedNonFinite++;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const x = soup[9 * t + 3 * k];
      const y = soup[9 * t + 3 * k + 1];
      const z = soup[9 * t + 3 * k + 2];
      let h = Math.imul(hashCoord(x), 0x85ebca6b) ^ Math.imul(hashCoord(y), 0xc2b2ae35) ^ Math.imul(hashCoord(z), 0x27d4eb2f);
      h = (h ^ (h >>> 15)) & mask;
      let found = -1;
      for (;;) {
        const e = table[h];
        if (e < 0) break;
        if (pos[3 * e] === x && pos[3 * e + 1] === y && pos[3 * e + 2] === z) {
          found = e;
          break;
        }
        h = (h + 1) & mask;
      }
      if (found < 0) {
        found = nV++;
        pos[3 * found] = x;
        pos[3 * found + 1] = y;
        pos[3 * found + 2] = z;
        table[h] = found;
      }
      tri[k] = found;
    }
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) {
      droppedDegenerate++;
      continue;
    }
    idx[3 * outT] = tri[0];
    idx[3 * outT + 1] = tri[1];
    idx[3 * outT + 2] = tri[2];
    outT++;
  }
  return {
    mesh: { positions: pos.slice(0, nV * 3), indices: idx.slice(0, outT * 3) },
    droppedDegenerate,
    droppedNonFinite,
  };
}

export interface RepairResult {
  mesh: IndexedMesh;
  /** Triángulos repetidos (mismos tres vértices) que se quitaron. */
  droppedDuplicate: number;
  /** Triángulos colgando de una sola arista (aletas sin volumen) que se quitaron. */
  droppedFins: number;
}

/** Tabla de dispersión abierta sobre enteros (claves de 2 o 3 índices). */
class IntKeyTable {
  private readonly table: Int32Array;
  private readonly mask: number;
  constructor(n: number) {
    let cap = 1;
    while (cap < n * 2) cap <<= 1;
    this.table = new Int32Array(cap).fill(-1);
    this.mask = cap - 1;
  }
  static hash(a: number, b: number, c: number): number {
    let h = Math.imul(a + 1, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35) ^ Math.imul(c + 1, 0x27d4eb2f);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    return (h ^ (h >>> 13)) >>> 0;
  }
  /** Busca la clave; si no está, la inserta con el valor `insert`. Devuelve el valor guardado (o -1 si la insertó). */
  findOrInsert(a: number, b: number, c: number, insert: number, equal: (stored: number) => boolean): number {
    let h = IntKeyTable.hash(a, b, c) & this.mask;
    for (;;) {
      const e = this.table[h];
      if (e < 0) {
        this.table[h] = insert;
        return -1;
      }
      if (equal(e)) return e;
      h = (h + 1) & this.mask;
    }
  }
  /** Busca la clave sin insertar. */
  find(a: number, b: number, c: number, equal: (stored: number) => boolean): number {
    let h = IntKeyTable.hash(a, b, c) & this.mask;
    for (;;) {
      const e = this.table[h];
      if (e < 0) return -1;
      if (equal(e)) return e;
      h = (h + 1) & this.mask;
    }
  }
}

/** Cuenta semiaristas dirigidas a→b de un conjunto de caras. */
class DirectedEdgeCounter {
  private readonly table: IntKeyTable;
  private readonly ea: Uint32Array;
  private readonly eb: Uint32Array;
  private readonly n: Uint16Array;
  private size = 0;
  constructor(capacity: number) {
    this.table = new IntKeyTable(capacity);
    this.ea = new Uint32Array(capacity);
    this.eb = new Uint32Array(capacity);
    this.n = new Uint16Array(capacity);
  }
  private key(a: number, b: number, insert: boolean): number {
    const eq = (e: number) => this.ea[e] === a && this.eb[e] === b;
    if (!insert) return this.table.find(a, b, 0x5bd1e995, eq);
    const found = this.table.findOrInsert(a, b, 0x5bd1e995, this.size, eq);
    if (found >= 0) return found;
    const id = this.size++;
    this.ea[id] = a;
    this.eb[id] = b;
    return id;
  }
  add(idx: Uint32Array, t: number): void {
    for (let k = 0; k < 3; k++) this.n[this.key(idx[3 * t + k], idx[3 * t + ((k + 1) % 3)], true)]++;
  }
  count(a: number, b: number): number {
    const e = this.key(a, b, false);
    return e < 0 ? 0 : this.n[e];
  }
}

/**
 * Repara defectos que no cambian la forma imprimible pero rompen la topología:
 *
 * - Triángulos repetidos (los mismos tres vértices, en cualquier orden). Se
 *   conserva la copia coherente con sus vecinos; una copia invertida encima
 *   de una cara buena se descarta; si las dos orientaciones son coherentes
 *   (dos cuerpos pegados cara con cara) se quitan ambas y los cuerpos quedan
 *   unidos, porque esa cara no delimita ningún volumen.
 * - Aletas: triángulos con dos aristas abiertas colgando de una arista que ya
 *   tiene dos caras (restos de esculpido o de booleanos). No encierran volumen.
 *
 * Con estos defectos cada cara repetida o aleta queda como una "isla" sin
 * vecinos, y cualquier operación por adyacencia (relleno de agujeros de la
 * selección, lazos de borde) tropieza con ellas aunque estén lejos.
 */
export function repairMesh(mesh: IndexedMesh): RepairResult {
  const idx = mesh.indices;
  const nT = idx.length / 3;
  const keep = new Uint8Array(nT).fill(1);
  let droppedDuplicate = 0;

  // 1) Triángulos repetidos: grupos por terna ordenada de vértices.
  {
    const s0 = new Uint32Array(nT);
    const s1 = new Uint32Array(nT);
    const s2 = new Uint32Array(nT);
    for (let t = 0; t < nT; t++) {
      let a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
      if (a > b) [a, b] = [b, a];
      if (b > c) [b, c] = [c, b];
      if (a > b) [a, b] = [b, a];
      s0[t] = a;
      s1[t] = b;
      s2[t] = c;
    }
    const table = new IntKeyTable(nT);
    const groupNext = new Int32Array(nT).fill(-1); // lista enlazada por grupo, desde el primero
    const groupLast = new Int32Array(nT); // válido solo en el primero de cada grupo
    const isFirst = new Uint8Array(nT);
    let groups = 0;
    for (let t = 0; t < nT; t++) {
      const first = table.findOrInsert(s0[t], s1[t], s2[t], t, (e) => s0[e] === s0[t] && s1[e] === s1[t] && s2[e] === s2[t]);
      if (first < 0) {
        isFirst[t] = 1;
        groupLast[t] = t;
      } else {
        groupNext[groupLast[first]] = t;
        groupLast[first] = t;
        groups++;
      }
    }
    if (groups > 0) {
      const sameOrientation = (t: number, u: number): boolean => {
        const a = idx[3 * t];
        const k = idx[3 * u] === a ? 0 : idx[3 * u + 1] === a ? 1 : 2;
        return idx[3 * u + ((k + 1) % 3)] === idx[3 * t + 1];
      };
      // Evidencia: semiaristas dirigidas de las caras ya decididas (al principio, las que no se repiten).
      const dir = new DirectedEdgeCounter(nT * 3);
      const pending: number[] = [];
      for (let t = 0; t < nT; t++) {
        if (!isFirst[t]) continue;
        if (groupNext[t] < 0) dir.add(idx, t);
        else pending.push(t);
      }
      const resolve = (t: number, keepPlus: boolean, keepMinus: boolean) => {
        let gotPlus = false;
        let gotMinus = false;
        for (let u = t; u >= 0; u = groupNext[u]) {
          const plus = u === t || sameOrientation(t, u);
          const take = plus ? keepPlus && !gotPlus : keepMinus && !gotMinus;
          if (take) {
            if (plus) gotPlus = true;
            else gotMinus = true;
            dir.add(idx, u);
          } else {
            keep[u] = 0;
            droppedDuplicate++;
          }
        }
      };
      // Qué copia conservar se decide por los vecinos: la cara coherente con el
      // resto de la malla es la verdadera; una copia invertida sobre ella se
      // descarta; si las dos orientaciones son coherentes (dos cuerpos pegados
      // cara con cara) se quitan ambas y los cuerpos quedan unidos. En un
      // parche repetido grande la evidencia llega desde el borde hacia adentro.
      let queue = pending;
      for (let round = 0; round < 64 && queue.length; round++) {
        const next: number[] = [];
        for (const t of queue) {
          const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
          let coh = 0, inc = 0;
          for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
            const same = dir.count(p, q);
            const opposite = dir.count(q, p);
            if (opposite > 0 && same === 0) coh++;
            else if (same > 0 && opposite === 0) inc++;
          }
          if (coh === inc) {
            next.push(t); // sin evidencia todavía
            continue;
          }
          // coh > inc: la orientación de t es coherente con los vecinos; inc > coh: la opuesta lo es.
          const keepPlus = coh > inc;
          let hasMinus = false;
          for (let u = groupNext[t]; u >= 0 && !hasMinus; u = groupNext[u]) if (!sameOrientation(t, u)) hasMinus = true;
          if (keepPlus || !hasMinus) resolve(t, true, false); // todas las copias al revés del entorno: se deja una (las normales se informan aparte)
          else resolve(t, false, true);
        }
        if (next.length === queue.length) break; // nadie avanzó
        queue = next;
      }
      // Sin evidencia (copias aisladas): se conserva una por orientación neta; con saldo cero no queda ninguna.
      for (const t of queue) {
        let net = 1;
        for (let u = groupNext[t]; u >= 0; u = groupNext[u]) net += sameOrientation(t, u) ? 1 : -1;
        resolve(t, net > 0, net < 0);
      }
    }
  }

  // 2) Aletas: caras con aristas abiertas colgando de una arista que ya tiene
  //    dos caras (valencia ≥ 3). Se pelan desde la punta: una cara con dos
  //    aristas abiertas no cierra nada. Solo dentro de la zona de aletas (caras
  //    con borde abierto conectadas a una arista no-manifold), para no comerse
  //    el borde de una malla legítimamente abierta.
  let droppedFins = 0;
  {
    const edges = new EdgeTable(idx, keep, nT);
    const openEdges = (t: number): number => {
      let n = 0;
      for (let k = 0; k < 3; k++) if (edges.valence(idx[3 * t + k], idx[3 * t + ((k + 1) % 3)]) === 1) n++;
      return n;
    };
    const touchesNonManifold = (t: number): boolean => {
      for (let k = 0; k < 3; k++) if (edges.valence(idx[3 * t + k], idx[3 * t + ((k + 1) % 3)]) >= 3) return true;
      return false;
    };
    const inRegion = new Uint8Array(nT);
    const region: number[] = [];
    for (let t = 0; t < nT; t++) {
      if (keep[t] && openEdges(t) > 0 && touchesNonManifold(t)) {
        inRegion[t] = 1;
        region.push(t);
      }
    }
    const neighbors = (t: number): number[] => {
      const out: number[] = [];
      for (let k = 0; k < 3; k++) {
        const g = edges.neighbor(t, idx[3 * t + k], idx[3 * t + ((k + 1) % 3)]);
        if (g >= 0) out.push(g);
      }
      return out;
    };
    const grow = (candidates: number[]) => {
      for (const g of candidates) {
        if (keep[g] && !inRegion[g] && openEdges(g) > 0) {
          inRegion[g] = 1;
          region.push(g);
        }
      }
    };
    for (let i = 0; i < region.length; i++) grow(neighbors(region[i]));
    const limit = Math.max(2000, Math.floor(0.01 * nT));
    if (region.length > 0 && region.length <= limit) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < region.length; i++) {
          const t = region[i];
          if (!keep[t] || openEdges(t) < 2) continue;
          const nb = neighbors(t);
          keep[t] = 0;
          edges.remove(t);
          droppedFins++;
          changed = true;
          grow(nb); // los vecinos acaban de ganar una arista abierta
        }
      }
    }
  }

  if (!droppedDuplicate && !droppedFins) return { mesh, droppedDuplicate: 0, droppedFins: 0 };
  const faces: number[] = [];
  for (let t = 0; t < nT; t++) if (keep[t]) faces.push(t);
  const outIdx = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    outIdx[3 * i] = idx[3 * faces[i]];
    outIdx[3 * i + 1] = idx[3 * faces[i] + 1];
    outIdx[3 * i + 2] = idx[3 * faces[i] + 2];
  }
  return { mesh: compactMesh(mesh.positions, outIdx), droppedDuplicate, droppedFins };
}

/** Aristas (no dirigidas) de las caras conservadas: valencia y hasta dos caras por arista. */
class EdgeTable {
  private readonly table: IntKeyTable;
  private readonly ea: Uint32Array;
  private readonly eb: Uint32Array;
  private readonly count: Uint16Array;
  private readonly f0: Int32Array;
  private readonly f1: Int32Array;
  private size = 0;
  constructor(private readonly idx: Uint32Array, keep: Uint8Array, nT: number) {
    this.table = new IntKeyTable(nT * 3);
    this.ea = new Uint32Array(nT * 3);
    this.eb = new Uint32Array(nT * 3);
    this.count = new Uint16Array(nT * 3);
    this.f0 = new Int32Array(nT * 3).fill(-1);
    this.f1 = new Int32Array(nT * 3).fill(-1);
    for (let t = 0; t < nT; t++) {
      if (!keep[t]) continue;
      for (let k = 0; k < 3; k++) {
        const e = this.key(idx[3 * t + k], idx[3 * t + ((k + 1) % 3)], true);
        this.count[e]++;
        if (this.f0[e] < 0) this.f0[e] = t;
        else if (this.f1[e] < 0) this.f1[e] = t;
      }
    }
  }
  private key(a: number, b: number, insert: boolean): number {
    if (a > b) [a, b] = [b, a];
    const eq = (e: number) => this.ea[e] === a && this.eb[e] === b;
    if (!insert) return this.table.find(a, b, 0x7fffffff, eq);
    const found = this.table.findOrInsert(a, b, 0x7fffffff, this.size, eq);
    if (found >= 0) return found;
    const id = this.size++;
    this.ea[id] = a;
    this.eb[id] = b;
    return id;
  }
  valence(a: number, b: number): number {
    const e = this.key(a, b, false);
    return e < 0 ? 0 : this.count[e];
  }
  /** La otra cara de una arista de valencia 2, o -1. */
  neighbor(t: number, a: number, b: number): number {
    const e = this.key(a, b, false);
    if (e < 0 || this.count[e] !== 2) return -1;
    if (this.f0[e] === t) return this.f1[e];
    if (this.f1[e] === t) return this.f0[e];
    return -1;
  }
  remove(t: number): void {
    const idx = this.idx;
    for (let k = 0; k < 3; k++) {
      const e = this.key(idx[3 * t + k], idx[3 * t + ((k + 1) % 3)], false);
      if (e < 0) continue;
      this.count[e]--;
      if (this.f0[e] === t) {
        this.f0[e] = this.f1[e];
        this.f1[e] = -1;
      } else if (this.f1[e] === t) this.f1[e] = -1;
    }
  }
}

/** Elimina vértices no referenciados y renumera. */
export function compactMesh(positions: Float64Array, indices: ArrayLike<number>, triCount?: number): IndexedMesh {
  const nT = triCount ?? indices.length / 3;
  const nV = positions.length / 3;
  const remap = new Int32Array(nV).fill(-1);
  let count = 0;
  const outIdx = new Uint32Array(nT * 3);
  for (let i = 0; i < nT * 3; i++) {
    const v = indices[i];
    let r = remap[v];
    if (r < 0) {
      r = remap[v] = count++;
    }
    outIdx[i] = r;
  }
  const outPos = new Float64Array(count * 3);
  for (let v = 0; v < nV; v++) {
    const r = remap[v];
    if (r >= 0) {
      outPos[3 * r] = positions[3 * v];
      outPos[3 * r + 1] = positions[3 * v + 1];
      outPos[3 * r + 2] = positions[3 * v + 2];
    }
  }
  return { positions: outPos, indices: outIdx };
}

/** Submalla con un subconjunto de caras (compactada). */
export function subMesh(mesh: IndexedMesh, faces: ArrayLike<number>): IndexedMesh {
  const idx = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    idx[3 * i] = mesh.indices[3 * f];
    idx[3 * i + 1] = mesh.indices[3 * f + 1];
    idx[3 * i + 2] = mesh.indices[3 * f + 2];
  }
  return compactMesh(mesh.positions, idx);
}
