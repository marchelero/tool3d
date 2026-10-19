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
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { MeshPiece } from "@/lib/3d/mesh";

interface ModelViewerProps {
  meshes: MeshPiece[];
  widthMm: number;
  heightMm: number;
  designMm?: number;
  expanded?: boolean;
  onToggleExpanded?: () => void;
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
  className,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
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
        Arrastra para girar · rueda o botones para acercar
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
