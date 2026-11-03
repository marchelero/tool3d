/**
 * Utilidades 2D: subdivisión plana por cuerdas y triangulación de polígonos
 * simples (con puntos colineales) eligiendo orejas de buena calidad.
 */

export function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function polygonArea(poly: number[], X: Float64Array, Y: Float64Array): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += X[p] * Y[q] - X[q] * Y[p];
  }
  return a / 2;
}

/**
 * Caras interiores de un grafo plano (PSLG). `X`,`Y` indexados por id local.
 * Devuelve ciclos CCW (área positiva). Lanza si el grafo es inconsistente.
 */
export function planarFaces(nodes: number[], edges: Array<[number, number]>, X: Float64Array, Y: Float64Array): number[][] {
  const adj = new Map<number, number[]>();
  for (const n of nodes) adj.set(n, []);
  const addAdj = (a: number, b: number) => {
    const l = adj.get(a)!;
    if (!l.includes(b)) l.push(b);
  };
  for (const [a, b] of edges) {
    if (a === b) continue;
    addAdj(a, b);
    addAdj(b, a);
  }
  // Ordenar vecinos por ángulo CCW
  for (const [v, list] of adj) {
    list.sort((p, q) => Math.atan2(Y[p] - Y[v], X[p] - X[v]) - Math.atan2(Y[q] - Y[v], X[q] - X[v]));
  }
  const used = new Set<string>();
  const faces: number[][] = [];
  for (const [u0, list] of adj) {
    for (const v0 of list) {
      const k0 = `${u0}>${v0}`;
      if (used.has(k0)) continue;
      const cycle: number[] = [];
      let u = u0;
      let v = v0;
      let guard = 0;
      while (guard++ < 10000) {
        const key = `${u}>${v}`;
        if (used.has(key)) break;
        used.add(key);
        cycle.push(u);
        const nl = adj.get(v)!;
        const idx = nl.indexOf(u);
        const w = nl[(idx - 1 + nl.length) % nl.length];
        u = v;
        v = w;
      }
      if (cycle.length >= 3 && polygonArea(cycle, X, Y) > 0) faces.push(cycle);
    }
  }
  return faces;
}

/**
 * Triangula un polígono simple CCW (puede tener vértices colineales)
 * eligiendo en cada paso la oreja con mejor ángulo mínimo.
 */
export function triangulatePolygon(poly: number[], X: Float64Array, Y: Float64Array): Array<[number, number, number]> | null {
  const tris: Array<[number, number, number]> = [];
  const ring = poly.slice();
  let scale = 0;
  for (const p of ring) scale = Math.max(scale, Math.abs(X[p]), Math.abs(Y[p]));
  const eps = 1e-14 * Math.max(1, scale * scale);
  let guard = 0;
  while (ring.length > 3 && guard++ < 10000) {
    let best = -1;
    let bestQ = -Infinity;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n];
      const b = ring[i];
      const c = ring[(i + 1) % n];
      const ar = orient(X[a], Y[a], X[b], Y[b], X[c], Y[c]);
      if (ar <= eps) continue;
      let ok = true;
      for (let j = 0; j < n; j++) {
        const p = ring[j];
        if (p === a || p === b || p === c) continue;
        if (X[p] === X[a] && Y[p] === Y[a]) continue;
        if (X[p] === X[c] && Y[p] === Y[c]) continue;
        const s0 = orient(X[a], Y[a], X[b], Y[b], X[p], Y[p]);
        const s1 = orient(X[b], Y[b], X[c], Y[c], X[p], Y[p]);
        const s2 = orient(X[c], Y[c], X[a], Y[a], X[p], Y[p]);
        if (s0 >= -eps && s1 >= -eps && s2 >= -eps) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const q = minAngle(X, Y, a, b, c);
      if (q > bestQ) {
        bestQ = q;
        best = i;
      }
    }
    if (best < 0) return null;
    const n2 = ring.length;
    tris.push([ring[(best - 1 + n2) % n2], ring[best], ring[(best + 1) % n2]]);
    ring.splice(best, 1);
  }
  if (ring.length === 3) {
    const [a, b, c] = ring;
    if (orient(X[a], Y[a], X[b], Y[b], X[c], Y[c]) <= eps) return null;
    tris.push([a, b, c]);
  }
  return tris;
}

function minAngle(X: Float64Array, Y: Float64Array, a: number, b: number, c: number): number {
  const ang = (p: number, q: number, r: number) => {
    const ux = X[q] - X[p], uy = Y[q] - Y[p];
    const vx = X[r] - X[p], vy = Y[r] - Y[p];
    return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy);
  };
  return Math.min(ang(a, b, c), ang(b, c, a), ang(c, a, b));
}

/** ¿Punto dentro de polígono? (regla par-impar) */
export function pointInPolygon(x: number, y: number, px: ArrayLike<number>, py: ArrayLike<number>): boolean {
  let inside = false;
  const n = px.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = py[i], yj = py[j];
    if (yi > y !== yj > y) {
      const xi = px[i], xj = px[j];
      if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Distancia de un punto a un polígono cerrado (sus aristas). */
export function distanceToPolyline(x: number, y: number, px: ArrayLike<number>, py: ArrayLike<number>): number {
  let best = Infinity;
  const n = px.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ux = px[j] - px[i], uy = py[j] - py[i];
    const l2 = ux * ux + uy * uy;
    let t = l2 > 0 ? ((x - px[i]) * ux + (y - py[i]) * uy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - px[i] - t * ux, y - py[i] - t * uy);
    if (d < best) best = d;
  }
  return best;
}

/** ¿El polígono cerrado es simple (sin autointersecciones)? */
export function isSimplePolygon(px: ArrayLike<number>, py: ArrayLike<number>): boolean {
  const n = px.length;
  if (n < 3) return false;
  // Grilla para acelerar
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    minx = Math.min(minx, px[i]); maxx = Math.max(maxx, px[i]);
    miny = Math.min(miny, py[i]); maxy = Math.max(maxy, py[i]);
  }
  const G = Math.max(1, Math.ceil(Math.sqrt(n) / 2));
  const cw = (maxx - minx) / G || 1;
  const ch = (maxy - miny) / G || 1;
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = Math.floor((Math.min(px[i], px[j]) - minx) / cw);
    const x1 = Math.floor((Math.max(px[i], px[j]) - minx) / cw);
    const y0 = Math.floor((Math.min(py[i], py[j]) - miny) / ch);
    const y1 = Math.floor((Math.max(py[i], py[j]) - miny) / ch);
    for (let gx = Math.max(0, x0); gx <= Math.min(G, x1); gx++) {
      for (let gy = Math.max(0, y0); gy <= Math.min(G, y1); gy++) {
        const key = gx * (G + 1) + gy;
        let l = cells.get(key);
        if (!l) cells.set(key, (l = []));
        l.push(i);
      }
    }
  }
  for (const list of cells.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a], k = list[b];
        if (Math.abs(i - k) === 1 || Math.abs(i - k) === n - 1) continue;
        const i2 = (i + 1) % n, k2 = (k + 1) % n;
        const d1 = orient(px[k], py[k], px[k2], py[k2], px[i], py[i]);
        const d2 = orient(px[k], py[k], px[k2], py[k2], px[i2], py[i2]);
        const d3 = orient(px[i], py[i], px[i2], py[i2], px[k], py[k]);
        const d4 = orient(px[i], py[i], px[i2], py[i2], px[k2], py[k2]);
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return false;
        if (d1 === 0 && d2 === 0) {
          // Colineales: verificar solapamiento
          const t0 = Math.max(Math.min(px[i], px[i2]), Math.min(px[k], px[k2]));
          const t1 = Math.min(Math.max(px[i], px[i2]), Math.max(px[k], px[k2]));
          const s0 = Math.max(Math.min(py[i], py[i2]), Math.min(py[k], py[k2]));
          const s1 = Math.min(Math.max(py[i], py[i2]), Math.max(py[k], py[k2]));
          if (t0 <= t1 && s0 <= s1) return false;
        }
      }
    }
  }
  return true;
}
