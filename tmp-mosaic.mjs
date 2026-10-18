import { buildMosaicSvg, TILE_KINDS, mosaicPreviewUrl } from "./src/lib/3d/mosaic.ts";

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8"><path d="M0 0H12V8H0Z" fill="#ef2c26"/></svg>`;
const sources = [source];

for (const kind of TILE_KINDS) {
  const svg = buildMosaicSvg(sources, {
    sizeMm: 40,
    tileMm: 11,
    gapMm: 1.5,
    rotation: 0,
    kind,
  });
  const tiles = (svg.match(/<g transform="translate\(/g) ?? []).length;
  const bad = /NaN|Infinity|undefined/.test(svg);
  const balanced =
    (svg.match(/<g\b/g) ?? []).length === (svg.match(/<\/g>/g) ?? []).length;
  console.log(
    `${kind.padEnd(8)} len=${String(svg.length).padStart(6)} tiles=${String(tiles).padStart(3)} bad=${bad} balanced=${balanced}`
  );
}

console.log(
  "rotate(45):",
  buildMosaicSvg(sources, { sizeMm: 40, tileMm: 11, gapMm: 1.5, rotation: 45, kind: "offset" }).includes("rotate(45")
);
console.log(
  "sin fuentes:",
  buildMosaicSvg([], { sizeMm: 40, tileMm: 11, gapMm: 1.5, rotation: 0, kind: "grid" }).includes("<svg")
);
const url = mosaicPreviewUrl("hex");
console.log("preview:", url.startsWith("data:image/svg+xml") && url.length > 200, url.length);
