import type { IndexedMesh } from '../core/types';
import { TriangleBVH } from '../core/TriangleBVH';
import { trianglesIntersect } from '../core/geometry';
import { generateCap, type CapOptions, type CapSurface, type ObstacleQuery } from './CutSurfaceGenerator';

export interface ClearanceInput {
  /** Malla con el perímetro incrustado (las dos pieles). */
  mesh: IndexedMesh;
  /** Vértices de la malla que forman el contorno, en el orden de la tapa. */
  loop: ArrayLike<number>;
  loopPositions: Float64Array;
  /** 1 en las caras de la piel de la pieza extraída. */
  extractedFaces: Uint8Array;
  /** true si la pieza extraída queda del lado +normal de la tapa. */
  extractedOnPositiveSide: boolean;
}

export interface ClearanceResult {
  cap: CapSurface;
  /** Triángulos de la tapa que todavía cruzan la piel (0 si quedó limpia). */
  intersections: number;
  refinements: number;
}

/**
 * Genera la superficie de corte garantizando que quede dentro del material:
 * la tapa no puede atravesar la piel de ninguna de las dos piezas. Pasa, por
 * ejemplo, cuando el perímetro cruza apenas el fondo de un valle, o cuando
 * encierra una zona casi paralela a la tapa (la cara por encima de la nariz).
 *
 * Si la tapa libre no toca la piel, se usa tal cual. Si la toca:
 *
 * 1. Cotas por estrella: para cada triángulo T de la tapa se recortan (en
 *    proyección sobre el plano) los triángulos de piel que se le superponen y
 *    se toma la altura mínima de la piel extraída sobre T (y la máxima de la
 *    piel del cuerpo que queda debajo). Cada vértice interior debe quedar
 *    debajo del mínimo de todos los triángulos de su estrella: así, cada
 *    triángulo de la tapa queda por debajo de la piel en toda su extensión,
 *    no solo en sus vértices.
 * 2. Los vértices que violan su cota se fijan en ella y el resto se deforma
 *    con una corrección armónica suave (CutSurfaceGenerator).
 * 3. Si todavía queda algún cruce (por ejemplo, un triángulo con los tres
 *    vértices en el contorno), se agregan puntos de Steiner y se repite.
 */
export function generateCapWithClearance(input: ClearanceInput, opts: CapOptions, maxRounds = 4): ClearanceResult {
  const { mesh, loop, loopPositions, extractedFaces } = input;
  const P = mesh.positions;
  const I = mesh.indices;
  const nb = loop.length;

  // Piel cercana a la tapa: caras cuya caja toca la caja del contorno ampliada.
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let i = 0; i < nb; i++) {
    const x = loopPositions[3 * i], y = loopPositions[3 * i + 1], z = loopPositions[3 * i + 2];
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    minz = Math.min(minz, z); maxz = Math.max(maxz, z);
  }
  const diag = Math.hypot(maxx - minx, maxy - miny, maxz - minz) || 1;
  const pad = 0.6 * diag + 1;
  const near: number[] = [];
  for (let f = 0; f < I.length / 3; f++) {
    let fx0 = Infinity, fy0 = Infinity, fz0 = Infinity, fx1 = -Infinity, fy1 = -Infinity, fz1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = I[3 * f + k];
      const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
      if (x < fx0) fx0 = x;
      if (x > fx1) fx1 = x;
      if (y < fy0) fy0 = y;
      if (y > fy1) fy1 = y;
      if (z < fz0) fz0 = z;
      if (z > fz1) fz1 = z;
    }
    if (fx1 < minx - pad || fx0 > maxx + pad || fy1 < miny - pad || fy0 > maxy + pad || fz1 < minz - pad || fz0 > maxz + pad) continue;
    near.push(f);
  }
  const skin = new TriangleBVH(P, I, near);

  // Margen respecto de la piel: pequeño frente al tamaño de los triángulos.
  let edgeSum = 0;
  for (let i = 0; i < nb; i++) {
    const j = (i + 1) % nb;
    edgeSum += Math.hypot(
      loopPositions[3 * j] - loopPositions[3 * i],
      loopPositions[3 * j + 1] - loopPositions[3 * i + 1],
      loopPositions[3 * j + 2] - loopPositions[3 * i + 2],
    );
  }
  const avgEdge = edgeSum / nb;
  const margin = Math.min(0.02, 0.05 * avgEdge);
  const sign = input.extractedOnPositiveSide ? 1 : -1;
  const obstacle = (q: ObstacleQuery) => starBounds(q, mesh, near, extractedFaces, sign, margin);

  // Primero la tapa libre: si no toca la piel, no se modifica.
  const plain = generateCap(loopPositions, opts);
  const plainBad = intersectingCapTriangles(plain, loop, mesh, skin);
  if (!plainBad.length) return { cap: plain, intersections: 0, refinements: 0 };

  let best = { cap: plain, bad: plainBad };
  const extra: Array<[number, number]> = [];
  let cap = generateCap(loopPositions, { ...opts, obstacle });
  let bad = intersectingCapTriangles(cap, loop, mesh, skin);
  if (bad.length < best.bad.length) best = { cap, bad };
  let rounds = 0;
  while (bad.length && rounds < maxRounds) {
    rounds++;
    const before = extra.length;
    const dx = cap.domain.x, dy = cap.domain.y;
    const T = cap.triangles;
    const tooClose = (x: number, y: number, scale: number) => {
      for (const [ex, ey] of extra) if (Math.hypot(ex - x, ey - y) < 0.05 * scale) return true;
      return false;
    };
    for (const t of bad) {
      const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
      const ar = Math.abs((dx[b] - dx[a]) * (dy[c] - dy[a]) - (dy[b] - dy[a]) * (dx[c] - dx[a])) / 2;
      const scale = Math.sqrt(ar);
      if (scale < 1e-3 * avgEdge) continue;
      const cand: Array<[number, number]> = [[(dx[a] + dx[b] + dx[c]) / 3, (dy[a] + dy[b] + dy[c]) / 3]];
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        // Las aristas del contorno no se pueden partir (deben coincidir con el perímetro).
        const boundaryEdge = p < nb && q < nb && (Math.abs(p - q) === 1 || Math.abs(p - q) === nb - 1);
        if (!boundaryEdge) cand.push([(dx[p] + dx[q]) / 2, (dy[p] + dy[q]) / 2]);
      }
      for (const [x, y] of cand) if (!tooClose(x, y, scale)) extra.push([x, y]);
    }
    if (extra.length === before) break;
    cap = generateCap(loopPositions, { ...opts, obstacle, extraPoints: extra });
    bad = intersectingCapTriangles(cap, loop, mesh, skin);
    if (bad.length < best.bad.length) best = { cap, bad };
  }
  return { cap: best.cap, intersections: best.bad.length, refinements: rounds };
}

/**
 * Cotas por vértice a partir de los triángulos de piel que se superponen (en
 * proyección) con cada triángulo T de la tapa. Sobre cada pedazo S∩T la piel
 * y la tapa son lineales, así que alcanza con imponer la condición en los
 * vértices del pedazo recortado q:
 *
 *   tapa(q) = λ_I(q)·B_T + c_B(q) ≤ piel(q) − margen·λ_I(q)
 *
 * donde λ_I es el peso baricéntrico de los vértices interiores de T y c_B el
 * aporte de sus vértices del contorno (fijos). Exigir que todo vértice
 * interior de T quede por debajo de B_T garantiza que T entero quede debajo
 * de la piel extraída; lo mismo, al revés, con la piel del cuerpo que queda
 * por debajo. `sign` = +1 si la piel extraída está del lado +normal.
 */
function starBounds(
  q: ObstacleQuery, mesh: IndexedMesh, near: number[], extractedFaces: Uint8Array, sign: number, margin: number,
): { lo: Float64Array; hi: Float64Array } {
  const { positions: CP, triangles: CT, boundaryCount: nb, origin: o, normal: n, u, v } = q;
  const NV = CP.length / 3;
  const NT = CT.length / 3;
  // Sistema donde la piel extraída queda "arriba": h' = sign·h.
  const proj = (x: number, y: number, z: number, out: Float64Array, k: number) => {
    const dx = x - o[0], dy = y - o[1], dz = z - o[2];
    out[3 * k] = dx * u[0] + dy * u[1] + dz * u[2];
    out[3 * k + 1] = dx * v[0] + dy * v[1] + dz * v[2];
    out[3 * k + 2] = sign * (dx * n[0] + dy * n[1] + dz * n[2]);
  };
  const cp = new Float64Array(NV * 3);
  for (let i = 0; i < NV; i++) proj(CP[3 * i], CP[3 * i + 1], CP[3 * i + 2], cp, i);

  // Grilla 2D de los triángulos de la tapa.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < NV; i++) {
    x0 = Math.min(x0, cp[3 * i]); x1 = Math.max(x1, cp[3 * i]);
    y0 = Math.min(y0, cp[3 * i + 1]); y1 = Math.max(y1, cp[3 * i + 1]);
  }
  const G = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(NT) / 2)));
  const cw = (x1 - x0) / G || 1, ch = (y1 - y0) / G || 1;
  const cells: number[][] = Array.from({ length: G * G }, () => []);
  const cell = (x: number, y: number) => [Math.max(0, Math.min(G - 1, Math.floor((x - x0) / cw))), Math.max(0, Math.min(G - 1, Math.floor((y - y0) / ch)))];
  for (let t = 0; t < NT; t++) {
    const a = CT[3 * t], b = CT[3 * t + 1], c = CT[3 * t + 2];
    const [gx0, gy0] = cell(Math.min(cp[3 * a], cp[3 * b], cp[3 * c]), Math.min(cp[3 * a + 1], cp[3 * b + 1], cp[3 * c + 1]));
    const [gx1, gy1] = cell(Math.max(cp[3 * a], cp[3 * b], cp[3 * c]), Math.max(cp[3 * a + 1], cp[3 * b + 1], cp[3 * c + 1]));
    for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) cells[gx * G + gy].push(t);
  }

  const P = mesh.positions;
  const I = mesh.indices;
  const B = new Float64Array(NT).fill(Infinity); // cota superior de los interiores de T
  const skinMin = new Float64Array(NT).fill(Infinity); // altura mínima de la piel extraída sobre T
  // Piel del cuerpo sobre T: muestras (λ_I, c_B, altura) para decidir luego si queda debajo.
  const lower: Array<number[]> = Array.from({ length: NT }, () => []);
  const sp = new Float64Array(9);
  const seen = new Int32Array(NT).fill(-1);
  let poly: number[] = [];
  let tmp: number[] = [];
  for (const f of near) {
    for (let k = 0; k < 3; k++) {
      const w = I[3 * f + k];
      proj(P[3 * w], P[3 * w + 1], P[3 * w + 2], sp, k);
    }
    const fx0 = Math.min(sp[0], sp[3], sp[6]), fx1 = Math.max(sp[0], sp[3], sp[6]);
    const fy0 = Math.min(sp[1], sp[4], sp[7]), fy1 = Math.max(sp[1], sp[4], sp[7]);
    if (fx1 < x0 || fx0 > x1 || fy1 < y0 || fy0 > y1) continue;
    const isX = extractedFaces[f] === 1;
    const ax = sp[3] - sp[0], ay = sp[4] - sp[1], bx = sp[6] - sp[0], by = sp[7] - sp[1];
    const det = ax * by - ay * bx;
    const scale2 = (fx1 - fx0) * (fx1 - fx0) + (fy1 - fy0) * (fy1 - fy0);
    // Piel casi vertical vista desde la normal: se toman sus vértices y puntos medios.
    const flat = Math.abs(det) <= 1e-10 * Math.max(scale2, 1e-30);
    const hAt = (x: number, y: number) => {
      const px = x - sp[0], py = y - sp[1];
      const l1 = (px * by - py * bx) / det;
      const l2 = (ax * py - ay * px) / det;
      return sp[2] + l1 * (sp[5] - sp[2]) + l2 * (sp[8] - sp[2]);
    };
    const [gx0, gy0] = cell(fx0, fy0);
    const [gx1, gy1] = cell(fx1, fy1);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        for (const t of cells[gx * G + gy]) {
          if (seen[t] === f) continue;
          seen[t] = f;
          const ta = CT[3 * t], tb = CT[3 * t + 1], tc = CT[3 * t + 2];
          const Ax = cp[3 * ta], Ay = cp[3 * ta + 1];
          const e1x = cp[3 * tb] - Ax, e1y = cp[3 * tb + 1] - Ay, e2x = cp[3 * tc] - Ax, e2y = cp[3 * tc + 1] - Ay;
          const tdet = e1x * e2y - e1y * e2x;
          if (tdet <= 0) continue;
          // Muestras q = (x, y, altura de piel)
          const samples: number[] = [];
          if (flat) {
            const pts = [
              [sp[0], sp[1], sp[2]], [sp[3], sp[4], sp[5]], [sp[6], sp[7], sp[8]],
              [(sp[0] + sp[3]) / 2, (sp[1] + sp[4]) / 2, isX ? Math.min(sp[2], sp[5]) : Math.max(sp[2], sp[5])],
              [(sp[3] + sp[6]) / 2, (sp[4] + sp[7]) / 2, isX ? Math.min(sp[5], sp[8]) : Math.max(sp[5], sp[8])],
              [(sp[6] + sp[0]) / 2, (sp[7] + sp[1]) / 2, isX ? Math.min(sp[8], sp[2]) : Math.max(sp[8], sp[2])],
            ];
            for (const [x, y, h] of pts) {
              const px = x - Ax, py = y - Ay;
              const l1 = (px * e2y - py * e2x) / tdet, l2 = (e1x * py - e1y * px) / tdet;
              if (l1 > 1e-9 && l2 > 1e-9 && l1 + l2 < 1 - 1e-9) samples.push(x, y, h);
            }
          } else {
            poly.length = 0;
            if (det > 0) poly.push(sp[0], sp[1], sp[3], sp[4], sp[6], sp[7]);
            else poly.push(sp[0], sp[1], sp[6], sp[7], sp[3], sp[4]);
            const tv = [ta, tb, tc];
            for (let e = 0; e < 3 && poly.length >= 6; e++) {
              const pa = tv[e], pb = tv[(e + 1) % 3];
              const ex = cp[3 * pb] - cp[3 * pa], ey = cp[3 * pb + 1] - cp[3 * pa + 1];
              const sx0 = cp[3 * pa], sy0 = cp[3 * pa + 1];
              tmp.length = 0;
              const m = poly.length / 2;
              for (let i = 0; i < m; i++) {
                const xA = poly[2 * i], yA = poly[2 * i + 1];
                const xB = poly[2 * ((i + 1) % m)], yB = poly[2 * ((i + 1) % m) + 1];
                const sA = ex * (yA - sy0) - ey * (xA - sx0);
                const sB = ex * (yB - sy0) - ey * (xB - sx0);
                if (sA >= 0) tmp.push(xA, yA);
                if ((sA >= 0) !== (sB >= 0)) {
                  const r = sA / (sA - sB);
                  tmp.push(xA + r * (xB - xA), yA + r * (yB - yA));
                }
              }
              const sw = poly;
              poly = tmp;
              tmp = sw;
            }
            const m = poly.length / 2;
            if (m < 3) continue;
            let area = 0;
            for (let i = 0; i < m; i++) {
              const j = (i + 1) % m;
              area += poly[2 * i] * poly[2 * j + 1] - poly[2 * j] * poly[2 * i + 1];
            }
            // Superposición nula (piel que solo toca el borde de T): no restringe.
            if (Math.abs(area) <= 1e-9 * tdet) continue;
            for (let i = 0; i < m; i++) samples.push(poly[2 * i], poly[2 * i + 1], hAt(poly[2 * i], poly[2 * i + 1]));
          }
          for (let k = 0; k < samples.length; k += 3) {
            const x = samples[k], y = samples[k + 1], h = samples[k + 2];
            const px = x - Ax, py = y - Ay;
            const lb = (px * e2y - py * e2x) / tdet;
            const lc = (e1x * py - e1y * px) / tdet;
            const la = 1 - lb - lc;
            let lI = 0, cB = 0;
            if (ta >= nb) lI += la; else cB += la * cp[3 * ta + 2];
            if (tb >= nb) lI += lb; else cB += lb * cp[3 * tb + 2];
            if (tc >= nb) lI += lc; else cB += lc * cp[3 * tc + 2];
            if (isX) {
              if (h < skinMin[t]) skinMin[t] = h;
              // Cerca del contorno (λ_I → 0) la condición es de pendiente; si
              // exige hundir demasiado la tapa, el desplazamiento se limita
              // (CutSurfaceGenerator) y el cruce restante se resuelve refinando.
              if (lI >= MIN_INTERIOR_WEIGHT) {
                const bound = (h - cB) / lI - margin;
                if (bound < B[t]) B[t] = bound;
              }
            } else {
              lower[t].push(lI, cB, h);
            }
          }
        }
      }
    }
  }
  // Piel del cuerpo: solo restringe la que queda por debajo de la piel extraída sobre T.
  const L = new Float64Array(NT).fill(-Infinity);
  for (let t = 0; t < NT; t++) {
    const arr = lower[t];
    for (let k = 0; k < arr.length; k += 3) {
      const lI = arr[k], cB = arr[k + 1], h = arr[k + 2];
      if (h >= skinMin[t]) continue;
      if (lI >= MIN_INTERIOR_WEIGHT) {
        const bound = (h - cB) / lI + margin;
        if (bound > L[t]) L[t] = bound;
      }
    }
  }
  const top = new Float64Array(NV).fill(Infinity);
  const bottom = new Float64Array(NV).fill(-Infinity);
  for (let t = 0; t < NT; t++) {
    for (let k = 0; k < 3; k++) {
      const w = CT[3 * t + k];
      if (B[t] < top[w]) top[w] = B[t];
      if (L[t] > bottom[w]) bottom[w] = L[t];
    }
  }
  const lo = new Float64Array(NV);
  const hi = new Float64Array(NV);
  for (let i = 0; i < NV; i++) {
    if (sign > 0) {
      lo[i] = bottom[i];
      hi[i] = top[i];
    } else {
      lo[i] = -top[i];
      hi[i] = -bottom[i];
    }
  }
  return { lo, hi };
}

const MIN_INTERIOR_WEIGHT = 1e-6;

/** Triángulos de la tapa que cruzan la piel (respetando los vértices compartidos del contorno). */
function intersectingCapTriangles(cap: CapSurface, loop: ArrayLike<number>, mesh: IndexedMesh, skin: TriangleBVH): number[] {
  const nb = cap.boundaryCount;
  const CP = cap.positions;
  const CT = cap.triangles;
  const capBVH = new TriangleBVH(CP, CT);
  const P = mesh.positions;
  const I = mesh.indices;
  const T1: Float64Array[] = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const T2: Float64Array[] = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
  const shared: Array<[number, number]> = [];
  const bad = new Set<number>();
  capBVH.overlapPairs(skin, (ct, sf) => {
    if (bad.has(ct)) return;
    shared.length = 0;
    for (let i = 0; i < 3; i++) {
      const li = CT[3 * ct + i];
      if (li >= nb) continue;
      const mv = loop[li];
      for (let j = 0; j < 3; j++) if (I[3 * sf + j] === mv) shared.push([i, j]);
    }
    for (let k = 0; k < 3; k++) {
      const a = CT[3 * ct + k] * 3;
      const b = I[3 * sf + k] * 3;
      T1[k][0] = CP[a]; T1[k][1] = CP[a + 1]; T1[k][2] = CP[a + 2];
      T2[k][0] = P[b]; T2[k][1] = P[b + 1]; T2[k][2] = P[b + 2];
    }
    if (trianglesIntersect(T1, T2, shared)) bad.add(ct);
  });
  return [...bad];
}
