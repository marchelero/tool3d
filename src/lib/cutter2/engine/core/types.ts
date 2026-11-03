export type Vec3 = [number, number, number];

export interface BBox {
  min: Vec3;
  max: Vec3;
}

export interface IndexedMesh {
  positions: Float64Array;
  indices: Uint32Array;
}

/** Punto de un camino sobre la superficie: vértice, punto de arista o punto interior de cara. */
export const PK_VERTEX = 0;
export const PK_EDGE = 1;
export const PK_FACE = 2;

export interface PathPoint {
  kind: number;
  /** Índice de vértice, arista o cara según `kind`. */
  id: number;
  /** Posición sobre la arista (0..1). */
  t: number;
  /** Baricéntricas cuando el punto es interior a una cara. */
  b0: number;
  b1: number;
  b2: number;
  x: number;
  y: number;
  z: number;
  /** Tramo (entre puntos de control) al que pertenece. */
  seg: number;
  /** Punto fijado por el usuario: el suavizado no lo mueve. */
  pinned: boolean;
}
