"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  Box,
  Grid3x3,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rotate3d,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Box3,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshPiece } from "@/lib/3d/mesh";

export interface RingDrag {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  wall: number;
  onCommit: (x: number, y: number) => void;
}

interface ModelViewerProps {
  meshes: MeshPiece[];
  widthMm: number;
  heightMm: number;
  designMm?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  ringDrag?: RingDrag;
  className?: string;
}

interface FitState {
  center: Vector3;
  distance: number;
}

export function ModelViewer({
  meshes,
  widthMm,
  heightMm,
  designMm = 0,
  expanded = false,
  onToggleExpanded,
  ringDrag,
  className,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ringDragRef = useRef<RingDrag | undefined>(ringDrag);
  const ghostRef = useRef<Group | null>(null);
  const ghostOuterRef = useRef<LineLoop | null>(null);
  const ghostInnerRef = useRef<LineLoop | null>(null);
  const ghostPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const committedRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pressedRef = useRef(false);
  const topZRef = useRef(0);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<Group | null>(null);
  const gridRef = useRef<GridHelper | null>(null);
  const materialsRef = useRef<MeshStandardMaterial[]>([]);
  const wireframeRef = useRef(false);
  const fitRef = useRef<FitState | null>(null);
  const lastFitSizeRef = useRef<Vector3 | null>(null);

  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      container.textContent =
        "Tu navegador no puede mostrar la vista 3D, pero la exportación sigue disponible.";
      container.classList.add(
        "flex",
        "items-center",
        "justify-center",
        "p-6",
        "text-center",
        "text-sm",
        "text-muted-foreground"
      );
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(40, 1, 1, 6000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -120, 110);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minDistance = 10;
    controls.maxDistance = 1500;
    controls.autoRotateSpeed = 1.6;
    controls.target.set(0, 0, 0);

    const raycaster = new Raycaster();
    const dragPlane = new Plane(new Vector3(0, 0, 1), 0);
    const ndc = new Vector2();
    const hitPoint = new Vector3();
    const hitOnPlane = (event: PointerEvent): Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(ndc, camera);
      dragPlane.constant = -topZRef.current;
      const point = raycaster.ray.intersectPlane(dragPlane, hitPoint);
      return point ? hitPoint.clone() : null;
    };

    const circleGeometry = (segments = 72): BufferGeometry => {
      const points: Vector3[] = [];
      for (let index = 0; index < segments; index += 1) {
        const angle = (2 * Math.PI * index) / segments;
        points.push(new Vector3(Math.cos(angle), Math.sin(angle), 0));
      }
      return new BufferGeometry().setFromPoints(points);
    };
    const ghostMaterial = new LineBasicMaterial({
      color: 0x2563eb,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const ghost = new Group();
    const ghostOuter = new LineLoop(circleGeometry(), ghostMaterial);
    const ghostInner = new LineLoop(circleGeometry(), ghostMaterial);
    ghostOuter.renderOrder = 999;
    ghostInner.renderOrder = 999;
    ghost.add(ghostOuter, ghostInner);
    ghost.visible = false;
    scene.add(ghost);
    ghostRef.current = ghost;
    ghostOuterRef.current = ghostOuter;
    ghostInnerRef.current = ghostInner;

    const placeGhost = (x: number, y: number) => {
      ghostPosRef.current = { x, y };
      ghost.position.set(x, y, topZRef.current + 0.4);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!ringDragRef.current?.active) return;
      const hit = hitOnPlane(event);
      if (hit) placeGhost(hit.x, hit.y);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!ringDragRef.current?.active) return;
      const hit = hitOnPlane(event);
      if (hit) placeGhost(hit.x, hit.y);
      pressedRef.current = true;
      event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pressedRef.current) return;
      pressedRef.current = false;
      const drag = ringDragRef.current;
      if (drag?.active) {
        drag.onCommit(ghostPosRef.current.x, ghostPosRef.current.y);
      }
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);

    const grid = new GridHelper(600, 60, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.4;
    scene.add(grid);

    scene.add(new HemisphereLight(0xffffff, 0x64748b, 1.15));
    const key = new DirectionalLight(0xffffff, 1.5);
    key.position.set(80, -120, 180);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.7);
    fill.position.set(-120, 90, 60);
    scene.add(fill);

    const model = new Group();
    scene.add(model);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    modelRef.current = model;
    gridRef.current = grid;

    const render = () => {
      if (ghost.visible) ghost.position.z = topZRef.current + 0.4;
      controls.update();
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(render);

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
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      scene.remove(ghost);
      ghostOuter.geometry.dispose();
      ghostInner.geometry.dispose();
      ghostMaterial.dispose();
      ghostRef.current = null;
      ghostOuterRef.current = null;
      ghostInnerRef.current = null;
      controls.dispose();
      for (const child of [...model.children]) {
        model.remove(child);
        if (child instanceof Mesh) {
          child.geometry.dispose();
          const material = child.material;
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose());
          } else {
            material.dispose();
          }
        }
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelRef.current = null;
      gridRef.current = null;
    };
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid) grid.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) controls.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    ringDragRef.current = ringDrag;
    const controls = controlsRef.current;
    if (controls) controls.enabled = !ringDrag?.active;
    const ghost = ghostRef.current;
    const outer = ghostOuterRef.current;
    const inner = ghostInnerRef.current;
    if (ghost && outer && inner) {
      ghost.visible = Boolean(ringDrag?.active);
      if (ringDrag) {
        outer.scale.setScalar(Math.max(0.2, ringDrag.radius + ringDrag.wall));
        inner.scale.setScalar(Math.max(0.2, ringDrag.radius));
        if (
          committedRef.current.x !== ringDrag.x ||
          committedRef.current.y !== ringDrag.y
        ) {
          committedRef.current = { x: ringDrag.x, y: ringDrag.y };
          ghostPosRef.current = { x: ringDrag.x, y: ringDrag.y };
          ghost.position.set(ringDrag.x, ringDrag.y, topZRef.current + 0.4);
        }
      }
    }
    const container = containerRef.current;
    if (container) container.style.cursor = ringDrag?.active ? "crosshair" : "";
  }, [ringDrag]);

  useEffect(() => {
    wireframeRef.current = wireframe;
    for (const material of materialsRef.current) {
      material.wireframe = wireframe;
    }
  }, [wireframe]);

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
        center.z + distance * 0.55
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
    const model = modelRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!model || !camera || !controls) return;

    for (const child of [...model.children]) {
      model.remove(child);
      if (child instanceof Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material.dispose();
        }
      }
    }

    materialsRef.current = [];
    for (const piece of meshes) {
      const material = new MeshStandardMaterial({
        color: piece.hex,
        roughness: 0.62,
        metalness: 0.04,
        side: DoubleSide,
        flatShading: false,
        wireframe: wireframeRef.current,
      });
      materialsRef.current.push(material);
      const mesh = new Mesh(piece.geometry, material);
      mesh.name = piece.name;
      model.add(mesh);
    }

    if (meshes.length === 0) return;

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    topZRef.current = box.max.z;
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const fov = (camera.fov * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 2.2;

    fitRef.current = { center, distance };
    camera.near = Math.max(0.5, distance / 200);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();

    const previous = lastFitSizeRef.current;
    const resized =
      !previous ||
      Math.abs(previous.x - size.x) > 1.5 ||
      Math.abs(previous.y - size.y) > 1.5 ||
      Math.abs(previous.z - size.z) > 1.5;

    if (resized) {
      lastFitSizeRef.current = size.clone();
      applyView("iso");
    }
  }, [applyView, meshes]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        ref={containerRef}
        className="size-full overflow-hidden rounded-lg border bg-gradient-to-b from-muted/40 to-muted/10"
      />

      <div className="absolute top-2 right-2 flex flex-col gap-1.5">
        {onToggleExpanded ? (
          <ViewerButton
            label={expanded ? "Restaurar (Esc)" : "Maximizar vista 3D"}
            onClick={onToggleExpanded}
          >
            {expanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </ViewerButton>
        ) : null}
        <ViewerButton label="Acercar" onClick={() => zoomBy(0.8)}>
          <ZoomIn className="size-4" />
        </ViewerButton>
        <ViewerButton label="Alejar" onClick={() => zoomBy(1.25)}>
          <ZoomOut className="size-4" />
        </ViewerButton>
        <ViewerButton
          label="Centrar (isométrica)"
          onClick={() => applyView("iso")}
        >
          <RefreshCw className="size-4" />
        </ViewerButton>
        <ViewerButton label="Vista superior" onClick={() => applyView("top")}>
          <ArrowDown className="size-4" />
        </ViewerButton>
        <ViewerButton label="Vista frontal" onClick={() => applyView("front")}>
          <Scan className="size-4" />
        </ViewerButton>
        <ViewerButton
          label={showGrid ? "Ocultar cuadrícula (10 mm)" : "Mostrar cuadrícula (10 mm)"}
          active={showGrid}
          onClick={() => setShowGrid((value) => !value)}
        >
          <Grid3x3 className="size-4" />
        </ViewerButton>
        <ViewerButton
          label={wireframe ? "Ver sólido" : "Ver alambre"}
          active={wireframe}
          onClick={() => setWireframe((value) => !value)}
        >
          <Box className="size-4" />
        </ViewerButton>
        <ViewerButton
          label={
            autoRotate ? "Detener rotación" : "Rotación automática"
          }
          active={autoRotate}
          onClick={() => setAutoRotate((value) => !value)}
        >
          <Rotate3d className="size-4" />
        </ViewerButton>
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-1 text-[11px] tabular-nums text-muted-foreground backdrop-blur">
        Ancho {Math.round(widthMm * 10) / 10} mm · Alto{" "}
        {Math.round(heightMm * 100) / 100} mm
        {designMm > 0 ? ` · Diseño ${Math.round(designMm * 10) / 10} mm` : ""}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
        {ringDrag?.active
          ? "Mové el mouse para ver la silueta · clic para colocar la anilla"
          : "Arrastra para girar · rueda o botones para acercar"}
      </div>
    </div>
  );
}

function ViewerButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-8 items-center justify-center rounded-md border shadow-sm backdrop-blur transition-colors ${
        active
          ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/25"
          : "bg-background/85 text-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
