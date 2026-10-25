import type { ManifoldToplevel } from "manifold-3d";
import { computeBounds } from "@/lib/mesh/bounds";
import type { MeshData } from "@/lib/mesh/types";
import type { CutAxis, CutSuggestion } from "./types";

const SAMPLES = 15;

export function suggestCuts(
  wasm: ManifoldToplevel,
  mesh: MeshData,
  onProgress?: (progress: number) => void
): CutSuggestion[] {
  const { Manifold, Mesh } = wasm;
  const source = new Mesh({
    numProp: 3,
    vertProperties: mesh.vertices,
    triVerts: mesh.faces,
  });
  const root = Manifold.ofMesh(source);
  if (root.status() !== "NoError") {
    root.delete();
    throw new Error("La malla no es un sólido cerrado y orientado");
  }
  const bounds = computeBounds(mesh.vertices);
  const axes: CutAxis[] = ["x", "y", "z"];
  const candidates: CutSuggestion[] = [];
  let completed = 0;
  const total = axes.length * (SAMPLES - 1);

  try {
    for (let axisIndex = 0; axisIndex < axes.length; axisIndex += 1) {
      const axis = axes[axisIndex];
      const other = [0, 1, 2].filter((index) => index !== axisIndex);
      const crossSection =
        (bounds.size[other[0]] + 1) * (bounds.size[other[1]] + 1);
      const thickness = Math.max(0.2, bounds.size[axisIndex] * 0.004);
      const series: { offset: number; ratio: number }[] = [];

      for (let step = 1; step < SAMPLES; step += 1) {
        const offset =
          bounds.min[axisIndex] +
          (bounds.size[axisIndex] * step) / SAMPLES;
        const size: [number, number, number] = [0, 0, 0];
        size[axisIndex] = thickness;
        size[other[0]] = bounds.size[other[0]] + 4;
        size[other[1]] = bounds.size[other[1]] + 4;
        const slab = Manifold.cube(size, true);
        const position: [number, number, number] = [
          bounds.center[0],
          bounds.center[1],
          bounds.center[2],
        ];
        position[axisIndex] = offset;
        const placed = slab.translate(position);
        slab.delete();
        const slice = root.intersect(placed);
        placed.delete();
        const ratio =
          slice.status() === "NoError" && slice.volume() > 0
            ? slice.volume() / thickness / crossSection
            : 0;
        slice.delete();
        series.push({ offset, ratio });
        completed += 1;
        onProgress?.(0.05 + (0.9 * completed) / total);
      }

      const maxRatio = Math.max(...series.map((item) => item.ratio), 0.0001);
      let index = 0;
      while (index < series.length) {
        if (series[index].ratio <= 0.02 || series[index].ratio > maxRatio * 0.6) {
          index += 1;
          continue;
        }
        const start = index;
        let end = index;
        let minimum = series[index].ratio;
        while (
          end + 1 < series.length &&
          series[end + 1].ratio > 0.02 &&
          series[end + 1].ratio <= maxRatio * 0.6
        ) {
          end += 1;
          minimum = Math.min(minimum, series[end].ratio);
        }
        const before = series[start - 1]?.ratio ?? 0;
        const after = series[end + 1]?.ratio ?? 0;
        if (
          start >= 2 &&
          end <= series.length - 3 &&
          minimum <= before * 0.88 &&
          minimum <= after * 0.88
        ) {
          const middle = series[start + Math.floor((end - start) / 2)];
          candidates.push({ axis, offset: middle.offset, ratio: minimum });
        }
        index = end + 1;
      }
    }
  } finally {
    root.delete();
  }

  candidates.sort((left, right) => left.ratio - right.ratio);
  const chosen: CutSuggestion[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= 3) break;
    const sizeIndex =
      candidate.axis === "x" ? 0 : candidate.axis === "y" ? 1 : 2;
    const tooClose = chosen.some(
      (item) =>
        item.axis === candidate.axis &&
        Math.abs(item.offset - candidate.offset) <
          bounds.size[sizeIndex] * 0.15
    );
    if (!tooClose) chosen.push(candidate);
  }
  return chosen;
}
