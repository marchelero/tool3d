"use client";

/* eslint-disable react-hooks/immutability -- los buffers de three.js se escriben en el lugar. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  CircleGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
  WireframeGeometry,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { Eye, Layers, Scan } from "lucide-react";
import type { PerimeterView } from "@/lib/cutter2/worker/protocol";
import { brushCursorPose } from "@/lib/cutter2/brush-cursor";
import {
  isPerimeterHandleVisibleInViewport,
  nearestPerimeterHandle,
  PERIMETER_HANDLE_MARKER,
  type ScreenHandle,
} from "@/lib/cutter2/perimeter-handle";
import { createRenderScheduler, viewerPixelRatio } from "@/lib/cutter2/render-scheduler";
import { StandardModelViewerToolbar, type ModelViewPreset } from "@/components/tools/shared/model-viewer-toolbar";

BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export type ViewerMode = "orbit" | "select" | "orient" | "perimeter";

export interface ViewerPiece {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
  color: string;
  capMask?: Uint8Array | null;
  opacity?: number;
  offset?: readonly [number, number, number];
}

export interface FaceHit {
  face: number;
  point: [number, number, number];
  bary: [number, number, number];
  normal: [number, number, number];
}

const SELECTED = new Color("#f97316");
const HOVERED = new Color("#fbbf24");
const CAP = new Color("#38bdf8");
const PROBLEM = new Color("#ef4444");

interface Entry {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  geometry: BufferGeometry;
  edges: LineSegments | null;
  colors: Float32Array;
  indices: Uint32Array;
  count: number;
  base: Color;
  painted: Uint8Array;
  signature: string;
  sourcePositions: Float32Array;
  sourceIndices: Uint32Array;
}

type ViewOptions = { transparency: boolean; edges: boolean; interior: boolean; plate: boolean };

interface Props {
  pieces: ViewerPiece[];
  activePieceId: string | null;
  selection: Uint8Array | null;
  hoverFaces: Uint8Array | null;
  perimeters: PerimeterView[];
  suggestedLines: Float32Array[];
  seamLines: Float32Array[];
  mode: ViewerMode;
  fitKey: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  paintEnabled?: boolean;
  brushRadius?: number;
  highlightFace?: number | null;
  showRings?: boolean;
  onFaceClick?: (hit: FaceHit, mods: { ctrl: boolean; shift: boolean; alt: boolean }) => void;
  onFaceHover?: (face: number | null) => void;
  onPaintStart?: (hit: FaceHit) => void;
  onPaintDrag?: (hit: FaceHit) => void;
  onPerimeterMove?: (loopIndex: number, index: number, hit: FaceHit | null, final: boolean) => void;
  onPerimeterInsert?: (loopIndex: number, hit: FaceHit) => void;
}

function barycentric(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number
): [number, number, number] {
  const v0x = bx - ax, v0y = by - ay, v0z = bz - az;
  const v1x = cx - ax, v1y = cy - ay, v1z = cz - az;
  const v2x = px - ax, v2y = py - ay, v2z = pz - az;
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-20) return [1 / 3, 1 / 3, 1 / 3];
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

export function Cutter2Viewer(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [viewOptions, setViewOptions] = useState<ViewOptions>({
    transparency: false,
    edges: false,
    interior: false,
    plate: true,
  });
  const stateRef = useRef<{
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    controls: OrbitControls;
    group: Group;
    lines: Group;
    grid: GridHelper;
    rings: Group;
    brushCursor: Group;
    entries: Map<string, Entry>;
    raycaster: Raycaster;
    pointer: Vector2;
    drag: { loopIndex: number; index: number; handle: Vector3 | null } | null;
    ghost: Points | null;
    painting: boolean;
    invalidate: () => void;
    disposed: boolean;
  } | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(viewerPixelRatio(window.devicePixelRatio));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    host.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(70, -110, 90);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.minDistance = 2;
    controls.maxDistance = 3000;

    const hemi = new HemisphereLight(0xffffff, 0x475569, 2.1);
    scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(60, -90, 120);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.9);
    fill.position.set(-80, 40, 60);
    scene.add(fill);

    const grid = new GridHelper(220, 44, 0x94a3b8, 0x334155);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.25;
    scene.add(grid);

    const rings = new Group();
    const ringGeometry = (() => {
      const points: Vector3[] = [];
      for (let i = 0; i < 128; i++) {
        const angle = (i / 128) * Math.PI * 2;
        points.push(new Vector3(Math.cos(angle), Math.sin(angle), 0));
      }
      return new BufferGeometry().setFromPoints(points);
    })();
    const ringSpecs = [
      { color: 0xef4444, rx: 0, ry: Math.PI / 2 },
      { color: 0x22c55e, rx: Math.PI / 2, ry: 0 },
      { color: 0x3b82f6, rx: 0, ry: 0 },
    ];
    for (const spec of ringSpecs) {
      const loop = new LineLoop(
        ringGeometry,
        new LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0.85, depthTest: false })
      );
      loop.rotation.set(spec.rx, spec.ry, 0);
      loop.renderOrder = 3;
      rings.add(loop);
    }
    rings.visible = false;
    scene.add(rings);

    const brushCursor = new Group();
    const brushSurface = new Mesh(
      new CircleGeometry(1, 48),
      new MeshBasicMaterial({
        color: "#f97316",
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: DoubleSide,
      })
    );
    brushSurface.position.z = 0.001;
    brushSurface.renderOrder = 20;
    brushCursor.add(brushSurface);

    const ringPoints = Array.from({ length: 48 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2;
      return new Vector3(Math.cos(angle), Math.sin(angle), 0);
    });
    const brushOutline = new LineLoop(
      new BufferGeometry().setFromPoints(ringPoints),
      new LineBasicMaterial({ color: "#c2410c", depthTest: false, depthWrite: false, transparent: true })
    );
    brushOutline.position.z = 0.002;
    brushOutline.renderOrder = 21;
    brushCursor.add(brushOutline);
    brushCursor.visible = false;
    scene.add(brushCursor);

    const group = new Group();
    const lines = new Group();
    scene.add(group, lines);

    const raycaster = new Raycaster();
    raycaster.firstHitOnly = true;
    const pointer = new Vector2();

    const state = {
      renderer,
      scene,
      camera,
      controls,
      group,
      lines,
      grid,
      rings,
      brushCursor,
      entries: new Map<string, Entry>(),
      raycaster,
      pointer,
      drag: null as { loopIndex: number; index: number; handle: Vector3 | null } | null,
      ghost: null as Points | null,
      painting: false,
      invalidate: () => {},
      disposed: false,
    };
    stateRef.current = state;

    const render = () => {
      if (state.disposed) return;
      const handle = state.drag?.handle;
      if (state.ghost) {
        state.ghost.visible = !!handle;
        if (handle) {
          state.ghost.position.copy(handle);
          state.ghost.updateMatrixWorld();
        }
      }
      controls.update();
      renderer.render(scene, camera);
    };
    const scheduler = createRenderScheduler(render);
    state.invalidate = scheduler.invalidate;
    controls.addEventListener("change", state.invalidate);

    const resize = () => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      state.invalidate();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    return () => {
      state.disposed = true;
      scheduler.dispose();
      observer.disconnect();
      controls.removeEventListener("change", state.invalidate);
      controls.dispose();
      for (const entry of state.entries.values()) {
        entry.geometry.dispose();
        entry.edges?.geometry.dispose();
        if (entry.edges) (entry.edges.material as LineBasicMaterial).dispose();
        entry.mesh.material.dispose();
      }
      state.entries.clear();
      grid.geometry.dispose();
      (grid.material as LineBasicMaterial).dispose();
      rings.children.forEach((child) => {
        const loop = child as LineLoop;
        (loop.material as LineBasicMaterial).dispose();
      });
      ringGeometry.dispose();
      brushSurface.geometry.dispose();
      (brushSurface.material as MeshBasicMaterial).dispose();
      brushOutline.geometry.dispose();
      (brushOutline.material as LineBasicMaterial).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- geometry
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const wanted = new Set(props.pieces.map((p) => p.id));
    let structural = false;
    for (const [id, entry] of state.entries) {
      if (wanted.has(id)) continue;
      state.group.remove(entry.mesh);
      entry.geometry.dispose();
      entry.edges?.geometry.dispose();
      if (entry.edges) (entry.edges.material as LineBasicMaterial).dispose();
      entry.mesh.material.dispose();
      state.entries.delete(id);
      structural = true;
    }
    for (const piece of props.pieces) {
      const signature = `${piece.color}|${piece.opacity ?? 1}`;
      let entry = state.entries.get(piece.id);
      const changed =
        !entry ||
        entry.count !== piece.indices.length / 3 ||
        entry.sourcePositions !== piece.positions ||
        entry.sourceIndices !== piece.indices;
      if (!entry || changed) {
        if (entry) {
          state.group.remove(entry.mesh);
          entry.geometry.dispose();
          entry.edges?.geometry.dispose();
          if (entry.edges) (entry.edges.material as LineBasicMaterial).dispose();
          entry.mesh.material.dispose();
        }
        const count = piece.indices.length / 3;
        const positions = new Float32Array(count * 9);
        for (let f = 0; f < count; f++) {
          for (let k = 0; k < 3; k++) {
            const v = piece.indices[f * 3 + k] * 3;
            const at = f * 9 + k * 3;
            positions[at] = piece.positions[v];
            positions[at + 1] = piece.positions[v + 1];
            positions[at + 2] = piece.positions[v + 2];
          }
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.computeBoundsTree();
        const base = new Color(piece.color);
        const colors = new Float32Array(count * 9);
        const material = new MeshStandardMaterial({
          vertexColors: true,
          flatShading: true,
          side: DoubleSide,
          metalness: 0.05,
          roughness: 0.72,
          transparent: (piece.opacity ?? 1) < 1,
          opacity: piece.opacity ?? 1,
        });
        const mesh = new Mesh(geometry, material);
        mesh.userData.pieceId = piece.id;
        state.group.add(mesh);
        entry = {
          mesh,
          geometry,
          edges: null,
          colors,
          indices: piece.indices,
          count,
          base,
          painted: new Uint8Array(count).fill(9),
          signature,
          sourcePositions: piece.positions,
          sourceIndices: piece.indices,
        };
        state.entries.set(piece.id, entry);
        geometry.setAttribute("color", new BufferAttribute(colors, 3));
        structural = true;
      }
      if (entry.signature !== signature) {
        entry.signature = signature;
        entry.base.set(piece.color);
        entry.painted.fill(9);
      }
      const material = entry.mesh.material;
      material.opacity = piece.opacity ?? 1;
      material.transparent = material.opacity < 1;
      entry.mesh.position.set(...(piece.offset ?? [0, 0, 0]));
      entry.mesh.renderOrder = (piece.opacity ?? 1) < 1 ? 2 : 1;
    }
    if (structural) {
      for (const entry of state.entries.values()) entry.painted.fill(9);
    }
    state.invalidate();
  }, [props.pieces]);

  // --------------------------------------------------------------- bed/rings
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const box = new Box3();
    let any = false;
    for (const entry of state.entries.values()) {
      entry.geometry.computeBoundingBox();
      const own = entry.geometry.boundingBox;
      if (!own) continue;
      const offset = entry.mesh.position;
      box.expandByPoint(own.min.clone().add(offset));
      box.expandByPoint(own.max.clone().add(offset));
      any = true;
    }
    if (!any) {
      state.grid.visible = false;
      state.rings.visible = false;
      state.invalidate();
      return;
    }
    state.grid.visible = viewOptions.plate;
    const size = new Vector3();
    box.getSize(size);
    const center = new Vector3();
    box.getCenter(center);
    const extent = Math.max(size.x, size.y, size.z, 1);
    state.grid.position.set(center.x, center.y, box.min.z - Math.max(0.25, extent * 0.004));
    state.grid.scale.setScalar(Math.max(1, (extent * 2.6) / 220));
    state.rings.visible = !!props.showRings;
    state.rings.position.copy(center);
    state.rings.scale.setScalar(extent * 0.62);
    state.invalidate();
  }, [props.pieces, props.showRings, viewOptions.plate]);

  // -------------------------------------------------------- toolbar options
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const piecesById = new Map(props.pieces.map((piece) => [piece.id, piece]));
    for (const [id, entry] of state.entries) {
      const piece = piecesById.get(id);
      if (!piece) continue;
      const material = entry.mesh.material;
      material.wireframe = wireframe;
      const factor = viewOptions.interior ? 0.28 : viewOptions.transparency ? 0.38 : 1;
      material.opacity = (piece.opacity ?? 1) * factor;
      material.transparent = material.opacity < 1;
      material.depthWrite = !material.transparent;
      material.needsUpdate = true;

      if (viewOptions.edges && !entry.edges) {
        const geometry = new WireframeGeometry(entry.geometry);
        const edges = new LineSegments(
          geometry,
          new LineBasicMaterial({ color: 0x0c0f12, transparent: true, opacity: 0.4, depthWrite: false })
        );
        edges.renderOrder = 2;
        entry.edges = edges;
        entry.mesh.add(edges);
      } else if (!viewOptions.edges && entry.edges) {
        entry.mesh.remove(entry.edges);
        entry.edges.geometry.dispose();
        (entry.edges.material as LineBasicMaterial).dispose();
        entry.edges = null;
      }
    }
    state.invalidate();
  }, [props.pieces, viewOptions, wireframe]);

  // ------------------------------------------------------------------ colors
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    const { selection, hoverFaces, activePieceId } = props;
    const piecesById = new Map(props.pieces.map((p) => [p.id, p]));
    let colorsChanged = false;
    for (const [id, entry] of state.entries) {
      const piece = piecesById.get(id);
      if (!piece) continue;
      const width = entry.count;
      const selectionHere = id === activePieceId ? selection : null;
      const hoverHere = id === activePieceId ? hoverFaces : null;
      const cap = piece.capMask;
      const colors = entry.colors;
      let entryColorsChanged = false;
      for (let f = 0; f < width; f++) {
        let stateCode = 0;
        if (cap && cap[f] === 1) stateCode = 3;
        if (selectionHere && selectionHere[f] === 1) stateCode = 1;
        else if (hoverHere && hoverHere[f] === 1) stateCode = 2;
        if (entry.painted[f] === stateCode) continue;
        entry.painted[f] = stateCode;
        colorsChanged = true;
        entryColorsChanged = true;
        const color = stateCode === 1 ? SELECTED : stateCode === 2 ? HOVERED : stateCode === 3 ? CAP : stateCode === 4 ? PROBLEM : entry.base;
        const at = f * 9;
        for (let k = 0; k < 3; k++) {
          colors[at + k * 3] = color.r;
          colors[at + k * 3 + 1] = color.g;
          colors[at + k * 3 + 2] = color.b;
        }
      }
      const attribute = entry.geometry.getAttribute("color") as BufferAttribute;
      if (entryColorsChanged) attribute.needsUpdate = true;
    }
    if (colorsChanged) state.invalidate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selection, props.hoverFaces, props.activePieceId, props.pieces]);

  // ------------------------------------------------------------ brush cursor
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    if (props.mode !== "select" || !props.paintEnabled) {
      state.brushCursor.visible = false;
    } else if (state.brushCursor.visible) {
      state.brushCursor.scale.setScalar(Math.max(props.brushRadius ?? 0, 0.001));
    }
    state.invalidate();
  }, [props.brushRadius, props.mode, props.paintEnabled]);

  // ------------------------------------------------- perimeter + seam lines
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;
    state.ghost = null;
    for (const child of [...state.lines.children]) {
      state.lines.remove(child);
      if (child instanceof Line || child instanceof LineSegments || child instanceof Points) {
        child.geometry.dispose();
        (child.material as LineBasicMaterial | PointsMaterial).dispose();
      }
    }
    for (const perimeter of props.perimeters) {
      const total = Math.floor(perimeter.positions.length / 3);
      const positions: number[] = [];
      const colors: number[] = [];
      const ok = new Color("#22c55e");
      const bad = new Color("#ef4444");
      for (let i = 0; i < total - 1; i++) {
        const seg = perimeter.segIndex[i] ?? 0;
        const color = perimeter.segmentOk[seg] === false ? bad : ok;
        const a = i;
        const b = i + 1;
        positions.push(
          perimeter.positions[a * 3], perimeter.positions[a * 3 + 1], perimeter.positions[a * 3 + 2],
          perimeter.positions[b * 3], perimeter.positions[b * 3 + 1], perimeter.positions[b * 3 + 2]
        );
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
      geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
      const line = new LineSegments(
        geometry,
        new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true })
      );
      line.renderOrder = 12;
      state.lines.add(line);

      const handles = perimeter.controlPositions.flatMap((p) => [p[0], p[1], p[2]]);
      const makeHandlePoints = (color: number, size: number, renderOrder: number) => {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new BufferAttribute(new Float32Array(handles), 3));
        const points = new Points(
          geometry,
          new PointsMaterial({
            color,
            size,
            sizeAttenuation: PERIMETER_HANDLE_MARKER.sizeAttenuation,
            depthTest: false,
            depthWrite: false,
          })
        );
        points.renderOrder = renderOrder;
        state.lines.add(points);
      };
      makeHandlePoints(0x0f172a, PERIMETER_HANDLE_MARKER.outlineSize, 13);
      makeHandlePoints(0x38bdf8, PERIMETER_HANDLE_MARKER.fillSize, 14);
    }
    if (props.perimeters.length > 0) {
      const ghostGeometry = new BufferGeometry();
      ghostGeometry.setAttribute("position", new BufferAttribute(new Float32Array(3), 3));
      const ghost = new Points(ghostGeometry, new PointsMaterial({ color: 0x0f172a, size: PERIMETER_HANDLE_MARKER.outlineSize, sizeAttenuation: false, depthTest: false }));
      ghost.renderOrder = 15;
      ghost.visible = false;
      state.ghost = ghost;
      state.lines.add(ghost);
    }
    for (const line of props.suggestedLines) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(line), 3));
      const path = new Line(geometry, new LineDashedMaterial({ color: 0x38bdf8, dashSize: 2, gapSize: 1.6, transparent: true, opacity: 0.85 }));
      path.computeLineDistances();
      path.renderOrder = 11;
      state.lines.add(path);
    }
    for (const line of props.seamLines) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(line), 3));
      const path = new Line(geometry, new LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9 }));
      path.renderOrder = 10;
      state.lines.add(path);
    }
    state.invalidate();
  }, [props.perimeters, props.suggestedLines, props.seamLines]);

  // ------------------------------------------------------------- camera fit
  useEffect(() => {
    const state = stateRef.current;
    if (!state || props.pieces.length === 0) return;
    const box = new Box3();
    for (const entry of state.entries.values()) {
      entry.geometry.computeBoundingBox();
      if (entry.geometry.boundingBox) {
        box.union(entry.geometry.boundingBox.clone().translate(entry.mesh.position));
      }
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new Sphere());
    const { camera, controls } = state;
    const distance = Math.max(sphere.radius * 3.2, 30);
    controls.target.copy(sphere.center);
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 1e-6) direction.set(0.6, -0.8, 0.55).normalize();
    camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
    camera.near = Math.max(0.05, distance / 500);
    camera.far = distance * 40;
    camera.updateProjectionMatrix();
    controls.update();
    state.invalidate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  // --------------------------------------------------------------- pointer IO
  useEffect(() => {
    const state = stateRef.current;
    const host = hostRef.current;
    if (!state || !host) return;
    const canvas = state.renderer.domElement;

    const setPointer = (event: PointerEvent | MouseEvent): boolean => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      state.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const camera = state.camera;
      camera.updateMatrixWorld();
      const forward = camera.getWorldDirection(new Vector3());
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const halfHeight = Math.tan((camera.fov * Math.PI) / 360);
      const halfWidth = halfHeight * camera.aspect;
      const direction = forward
        .addScaledVector(right, state.pointer.x * halfWidth)
        .addScaledVector(up, state.pointer.y * halfHeight)
        .normalize();
      const origin = new Vector3().setFromMatrixPosition(camera.matrixWorld);
      state.raycaster.ray.set(origin, direction);
      return true;
    };

    const activeEntry = () => {
      const id = propsRef.current.activePieceId;
      if (!id) return null;
      for (const [key, entry] of state.entries) if (key === id) return entry;
      return null;
    };

    const hitActive = (event: PointerEvent | MouseEvent): FaceHit | null => {
      const entry = activeEntry();
      if (!entry || !setPointer(event)) return null;
      const hits = state.raycaster.intersectObject(entry.mesh, false);
      const hit = hits[0];
      if (!hit || hit.faceIndex == null) return null;
      const position = entry.geometry.getAttribute("position");
      const slot = hit.faceIndex;
      const index = entry.geometry.getIndex();
      const a = index ? index.getX(slot * 3) : slot * 3;
      const b = index ? index.getX(slot * 3 + 1) : slot * 3 + 1;
      const c = index ? index.getX(slot * 3 + 2) : slot * 3 + 2;
      const f = Math.floor(Math.min(a, b, c) / 3);
      const point = entry.mesh.worldToLocal(hit.point.clone());
      const bary = barycentric(
        point.x, point.y, point.z,
        position.getX(a), position.getY(a), position.getZ(a),
        position.getX(b), position.getY(b), position.getZ(b),
        position.getX(c), position.getY(c), position.getZ(c)
      );
      const pa = new Vector3(position.getX(a), position.getY(a), position.getZ(a));
      const pb = new Vector3(position.getX(b), position.getY(b), position.getZ(b));
      const pc = new Vector3(position.getX(c), position.getY(c), position.getZ(c));
      const normal = pb.clone().sub(pa).cross(pc.clone().sub(pa)).normalize();
      return { face: f, point: [point.x, point.y, point.z], bary, normal: [normal.x, normal.y, normal.z] };
    };

    const updateBrushCursor = (hit: FaceHit | null) => {
      const cursor = state.brushCursor;
      const entry = activeEntry();
      if (!hit || !entry || propsRef.current.mode !== "select" || !propsRef.current.paintEnabled) {
        if (cursor.visible) {
          cursor.visible = false;
          state.invalidate();
        }
        return;
      }

      const pose = brushCursorPose(
        hit.point,
        hit.normal,
        [entry.mesh.position.x, entry.mesh.position.y, entry.mesh.position.z],
        propsRef.current.brushRadius ?? 0
      );
      cursor.position.set(...pose.position);
      cursor.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...pose.normal));
      cursor.scale.setScalar(Math.max(pose.radius, 0.001));
      cursor.visible = true;
      state.invalidate();
    };

    const controlScreen = (loopIndex: number, index: number): { x: number; y: number } | null => {
      const perimeter = propsRef.current.perimeters[loopIndex];
      if (!perimeter) return null;
      const p = perimeter.controlPositions[index];
      if (!p) return null;
      const v = new Vector3(p[0], p[1], p[2]).project(state.camera);
      if (!isPerimeterHandleVisibleInViewport(v)) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    };

    const nearestHandle = (event: PointerEvent): { loopIndex: number; index: number } | null => {
      const handles: ScreenHandle[] = [];
      for (let loopIndex = 0; loopIndex < propsRef.current.perimeters.length; loopIndex++) {
        const perimeter = propsRef.current.perimeters[loopIndex];
        for (let index = 0; index < perimeter.controlPositions.length; index++) {
          const screen = controlScreen(loopIndex, index);
          if (!screen) continue;
          handles.push({ loopIndex, index, ...screen });
        }
      }
      return nearestPerimeterHandle(handles, event.clientX, event.clientY);
    };

    const nearestLoop = (hit: FaceHit): number => {
      let bestLoop = 0;
      let bestDistance = Infinity;
      for (let loopIndex = 0; loopIndex < propsRef.current.perimeters.length; loopIndex++) {
        for (const point of propsRef.current.perimeters[loopIndex].controlPositions) {
          const distance = Math.hypot(point[0] - hit.point[0], point[1] - hit.point[1], point[2] - hit.point[2]);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestLoop = loopIndex;
          }
        }
      }
      return bestLoop;
    };

    const onPointerDown = (event: PointerEvent) => {
      const mode = propsRef.current.mode;
      if (event.button !== 0) return;
      downAt2 = { x: event.clientX, y: event.clientY };
      if (mode === "perimeter") {
        const handle = nearestHandle(event);
        if (handle) {
          const { loopIndex, index } = handle;
          state.drag = { loopIndex, index, handle: new Vector3() };
          state.controls.enabled = false;
          const p = propsRef.current.perimeters[loopIndex]?.controlPositions[index];
          if (p) state.drag.handle?.set(p[0], p[1], p[2]);
          canvas.setPointerCapture(event.pointerId);
          event.preventDefault();
          return;
        }
      }
      if (mode === "select" && propsRef.current.paintEnabled) {
        const hit = hitActive(event);
        if (hit) {
          state.painting = true;
          state.controls.enabled = false;
          updateBrushCursor(hit);
          propsRef.current.onPaintStart?.(hit);
          propsRef.current.onPaintDrag?.(hit);
          canvas.setPointerCapture(event.pointerId);
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const mode = propsRef.current.mode;
      if (state.drag) {
        const hit = hitActive(event);
        if (hit && state.drag.handle) state.drag.handle.set(hit.point[0], hit.point[1], hit.point[2]);
        else if (!hit && state.drag.handle) {
          const entry = activeEntry();
          if (entry) {
            const plane = state.raycaster.ray;
            const distance = plane.origin.distanceTo(state.drag.handle);
            const point = plane.at(Math.max(0, distance), new Vector3());
            state.drag.handle.copy(point);
          }
        }
        propsRef.current.onPerimeterMove?.(state.drag.loopIndex, state.drag.index, hit, false);
        state.invalidate();
        return;
      }
      if (mode === "select" && state.painting) {
        const hit = hitActive(event);
        updateBrushCursor(hit);
        if (hit) propsRef.current.onPaintDrag?.(hit);
        return;
      }
      if (mode === "select" || mode === "perimeter" || mode === "orient") {
        const hit = hitActive(event);
        updateBrushCursor(mode === "select" ? hit : null);
        propsRef.current.onFaceHover?.(hit ? hit.face : null);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (state.drag) {
        const hit = hitActive(event);
        propsRef.current.onPerimeterMove?.(state.drag.loopIndex, state.drag.index, hit, true);
        state.drag = null;
        state.controls.enabled = true;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        return;
      }
      if (state.painting) {
        state.painting = false;
        state.controls.enabled = true;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      }
    };

    let downAt2: { x: number; y: number } | null = null;

    const onClick = (event: MouseEvent) => {
      const mode = propsRef.current.mode;
      if (mode !== "select" && mode !== "orient") return;
      const moved = downAt2 ? Math.hypot(event.clientX - downAt2.x, event.clientY - downAt2.y) : 0;
      downAt2 = null;
      if (moved > 5) return;
      const hit = hitActive(event);
      if (!hit) return;
      propsRef.current.onFaceClick?.(hit, { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey });
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (propsRef.current.mode !== "perimeter") return;
      const hit = hitActive(event);
      if (hit && propsRef.current.perimeters.length > 0) propsRef.current.onPerimeterInsert?.(nearestLoop(hit), hit);
    };

    const onLeave = () => {
      updateBrushCursor(null);
      propsRef.current.onFaceHover?.(null);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const frameView = useCallback((preset?: ModelViewPreset) => {
    const state = stateRef.current;
    if (!state) return;
    const box = new Box3();
    for (const entry of state.entries.values()) {
      entry.geometry.computeBoundingBox();
      if (!entry.geometry.boundingBox) continue;
      box.union(entry.geometry.boundingBox.clone().translate(entry.mesh.position));
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length() || 1;
    const distance = Math.max((size / 2 / Math.tan((state.camera.fov * Math.PI) / 360)) * 1.12, 2);
    const presetAngles: Record<ModelViewPreset, [number, number]> = {
      iso: [-68, 20],
      front: [-90, 0],
      back: [90, 0],
      right: [0, 0],
      left: [180, 0],
      top: [-90, 89.9],
      bottom: [-90, -89.9],
    };
    const [yawDegrees, pitchDegrees] = preset ? presetAngles[preset] : [
      Math.atan2(state.camera.position.y - state.controls.target.y, state.camera.position.x - state.controls.target.x) * 180 / Math.PI,
      Math.asin((state.camera.position.z - state.controls.target.z) / state.camera.position.distanceTo(state.controls.target)) * 180 / Math.PI,
    ];
    const yaw = yawDegrees * Math.PI / 180;
    const pitch = pitchDegrees * Math.PI / 180;
    const horizontal = Math.cos(pitch) * distance;
    state.controls.target.copy(center);
    state.camera.position.set(
      center.x + horizontal * Math.cos(yaw),
      center.y + horizontal * Math.sin(yaw),
      center.z + Math.sin(pitch) * distance
    );
    state.camera.up.set(0, 0, 1);
    state.camera.lookAt(center);
    state.camera.near = Math.max(0.05, distance / 500);
    state.camera.far = distance * 40;
    state.camera.updateProjectionMatrix();
    state.controls.update();
    state.invalidate();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const state = stateRef.current;
    if (!state) return;
    const offset = state.camera.position.clone().sub(state.controls.target).multiplyScalar(factor);
    state.camera.position.copy(state.controls.target).add(offset);
    state.controls.update();
    state.invalidate();
  }, []);

  const toggleOption = (key: keyof ViewOptions) => {
    setViewOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  const cursor = props.mode === "select" ? "crosshair" : props.mode === "perimeter" ? "grab" : props.mode === "orient" ? "pointer" : "grab";

  return (
    <div ref={hostRef} className="relative h-full w-full" style={{ cursor }}>
      {props.pieces.length > 0 && (
        <StandardModelViewerToolbar
          expanded={props.expanded}
          onToggleExpanded={props.onToggleExpanded}
          onZoomIn={() => zoomBy(0.8)}
          onZoomOut={() => zoomBy(1.25)}
          onCenter={() => frameView()}
          onViewPreset={frameView}
          gridVisible={viewOptions.plate}
          onToggleGrid={() => toggleOption("plate")}
          wireframeVisible={wireframe}
          onToggleWireframe={() => setWireframe((value) => !value)}
          extraActions={[
            {
              id: "transparency",
              label: viewOptions.transparency ? "Desactivar transparencia" : "Activar transparencia",
              icon: <Eye className="size-4" />,
              onClick: () => toggleOption("transparency"),
              active: viewOptions.transparency,
            },
            {
              id: "edges",
              label: viewOptions.edges ? "Ocultar aristas" : "Mostrar aristas",
              icon: <Scan className="size-4" />,
              onClick: () => toggleOption("edges"),
              active: viewOptions.edges,
            },
            {
              id: "interior",
              label: viewOptions.interior ? "Ocultar superficies interiores" : "Ver superficies interiores del corte",
              icon: <Layers className="size-4" />,
              onClick: () => toggleOption("interior"),
              active: viewOptions.interior,
            },
          ]}
        />
      )}
    </div>
  );
}
