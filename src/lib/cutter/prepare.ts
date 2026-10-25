import { buildShapeRings } from "@/lib/3d/shapes";
import { computeBounds } from "@/lib/mesh/bounds";
import { repairMesh } from "@/lib/mesh/repair";
import { analyzeMesh } from "@/lib/mesh/topology";
import type { MeshData, RepairResult } from "@/lib/mesh/types";
import type {
  CutAxis,
  CutOp,
  CutPart,
  CutSpec,
  CutterPartView,
  LoadedModel,
} from "./types";

export function planeNormal(axis: CutAxis): [number, number, number] {
  if (axis === "x") return [1, 0, 0];
  if (axis === "y") return [0, 1, 0];
  return [0, 0, 1];
}

export function planeNormalOf(
  op: Extract<CutOp, { kind: "plane" }>
): [number, number, number] {
  const normal = op.normal ?? planeNormal(op.axis);
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

function shapeSpec(op: Extract<CutOp, { kind: "shape" }>, model: LoadedModel): CutSpec {
  const bounds = model.bounds;
  const rings = buildShapeRings(op.shape, {
    widthMm: op.width,
    heightMm: op.height,
    cornerMm: Math.min(op.width, op.height) * 0.12,
    starPoints: 5,
    starInnerRatio: 0.45,
  });
  const ring = rings[0];
  if (!ring || ring.length < 3) {
    throw new Error("La forma elegida no tiene un contorno válido");
  }
  const angle = (op.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [centerX, centerY] = bounds.center;
  const transformed = ring.map(([x, y]) => {
    const rotatedX = x * cos - y * sin;
    const rotatedY = x * sin + y * cos;
    return [centerX + rotatedX + op.offsetX, centerY + rotatedY + op.offsetY] as [
      number,
      number
    ];
  });
  const margin = Math.max(2, Math.max(...bounds.size) * 0.06);
  return {
    kind: "shape",
    ring: transformed,
    zMin: bounds.min[2] - margin,
    zMax: bounds.max[2] + margin,
  };
}

export function opsToSpecs(ops: CutOp[], model: LoadedModel): CutSpec[] {
  return ops
    .filter((op) => op.enabled)
    .map((op): CutSpec => {
      if (op.kind === "plane") {
        return {
          kind: "plane",
          normal: planeNormalOf(op),
          offset: op.offset,
          joint: op.joint,
        };
      }
      if (op.kind === "curve") {
        return {
          kind: "curve",
          axis: op.axis,
          offset: op.offset,
          amplitude: op.amplitude,
          wavelength: op.wavelength,
          phase: op.phase,
        };
      }
      if (op.kind === "components") {
        return { kind: "components" };
      }
      if (op.kind === "region") {
        return {
          kind: "region",
          axis: op.axis,
          rings: op.rings,
          min: op.min,
          max: op.max,
        };
      }
      return shapeSpec(op, model);
    });
}

export function finalizeParts(parts: CutPart[]): CutterPartView[] {
  return parts.map((part) => ({
    id: part.id,
    name: part.name,
    mesh: part.mesh,
    color: part.color,
    volume: part.volume,
    diagnostics: analyzeMesh(part.mesh),
  }));
}

export function singlePart(model: {
  mesh: MeshData;
  diagnostics: ReturnType<typeof analyzeMesh>;
}): CutterPartView {
  return {
    id: "0",
    name: "Pieza 1",
    mesh: model.mesh,
    color: "#7dd3fc",
    volume: model.diagnostics.volume,
    diagnostics: model.diagnostics,
  };
}

export function repairModel(mesh: MeshData): RepairResult {
  return repairMesh(mesh);
}

export function partBounds(part: CutterPartView) {
  return computeBounds(part.mesh.vertices);
}
