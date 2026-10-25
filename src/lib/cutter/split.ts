import type { Manifold, ManifoldToplevel, Mat4 } from "manifold-3d";
import { computeBounds } from "@/lib/mesh/bounds";
import type { MeshData, MeshBounds } from "@/lib/mesh/types";
import type { CutPart, CutSpec } from "./types";

export const PART_COLORS = [
  "#7dd3fc",
  "#fca5a5",
  "#fcd34d",
  "#86efac",
  "#c4b5fd",
  "#fdba74",
  "#f9a8d4",
  "#5eead4",
];

interface WorkingPart {
  manifold: Manifold;
  id: string;
}

function copyManifoldMesh(manifold: Manifold): MeshData {
  const source = manifold.getMesh();
  const vertexCount = source.vertProperties.length / source.numProp;
  const vertices = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    const base = index * source.numProp;
    vertices[index * 3] = source.vertProperties[base];
    vertices[index * 3 + 1] = source.vertProperties[base + 1];
    vertices[index * 3 + 2] = source.vertProperties[base + 2];
  }
  return { vertices, faces: new Uint32Array(source.triVerts) };
}

function signedArea(points: [number, number][]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function ccw(points: [number, number][]): [number, number][] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

function planeSplits(vertices: Float32Array, normal: [number, number, number], offset: number): boolean {
  const [nx, ny, nz] = normal;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 3) {
    const projection =
      vertices[index] * nx +
      vertices[index + 1] * ny +
      vertices[index + 2] * nz;
    if (projection < minimum) minimum = projection;
    if (projection > maximum) maximum = projection;
  }
  const margin = Math.max(1e-6, (maximum - minimum) * 1e-6);
  return offset > minimum + margin && offset < maximum - margin;
}

function buildCurveCutter(
  wasm: ManifoldToplevel,
  op: Extract<CutSpec, { kind: "curve" }>,
  bounds: MeshBounds
): Manifold {
  const { CrossSection } = wasm;
  const [minX, minY, minZ] = bounds.min;
  const [sizeX, sizeY, sizeZ] = bounds.size;
  const [centerX, centerY] = bounds.center;
  const margin = Math.max(2, Math.max(sizeX, sizeY, sizeZ) * 0.06);
  const amplitude = Math.abs(op.amplitude);
  const wavelength = Math.max(0.5, op.wavelength);
  const bottom = minZ - margin;

  let height: number;
  const points: [number, number][] = [];
  if (op.axis === "x") {
    const start = minX - margin;
    const end = bounds.max[0] + margin;
    const segments = 120;
    for (let index = 0; index <= segments; index += 1) {
      const x = start + ((end - start) * index) / segments;
      const z =
        op.offset +
        amplitude * Math.sin(((x - minX) / wavelength) * Math.PI * 2 + op.phase);
      points.push([x, z]);
    }
    points.push([end, bottom], [start, bottom]);
    height = sizeY + margin * 2;
  } else {
    const start = minY - margin;
    const end = bounds.max[1] + margin;
    const segments = 120;
    for (let index = 0; index <= segments; index += 1) {
      const y = start + ((end - start) * index) / segments;
      const z =
        op.offset +
        amplitude * Math.sin(((y - minY) / wavelength) * Math.PI * 2 + op.phase);
      points.push([-z, y]);
    }
    points.push([-bottom, end], [-bottom, start]);
    height = sizeX + margin * 2;
  }

  const section = CrossSection.ofPolygons([ccw(points)]);
  const extruded = section.extrude(height, 0, 0, [1, 1], true);
  section.delete();
  const rotated =
    op.axis === "x"
      ? extruded.rotate([90, 0, 0])
      : extruded.rotate([0, 90, 0]);
  extruded.delete();
  const translated =
    op.axis === "x"
      ? rotated.translate([0, centerY, 0])
      : rotated.translate([centerX, 0, 0]);
  rotated.delete();
  return translated;
}

function buildShapeCutter(
  wasm: ManifoldToplevel,
  op: Extract<CutSpec, { kind: "shape" }>
): Manifold {
  const { CrossSection } = wasm;
  if (op.ring.length < 3) {
    throw new Error("La forma del corte no tiene contorno suficiente");
  }
  const section = CrossSection.ofPolygons([ccw(op.ring)]);
  const height = Math.max(1, op.zMax - op.zMin);
  const extruded = section.extrude(height, 0, 0, [1, 1], true);
  section.delete();
  const translated = extruded.translate([0, 0, (op.zMin + op.zMax) / 2]);
  extruded.delete();
  return translated;
}

function affineMatrix(
  xAxis: [number, number, number],
  yAxis: [number, number, number],
  zAxis: [number, number, number],
  origin: [number, number, number]
): Mat4 {
  return [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    zAxis[0], zAxis[1], zAxis[2], 0,
    origin[0], origin[1], origin[2], 1,
  ];
}

function buildRegionCutter(
  wasm: ManifoldToplevel,
  op: Extract<CutSpec, { kind: "region" }>
): Manifold {
  const { CrossSection } = wasm;
  const rings = op.rings.filter(
    (ring) => ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-9
  );
  if (rings.length === 0) {
    throw new Error("La zona seleccionada no tiene un borde cerrado");
  }
  const height = op.max - op.min;
  if (!Number.isFinite(height) || height <= 1e-9) {
    throw new Error("La zona seleccionada no tiene una profundidad válida");
  }
  const section = CrossSection.ofPolygons(rings, "EvenOdd");
  if (section.isEmpty() || section.area() <= 1e-9) {
    section.delete();
    throw new Error("La zona seleccionada no tiene una superficie válida");
  }
  const extruded = section.extrude(height, 0, 0, [1, 1], true);
  section.delete();
  const middle = (op.min + op.max) / 2;
  const mapping: Mat4 =
    op.axis === "x"
      ? affineMatrix([0, 1, 0], [0, 0, 1], [1, 0, 0], [middle, 0, 0])
      : op.axis === "y"
        ? affineMatrix([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, middle, 0])
        : affineMatrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, middle]);
  const positioned = extruded.transform(mapping);
  extruded.delete();
  return positioned;
}

function applyPlaneJoint(
  wasm: ManifoldToplevel,
  positive: Manifold,
  negative: Manifold,
  spec: Extract<CutSpec, { kind: "plane" }>
): [Manifold, Manifold] | null {
  const joint = spec.joint;
  if (!joint) return null;
  const axis = spec.normal
    .map((value) => Math.abs(value))
    .reduce((best, value, index, all) => (value > all[best] ? index : best), 0);
  if (Math.abs(spec.normal[axis]) < 0.999) return null;
  const otherAxes = [0, 1, 2].filter((index) => index !== axis);
  const positiveBox = positive.boundingBox();
  const negativeBox = negative.boundingBox();
  const overlaps = otherAxes
    .map((index) => ({
      index,
      minimum: Math.max(positiveBox.min[index], negativeBox.min[index]),
      maximum: Math.min(positiveBox.max[index], negativeBox.max[index]),
    }))
    .map((entry) => ({ ...entry, width: entry.maximum - entry.minimum }))
    .sort((left, right) => right.width - left.width);
  if (overlaps[1].width < 2.4) return null;
  const minimumWidth = overlaps[1].width;
  const radius = Math.min(joint.diameter / 2, (minimumWidth - 2.4) / 2);
  if (radius < 1) return null;
  const thickness = Math.min(
    positiveBox.max[axis] - positiveBox.min[axis],
    negativeBox.max[axis] - negativeBox.min[axis]
  );
  const length = Math.min(joint.length, thickness * 0.4, 8);
  if (length < 1.5) return null;

  const spread = overlaps[0];
  const cross = overlaps[1];
  const crossCenter = (cross.minimum + cross.maximum) / 2;
  const direction = spec.normal[axis] >= 0 ? 1 : -1;

  if (joint.variant === "dovetail") {
    const crossThickness = Math.max(1, 2 * radius);
    const availableWidth = spread.width - 2.4;
    const tipWidth = Math.min(joint.diameter * 1.15, availableWidth);
    const baseWidth = tipWidth * 0.66;
    if (tipWidth < 3 || baseWidth < 1.5) return null;
    const edgeWidth = 1.2 + tipWidth / 2;
    const low = spread.minimum + edgeWidth;
    const high = spread.maximum - edgeWidth;
    if (high < low) return null;
    const requested = Math.max(1, Math.min(4, Math.round(joint.count ?? 1)));
    const capacity = Math.max(
      1,
      Math.floor((high - low) / (tipWidth + 1.2)) + 1
    );
    const count = Math.min(requested, capacity);
    const centers: number[] = [];
    for (let index = 0; index < count; index += 1) {
      centers.push(
        count === 1
          ? (low + high) / 2
          : low + ((high - low) * index) / (count - 1)
      );
    }
    const overlap = Math.min(1, length * 0.25);
    const inset = Math.max(0.6, joint.clearance);
    const slope = (tipWidth - baseWidth) / 2 / length;
    const cavityHalfBase = baseWidth / 2 - slope * inset + joint.clearance;
    const cavityHalfTip = tipWidth / 2 + slope * inset + joint.clearance;

    const buildPrism = (
      halfBase: number,
      halfTip: number,
      start: number,
      end: number,
      depth: number,
      spreadCenter: number
    ): Manifold => {
      const points = ccw([
        [-halfBase, start],
        [halfBase, start],
        [halfTip, end],
        [-halfTip, end],
      ]);
      const section = wasm.CrossSection.ofPolygons([points]);
      const extruded = section.extrude(depth, 0, 0, [1, 1], true);
      section.delete();
      const spreadAxis: [number, number, number] = [0, 0, 0];
      spreadAxis[spread.index] = 1;
      const depthAxis: [number, number, number] = [0, 0, 0];
      depthAxis[axis] = -direction;
      const crossAxis: [number, number, number] = [
        spreadAxis[1] * depthAxis[2] - spreadAxis[2] * depthAxis[1],
        spreadAxis[2] * depthAxis[0] - spreadAxis[0] * depthAxis[2],
        spreadAxis[0] * depthAxis[1] - spreadAxis[1] * depthAxis[0],
      ];
      const origin: [number, number, number] = [0, 0, 0];
      origin[axis] = spec.offset;
      origin[spread.index] = spreadCenter;
      origin[cross.index] = crossCenter;
      const placed = extruded.transform(
        affineMatrix(spreadAxis, depthAxis, crossAxis, origin)
      );
      extruded.delete();
      return placed;
    };

    let union = positive;
    let drilled = negative;
    let ownsUnion = false;
    let ownsDrilled = false;
    for (const spreadCenter of centers) {
      const tab = buildPrism(
        baseWidth / 2,
        tipWidth / 2,
        -overlap,
        length,
        crossThickness,
        spreadCenter
      );
      const nextUnion = union.add(tab);
      tab.delete();
      if (ownsUnion) union.delete();
      if (nextUnion.status() !== "NoError" || nextUnion.volume() <= 0) {
        nextUnion.delete();
        if (ownsDrilled) drilled.delete();
        return null;
      }
      union = nextUnion;
      ownsUnion = true;

      const cavity = buildPrism(
        cavityHalfBase,
        cavityHalfTip,
        -inset,
        length + inset,
        crossThickness + joint.clearance * 2,
        spreadCenter
      );
      const nextDrilled = drilled.subtract(cavity);
      cavity.delete();
      if (ownsDrilled) drilled.delete();
      if (nextDrilled.status() !== "NoError" || nextDrilled.volume() <= 0) {
        nextDrilled.delete();
        if (ownsUnion) union.delete();
        return null;
      }
      drilled = nextDrilled;
      ownsDrilled = true;
    }
    positive.delete();
    negative.delete();
    return [union, drilled];
  }

  const edge = 1.2 + radius;
  const low = spread.minimum + edge;
  const high = spread.maximum - edge;
  if (high < low) return null;
  const requested = Math.max(1, Math.min(4, Math.round(joint.count ?? 1)));
  const capacity = Math.max(
    1,
    Math.floor((high - low) / (3 * Math.max(joint.diameter, 2))) + 1
  );
  const count = Math.min(requested, capacity);
  const centers: number[] = [];
  for (let index = 0; index < count; index += 1) {
    centers.push(
      count === 1 ? (low + high) / 2 : low + ((high - low) * index) / (count - 1)
    );
  }

  const makeSolid = (
    height: number,
    cylinderRadius: number,
    alongAxis: number,
    spreadCenter: number,
    clear: number
  ): Manifold => {
    let solid = wasm.Manifold.cylinder(
      height,
      cylinderRadius,
      cylinderRadius,
      32,
      true
    );
    if (axis === 0) {
      const rotated = solid.rotate([0, 90, 0]);
      solid.delete();
      solid = rotated;
    } else if (axis === 1) {
      const rotated = solid.rotate([90, 0, 0]);
      solid.delete();
      solid = rotated;
    }
    const position: [number, number, number] = [0, 0, 0];
    position[axis] = alongAxis;
    position[spread.index] = spreadCenter;
    position[cross.index] = crossCenter;
    if (joint.variant === "keyed") {
      const sizes: [number, number, number] = [0, 0, 0];
      sizes[axis] = height;
      sizes[spread.index] = cylinderRadius * 3.2 + clear * 2;
      sizes[cross.index] = cylinderRadius * 1.1 + clear * 2;
      const key = wasm.Manifold.cube(sizes, true);
      const placed = key.translate(position);
      key.delete();
      const merged = solid.add(placed);
      placed.delete();
      solid.delete();
      solid = merged;
    }
    return solid.translate(position);
  };

  let union = positive;
  let drilled = negative;
  let ownsUnion = false;
  let ownsDrilled = false;
  for (const spreadCenter of centers) {
    const peg = makeSolid(
      length + 1,
      radius,
      spec.offset + length / 2,
      spreadCenter, 0
    );
    const nextUnion = union.add(peg);
    peg.delete();
    if (ownsUnion) union.delete();
    if (nextUnion.status() !== "NoError" || nextUnion.volume() <= 0) {
      nextUnion.delete();
      if (ownsDrilled) drilled.delete();
      return null;
    }
    union = nextUnion;
    ownsUnion = true;

    const hole = makeSolid(
      length + 1.2,
      radius + joint.clearance,
      spec.offset - length / 2,
      spreadCenter, joint.clearance
    );
    const nextDrilled = drilled.subtract(hole);
    hole.delete();
    if (ownsDrilled) drilled.delete();
    if (nextDrilled.status() !== "NoError" || nextDrilled.volume() <= 0) {
      nextDrilled.delete();
      union.delete();
      return null;
    }
    drilled = nextDrilled;
    ownsDrilled = true;
  }
  positive.delete();
  negative.delete();
  return [union, drilled];
}

export function cutMesh(
  wasm: ManifoldToplevel,
  input: MeshData,
  ops: CutSpec[],
  onProgress?: (progress: number) => void,
  onWarning?: (message: string) => void
): CutPart[] {
  const { Manifold, Mesh } = wasm;
  const sourceMesh = new Mesh({
    numProp: 3,
    vertProperties: input.vertices,
    triVerts: input.faces,
  });
  const bounds = computeBounds(input.vertices);

  let parts: WorkingPart[];
  try {
    const root = Manifold.ofMesh(sourceMesh);
    if (root.status() !== "NoError") {
      root.delete();
      throw new Error("La malla no es un sólido cerrado y orientado");
    }
    parts = [{ manifold: root, id: "0" }];
  } catch (error) {
    if (error instanceof Error && error.message.includes("cerrado")) {
      throw error;
    }
    throw new Error(
      "El motor no pudo interpretar la malla. Reparala o probá con otro archivo."
    );
  }

  let splitIndex = 0;
  let opIndex = 0;

  try {
  for (const op of ops) {
    if (op.kind === "components") {
      const next: WorkingPart[] = [];
      for (const part of parts) {
        const shells = part.manifold.decompose();
        part.manifold.delete();
        for (const shell of shells) {
          if (shell.numTri() === 0 || shell.volume() <= 1e-9) {
            shell.delete();
            continue;
          }
          splitIndex += 1;
          next.push({ manifold: shell, id: `${part.id}-${splitIndex}` });
        }
      }
      parts = next;
      opIndex += 1;
      onProgress?.(0.45 + (0.45 * opIndex) / Math.max(1, ops.length));
      continue;
    }
    let cutter: Manifold | null = null;
      if (op.kind === "curve") {
        cutter = buildCurveCutter(wasm, op, bounds);
      } else if (op.kind === "shape") {
        cutter = buildShapeCutter(wasm, op);
      } else if (op.kind === "region") {
        cutter = buildRegionCutter(wasm, op);
      }

      const next: WorkingPart[] = [];
      for (const part of parts) {
        if (op.kind === "plane") {
          const mesh = part.manifold.getMesh();
          if (!planeSplits(mesh.vertProperties, op.normal, op.offset)) {
            next.push(part);
            continue;
          }
        }

        let [positive, negative] =
          op.kind === "plane"
            ? part.manifold.splitByPlane(op.normal, op.offset)
            : part.manifold.split(cutter as Manifold);
        if (positive.status() !== "NoError" || negative.status() !== "NoError") {
          positive.delete();
          negative.delete();
          throw new Error("El motor no pudo completar el corte");
        }

        part.manifold.delete();
        if (op.kind === "plane" && op.joint) {
          const jointed = applyPlaneJoint(wasm, positive, negative, op);
          if (jointed) {
            [positive, negative] = jointed;
          } else {
            onWarning?.(
              `No se pudo colocar el encastre del plano ${
                op.normal[0] !== 0 ? "X" : op.normal[1] !== 0 ? "Y" : "Z"
              }: la pieza es demasiado angosta o fina en esa cara.`
            );
          }
        }
        for (const piece of [positive, negative]) {
          if (piece.numTri() === 0 || piece.volume() <= 1e-9) {
            piece.delete();
            continue;
          }
          splitIndex += 1;
          next.push({ manifold: piece, id: `${part.id}-${splitIndex}` });
        }
      }
      cutter?.delete();
      parts = next;
      opIndex += 1;
      onProgress?.(0.45 + (0.45 * opIndex) / Math.max(1, ops.length));
    }

    const colored = parts
      .map((part) => ({ part, volume: part.manifold.volume() }))
      .sort((left, right) => right.volume - left.volume);

    return colored.map(({ part, volume }, index) => ({
      id: part.id,
      name: `Pieza ${index + 1}`,
      mesh: copyManifoldMesh(part.manifold),
      volume,
      color: PART_COLORS[index % PART_COLORS.length],
    }));
  } finally {
    for (const part of parts) part.manifold.delete();
  }
}

export { cutMesh as splitMesh };
