import type { IndexedMesh } from '../core/types';
import { GeometryError } from '../core/TaskContext';
import { parseSTL } from './stl';
import { parse3MF } from './threemf';
import { repairMesh, weldTriangleSoup } from './weld';

export type ModelFormat = 'stl-binary' | 'stl-ascii' | '3mf';

export interface ImportedModel {
  fileName: string;
  format: ModelFormat;
  mesh: IndexedMesh;
  /** Triángulos en el archivo antes de soldar. */
  fileTriangleCount: number;
  objectNames: string[];
  warnings: string[];
}

/**
 * ModelImporter: detecta el formato, lee el archivo y suelda vértices
 * coincidentes. No modifica la forma: solo quita triángulos que no aportan
 * volumen y rompen la topología (repetidos y aletas colgantes).
 */
export function importModel(fileName: string, buffer: ArrayBuffer): ImportedModel {
  const bytes = new Uint8Array(buffer);
  const lower = fileName.toLowerCase();
  const isZip = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const warnings: string[] = [];
  let soup: Float32Array | Float64Array;
  let format: ModelFormat;
  let fileTriangleCount: number;
  let objectNames: string[] = [];
  if (lower.endsWith('.3mf') || isZip) {
    const r = parse3MF(buffer);
    soup = r.soup;
    format = '3mf';
    fileTriangleCount = r.triangleCount;
    objectNames = r.objectNames;
    warnings.push(...r.warnings);
  } else if (lower.endsWith('.stl') || !isZip) {
    const r = parseSTL(buffer);
    soup = r.soup;
    format = r.format === 'binary' ? 'stl-binary' : 'stl-ascii';
    fileTriangleCount = r.triangleCount;
    warnings.push(...r.warnings);
  } else {
    throw new GeometryError('Formato no soportado. Usá STL o 3MF.', 'format');
  }
  const welded = weldTriangleSoup(soup);
  if (welded.droppedDegenerate > 0) {
    warnings.push(`Se ignoraron ${welded.droppedDegenerate} triángulos degenerados (vértices repetidos).`);
  }
  if (welded.droppedNonFinite > 0) {
    warnings.push(`Se ignoraron ${welded.droppedNonFinite} triángulos con coordenadas inválidas.`);
  }
  if (welded.mesh.indices.length === 0) {
    throw new GeometryError('El modelo no contiene triángulos válidos.', 'empty');
  }
  const repaired = repairMesh(welded.mesh);
  if (repaired.droppedDuplicate > 0) {
    warnings.push(`Se quitaron ${repaired.droppedDuplicate} triángulos repetidos (caras duplicadas, sin volumen propio).`);
  }
  if (repaired.droppedFins > 0) {
    warnings.push(`Se quitaron ${repaired.droppedFins} triángulos sueltos que colgaban de una arista (aletas sin volumen).`);
  }
  if (repaired.mesh.indices.length === 0) {
    throw new GeometryError('El modelo no contiene triángulos válidos.', 'empty');
  }
  return { fileName, format, mesh: repaired.mesh, fileTriangleCount, objectNames, warnings };
}
