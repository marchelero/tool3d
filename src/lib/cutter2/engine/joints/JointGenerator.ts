import type { IndexedMesh, Vec3 } from '../core/types';
import { GeometryError, NULL_CONTEXT, type TaskContext } from '../core/TaskContext';
import type { SeamInfo } from '../cut/SplitOperation';
import { BooleanGeometryEngine, frameMatrix, type ManifoldObj } from '../boolean/BooleanGeometryEngine';
import { distanceToPolyline, pointInPolygon } from '../cut/polygon2d';
import { TriangleBVH } from '../core/TriangleBVH';

export type JointType = 'none' | 'peg' | 'double-peg' | 'key' | 'dovetail';

export interface ToleranceProfile {
  id: string;
  name: string;
  /** Holgura radial (mm). */
  clearance: number;
  /** Holgura en profundidad (mm). */
  depthClearance: number;
  description: string;
}

/** Perfiles de tolerancia FDM orientativos (boquilla 0,4 mm). Son editables. */
export const TOLERANCE_PROFILES: ToleranceProfile[] = [
  { id: 'pla-firme', name: 'PLA · ajuste firme', clearance: 0.1, depthClearance: 0.3, description: 'Encastre a presión. Requiere buena calibración.' },
  { id: 'pla', name: 'PLA · estándar', clearance: 0.15, depthClearance: 0.4, description: 'Entra con la mano, sin juego visible.' },
  { id: 'petg', name: 'PETG', clearance: 0.2, depthClearance: 0.4, description: 'PETG se expande algo más en las primeras capas.' },
  { id: 'abs', name: 'ABS / ASA', clearance: 0.2, depthClearance: 0.5, description: 'Compensa contracción térmica.' },
  { id: 'tpu', name: 'TPU / flexible', clearance: 0.1, depthClearance: 0.3, description: 'El material cede: se puede ajustar más.' },
  { id: 'holgado', name: 'Holgado (para pegar)', clearance: 0.3, depthClearance: 0.6, description: 'Deja lugar para el adhesivo.' },
];

export interface JointParams {
  type: JointType;
  /** Diámetro del tetón o ancho de la llave / cola (mm). */
  diameter: number;
  /** Profundidad de inserción (mm). */
  depth: number;
  clearance: number;
  depthClearance: number;
  /** Desplazamiento en el plano de la unión respecto del centro sugerido (mm). */
  offsetU: number;
  offsetV: number;
  /** Rotación en el plano (grados) para doble tetón, llave y cola de milano. */
  angle: number;
  /** Inclinación del eje respecto de la normal (grados, 0 = perpendicular). */
  tilt: number;
  /** Pieza que lleva el macho. */
  maleOn: 'extracted' | 'body';
  /** Chaflán de la punta (mm). */
  chamfer: number;
  /** Espesor mínimo de pared que se exige alrededor de la hembra (mm). */
  minWall: number;
}

export interface JointIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface JointResult {
  extracted: IndexedMesh;
  remainder: IndexedMesh;
  /** Caras interiores (superficie de corte, macho y hembra) de cada pieza. */
  extractedCapMask: Uint8Array;
  remainderCapMask: Uint8Array;
  valid: boolean;
  issues: JointIssue[];
  metrics: {
    interferenceVolume: number;
    wallExcessVolume: number;
    maleExcessVolume: number;
    assemblyClear: boolean;
    maleVolume: number;
  };
}

/**
 * Sugerencia de encastre a partir de la geometría real: tamaño de la
 * superficie de unión y espesor de cada pieza medido con rayos.
 */
export function suggestJoint(
  seam: SeamInfo,
  profile: ToleranceProfile = TOLERANCE_PROFILES[1],
  extracted?: IndexedMesh,
  remainder?: IndexedMesh,
): JointParams | null {
  const rho = seam.inradius;
  const margin = 0.9;
  const maxD = 2 * (rho - margin - profile.clearance);
  if (maxD < 2) return null;
  let d = Math.max(2, Math.min(8, maxD, 0.5 * rho * 2 * 0.5));
  let depth = Math.max(2, Math.min(6, d));
  const au = seam.incenter[0], av = seam.incenter[1];
  const anchor: Vec3 = [
    seam.center[0] + au * seam.u[0] + av * seam.v[0],
    seam.center[1] + au * seam.u[1] + av * seam.v[1],
    seam.center[2] + au * seam.u[2] + av * seam.v[2],
  ];
  const N = seam.normal;
  if (remainder) {
    // Espesor del cuerpo detrás de la unión: la hembra no debe pasar del 60 %.
    const tB = thicknessAlong(remainder, anchor, [-N[0], -N[1], -N[2]], seam.maxDeviation);
    if (Number.isFinite(tB)) depth = Math.max(1.5, Math.min(depth, 0.6 * tB - profile.depthClearance));
  }
  if (extracted) {
    // Espesor de la pieza: la base del macho necesita apoyo.
    const tE = thicknessAlong(extracted, anchor, N, seam.maxDeviation);
    if (Number.isFinite(tE) && tE < 2.5) d = Math.min(d, Math.max(2, tE));
  }
  d = Math.floor(d * 2) / 2;
  depth = Math.round(depth * 2) / 2;
  return {
    type: 'peg',
    diameter: d,
    depth,
    clearance: profile.clearance,
    depthClearance: profile.depthClearance,
    offsetU: 0,
    offsetV: 0,
    angle: 0,
    tilt: 0,
    maleOn: 'extracted',
    chamfer: Math.min(0.5, d * 0.12),
    minWall: 1.2,
  };
}

/** Distancia desde el punto (sobre la unión) hasta la superficie exterior de la pieza a lo largo de dir. */
export function thicknessAlong(mesh: IndexedMesh, origin: Vec3, dir: Vec3, skip: number): number {
  const bvh = new TriangleBVH(mesh.positions, mesh.indices);
  const hits = bvh.raycastAll(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], 1e6);
  for (const h of hits) if (h.t > skip + 0.05) return h.t;
  return Infinity;
}

interface Footprint {
  /** Puntos de muestra del contorno de la huella (u, v) que deben quedar dentro. */
  samples: Array<[number, number]>;
}

/**
 * JointGenerator: genera macho y hembra con booleanas reales (Manifold) y
 * valida espesores, interferencias, dirección de ensamblaje y volúmenes.
 */
export async function applyJoint(
  engine: BooleanGeometryEngine,
  extracted: IndexedMesh,
  remainder: IndexedMesh,
  seam: SeamInfo,
  p: JointParams,
  task: TaskContext = NULL_CONTEXT,
  masks: { extracted?: Uint8Array; remainder?: Uint8Array } = {},
): Promise<JointResult> {
  if (p.type === 'none') {
    return {
      extracted, remainder, valid: true, issues: [],
      extractedCapMask: masks.extracted ?? new Uint8Array(extracted.indices.length / 3),
      remainderCapMask: masks.remainder ?? new Uint8Array(remainder.indices.length / 3),
      metrics: { interferenceVolume: 0, wallExcessVolume: 0, maleExcessVolume: 0, assemblyClear: true, maleVolume: 0 },
    };
  }
  const issues: JointIssue[] = [];
  const { Manifold, CrossSection } = engine.wasm;
  const r = p.diameter / 2;
  if (p.diameter < 1.5) issues.push({ severity: 'error', code: 'too-thin', message: 'El encastre es demasiado fino para imprimirse (mínimo 1,5 mm).' });
  if (p.depth < 1) issues.push({ severity: 'error', code: 'too-short', message: 'La profundidad mínima es 1 mm.' });
  if (p.depth / p.diameter > 3) issues.push({ severity: 'warning', code: 'slender', message: 'El tetón es largo y fino: puede quebrarse al ensamblar.' });
  if (p.clearance < 0) issues.push({ severity: 'error', code: 'negative-clearance', message: 'La holgura no puede ser negativa.' });

  // Marco del encastre: Z apunta hacia la pieza que lleva la hembra.
  const N = seam.normal; // desde el cuerpo hacia la pieza extraída
  const zDir: Vec3 = p.maleOn === 'extracted' ? [-N[0], -N[1], -N[2]] : [N[0], N[1], N[2]];
  const ang = (p.angle * Math.PI) / 180;
  const au = seam.incenter[0] + p.offsetU;
  const av = seam.incenter[1] + p.offsetV;
  const anchor: Vec3 = [
    seam.center[0] + au * seam.u[0] + av * seam.v[0],
    seam.center[1] + au * seam.u[1] + av * seam.v[1],
    seam.center[2] + au * seam.u[2] + av * seam.v[2],
  ];
  const W: Vec3 = [
    Math.cos(ang) * seam.u[0] + Math.sin(ang) * seam.v[0],
    Math.cos(ang) * seam.u[1] + Math.sin(ang) * seam.v[1],
    Math.cos(ang) * seam.u[2] + Math.sin(ang) * seam.v[2],
  ];
  // Inclinación: rotar el eje dentro del plano (W, Z)
  const tilt = (p.tilt * Math.PI) / 180;
  const axis: Vec3 = [
    Math.cos(tilt) * zDir[0] + Math.sin(tilt) * W[0],
    Math.cos(tilt) * zDir[1] + Math.sin(tilt) * W[1],
    Math.cos(tilt) * zDir[2] + Math.sin(tilt) * W[2],
  ];
  const M = frameMatrix(anchor, axis, W);
  const dev = seam.maxDeviation;
  const embed = Math.min(Math.max(1.2, dev + 0.8), Math.max(1.2, p.depth));
  const open = dev + 0.6;
  const seg = Math.max(24, Math.min(64, Math.round(p.diameter * 8)));

  // Huella en el plano (u, v) para verificar que entra en la superficie de unión.
  const fp: Footprint = { samples: [] };
  const addCircle = (cu: number, cv: number, rad: number) => {
    for (let i = 0; i < 32; i++) {
      const t = (2 * Math.PI * i) / 32;
      fp.samples.push([cu + rad * Math.cos(t), cv + rad * Math.sin(t)]);
    }
  };
  const wu = Math.cos(ang), wv = Math.sin(ang);
  const spacing = p.diameter + Math.max(2, p.diameter * 0.8);
  const keyLen = Math.max(p.diameter * 2, p.diameter + 3);

  await task.checkpoint('Generando el encastre', 0.1);
  const result = engine.scope((track) => {
    const male = track(buildMale(Manifold, CrossSection, p, r, embed, seg, spacing, keyLen, track));
    const female = track(buildFemale(Manifold, CrossSection, p, r, open, seg, spacing, keyLen, track));
    let maleW = track(male.transform(M));
    const femaleW = track(female.transform(M));
    // Huella de la unión como prisma (para recortar el riel de la cola de milano).
    let footprintW: ManifoldObj | null = null;
    if (p.type === 'dovetail') {
      const pts = seam.outlineX.map((x, i) => [x, seam.outlineY[i]] as [number, number]);
      const fp = track(new CrossSection([pts], 'EvenOdd'));
      const H = p.depth + embed + 4;
      const prism = track(track(fp.extrude(H)).translate([0, 0, -(p.depth + 2)]));
      footprintW = track(prism.transform(frameMatrix(seam.center, seam.normal, seam.u) as never));
      // El riel termina en el borde de la unión: no sobresale de la pieza.
      maleW = track(maleW.intersect(footprintW));
    }

    // Huella
    const rr = r + p.clearance + 0.8;
    if (p.type === 'peg') addCircle(au, av, rr);
    else if (p.type === 'double-peg') {
      addCircle(au + (wu * spacing) / 2, av + (wv * spacing) / 2, rr);
      addCircle(au - (wu * spacing) / 2, av - (wv * spacing) / 2, rr);
    } else if (p.type === 'key') {
      const hl = keyLen / 2 + p.clearance + 0.8, hw = r + p.clearance + 0.8;
      for (const [x, y] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]) fp.samples.push([au + x * wu - y * wv, av + x * wv + y * wu]);
    }
    if (p.type !== 'dovetail') {
      const outside = fp.samples.filter(([u, v]) => !pointInPolygon(u, v, seam.outlineX, seam.outlineY));
      if (outside.length) {
        issues.push({ severity: 'error', code: 'outside-seam', message: 'El encastre no entra en la superficie de unión: reducí el diámetro o movelo hacia el centro.' });
      }
    }

    const maleTag = engine.toManifoldTagged(p.maleOn === 'extracted' ? extracted : remainder, p.maleOn === 'extracted' ? masks.extracted : masks.remainder);
    const femaleTag = engine.toManifoldTagged(p.maleOn === 'extracted' ? remainder : extracted, p.maleOn === 'extracted' ? masks.remainder : masks.extracted);
    const maleSolid = track(maleTag.manifold);
    const femaleSolid = track(femaleTag.manifold);
    const genusM0 = maleSolid.genus();
    const genusF0 = femaleSolid.genus();

    // La parte del macho que va embebida debe quedar dentro de su pieza.
    const embedPart = track(maleW.intersect(track(halfSpaceBox(Manifold, M, -embed - 1, -(dev + 0.05), 400))));
    const maleExcess = track(embedPart.subtract(maleSolid)).volume();
    const tolV = (v: number) => Math.max(0.02, 0.004 * v);
    if (maleExcess > tolV(embedPart.volume())) {
      issues.push({ severity: 'error', code: 'male-pokes-out', message: 'La base del macho sobresale de su pieza: la pieza es muy delgada en esa zona.' });
    }

    // Paredes alrededor de la hembra.
    const shell = track(buildFemaleShell(Manifold, CrossSection, p, r, seg, spacing, keyLen, dev));
    const shellW = track(shell.transform(M));
    const wallExcess = track(shellW.subtract(femaleSolid)).volume();
    if (p.type !== 'dovetail' && wallExcess > tolV(shellW.volume())) {
      issues.push({
        severity: 'error',
        code: 'thin-walls',
        message: `Las paredes alrededor de la hembra quedan con menos de ${p.minWall.toFixed(1)} mm: reducí el diámetro o la profundidad.`,
      });
    }

    if (p.type === 'dovetail') {
      // La cola de milano necesita que el canal salga de la pieza solo dentro de la unión.
      const ext = track(buildDovetailExtension(Manifold, CrossSection, p, r));
      const extW = track(ext.transform(M));
      const beyond = footprintW ? track(extW.subtract(footprintW)) : extW;
      const outsideCut = track(beyond.intersect(femaleSolid)).volume();
      if (outsideCut > 0.05) {
        issues.push({
          severity: 'error',
          code: 'dovetail-blocked',
          message: 'La cola de milano no se puede montar: el canal atravesaría la pieza fuera de la unión. Usá tetón o llave.',
        });
      }
    }

    const maleOut = track(Manifold.union(maleSolid, maleW));
    const femaleOut = track(femaleSolid.subtract(femaleW));
    const inter = track(maleOut.intersect(femaleOut)).volume();
    if (inter > Math.max(0.01, 1e-5 * maleOut.volume())) {
      issues.push({ severity: 'error', code: 'interference', message: `Las piezas se interfieren (${inter.toFixed(2)} mm³). Aumentá la holgura.` });
    }
    if (femaleOut.genus() !== genusF0) {
      issues.push({ severity: 'error', code: 'breakthrough', message: 'La hembra atraviesa la pieza y abre un agujero pasante.' });
    }
    if (maleOut.genus() !== genusM0) {
      issues.push({ severity: 'warning', code: 'male-genus', message: `El macho cambió la topología de su pieza (género ${genusM0} → ${maleOut.genus()}).` });
    }
    for (const m of [maleOut, femaleOut]) {
      if (m.status() !== 'NoError' || m.isEmpty()) {
        issues.push({ severity: 'error', code: 'boolean-error', message: 'La operación booleana no produjo un sólido válido.' });
      }
    }

    // Dirección de ensamblaje: retirar el macho a lo largo del eje.
    let assemblyClear = true;
    if (p.type !== 'dovetail') {
      const travel = p.depth + 1;
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const d = t * travel;
        const moved = track(maleOut.translate([-axis[0] * d, -axis[1] * d, -axis[2] * d]));
        const v = track(moved.intersect(femaleOut)).volume();
        if (v > Math.max(0.05, 1e-4 * maleOut.volume())) {
          assemblyClear = false;
          break;
        }
      }
      if (!assemblyClear) {
        issues.push({ severity: 'error', code: 'assembly-blocked', message: 'La pieza no puede insertarse en línea recta en esa dirección: algo del modelo la bloquea.' });
      }
    }

    const maleRes = engine.fromManifoldTaggedSafe(maleOut, maleTag.id);
    const femaleRes = engine.fromManifoldTaggedSafe(femaleOut, femaleTag.id);
    const repairs = [maleRes.repair, femaleRes.repair].filter((r): r is NonNullable<typeof r> => r !== null);
    if (repairs.length) {
      const removed = repairs.reduce((a, r) => a + r.removedTriangles, 0);
      const tol = Math.max(...repairs.map((r) => r.tolerance));
      issues.push({
        severity: 'info',
        code: 'export-repair',
        message:
          tol === 0
            ? `Se unieron vértices duplicados que dejó la booleana (${removed} triángulos de área nula eliminados); la forma no cambia.`
            : `Se simplificaron detalles de la booleana menores a ${(tol * 1000).toFixed(1)} µm para que el STL no tenga triángulos degenerados.`,
      });
    }
    if (!maleRes.safe || !femaleRes.safe) {
      issues.push({ severity: 'error', code: 'stl-unsafe', message: 'La booleana dejó vértices tan cercanos que el STL tendría triángulos degenerados.' });
    }
    return {
      maleMesh: maleRes.mesh, femaleMesh: femaleRes.mesh, maleMask: maleRes.capMask, femaleMask: femaleRes.capMask,
      metrics: { interferenceVolume: inter, wallExcessVolume: wallExcess, maleExcessVolume: maleExcess, assemblyClear, maleVolume: maleW.volume() },
    };
  });
  await task.checkpoint('Validando el encastre', 0.95);
  const extractedOut = p.maleOn === 'extracted' ? result.maleMesh : result.femaleMesh;
  const remainderOut = p.maleOn === 'extracted' ? result.femaleMesh : result.maleMesh;
  const valid = !issues.some((i) => i.severity === 'error');
  return {
    extracted: extractedOut,
    remainder: remainderOut,
    extractedCapMask: p.maleOn === 'extracted' ? result.maleMask : result.femaleMask,
    remainderCapMask: p.maleOn === 'extracted' ? result.femaleMask : result.maleMask,
    valid,
    issues,
    metrics: result.metrics,
  };
}

/** Permutación cíclica de ejes (x→Y, y→Z, z→X), orden columna. */
const CYCLE = [0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1];

type ManifoldCtor = BooleanGeometryEngine['wasm']['Manifold'];
type CrossSectionCtor = BooleanGeometryEngine['wasm']['CrossSection'];
type Track = <T extends { delete(): void }>(m: T) => T;

/**
 * Macho en coordenadas locales (z desde -embed hasta depth). Cada forma se
 * construye como un único sólido (revolución o envolvente convexa) para no
 * unir caras coplanares, que dejan vértices coincidentes al pasar a STL.
 */
function buildMale(Manifold: ManifoldCtor, CrossSection: CrossSectionCtor, p: JointParams, r: number, embed: number, seg: number, spacing: number, keyLen: number, track: Track): ManifoldObj {
  const ch = Math.max(0, Math.min(p.chamfer, r * 0.5, p.depth * 0.4));
  const peg = (): ManifoldObj => {
    const pts: Array<[number, number]> = ch > 0
      ? [[0, -embed], [r, -embed], [r, p.depth - ch], [r - ch, p.depth], [0, p.depth]]
      : [[0, -embed], [r, -embed], [r, p.depth], [0, p.depth]];
    const cs = track(new CrossSection([pts]));
    return cs.revolve(seg);
  };
  switch (p.type) {
    case 'peg':
      return peg();
    case 'double-peg': {
      const a = track(track(peg()).translate([spacing / 2, 0, 0]));
      const b = track(track(peg()).translate([-spacing / 2, 0, 0]));
      return Manifold.union(a, b);
    }
    case 'key': {
      const h = p.depth + embed - ch;
      const base = track(Manifold.cube([keyLen, 2 * r, h], true).translate([0, 0, h / 2 - embed]));
      if (ch <= 0) return base;
      const top = track(Manifold.cube([Math.max(0.2, keyLen - 2 * ch), Math.max(0.2, 2 * r - 2 * ch), 0.01], true).translate([0, 0, p.depth - 0.005]));
      return Manifold.hull([base, top]);
    }
    case 'dovetail': {
      // Perfil trapezoidal en (y, z): angosto en la base, ancho en la punta; extruido a lo largo de x.
      const L = Math.max(4 * r, 60);
      const grow = Math.tan((15 * Math.PI) / 180) * p.depth;
      const profile = track(new CrossSection([
        [
          [-r, -embed],
          [r, -embed],
          [r, 0],
          [r + grow, p.depth],
          [-r - grow, p.depth],
          [-r, 0],
        ],
      ]));
      // Extruir y permutar ejes: (x, y, z) del perfil → (Y, Z, X) locales.
      const ex = track(track(profile.extrude(L)).translate([0, 0, -L / 2]));
      return ex.transform(CYCLE as never);
    }
    default:
      throw new GeometryError('Tipo de encastre desconocido.', 'joint-type');
  }
}

/** Hembra (macho agrandado por la holgura), desde -open hasta depth + holgura. */
function buildFemale(Manifold: ManifoldCtor, CrossSection: CrossSectionCtor, p: JointParams, r: number, open: number, seg: number, spacing: number, keyLen: number, track: Track): ManifoldObj {
  const rc = r + p.clearance;
  const h = p.depth + p.depthClearance + open;
  const hole = () => track(Manifold.cylinder(h, rc, rc, seg)).translate([0, 0, -open]);
  switch (p.type) {
    case 'peg':
      return hole();
    case 'double-peg': {
      const a = track(track(hole()).translate([spacing / 2, 0, 0]));
      const b = track(track(hole()).translate([-spacing / 2, 0, 0]));
      return Manifold.union(a, b);
    }
    case 'key':
      return Manifold.cube([keyLen + 2 * p.clearance, 2 * rc, h], true).translate([0, 0, h / 2 - open]);
    case 'dovetail': {
      const L = 400;
      const grow = Math.tan((15 * Math.PI) / 180) * p.depth;
      const c = p.clearance;
      const profile = track(new CrossSection([
        [
          [-r - c, -open],
          [r + c, -open],
          [r + c, 0],
          [r + grow + c, p.depth + p.depthClearance],
          [-r - grow - c, p.depth + p.depthClearance],
          [-r - c, 0],
        ],
      ]));
      const ex = track(track(profile.extrude(L)).translate([0, 0, -L / 2]));
      return ex.transform(CYCLE as never);
    }
    default:
      throw new GeometryError('Tipo de encastre desconocido.', 'joint-type');
  }
}

/** Volumen que debe quedar dentro de la pieza hembra (hembra + pared mínima), sin la boca. */
function buildFemaleShell(Manifold: ManifoldCtor, _CS: CrossSectionCtor, p: JointParams, r: number, seg: number, spacing: number, keyLen: number, dev: number): ManifoldObj {
  const w = p.minWall;
  const rc = r + p.clearance + w;
  const z0 = 0.6 + dev;
  const h = p.depth + p.depthClearance + w - z0;
  switch (p.type) {
    case 'double-peg': {
      const a = Manifold.cylinder(h, rc, rc, seg).translate([spacing / 2, 0, z0]);
      const b = Manifold.cylinder(h, rc, rc, seg).translate([-spacing / 2, 0, z0]);
      const u = Manifold.union(a, b);
      a.delete();
      b.delete();
      return u;
    }
    case 'key':
      return Manifold.cube([keyLen + 2 * (p.clearance + w), 2 * rc, h], true).translate([0, 0, z0 + h / 2]);
    case 'dovetail':
      return Manifold.cube([1, 1, 1], true).translate([0, 0, -1000]);
    default:
      return Manifold.cylinder(h, rc, rc, seg).translate([0, 0, z0]);
  }
}

/** Prolongación del canal de la cola de milano fuera de la huella de la unión. */
function buildDovetailExtension(Manifold: ManifoldCtor, CrossSection: CrossSectionCtor, p: JointParams, r: number): ManifoldObj {
  void Manifold;
  const grow = Math.tan((15 * Math.PI) / 180) * p.depth;
  const profile = new CrossSection([
    [
      [-r, 0.4],
      [r, 0.4],
      [r + grow, p.depth],
      [-r - grow, p.depth],
    ],
  ]);
  const ex0 = profile.extrude(400);
  profile.delete();
  const ex = ex0.translate([0, 0, -200]);
  ex0.delete();
  const out = ex.transform(CYCLE as never);
  ex.delete();
  return out;
}

/** Caja local delimitada en z (para separar la parte embebida del macho). */
function halfSpaceBox(Manifold: ManifoldCtor, M: number[], z0: number, z1: number, size: number): ManifoldObj {
  const box = Manifold.cube([size, size, z1 - z0], true).translate([0, 0, (z0 + z1) / 2]);
  const out = box.transform(M as never);
  box.delete();
  return out;
}

/** Distancia mínima de la huella al borde de la unión (para la interfaz). */
export function footprintMargin(seam: SeamInfo, u: number, v: number): number {
  return pointInPolygon(u, v, seam.outlineX, seam.outlineY) ? distanceToPolyline(u, v, seam.outlineX, seam.outlineY) : -distanceToPolyline(u, v, seam.outlineX, seam.outlineY);
}
