import { performance } from "node:perf_hooks";
import Module from "manifold-3d";

const now = () => performance.now();

const initStart = now();
const wasm = await Module();
wasm.setup();
const { Manifold } = wasm;
const initMs = now() - initStart;

const check = (label, value, expected, tolerance = 1e-6) => {
  const ok = Math.abs(value - expected) <= tolerance;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${value.toFixed(6)} (esperado ${expected})`);
  if (!ok) process.exitCode = 1;
};

console.log(`init: ${initMs.toFixed(1)} ms`);

const cube = Manifold.cube([20, 20, 20], true);
console.log(`cubo: volume=${cube.volume().toFixed(3)} tri=${cube.numTri()} status=${cube.status()}`);

const splitStart = now();
const halves = cube.splitByPlane([0, 0, 1], 0);
const splitMs = now() - splitStart;
const [lower, upper] = halves;
console.log(`split: ${splitMs.toFixed(2)} ms -> ${halves.length} piezas`);
check("volumen inferior", lower.volume(), 4000);
check("volumen superior", upper.volume(), 4000);
check("suma", lower.volume() + upper.volume(), cube.volume(), 1e-4);
console.log(`estado inferior=${lower.status()} superior=${upper.status()} genus=${lower.genus()}`);

const diagonal = cube.splitByPlane([1, 1, 0], 0);
check("suma diagonal", diagonal[0].volume() + diagonal[1].volume(), cube.volume(), 1e-4);
console.log(`diagonal: ${diagonal[0].volume().toFixed(3)} + ${diagonal[1].volume().toFixed(3)}`);

const mesh = cube.getMesh();
console.log(`mesh: numProp=${mesh.numProp} verts=${mesh.vertProperties.length / mesh.numProp} tris=${mesh.triVerts.length / 3}`);
const roundtrip = Manifold.ofMesh(mesh);
check("roundtrip", roundtrip.volume(), 8000, 1e-3);

const curvePoints = [];
for (let i = 0; i <= 60; i += 1) {
  const x = -30 + (60 * i) / 60;
  curvePoints.push([x, 6 * Math.sin(x / 6)]);
}
curvePoints.push([30, -40], [-30, -40]);
curvePoints.reverse();
const curveCutter = wasm.CrossSection.ofPolygons([curvePoints]).extrude(
  40,
  0,
  0,
  1,
  true
);
const curveA = Manifold.intersection(cube, curveCutter);
const curveB = Manifold.difference(cube, curveCutter);
check("curva suma", curveA.volume() + curveB.volume(), cube.volume(), 1e-3);
console.log(
  `curva: ${curveA.volume().toFixed(3)} + ${curveB.volume().toFixed(3)} ` +
    `status=${curveA.status()}/${curveB.status()} tri=${curveCutter.numTri()}`
);

const big = Manifold.sphere(50, 400);
const bigStart = now();
const bigSplit = big.splitByPlane([0.3, 0.2, 1], 0);
const bigMs = now() - bigStart;
check("esfera suma", bigSplit[0].volume() + bigSplit[1].volume(), big.volume(), 0.5);
console.log(`esfera: tris=${big.numTri()} split=${bigMs.toFixed(1)} ms vol=${big.volume().toFixed(2)}`);

const openMesh = new wasm.Mesh({
  numProp: 3,
  vertProperties: new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]),
  triVerts: new Uint32Array([0, 1, 2, 0, 2, 3]),
});
try {
  const open = Manifold.ofMesh(openMesh);
  console.log(`abierto: volume=${open.volume().toFixed(3)} status=${open.status()} empty=${open.isEmpty()}`);
} catch (error) {
  console.log(`abierto: rechazado -> ${error instanceof Error ? error.message : error}`);
}

console.log(`memoria RSS: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB`);
console.log(`RESULTADO: ${process.exitCode ? "FAIL" : "OK"}`);
