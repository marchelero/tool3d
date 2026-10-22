import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { StlData } from "./types";
import { analyzeMesh, computeBounds, weldTriangleSoup } from "./subdivide";

const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_TRIANGLES = 3_000_000;

export interface LoadedStl extends StlData {
  geometry: BufferGeometry;
}

export async function loadStlFile(file: File): Promise<LoadedStl> {
  if (file.size === 0) {
    throw new Error("El archivo está vacío");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("El archivo supera el límite de 120 MB");
  }
  const buffer = await file.arrayBuffer();
  let geometry: BufferGeometry;
  try {
    geometry = new STLLoader().parse(buffer);
  } catch {
    throw new Error("No se pudo interpretar el STL. Verificá que no esté dañado.");
  }
  const attribute = geometry.getAttribute("position");
  if (!attribute || attribute.count < 3) {
    geometry.dispose();
    throw new Error("El STL no contiene triángulos válidos");
  }
  const triangles = Math.floor(attribute.count / 3);
  if (triangles > MAX_TRIANGLES) {
    geometry.dispose();
    throw new Error("El STL supera el límite de 3 millones de triángulos");
  }
  const positions = new Float32Array(attribute.count * 3);
  for (let index = 0; index < attribute.count; index += 1) {
    positions[index * 3] = attribute.getX(index);
    positions[index * 3 + 1] = attribute.getY(index);
    positions[index * 3 + 2] = attribute.getZ(index);
  }
  const bounds = computeBounds(positions);
  const maxDimension = Math.max(bounds.size[0], bounds.size[1], bounds.size[2]);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    geometry.dispose();
    throw new Error("El STL no tiene dimensiones válidas");
  }
  let diagnostics;
  try {
    const welded = weldTriangleSoup(positions);
    diagnostics = analyzeMesh(welded);
  } catch (error) {
    geometry.dispose();
    throw error instanceof Error
      ? error
      : new Error("No se pudo analizar la malla");
  }
  return {
    fileName: file.name,
    fileSize: file.size,
    positions,
    triangles,
    bounds,
    openEdges: diagnostics.openEdges,
    nonManifoldEdges: diagnostics.nonManifoldEdges,
    geometry,
  };
}
