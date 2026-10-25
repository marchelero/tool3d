"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Box,
  Grid3x3,
  Maximize2,
  RefreshCw,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import { IconAction, PanelTooltips } from "@/components/tools/shared/panel";
import type { MeshData } from "@/lib/mesh/types";
import type {
  CutAxis,
  CutOp,
  CutterPartView,
  RegionCutOp,
} from "@/lib/cutter/types";
import { buildShapeRings } from "@/lib/3d/shapes";
import { cn } from "@/lib/utils";

const MAX_SOLID_FACES = 50000;

Mesh.prototype.raycast = acceleratedRaycast;
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

interface FitState {
  center: Vector3;
  distance: number;
  maxDimension: number;
}

interface PartMeshEntry {
  mesh: Mesh;
  baseCenter: Vector3;
  explodedPosition: Vector3;
}

export type PaintAction = "replace" | "add" | "subtract";

export interface FacePick {
  partId: string;
  faceIndex: number;
  point: [number, number, number];
  action: PaintAction;
}

export interface FaceSelection {
  partId: string;
  faces: number[];
  loops?: [number, number, number][][];
}

export interface CutPlacement {
  axis: CutAxis;
  onPreview: (offset: number, point: [number, number, number]) => void;
  onCommit: (offset: number, point: [number, number, number]) => void;
}

function geometryFromMesh(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.vertices, 3));
  geometry.setIndex(new BufferAttribute(mesh.faces, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeBoundsTree();
  return geometry;
}

function disposeObject(object: Mesh | Line | LineSegments) {
  if (object.geometry.boundsTree) object.geometry.disposeBoundsTree();
  object.geometry.dispose();
  const material = object.material;
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

export function CutterViewer({
  parts,
  cuts,
  selectedPartId,
  exploded,
  pickMode = false,
  onPickFace,
  selection = null,
  placement = null,
  moveMode = false,
  partOffsets = {},
  onMovePart,
  onMoveCut,
  activeCutId = null,
  showCutPreviews = true,
  onTransformCut,
  onEditRegionNode,
  className,
}: {
  parts: CutterPartView[];
  cuts: CutOp[];
  selectedPartId: string | null;
  exploded: number;
  pickMode?: boolean;
  onPickFace?: (pick: FacePick) => void;
  selection?: FaceSelection | null;
  placement?: CutPlacement | null;
  moveMode?: boolean;
  partOffsets?: Record<string, [number, number, number]>;
  onMovePart?: (partId: string, offset: [number, number, number]) => void;
  onMoveCut?: (id: string, offset: number) => void;
  activeCutId?: string | null;
  showCutPreviews?: boolean;
  onTransformCut?: (
    id: string,
    normal: [number, number, number],
    offset: number
  ) => void;
  onEditRegionNode?: (
    id: string,
    ringIndex: number,
    pointIndex: number,
    point: [number, number]
  ) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const gridRef = useRef<GridHelper | null>(null);
  const partsGroupRef = useRef<Group | null>(null);
  const planesGroupRef = useRef<Group | null>(null);
  const partEntriesRef = useRef<PartMeshEntry[]>([]);
  const selectionMeshRef = useRef<Mesh | null>(null);
  const fitRef = useRef<FitState | null>(null);
  const showGridRef = useRef(true);
  const onPickRef = useRef(onPickFace);
  const pickModeRef = useRef(pickMode);
  const placementRef = useRef(placement);
  const moveModeRef = useRef(moveMode);
  const offsetsRef = useRef(partOffsets);
  const onMovePartRef = useRef(onMovePart);
  const onMoveCutRef = useRef(onMoveCut);
  const onTransformCutRef = useRef(onTransformCut);
  const onEditRegionNodeRef = useRef(onEditRegionNode);

  const [showGrid, setShowGrid] = useState(true);
  const [wireframe, setWireframe] = useState(false);

  useEffect(() => {
    onPickRef.current = onPickFace;
    pickModeRef.current = pickMode;
    placementRef.current = placement;
    moveModeRef.current = moveMode;
    offsetsRef.current = partOffsets;
    onMovePartRef.current = onMovePart;
    onMoveCutRef.current = onMoveCut;
    onTransformCutRef.current = onTransformCut;
    onEditRegionNodeRef.current = onEditRegionNode;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.domElement.style.cursor =
        pickMode || placement ? "crosshair" : moveMode ? "move" : "";
    }
  }, [
    onPickFace,
    pickMode,
    placement,
    moveMode,
    partOffsets,
    onMovePart,
    onMoveCut,
    onTransformCut,
    onEditRegionNode,
  ]);

  useEffect(() => {
    showGridRef.current = showGrid;
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  const applyView = useCallback((mode: "iso" | "top" | "front") => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const fit = fitRef.current;
    if (!camera || !controls || !fit) return;
    const { center, distance } = fit;
    if (mode === "top") {
      camera.position.set(center.x, center.y - 0.01, center.z + distance);
    } else if (mode === "front") {
      camera.position.set(center.x, center.y - distance, center.z + 0.01);
    } else {
      camera.position.set(
        center.x + distance * 0.62,
        center.y - distance * 0.62,
        center.z + distance * 0.5
      );
    }
    controls.target.copy(center);
    controls.update();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const offset = camera.position
      .clone()
      .sub(controls.target)
      .multiplyScalar(factor);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      container.classList.add(
        "flex",
        "items-center",
        "justify-center",
        "p-6",
        "text-center",
        "text-sm",
        "text-muted-foreground"
      );
      container.textContent =
        "Tu navegador no puede mostrar la vista 3D, pero la exportación sigue disponible.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.5, 12000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -120, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 1;
    controls.maxDistance = 8000;

    scene.add(new HemisphereLight(0xffffff, 0x64748b, 0.65));
    const key = new DirectionalLight(0xffffff, 2.3);
    key.position.set(80, -120, 180);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.6);
    fill.position.set(-120, 90, 60);
    scene.add(fill);
    const rim = new DirectionalLight(0xffffff, 0.45);
    rim.position.set(-40, 140, -90);
    scene.add(rim);

    const grid = new GridHelper(200, 40, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.4;
    scene.add(grid);
    gridRef.current = grid;

    const partsGroup = new Group();
    const planesGroup = new Group();
    scene.add(partsGroup, planesGroup);

    const raycaster = new Raycaster();
    raycaster.firstHitOnly = true;
    const pointer = new Vector2();
    const dragPlane = new Plane();
    const dragNormal = new Vector3();
    const dragPoint = new Vector3();
    const dragDelta = new Vector3();
    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      return true;
    };
    const hitAt = (event: PointerEvent) => {
      const entries = partEntriesRef.current;
      if (entries.length === 0 || !setPointer(event)) return null;
      const hits = raycaster.intersectObjects(
        entries.map((entry) => entry.mesh),
        false
      );
      const hit = hits[0];
      if (!hit || hit.faceIndex == null) return null;
      const found = entries.find((entry) => entry.mesh === hit.object);
      if (!found) return null;
      return { hit, found };
    };
    const cutHitAt = (event: PointerEvent) => {
      const meshes = planesGroup.children.filter(
        (child): child is Mesh =>
          child instanceof Mesh &&
          typeof child.userData.cutId === "string" &&
          child.userData.cutKind !== "region-node"
      );
      if (meshes.length === 0 || !setPointer(event)) return null;
      const hits = raycaster.intersectObjects(meshes, false);
      const hit = hits[0];
      if (!hit || hit.faceIndex == null) return null;
      const partHit = raycaster.intersectObjects(
        partEntriesRef.current.map((entry) => entry.mesh),
        false
      )[0];
      if (partHit && partHit.distance < hit.distance - 0.05) return null;
      return hit.object;
    };
    const nodeHitAt = (event: PointerEvent) => {
      const meshes = planesGroup.children.filter(
        (child): child is Mesh =>
          child instanceof Mesh &&
          child.userData.cutKind === "region-node"
      );
      if (meshes.length === 0 || !setPointer(event)) return null;
      const hit = raycaster.intersectObjects(meshes, false)[0];
      return hit ? (hit.object as Mesh) : null;
    };
    const axisNormal = (axis: CutAxis): Vector3 =>
      new Vector3(
        axis === "x" ? 1 : 0,
        axis === "y" ? 1 : 0,
        axis === "z" ? 1 : 0
      );
    const toRegion2D = (
      point: Vector3,
      axis: CutAxis
    ): [number, number] =>
      axis === "x"
        ? [point.y, point.z]
        : axis === "y"
          ? [point.x, point.z]
          : [point.x, point.y];
    const pointOffset = (
      point: Vector3,
      axis: CutAxis
    ): number => (axis === "x" ? point.x : axis === "y" ? point.y : point.z);
    const beginDragPlane = (point: Vector3) => {
      camera.getWorldDirection(dragNormal);
      dragPlane.setFromNormalAndCoplanarPoint(dragNormal, point);
    };
    const pointerOnDragPlane = (event: PointerEvent) => {
      if (!setPointer(event)) return null;
      return raycaster.ray.intersectPlane(dragPlane, dragPoint);
    };
    const capturePointer = (pointerId: number) => {
      try {
        renderer.domElement.setPointerCapture(pointerId);
      } catch {
        return;
      }
    };
    const emitPick = (
      result: NonNullable<ReturnType<typeof hitAt>>,
      action: PaintAction
    ) => {
      if (!onPickRef.current) return;
      const local = result.found.mesh.worldToLocal(result.hit.point.clone());
      onPickRef.current({
        partId: result.found.mesh.userData.partId as string,
        faceIndex: result.hit.faceIndex as number,
        point: [local.x, local.y, local.z],
        action,
      });
    };

    let painting = false;
    let paintedFace = -1;
    let lastPaintAt = 0;
    const zAxis = new Vector3(0, 0, 1);
    const cutQuaternion = new Quaternion();
    const cameraRight = new Vector3();
    const cameraUp = new Vector3();
    let cutDrag: {
      id: string;
      mode: "move" | "rotate";
      startOffset: number;
      startPoint: Vector3;
      startNormal: Vector3;
      normal: Vector3;
      pivot: Vector3;
      offset: number;
      startX: number;
      startY: number;
    } | null = null;
    let partDrag: {
      entry: PartMeshEntry;
      startPosition: Vector3;
      startPoint: Vector3;
    } | null = null;
    let nodeDrag: {
      mesh: Mesh;
      id: string;
      ringIndex: number;
      pointIndex: number;
      axis: CutAxis;
      plane: Plane;
      point: [number, number];
    } | null = null;

    const updateCutVisual = (
      id: string,
      normal: Vector3,
      offset: number,
      pivot: Vector3
    ) => {
      cutQuaternion.setFromUnitVectors(zAxis, normal);
      for (const child of planesGroup.children) {
        if (child.userData.cutId !== id) continue;
        child.position.copy(pivot);
        child.quaternion.copy(cutQuaternion);
      }
      if (cutDrag) cutDrag.offset = offset;
    };

    const finishDrag = () => {
      if (nodeDrag) {
        onEditRegionNodeRef.current?.(
          nodeDrag.id,
          nodeDrag.ringIndex,
          nodeDrag.pointIndex,
          nodeDrag.point
        );
        nodeDrag = null;
      }
      if (cutDrag) {
        const normal: [number, number, number] = [
          cutDrag.normal.x,
          cutDrag.normal.y,
          cutDrag.normal.z,
        ];
        if (onTransformCutRef.current) {
          onTransformCutRef.current(cutDrag.id, normal, cutDrag.offset);
        } else if (cutDrag.mode === "move") {
          onMoveCutRef.current?.(cutDrag.id, cutDrag.offset);
        }
        cutDrag = null;
      }
      if (partDrag) {
        const offset = partDrag.entry.mesh.position
          .clone()
          .sub(partDrag.entry.explodedPosition);
        onMovePartRef.current?.(partDrag.entry.mesh.userData.partId as string, [
          offset.x,
          offset.y,
          offset.z,
        ]);
        partDrag = null;
      }
      painting = false;
      paintedFace = -1;
      controls.enabled = true;
      renderer.domElement.style.cursor = "";
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const active = placementRef.current;
      if (active) {
        const result = hitAt(event);
        if (!result) return;
        event.stopPropagation();
        active.onCommit(pointOffset(result.hit.point, active.axis), [
          result.hit.point.x,
          result.hit.point.y,
          result.hit.point.z,
        ]);
        return;
      }
      if (pickModeRef.current && onPickRef.current) {
        const result = hitAt(event);
        if (!result) return;
        event.stopPropagation();
        event.preventDefault();
        capturePointer(event.pointerId);
        painting = true;
        controls.enabled = false;
        paintedFace = result.hit.faceIndex as number;
        lastPaintAt = performance.now();
        const action: PaintAction = event.altKey
          ? "subtract"
          : event.shiftKey || event.ctrlKey || event.metaKey
            ? "add"
            : "replace";
        emitPick(result, action);
        renderer.domElement.style.cursor = "crosshair";
        return;
      }
      if (moveModeRef.current) {
        const result = hitAt(event);
        if (!result) return;
        event.stopPropagation();
        event.preventDefault();
        capturePointer(event.pointerId);
        controls.enabled = false;
        partDrag = {
          entry: result.found,
          startPosition: result.found.mesh.position.clone(),
          startPoint: result.hit.point.clone(),
        };
        beginDragPlane(result.hit.point);
        renderer.domElement.style.cursor = "grabbing";
        return;
      }
      const nodeMesh = nodeHitAt(event);
      if (nodeMesh) {
        event.stopPropagation();
        event.preventDefault();
        capturePointer(event.pointerId);
        controls.enabled = false;
        const axis = nodeMesh.userData.cutAxis as CutAxis;
        const planeValue = nodeMesh.userData.cutPlane as number;
        const origin =
          axis === "x"
            ? new Vector3(planeValue, 0, 0)
            : axis === "y"
              ? new Vector3(0, planeValue, 0)
              : new Vector3(0, 0, planeValue);
        nodeDrag = {
          mesh: nodeMesh,
          id: nodeMesh.userData.cutId as string,
          ringIndex: nodeMesh.userData.ringIndex as number,
          pointIndex: nodeMesh.userData.pointIndex as number,
          axis,
          plane: new Plane().setFromNormalAndCoplanarPoint(
            axisNormal(axis),
            origin
          ),
          point: toRegion2D(nodeMesh.position, axis),
        };
        renderer.domElement.style.cursor = "grabbing";
        return;
      }
      const cutMesh = cutHitAt(event);
      if (!cutMesh) return;
      event.stopPropagation();
      event.preventDefault();
      capturePointer(event.pointerId);
      controls.enabled = false;
      const normalValues = cutMesh.userData.cutNormal as
        | [number, number, number]
        | undefined;
      const normal = normalValues
        ? new Vector3(...normalValues).normalize()
        : new Vector3(0, 0, 1);
      const pivot = cutMesh.position.clone();
      cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
      cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
      cutDrag = {
        id: cutMesh.userData.cutId as string,
        mode:
          cutMesh.userData.cutHandle === "rotate" || event.shiftKey
            ? "rotate"
            : "move",
        startOffset: cutMesh.userData.cutOffset as number,
        startPoint: pivot.clone(),
        startNormal: normal.clone(),
        normal,
        pivot,
        offset: cutMesh.userData.cutOffset as number,
        startX: event.clientX,
        startY: event.clientY,
      };
      beginDragPlane(pivot);
      renderer.domElement.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (nodeDrag) {
        if (!setPointer(event)) return;
        const point = raycaster.ray.intersectPlane(nodeDrag.plane, dragPoint);
        if (!point) return;
        nodeDrag.mesh.position.copy(point);
        nodeDrag.point = toRegion2D(point, nodeDrag.axis);
        return;
      }
      if (cutDrag) {
        if (cutDrag.mode === "rotate") {
          const dx = event.clientX - cutDrag.startX;
          const dy = event.clientY - cutDrag.startY;
          const normal = cutDrag.startNormal
            .clone()
            .applyAxisAngle(cameraRight, dy * 0.008)
            .applyAxisAngle(cameraUp, -dx * 0.008)
            .normalize();
          cutDrag.normal = normal;
          cutDrag.offset = normal.dot(cutDrag.pivot);
          updateCutVisual(
            cutDrag.id,
            normal,
            cutDrag.offset,
            cutDrag.pivot
          );
          return;
        }
        const point = pointerOnDragPlane(event);
        if (!point) return;
        const delta = point.clone().sub(cutDrag.startPoint).dot(cutDrag.normal);
        cutDrag.offset = cutDrag.startOffset + delta;
        const pivot = cutDrag.pivot
          .clone()
          .addScaledVector(cutDrag.normal, delta);
        updateCutVisual(
          cutDrag.id,
          cutDrag.normal,
          cutDrag.offset,
          pivot
        );
        return;
      }
      if (partDrag) {
        const point = pointerOnDragPlane(event);
        if (!point) return;
        dragDelta.copy(point).sub(partDrag.startPoint);
        partDrag.entry.mesh.position.copy(partDrag.startPosition).add(dragDelta);
        return;
      }
      if (painting) {
        if (performance.now() - lastPaintAt < 90) return;
        const result = hitAt(event);
        if (!result) return;
        const face = result.hit.faceIndex as number;
        if (face === paintedFace) return;
        paintedFace = face;
        lastPaintAt = performance.now();
        emitPick(result, event.altKey ? "subtract" : "add");
        return;
      }
      const active = placementRef.current;
      if (active) {
        const result = hitAt(event);
        if (!result) return;
        active.onPreview(pointOffset(result.hit.point, active.axis), [
          result.hit.point.x,
          result.hit.point.y,
          result.hit.point.z,
        ]);
        renderer.domElement.style.cursor = "crosshair";
        return;
      }
      if (!pickModeRef.current && !moveModeRef.current) {
        renderer.domElement.style.cursor = cutHitAt(event) ? "grab" : "";
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (painting) {
        const result = hitAt(event);
        if (result) {
          const face = result.hit.faceIndex as number;
          if (face !== paintedFace) {
            paintedFace = face;
            emitPick(result, event.altKey ? "subtract" : "add");
          }
        }
      }
      finishDrag();
    };
    renderer.domElement.addEventListener(
      "pointerdown",
      onPointerDown,
      true
    );
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    partsGroupRef.current = partsGroup;
    planesGroupRef.current = planesGroup;

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener(
        "pointerdown",
        onPointerDown,
        true
      );
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      for (const entry of partEntriesRef.current) {
        partsGroup.remove(entry.mesh);
        disposeObject(entry.mesh);
      }
      partEntriesRef.current = [];
      for (const child of [...planesGroup.children]) {
        planesGroup.remove(child);
        if (child instanceof Mesh || child instanceof Line) {
          disposeObject(child);
        }
      }
      controls.dispose();
      grid.geometry.dispose();
      const gridMaterial = grid.material;
      if (Array.isArray(gridMaterial)) {
        gridMaterial.forEach((item) => item.dispose());
      } else {
        gridMaterial.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      gridRef.current = null;
      partsGroupRef.current = null;
      planesGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = partsGroupRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !scene || !camera || !controls) return;

    for (const entry of partEntriesRef.current) {
      group.remove(entry.mesh);
      disposeObject(entry.mesh);
    }
    partEntriesRef.current = [];

    if (parts.length === 0) {
      fitRef.current = null;
      return;
    }

    const allBox = new Box3();
    for (const part of parts) {
      const geometry = geometryFromMesh(part.mesh);
      const selected = part.id === selectedPartId;
      const material = new MeshStandardMaterial({
        color: part.color,
        roughness: 0.6,
        metalness: 0.05,
        side: DoubleSide,
        wireframe,
        emissive: selected ? 0x0f3d5c : 0x000000,
        emissiveIntensity: selected ? 0.35 : 0,
      });
      const mesh = new Mesh(geometry, material);
      mesh.userData.partId = part.id;
      mesh.updateMatrixWorld(true);
      const box = new Box3().setFromObject(mesh);
      const center = box.getCenter(new Vector3());
      allBox.union(box);
      group.add(mesh);
      partEntriesRef.current.push({
        mesh,
        baseCenter: center,
        explodedPosition: center.clone(),
      });
    }

    const center = allBox.getCenter(new Vector3());
    const size = allBox.getSize(new Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 1);
    const fov = (camera.fov * Math.PI) / 180;
    const distance = (maxDimension / 2 / Math.tan(fov / 2)) * 2.1;
    fitRef.current = { center, distance, maxDimension };

    camera.near = Math.max(0.05, distance / 500);
    camera.far = distance * 60;
    camera.updateProjectionMatrix();

    const oldGrid = gridRef.current;
    if (oldGrid) {
      scene.remove(oldGrid);
      oldGrid.geometry.dispose();
      const gridMaterial = oldGrid.material;
      if (Array.isArray(gridMaterial)) {
        gridMaterial.forEach((item) => item.dispose());
      } else {
        gridMaterial.dispose();
      }
    }
    const gridSize = maxDimension * 2.6;
    const divisions = Math.min(160, Math.max(10, Math.round(maxDimension / 8)));
    const grid = new GridHelper(gridSize, divisions, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(center.x, center.y, allBox.min.z - maxDimension * 0.002);
    grid.visible = showGridRef.current;
    scene.add(grid);
    gridRef.current = grid;

    applyView("iso");
    controls.update();
  }, [applyView, parts, selectedPartId, wireframe]);

  useEffect(() => {
    const entries = partEntriesRef.current;
    if (entries.length === 0) return;
    const fit = fitRef.current;
    const spread = (fit?.maxDimension ?? 10) * 1.1 * exploded;
    const overall = new Vector3();
    for (const entry of entries) overall.add(entry.baseCenter);
    overall.divideScalar(entries.length);
    const offsets = offsetsRef.current;
    for (const entry of entries) {
      const direction = entry.baseCenter.clone().sub(overall);
      if (direction.lengthSq() < 1e-9) direction.set(0, 0, 1);
      direction.normalize();
      entry.explodedPosition.copy(direction.multiplyScalar(spread));
      const offset = offsets[entry.mesh.userData.partId as string];
      const target = entry.explodedPosition.clone();
      if (offset) {
        target.x += offset[0];
        target.y += offset[1];
        target.z += offset[2];
      }
      entry.mesh.position.copy(target);
    }
  }, [exploded, parts, partOffsets]);

  useEffect(() => {
    if (!selection || selection.faces.length === 0) return;
    const entry = partEntriesRef.current.find(
      (item) => item.mesh.userData.partId === selection.partId
    );
    if (!entry) return;
    const part = parts.find((item) => item.id === selection.partId);
    if (!part) return;
    if (selection.faces.length > MAX_SOLID_FACES) {
      const material = entry.mesh.material;
      if (!(material instanceof MeshStandardMaterial)) return;
      const emissive = material.emissive.clone();
      const intensity = material.emissiveIntensity;
      material.emissive.setHex(0xf59e0b);
      material.emissiveIntensity = 0.5;
      const restoreMaterial = () => {
        material.emissive.copy(emissive);
        material.emissiveIntensity = intensity;
      };
      if (!selection.loops || selection.loops.length > 60) {
        return restoreMaterial;
      }
      const segments: number[] = [];
      for (const loop of selection.loops) {
        for (let index = 0; index < loop.length; index += 1) {
          const point = loop[index];
          const next = loop[(index + 1) % loop.length];
          segments.push(point[0], point[1], point[2], next[0], next[1], next[2]);
        }
      }
      const geometry = new BufferGeometry();
      const attribute = new BufferAttribute(
        new Float32Array(segments),
        3
      );
      geometry.setAttribute("position", attribute);
      const box = new Box3().setFromBufferAttribute(attribute);
      geometry.boundingBox = box;
      geometry.boundingSphere = box.getBoundingSphere(new Sphere());
      const outline = new LineSegments(
        geometry,
        new LineBasicMaterial({
          color: 0xfb923c,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        })
      );
      outline.renderOrder = 4;
      entry.mesh.add(outline);
      selectionMeshRef.current = null;
      return () => {
        outline.removeFromParent();
        disposeObject(outline);
        restoreMaterial();
      };
    }
    const positions = new Float32Array(selection.faces.length * 9);
    selection.faces.forEach((face, faceIndex) => {
      const base = faceIndex * 9;
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = part.mesh.faces[face * 3 + corner] * 3;
        const x = part.mesh.vertices[vertex];
        const y = part.mesh.vertices[vertex + 1];
        const z = part.mesh.vertices[vertex + 2];
        positions[base + corner * 3] = Number.isFinite(x) ? x : 0;
        positions[base + corner * 3 + 1] = Number.isFinite(y) ? y : 0;
        positions[base + corner * 3 + 2] = Number.isFinite(z) ? z : 0;
      }
    });
    const geometry = new BufferGeometry();
    const attribute = new BufferAttribute(positions, 3);
    geometry.setAttribute("position", attribute);
    const box = new Box3().setFromBufferAttribute(attribute);
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    const material = new MeshBasicMaterial({
      color: 0xfb923c,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const overlay = new Mesh(geometry, material);
    overlay.renderOrder = 3;
    entry.mesh.add(overlay);
    selectionMeshRef.current = overlay;
    return () => {
      overlay.removeFromParent();
      disposeObject(overlay);
      if (selectionMeshRef.current === overlay) {
        selectionMeshRef.current = null;
      }
    };
  }, [selection, parts]);

  useEffect(() => {
    const group = planesGroupRef.current;
    if (!group || parts.length === 0) return;
    for (const child of [...group.children]) {
      group.remove(child);
      if (child instanceof Mesh || child instanceof Line) {
        disposeObject(child);
      }
    }
    if (!showCutPreviews) return;

    const boxes = parts.map((part) => {
      const entry = partEntriesRef.current.find(
        (item) => item.mesh.userData.partId === part.id
      );
      return entry ? new Box3().setFromObject(entry.mesh) : new Box3();
    });
    const bounds = boxes.reduce((acc, box) => acc.union(box), new Box3());
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const span = Math.max(size.x, size.y, size.z, 10) * 1.28;
    const modelSpan = Math.max(size.x, size.y, size.z, 10);
    const nodeRadius = Math.max(0.35, modelSpan * 0.006);
    const zAxis = new Vector3(0, 0, 1);

    for (const plane of cuts) {
      if (!plane.enabled || plane.kind !== "plane") continue;
      const normal = new Vector3(
        ...(plane.normal ?? [
          plane.axis === "x" ? 1 : 0,
          plane.axis === "y" ? 1 : 0,
          plane.axis === "z" ? 1 : 0,
        ])
      ).normalize();
      const position = center
        .clone()
        .addScaledVector(normal, plane.offset - center.dot(normal));
      const active = plane.id === activeCutId;
      const geometry = new PlaneGeometry(span, span);
      const material = new MeshStandardMaterial({
        color: active ? 0x0ea5e9 : 0x38bdf8,
        transparent: true,
        opacity: active ? 0.24 : 0.14,
        side: DoubleSide,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.quaternion.setFromUnitVectors(zAxis, normal);
      mesh.userData.cutId = plane.id;
      mesh.userData.cutAxis = plane.axis;
      mesh.userData.cutOffset = plane.offset;
      mesh.userData.cutNormal = [normal.x, normal.y, normal.z];
      mesh.userData.cutHandle = "move";
      group.add(mesh);

      const edges = new LineSegments(
        new EdgesGeometry(geometry),
        new LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.9 })
      );
      edges.position.copy(position);
      edges.quaternion.copy(mesh.quaternion);
      edges.userData.cutId = plane.id;
      group.add(edges);

      if (active) {
        const ringRadius = span * 0.46;
        const ring = new Mesh(
          new TorusGeometry(
            ringRadius,
            Math.max(0.5, ringRadius * 0.018),
            12,
            96
          ),
          new MeshBasicMaterial({
            color: 0xf59e0b,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          })
        );
        ring.position.copy(position);
        ring.quaternion.copy(mesh.quaternion);
        ring.renderOrder = 4;
        ring.userData.cutId = plane.id;
        ring.userData.cutOffset = plane.offset;
        ring.userData.cutNormal = [normal.x, normal.y, normal.z];
        ring.userData.cutHandle = "rotate";
        group.add(ring);
      }
    }
    const regionCuts = cuts.filter(
      (cut): cut is RegionCutOp => cut.enabled && cut.kind === "region"
    );
    const totalRegionPoints = regionCuts.reduce(
      (sum, cut) =>
        sum + cut.rings.reduce((ringSum, ring) => ringSum + ring.length, 0),
      0
    );
    let nodeBudget = 400;
    for (const cut of cuts) {
      if (!cut.enabled) continue;
      const color = cut.id === activeCutId ? 0xf59e0b : 0xc084fc;
      const nodeColor = cut.id === activeCutId ? 0xf59e0b : 0x38bdf8;
      if (cut.kind === "curve") {
        const points: Vector3[] = [];
        const segments = 160;
        if (cut.axis === "x") {
          const start = bounds.min.x;
          const end = bounds.max.x;
          for (let index = 0; index <= segments; index += 1) {
            const x = start + ((end - start) * index) / segments;
            const z =
              cut.offset +
              cut.amplitude *
                Math.sin(
                  ((x - bounds.min.x) / Math.max(0.001, cut.wavelength)) *
                    Math.PI *
                    2 +
                    cut.phase
                );
            points.push(new Vector3(x, center.y, z));
          }
        } else {
          const start = bounds.min.y;
          const end = bounds.max.y;
          for (let index = 0; index <= segments; index += 1) {
            const y = start + ((end - start) * index) / segments;
            const z =
              cut.offset +
              cut.amplitude *
                Math.sin(
                  ((y - bounds.min.y) / Math.max(0.001, cut.wavelength)) *
                    Math.PI *
                    2 +
                    cut.phase
                );
            points.push(new Vector3(center.x, y, z));
          }
        }
        const line = new Line(
          new BufferGeometry().setFromPoints(points),
          new LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          })
        );
        line.renderOrder = 5;
        line.userData.cutId = cut.id;
        line.userData.cutKind = "curve";
        group.add(line);
      } else if (cut.kind === "shape") {
        const rings = buildShapeRings(cut.shape, {
          widthMm: cut.width,
          heightMm: cut.height,
          cornerMm: Math.min(cut.width, cut.height) * 0.12,
          starPoints: 5,
          starInnerRatio: 0.45,
        });
        const ring = rings[0];
        if (!ring || ring.length < 3) continue;
        const angle = (cut.rotationDeg * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const points = ring.map(
          ([x, y]) =>
            new Vector3(
              center.x + x * cos - y * sin + cut.offsetX,
              center.y + x * sin + y * cos + cut.offsetY,
              bounds.max.z + Math.max(0.15, size.z * 0.002)
            )
        );
        const outline = new LineLoop(
          new BufferGeometry().setFromPoints(points),
          new LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          })
        );
        outline.renderOrder = 5;
        outline.userData.cutId = cut.id;
        outline.userData.cutKind = "shape";
        group.add(outline);
      } else if (cut.kind === "region") {
        const plane = (cut.min + cut.max) / 2;
        cut.rings.forEach((ring, ringIndex) => {
          if (ring.length < 3) return;
          const points = ring.map(([first, second]) =>
            cut.axis === "x"
              ? new Vector3(plane, first, second)
              : cut.axis === "y"
                ? new Vector3(first, plane, second)
                : new Vector3(first, second, plane)
          );
          const outline = new LineLoop(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({
              color,
              transparent: true,
              opacity: 0.95,
              depthTest: false,
            })
          );
          outline.renderOrder = 5;
          outline.userData.cutId = cut.id;
          outline.userData.cutKind = "region";
          group.add(outline);

          let count = ring.length;
          if (totalRegionPoints > 400) {
            count = Math.max(
              3,
              Math.floor((ring.length / totalRegionPoints) * 400)
            );
          }
          count = Math.min(count, ring.length, nodeBudget);
          if (count < 1) return;
          for (let index = 0; index < count; index += 1) {
            const pointIndex =
              count === ring.length
                ? index
                : Math.floor((index * ring.length) / count);
            const [first, second] = ring[pointIndex];
            const position =
              cut.axis === "x"
                ? new Vector3(plane, first, second)
                : cut.axis === "y"
                  ? new Vector3(first, plane, second)
                  : new Vector3(first, second, plane);
            const node = new Mesh(
              new SphereGeometry(nodeRadius, 12, 8),
              new MeshBasicMaterial({
                color: nodeColor,
                depthTest: false,
                depthWrite: false,
              })
            );
            node.position.copy(position);
            node.renderOrder = 6;
            node.userData.cutId = cut.id;
            node.userData.cutKind = "region-node";
            node.userData.ringIndex = ringIndex;
            node.userData.pointIndex = pointIndex;
            node.userData.cutAxis = cut.axis;
            node.userData.cutPlane = plane;
            node.userData.nodeRadius = nodeRadius;
            group.add(node);
            nodeBudget -= 1;
            if (nodeBudget <= 0) return;
          }
        });
      }
    }
  }, [activeCutId, cuts, parts, showCutPreviews]);

  return (
    <PanelTooltips>
      <div className={cn("relative", className)}>
        <div
          ref={containerRef}
          className="size-full overflow-hidden rounded-lg border bg-gradient-to-b from-muted/45 via-muted/15 to-background"
        />
        {parts.length > 0 ? (
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <IconAction
              label="Centrar vista"
              icon={RefreshCw}
              onClick={() => applyView("iso")}
            />
            <IconAction
              label="Vista superior"
              icon={ArrowDown}
              onClick={() => applyView("top")}
            />
            <IconAction
              label="Vista frontal"
              icon={Scan}
              onClick={() => applyView("front")}
            />
            <IconAction
              label="Acercar"
              icon={ZoomIn}
              onClick={() => zoomBy(0.82)}
            />
            <IconAction
              label="Alejar"
              icon={ZoomOut}
              onClick={() => zoomBy(1.22)}
            />
            <IconAction
              label={
                showGrid ? "Ocultar cuadrícula" : "Mostrar cuadrícula"
              }
              icon={Grid3x3}
              active={showGrid}
              onClick={() => setShowGrid((value) => !value)}
            />
            <IconAction
              label={wireframe ? "Ver sólido" : "Ver aristas"}
              icon={Box}
              active={wireframe}
              onClick={() => setWireframe((value) => !value)}
            />
            <IconAction
              label="Vista completa"
              icon={Maximize2}
              onClick={() => {
                const fit = fitRef.current;
                const camera = cameraRef.current;
                const controls = controlsRef.current;
                if (!fit || !camera || !controls) return;
                camera.position.set(
                  fit.center.x + fit.distance * 0.62,
                  fit.center.y - fit.distance * 0.62,
                  fit.center.z + fit.distance * 0.5
                );
                controls.target.copy(fit.center);
                controls.update();
              }}
            />
          </div>
        ) : null}
        {pickMode ? (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-primary/40 bg-background/90 px-2 py-1 text-[10px] font-medium text-primary shadow-sm backdrop-blur">
            Arrastrá para pintar la zona · Shift suma · Alt resta
          </span>
        ) : moveMode ? (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-primary/40 bg-background/90 px-2 py-1 text-[10px] font-medium text-primary shadow-sm backdrop-blur">
            Arrastrá una pieza para moverla · soltá para fijarla
          </span>
        ) : cuts.some((cut) => cut.kind === "plane" && cut.enabled) ? (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            Arrastrá el plano para moverlo y el aro ámbar para inclinarlo
          </span>
        ) : null}
      </div>
    </PanelTooltips>
  );
}
