import { Color, type BufferGeometry, type Mesh } from "three";
import { unzipSync } from "fflate";
import { computeBounds } from "@/lib/mesh/bounds";
import { analyzeMesh } from "@/lib/mesh/topology";
import type { MeshData } from "@/lib/mesh/types";
import { weldTriangleSoup } from "@/lib/mesh/weld";
import type { LoadedModel } from "./types";

const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_TRIANGLES = 3_000_000;

const UNIT_SCALE: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

function triangleSoupFromGeometry(geometry: BufferGeometry): Float32Array {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const triangles = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const positions = new Float32Array(triangles * 9);
  let cursor = 0;
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = index
        ? index.getX(triangle * 3 + corner)
        : triangle * 3 + corner;
      positions[cursor] = position.getX(vertex);
      positions[cursor + 1] = position.getY(vertex);
      positions[cursor + 2] = position.getZ(vertex);
      cursor += 3;
    }
  }
  return positions;
}

function weldColored(
  positions: Float32Array,
  colors: (string | null)[]
): { mesh: MeshData; faceColors: (string | null)[] } {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const maxDimension = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const tolerance = Math.max(1e-6, maxDimension * 1e-6);
  const inverse = 1 / tolerance;
  const indexByKey = new Map<string, number>();
  const vertices: number[] = [];
  const faces: number[] = [];
  const faceColors: (string | null)[] = [];
  const triangleCount = Math.floor(positions.length / 9);

  const vertexIndex = (offset: number): number => {
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    const key = `${Math.round(x * inverse)},${Math.round(
      y * inverse
    )},${Math.round(z * inverse)}`;
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length / 3;
    indexByKey.set(key, index);
    vertices.push(x, y, z);
    return index;
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 9;
    const a = vertexIndex(offset);
    const b = vertexIndex(offset + 3);
    const c = vertexIndex(offset + 6);
    if (a === b || b === c || a === c) continue;
    faces.push(a, b, c);
    faceColors.push(colors[triangle] ?? null);
  }

  return {
    mesh: {
      vertices: new Float32Array(vertices),
      faces: new Uint32Array(faces),
    },
    faceColors,
  };
}

function read3mfUnit(bytes: Uint8Array): string {
  try {
    const modelFiles = unzipSync(bytes, {
      filter: (file) => file.name.toLowerCase().endsWith(".model"),
    });
    const decoder = new TextDecoder();
    for (const data of Object.values(modelFiles)) {
      const text = decoder.decode(data);
      const match = text.match(/<model[^>]*\bunit="([^"]+)"/i);
      if (match?.[1]) return match[1].toLowerCase();
    }
  } catch {
    return "millimeter";
  }
  return "millimeter";
}

async function loadStl(buffer: ArrayBuffer): Promise<{
  mesh: MeshData;
  faceColors: (string | null)[];
}> {
  const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
  let geometry: BufferGeometry;
  try {
    geometry = new STLLoader().parse(buffer);
  } catch {
    throw new Error("No se pudo interpretar el STL. Verificá que no esté dañado.");
  }
  const position = geometry.getAttribute("position");
  if (!position || position.count < 3) {
    geometry.dispose();
    throw new Error("El STL no contiene triángulos válidos");
  }
  const positions = triangleSoupFromGeometry(geometry);
  geometry.dispose();
  const triangles = Math.floor(positions.length / 9);
  if (triangles > MAX_TRIANGLES) {
    throw new Error("El modelo supera el límite de 3 millones de triángulos");
  }
  return {
    mesh: weldTriangleSoup(positions),
    faceColors: new Array(triangles).fill(null),
  };
}

async function load3mf(buffer: ArrayBuffer): Promise<{
  mesh: MeshData;
  faceColors: (string | null)[];
  scale: number;
  unit: string;
}> {
  const { ThreeMFLoader } = await import(
    "three/examples/jsm/loaders/3MFLoader.js"
  );
  const unit = read3mfUnit(new Uint8Array(buffer));
  const scale = UNIT_SCALE[unit] ?? 1;
  let group;
  try {
    group = new ThreeMFLoader().parse(buffer);
  } catch {
    throw new Error("No se pudo interpretar el 3MF. Verificá que no esté dañado.");
  }
  group.updateMatrixWorld(true);

  const positions: number[] = [];
  const colors: (string | null)[] = [];
  const vertex = group.position.clone();

  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const color = geometry.getAttribute("color");
    const index = geometry.getIndex();
    const triangles = index
      ? Math.floor(index.count / 3)
      : Math.floor(position.count / 3);
    for (let triangle = 0; triangle < triangles; triangle += 1) {
      let faceColor: string | null = null;
      for (let corner = 0; corner < 3; corner += 1) {
        const source = index
          ? index.getX(triangle * 3 + corner)
          : triangle * 3 + corner;
        vertex.set(position.getX(source), position.getY(source), position.getZ(source));
        vertex.applyMatrix4(mesh.matrixWorld);
        positions.push(vertex.x * scale, vertex.y * scale, vertex.z * scale);
        if (corner === 0 && color) {
          faceColor = `#${new Color().setRGB(
            color.getX(source),
            color.getY(source),
            color.getZ(source)
          ).getHexString()}`;
        }
      }
      colors.push(faceColor);
    }
  });

  if (positions.length === 0) {
    throw new Error("El 3MF no contiene geometría visible");
  }
  if (colors.length > MAX_TRIANGLES) {
    throw new Error("El modelo supera el límite de 3 millones de triángulos");
  }

  const welded = weldColored(new Float32Array(positions), colors);
  return {
    mesh: welded.mesh,
    faceColors: welded.faceColors,
    scale,
    unit,
  };
}

export async function loadModelFile(file: File): Promise<LoadedModel> {
  if (file.size === 0) {
    throw new Error("El archivo está vacío");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("El archivo supera el límite de 120 MB");
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "stl" && extension !== "3mf") {
    throw new Error("Formato no compatible. Cargá un archivo STL o 3MF.");
  }

  const buffer = await file.arrayBuffer();
  const warnings: string[] = [];
  let mesh: MeshData;
  let faceColors: (string | null)[];
  let format: "stl" | "3mf";

  if (extension === "stl") {
    format = "stl";
    const loaded = await loadStl(buffer);
    mesh = loaded.mesh;
    faceColors = loaded.faceColors;
    warnings.push(
      "El STL no guarda colores: se asumieron milímetros y eje Z arriba."
    );
  } else {
    format = "3mf";
    const loaded = await load3mf(buffer);
    mesh = loaded.mesh;
    faceColors = loaded.faceColors;
    if (loaded.scale !== 1) {
      warnings.push(
        `Unidades del 3MF: ${loaded.unit}. Se convirtió a milímetros.`
      );
    }
  }

  let firstColor: string | null = null;
  let distinctColors = 0;
  for (const color of faceColors) {
    if (!color) continue;
    if (firstColor === null) {
      firstColor = color;
      distinctColors = 1;
    } else if (color !== firstColor) {
      distinctColors = 2;
      break;
    }
  }
  const hasColors = distinctColors > 1;
  if (format === "3mf") {
    if (distinctColors === 0) {
      warnings.push("El 3MF no tiene materiales de color visibles.");
    } else if (!hasColors) {
      warnings.push(
        "El 3MF usa un solo color visible; la varita usará ángulos."
      );
    }
  }

  const bounds = computeBounds(mesh.vertices);
  const maxDimension = Math.max(...bounds.size);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error("El modelo no tiene dimensiones válidas");
  }
  if (maxDimension < 2 || maxDimension > 1000) {
    warnings.push(
      `El tamaño es de ${maxDimension.toFixed(1)} mm. Revisá si el archivo usa otras unidades.`
    );
  }
  const diagnostics = analyzeMesh(mesh);

  return {
    fileName: file.name,
    fileSize: file.size,
    format,
    mesh,
    bounds,
    diagnostics,
    faceColors: hasColors ? (faceColors as string[]) : null,
    hasColors,
    warnings,
  };
}
