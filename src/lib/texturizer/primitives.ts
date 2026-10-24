import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  SphereGeometry,
} from "three";
import type { LoadedStl } from "./load-stl";
import { analyzeMesh, computeBounds, weldTriangleSoup } from "./subdivide";

export type PrimitiveKind = "cube" | "sphere" | "pyramid";

export const PRIMITIVE_LABELS: Record<PrimitiveKind, string> = {
  cube: "Cubo",
  sphere: "Esfera",
  pyramid: "Pirámide",
};

const DEFAULT_SIZE_MM = 30;
const SPHERE_WIDTH_SEGMENTS = 64;
const SPHERE_HEIGHT_SEGMENTS = 32;

function geometryToSoup(geometry: BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const positions = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const source = index ? index.getX(vertex) : vertex;
    positions[vertex * 3] = position.getX(source);
    positions[vertex * 3 + 1] = position.getY(source);
    positions[vertex * 3 + 2] = position.getZ(source);
  }
  return positions;
}

function geometryFromSoup(positions: Float32Array): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildPyramid(sizeMm: number): Float32Array {
  const half = sizeMm / 2;
  const height = sizeMm;
  const vertices = [
    -half, -half, 0,
    half, -half, 0,
    half, half, 0,
    -half, half, 0,
    0, 0, height,
  ];
  const faces = [
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
    0, 2, 1,
    0, 3, 2,
  ];
  const positions = new Float32Array(faces.length * 3);
  for (let index = 0; index < faces.length; index += 1) {
    const source = faces[index] * 3;
    positions[index * 3] = vertices[source];
    positions[index * 3 + 1] = vertices[source + 1];
    positions[index * 3 + 2] = vertices[source + 2];
  }
  return positions;
}

export function createPrimitive(
  kind: PrimitiveKind,
  sizeMm = DEFAULT_SIZE_MM
): LoadedStl {
  let geometry: BufferGeometry;
  let positions: Float32Array;

  if (kind === "cube") {
    geometry = new BoxGeometry(sizeMm, sizeMm, sizeMm);
    positions = geometryToSoup(geometry);
  } else if (kind === "sphere") {
    geometry = new SphereGeometry(
      sizeMm / 2,
      SPHERE_WIDTH_SEGMENTS,
      SPHERE_HEIGHT_SEGMENTS
    );
    positions = geometryToSoup(geometry);
  } else {
    positions = buildPyramid(sizeMm);
    geometry = geometryFromSoup(positions);
  }

  const bounds = computeBounds(positions);
  const diagnostics = analyzeMesh(weldTriangleSoup(positions));
  return {
    fileName: `${PRIMITIVE_LABELS[kind]} ${sizeMm} mm.stl`,
    fileSize: 0,
    positions,
    triangles: positions.length / 9,
    bounds,
    openEdges: diagnostics.openEdges,
    nonManifoldEdges: diagnostics.nonManifoldEdges,
    geometry,
  };
}
