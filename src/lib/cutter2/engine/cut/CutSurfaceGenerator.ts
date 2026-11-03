import type { Vec3 } from '../core/types';
import { GeometryError } from '../core/TaskContext';
import { isSimplePolygon } from './polygon2d';
import { triangulateDomain } from './domainTriangulation';
import { cotanWeights, solveLaplace, uniformWeights } from './laplace';

export type CutMethod = 'planar' | 'curved';

export interface CapOptions {
  method: CutMethod;
  /**
   * Desviación máxima admitida para considerar plano el contorno
   * (relativa al radio equivalente). Por encima, el cierre plano informa.
   */
  planarTolerance?: number;
  /** Abombado opcional del cierre curvo, en mm (+ hacia la normal del plano). */
  bulge?: number;
  /**
   * Conexiones directas prohibidas entre vértices del contorno (índices
   * locales): por ejemplo, pares que ya están unidos por una arista de la
   * malla. La tapa no puede repetir esas aristas sin volverse no-manifold.
   */
  forbidDiagonal?: (i: number, j: number) => boolean;
  /** Puntos de Steiner adicionales en el dominio 2D (refinamiento local). */
  extraPoints?: ReadonlyArray<[number, number]>;
  /**
   * Obstáculo: dada la tapa provisoria, devuelve para cada vértice el
   * intervalo [lo, hi] de alturas admitidas a lo largo de `normal` (medidas
   * desde `origin`), de modo que la tapa quede dentro del material, entre las
   * dos pieles. La corrección mueve los vértices interiores a lo largo de la
   * normal con una deformación armónica suave (los pies sobre el plano no
   * cambian).
   */
  obstacle?: (cap: ObstacleQuery) => { lo: Float64Array; hi: Float64Array };
}

export interface ObstacleQuery {
  positions: Float64Array;
  triangles: Uint32Array;
  boundaryCount: number;
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

export interface CapPlane {
  origin: Vec3;
  normal: Vec3;
  u: Vec3;
  v: Vec3;
}

export interface CapSurface {
  method: CutMethod;
  /** Posiciones: los n primeros son el contorno (mismo orden), luego interiores. */
  positions: Float64Array;
  /** Triángulos locales, CCW respecto de `plane.normal`. */
  triangles: Uint32Array;
  boundaryCount: number;
  plane: CapPlane;
  planarity: { maxDeviation: number; rmsDeviation: number; relative: number; equivalentRadius: number };
  projectionSimple: boolean;
  /**
   * Inclinación (grados) del plano de la tapa respecto de la normal media del
   * contorno. Es 0 salvo que el contorno se pliegue visto desde su normal.
   */
  tiltDeg: number;
  area: number;
  quality: { minAngleDeg: number; maxAspect: number };
  /** Polígono del contorno proyectado (para encastres). */
  outline2D: { x: Float64Array; y: Float64Array };
  /** Coordenadas de dominio de todos los vértices (los n primeros son el contorno). */
  domain: { x: Float64Array; y: Float64Array };
  /** Vértices que el obstáculo tuvo que desplazar, y los que no tenían lugar. */
  obstacle: { moved: number; unresolved: number };
}

/** Plano medio de un contorno cerrado: centroide por longitud y normal de Newell. */
export function fitLoopPlane(loop: Float64Array): { origin: Vec3; normal: Vec3 } {
  const n = loop.length / 3;
  let cx = 0, cy = 0, cz = 0, L = 0, nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = loop[3 * i], ay = loop[3 * i + 1], az = loop[3 * i + 2];
    const bx = loop[3 * j], by = loop[3 * j + 1], bz = loop[3 * j + 2];
    const l = Math.hypot(bx - ax, by - ay, bz - az);
    L += l;
    cx += ((ax + bx) / 2) * l;
    cy += ((ay + by) / 2) * l;
    cz += ((az + bz) / 2) * l;
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  return { origin: [cx / L, cy / L, cz / L], normal: [nx / nl, ny / nl, nz / nl] };
}

interface LoopProjection {
  n: Vec3;
  u: Vec3;
  v: Vec3;
  px: Float64Array;
  py: Float64Array;
  ph: Float64Array;
  area2: number;
  simple: boolean;
}

/** Base ortonormal (u, v) para una normal unitaria. */
function basisFor(n: Vec3): { u: Vec3; v: Vec3 } {
  const [nx, ny, nz] = n;
  let ux: number, uy: number, uz: number;
  if (Math.abs(nx) < 0.9) {
    ux = 0; uy = nz; uz = -ny;
  } else {
    ux = -nz; uy = 0; uz = nx;
  }
  const l = Math.hypot(ux, uy, uz);
  ux /= l; uy /= l; uz /= l;
  return { u: [ux, uy, uz], v: [ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux] };
}

/** Proyecta el contorno sobre el plano (centro, normal) y verifica que sea simple y CCW. */
function projectLoop(loop: Float64Array, cx: number, cy: number, cz: number, n: Vec3): LoopProjection {
  const m = loop.length / 3;
  const { u, v } = basisFor(n);
  const px = new Float64Array(m), py = new Float64Array(m), ph = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const dx = loop[3 * i] - cx, dy = loop[3 * i + 1] - cy, dz = loop[3 * i + 2] - cz;
    px[i] = dx * u[0] + dy * u[1] + dz * u[2];
    py[i] = dx * v[0] + dy * v[1] + dz * v[2];
    ph[i] = dx * n[0] + dy * n[1] + dz * n[2];
  }
  let area2 = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    area2 += px[i] * py[j] - px[j] * py[i];
  }
  return { n, u, v, px, py, ph, area2, simple: area2 > 0 && isSimplePolygon(px, py) };
}

/**
 * Busca, alrededor de la normal media, una dirección desde la que el contorno
 * se proyecte como polígono simple. Prefiere la menor inclinación que tenga
 * margen (las direcciones vecinas también son simples), para no quedar al
 * borde de un pliegue.
 */
function findSimpleProjection(
  loop: Float64Array, cx: number, cy: number, cz: number, n0: Vec3, u0: Vec3, v0: Vec3,
): { proj: LoopProjection; tiltDeg: number } | null {
  const tilts = [4, 8, 12, 16, 20, 25, 30, 35, 40, 45];
  const AZ = 24;
  const grid: Array<Array<LoopProjection | null>> = [];
  for (const t of tilts) {
    const row: Array<LoopProjection | null> = [];
    const th = (t * Math.PI) / 180;
    for (let k = 0; k < AZ; k++) {
      const ph = (2 * Math.PI * k) / AZ;
      const a = Math.sin(th) * Math.cos(ph), b = Math.sin(th) * Math.sin(ph), c = Math.cos(th);
      const d: Vec3 = [c * n0[0] + a * u0[0] + b * v0[0], c * n0[1] + a * u0[1] + b * v0[1], c * n0[2] + a * u0[2] + b * v0[2]];
      const l = Math.hypot(d[0], d[1], d[2]);
      const p = projectLoop(loop, cx, cy, cz, [d[0] / l, d[1] / l, d[2] / l]);
      row.push(p.simple ? p : null);
    }
    grid.push(row);
  }
  const ok = (ti: number, k: number) => ti >= 0 && ti < tilts.length && grid[ti][(k + AZ) % AZ] !== null;
  let fallback: { proj: LoopProjection; tiltDeg: number } | null = null;
  for (let ti = 0; ti < tilts.length; ti++) {
    let best = -1, bestScore = -1;
    for (let k = 0; k < AZ; k++) {
      if (!grid[ti][k]) continue;
      // Margen: vecinos en azimut y en inclinación (hacia afuera) también simples.
      const score = (ok(ti, k - 1) ? 1 : 0) + (ok(ti, k + 1) ? 1 : 0) + (ok(ti + 1, k) ? 1 : 0) + (ok(ti, k - 2) && ok(ti, k + 2) ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best < 0) continue;
    const cand = { proj: grid[ti][best]!, tiltDeg: tilts[ti] };
    if (bestScore >= 3) return cand;
    if (!fallback) fallback = cand;
  }
  return fallback;
}

/**
 * CutSurfaceGenerator: construye la superficie geométrica de separación a
 * partir del contorno aprobado. El contorno no se desplaza: sus vértices
 * son exactamente los del perímetro incrustado en la malla.
 *
 * Método A (plano): plano de Newell + triangulación restringida de calidad;
 * los vértices interiores quedan sobre el plano salvo la interpolación
 * armónica de la desviación del borde.
 *
 * Método B (curvo): membrana mínima (superficie de área mínima discreta,
 * iteraciones de Pinkall–Polthier) que respeta el contorno 3D.
 */
export function generateCap(loop: Float64Array, opts: CapOptions): CapSurface {
  const n = loop.length / 3;
  if (n < 3) throw new GeometryError('El contorno tiene muy pocos puntos.', 'cap-few');
  // Centroide ponderado por longitud y normal de Newell.
  let cx = 0, cy = 0, cz = 0, L = 0;
  let nx = 0, ny = 0, nz = 0;
  const seglen = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = loop[3 * i], ay = loop[3 * i + 1], az = loop[3 * i + 2];
    const bx = loop[3 * j], by = loop[3 * j + 1], bz = loop[3 * j + 2];
    const l = Math.hypot(bx - ax, by - ay, bz - az);
    seglen[i] = l;
    L += l;
    cx += ((ax + bx) / 2) * l;
    cy += ((ay + by) / 2) * l;
    cz += ((az + bz) / 2) * l;
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  cx /= L; cy /= L; cz /= L;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-12 * L * L) throw new GeometryError('El contorno no encierra un área (está plegado sobre sí mismo).', 'cap-flat');
  nx /= nl; ny /= nl; nz /= nl;
  const n0: Vec3 = [nx, ny, nz];
  let proj = projectLoop(loop, cx, cy, cz, n0);
  let tiltDeg = 0;
  if (!proj.simple) {
    // Visto desde la normal media el contorno se pliega (por ejemplo, un tramo
    // sube por el costado de una protuberancia). Buscar la dirección cercana
    // más estable desde la que el contorno se vea como un polígono simple.
    const alt = findSimpleProjection(loop, cx, cy, cz, n0, proj.u, proj.v);
    if (alt) {
      proj = alt.proj;
      tiltDeg = alt.tiltDeg;
    }
  }
  [nx, ny, nz] = proj.n;
  const [ux, uy, uz] = proj.u;
  const [vx, vy, vz] = proj.v;
  const { px, py, ph, area2 } = proj;
  const projArea = Math.abs(area2) / 2;
  const equivalentRadius = Math.sqrt(projArea / Math.PI);
  let maxDev = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    maxDev = Math.max(maxDev, Math.abs(ph[i]));
    sum2 += ph[i] * ph[i];
  }
  const planarity = { maxDeviation: maxDev, rmsDeviation: Math.sqrt(sum2 / n), relative: maxDev / Math.max(equivalentRadius, 1e-12), equivalentRadius };
  const projectionSimple = proj.simple;

  // Espaciado del interior ~ mediana de los tramos del borde
  const sorted = Array.from(seglen).sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)] || L / n;
  const spacing = Math.max(median, L / 4000);

  const plane: CapPlane = { origin: [cx, cy, cz], normal: [nx, ny, nz], u: [ux, uy, uz], v: [vx, vy, vz] };

  let domainX: Float64Array;
  let domainY: Float64Array;
  if (opts.method === 'planar') {
    if (!projectionSimple) {
      throw new GeometryError(
        'El perímetro no se puede cerrar con un plano: desde ninguna dirección cercana a su normal se ve sin superponerse consigo mismo. Usá el cierre curvo o ajustá el perímetro al plano.',
        'cap-planar-fold',
      );
    }
    domainX = px;
    domainY = py;
  } else if (projectionSimple) {
    domainX = px;
    domainY = py;
  } else {
    // Dominio circular parametrizado por longitud de arco.
    const R = L / (2 * Math.PI);
    domainX = new Float64Array(n);
    domainY = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * s) / L;
      domainX[i] = R * Math.cos(th);
      domainY[i] = R * Math.sin(th);
      s += seglen[i];
    }
  }
  const extra: Array<[number, number]> = opts.extraPoints ? opts.extraPoints.map(([x, y]) => [x, y] as [number, number]) : [];
  let dom = triangulateDomain(domainX, domainY, spacing, 60000, extra);
  if (opts.forbidDiagonal) {
    for (let attempt = 0; ; attempt++) {
      const bad: Array<[number, number]> = [];
      const T0 = dom.tris;
      for (let t = 0; t < T0.length / 3; t++) {
        for (let k = 0; k < 3; k++) {
          const a = T0[3 * t + k];
          const b = T0[3 * t + ((k + 1) % 3)];
          if (a >= n || b >= n) continue;
          const d = Math.abs(a - b);
          if (d === 1 || d === n - 1) continue;
          if (a < b && opts.forbidDiagonal(a, b)) bad.push([a, b]);
          else if (b < a && opts.forbidDiagonal(b, a)) bad.push([b, a]);
        }
      }
      if (!bad.length) break;
      if (attempt >= 12) {
        throw new GeometryError('La superficie de corte coincide con aristas de la malla junto al perímetro.', 'cap-forbidden', `${bad.length} diagonales`);
      }
      const seen = new Set<string>();
      for (const [a, b] of bad) {
        const key = `${a}_${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        extra.push([(domainX[a] + domainX[b]) / 2, (domainY[a] + domainY[b]) / 2]);
      }
      dom = triangulateDomain(domainX, domainY, spacing, 60000, extra);
    }
  }
  const N = dom.X.length;
  const pos = new Float64Array(N * 3);
  const fixed = new Uint8Array(N);
  for (let i = 0; i < n; i++) {
    fixed[i] = 1;
    pos[3 * i] = loop[3 * i];
    pos[3 * i + 1] = loop[3 * i + 1];
    pos[3 * i + 2] = loop[3 * i + 2];
  }
  if (domainX === px) {
    // Altura armónica sobre el plano (exactamente plano si el borde lo es).
    const h = new Float64Array(N);
    for (let i = 0; i < n; i++) h[i] = ph[i];
    const flat = new Float64Array(N * 2);
    for (let i = 0; i < N; i++) {
      flat[2 * i] = dom.X[i];
      flat[2 * i + 1] = dom.Y[i];
    }
    solveLaplace(N, fixed, cotanWeights(flat, dom.tris, N, 2), h, 1);
    for (let i = n; i < N; i++) {
      pos[3 * i] = cx + dom.X[i] * ux + dom.Y[i] * vx + h[i] * nx;
      pos[3 * i + 1] = cy + dom.X[i] * uy + dom.Y[i] * vy + h[i] * ny;
      pos[3 * i + 2] = cz + dom.X[i] * uz + dom.Y[i] * vz + h[i] * nz;
    }
  } else {
    // Mapa armónico inicial desde el disco.
    for (let i = n; i < N; i++) {
      pos[3 * i] = cx;
      pos[3 * i + 1] = cy;
      pos[3 * i + 2] = cz;
    }
    solveLaplace(N, fixed, uniformWeights(dom.tris, N), pos, 3);
  }

  if (opts.method === 'curved') {
    if (domainX === px) {
      // Grafo mínimo sobre el plano: iterar pesos cotangentes de la superficie
      // actual moviendo solo la altura. La tapa sigue siendo un grafo (los pies
      // no cambian), así que no se pliega y admite el obstáculo.
      const h = new Float64Array(N);
      const fx = new Float64Array(N), fy = new Float64Array(N), fz = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const hx = (pos[3 * i] - cx) * nx + (pos[3 * i + 1] - cy) * ny + (pos[3 * i + 2] - cz) * nz;
        h[i] = hx;
        fx[i] = pos[3 * i] - hx * nx;
        fy[i] = pos[3 * i + 1] - hx * ny;
        fz[i] = pos[3 * i + 2] - hx * nz;
      }
      for (let it = 0; it < 8; it++) {
        const w = cotanWeights(pos, dom.tris, N, 3);
        solveLaplace(N, fixed, w, h, 1, undefined, 1e-9, 2000);
        for (let i = n; i < N; i++) {
          pos[3 * i] = fx[i] + h[i] * nx;
          pos[3 * i + 1] = fy[i] + h[i] * ny;
          pos[3 * i + 2] = fz[i] + h[i] * nz;
        }
      }
    } else {
      // Superficie mínima discreta libre (dominio de disco): iterar pesos cotangentes.
      for (let it = 0; it < 8; it++) {
        const w = cotanWeights(pos, dom.tris, N, 3);
        solveLaplace(N, fixed, w, pos, 3, undefined, 1e-9, 2000);
      }
    }
    if (opts.bulge && Math.abs(opts.bulge) > 0) {
      // Perfil suave (Poisson con borde nulo) normalizado a 1 en el máximo.
      const phi = new Float64Array(N);
      const src = new Float64Array(N);
      for (let i = n; i < N; i++) src[i] = 1;
      solveLaplace(N, fixed, uniformWeights(dom.tris, N), phi, 1, src);
      let mx = 0;
      for (let i = 0; i < N; i++) mx = Math.max(mx, phi[i]);
      if (mx > 0) {
        for (let i = n; i < N; i++) {
          const d = (opts.bulge * phi[i]) / mx;
          pos[3 * i] += d * nx;
          pos[3 * i + 1] += d * ny;
          pos[3 * i + 2] += d * nz;
        }
      }
    }
  }

  let obstacleStats = { moved: 0, unresolved: 0 };
  if (opts.obstacle && domainX === px && footprintValid(pos, dom.tris, [cx, cy, cz], [ux, uy, uz], [vx, vy, vz])) {
    // Solo si los pies de los vértices sobre el plano forman una triangulación
    // válida: así, moverse a lo largo de la normal no pliega la tapa.
    const b = opts.obstacle({ positions: pos, triangles: dom.tris, boundaryCount: n, origin: [cx, cy, cz], normal: [nx, ny, nz], u: [ux, uy, uz], v: [vx, vy, vz] });
    // Nunca hundir la tapa más que una fracción de su tamaño: si hiciera falta, se refina.
    const maxShift = 0.35 * equivalentRadius + 0.25;
    obstacleStats = applyObstacle(pos, N, n, dom.tris, [cx, cy, cz], [nx, ny, nz], b.lo, b.hi, maxShift);
  }

  // Calidad y área
  let minAng = Math.PI;
  let maxAspect = 1;
  let area = 0;
  const T = dom.tris;
  for (let t = 0; t < T.length / 3; t++) {
    const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2];
    const e = [
      [pos[3 * b] - pos[3 * a], pos[3 * b + 1] - pos[3 * a + 1], pos[3 * b + 2] - pos[3 * a + 2]],
      [pos[3 * c] - pos[3 * b], pos[3 * c + 1] - pos[3 * b + 1], pos[3 * c + 2] - pos[3 * b + 2]],
      [pos[3 * a] - pos[3 * c], pos[3 * a + 1] - pos[3 * c + 1], pos[3 * a + 2] - pos[3 * c + 2]],
    ];
    const l = e.map((v) => Math.hypot(v[0], v[1], v[2]));
    const cr = Math.hypot(e[0][1] * e[2][2] - e[0][2] * e[2][1], e[0][2] * e[2][0] - e[0][0] * e[2][2], e[0][0] * e[2][1] - e[0][1] * e[2][0]);
    area += cr / 2;
    const lmax = Math.max(...l);
    const hmin = cr / lmax;
    if (hmin > 0) maxAspect = Math.max(maxAspect, lmax / hmin);
    for (let k = 0; k < 3; k++) {
      const u = e[k], w = e[(k + 2) % 3];
      const cos = -(u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (l[k] * l[(k + 2) % 3] || 1);
      minAng = Math.min(minAng, Math.acos(Math.max(-1, Math.min(1, cos))));
    }
  }

  return {
    method: opts.method,
    positions: pos,
    triangles: dom.tris,
    boundaryCount: n,
    plane,
    planarity,
    projectionSimple,
    tiltDeg,
    area,
    quality: { minAngleDeg: (minAng * 180) / Math.PI, maxAspect },
    outline2D: { x: px, y: py },
    domain: { x: dom.X, y: dom.Y },
    obstacle: obstacleStats,
  };
}

/** ¿La proyección de la tapa sobre el plano conserva la orientación de todos los triángulos? */
function footprintValid(pos: Float64Array, tris: Uint32Array, o: Vec3, u: Vec3, v: Vec3): boolean {
  const X = (i: number) => (pos[3 * i] - o[0]) * u[0] + (pos[3 * i + 1] - o[1]) * u[1] + (pos[3 * i + 2] - o[2]) * u[2];
  const Y = (i: number) => (pos[3 * i] - o[0]) * v[0] + (pos[3 * i + 1] - o[1]) * v[1] + (pos[3 * i + 2] - o[2]) * v[2];
  for (let t = 0; t < tris.length / 3; t++) {
    const a = tris[3 * t], b = tris[3 * t + 1], c = tris[3 * t + 2];
    const ax = X(a), ay = Y(a);
    if ((X(b) - ax) * (Y(c) - ay) - (Y(b) - ay) * (X(c) - ax) <= 0) return false;
  }
  return true;
}

/**
 * Lleva los vértices interiores dentro del intervalo admitido por el
 * obstáculo. Conjunto activo: los vértices que violan quedan fijos en el
 * límite y el resto se deforma con una corrección armónica (cero en el
 * contorno), que conserva la forma lejos del contacto.
 */
function applyObstacle(
  pos: Float64Array, N: number, nb: number, tris: Uint32Array, origin: Vec3, normal: Vec3,
  lo: Float64Array, hi: Float64Array, maxShift: number,
): { moved: number; unresolved: number } {
  const [ox, oy, oz] = origin;
  const [nx, ny, nz] = normal;
  const h0 = new Float64Array(N);
  for (let i = nb; i < N; i++) {
    h0[i] = (pos[3 * i] - ox) * nx + (pos[3 * i + 1] - oy) * ny + (pos[3 * i + 2] - oz) * nz;
  }
  const active = new Uint8Array(N);
  const target = new Float64Array(N);
  for (let i = 0; i < nb; i++) active[i] = 1; // contorno: corrección nula
  const weights = uniformWeights(tris, N);
  const d = new Float64Array(N);
  let unresolved = 0;
  for (let round = 0; round < 12; round++) {
    let added = 0;
    for (let i = nb; i < N; i++) {
      if (active[i]) continue;
      const h = h0[i] + d[i];
      if (h > hi[i] + 1e-12 || h < lo[i] - 1e-12) {
        active[i] = 1;
        let tgt = lo[i] > hi[i] ? (lo[i] + hi[i]) / 2 : h > hi[i] ? hi[i] : lo[i];
        tgt = Math.max(h0[i] - maxShift, Math.min(h0[i] + maxShift, tgt));
        target[i] = tgt;
        if (lo[i] > hi[i]) unresolved++;
        added++;
      }
    }
    if (!added) break;
    d.fill(0);
    for (let i = nb; i < N; i++) if (active[i]) d[i] = target[i] - h0[i];
    solveLaplace(N, active, weights, d, 1);
  }
  let moved = 0;
  for (let i = nb; i < N; i++) {
    if (d[i] === 0) continue;
    if (active[i]) moved++;
    pos[3 * i] += d[i] * nx;
    pos[3 * i + 1] += d[i] * ny;
    pos[3 * i + 2] += d[i] * nz;
  }
  return { moved, unresolved };
}
