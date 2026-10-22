"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  Box,
  Eye,
  EyeOff,
  Grid3x3,
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
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IconAction, PanelTooltips } from "@/components/tools/shared/panel";
import { cn } from "@/lib/utils";

interface FitState {
  center: Vector3;
  distance: number;
  maxDimension: number;
}

export function TexturizerViewer({
  originalGeometry,
  geometry,
  showOriginal,
  onToggleShowOriginal,
  className,
}: {
  originalGeometry: BufferGeometry | null;
  geometry: BufferGeometry | null;
  showOriginal: boolean;
  onToggleShowOriginal: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const materialRef = useRef<MeshStandardMaterial | null>(null);
  const gridRef = useRef<GridHelper | null>(null);
  const fitRef = useRef<FitState | null>(null);
  const lastOriginalRef = useRef<BufferGeometry | null>(null);

  const [showGrid, setShowGrid] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const showGridRef = useRef(showGrid);

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
        center.x + distance * 0.6,
        center.y - distance * 0.6,
        center.z + distance * 0.52
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
    const camera = new PerspectiveCamera(38, 1, 0.5, 8000);
    camera.up.set(0, 0, 1);
    camera.position.set(120, -120, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 2;
    controls.maxDistance = 4000;
    controls.autoRotateSpeed = 1.5;

    scene.add(new HemisphereLight(0xffffff, 0x64748b, 0.6));
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(80, -120, 180);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.55);
    fill.position.set(-120, 90, 60);
    scene.add(fill);
    const rim = new DirectionalLight(0xffffff, 0.4);
    rim.position.set(-40, 140, -90);
    scene.add(rim);

    const material = new MeshStandardMaterial({
      color: 0xb8c1cc,
      roughness: 0.56,
      metalness: 0.05,
      side: DoubleSide,
      flatShading: false,
      wireframe: false,
    });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.visible = false;
    scene.add(mesh);

    const grid = new GridHelper(200, 40, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.4;
    scene.add(grid);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    meshRef.current = mesh;
    materialRef.current = material;
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
      material.dispose();
      grid.geometry.dispose();
      const gridMaterial = grid.material;
      if (Array.isArray(gridMaterial)) {
        gridMaterial.forEach((item) => item.dispose());
      } else {
        gridMaterial.dispose();
      }
      scene.remove(mesh);
      scene.remove(grid);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      meshRef.current = null;
      materialRef.current = null;
      gridRef.current = null;
    };
  }, []);

  useEffect(() => {
    const material = materialRef.current;
    if (material) material.wireframe = wireframe;
  }, [wireframe]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls) controls.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    showGridRef.current = showGrid;
    const grid = gridRef.current;
    if (grid) grid.visible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const display = !showOriginal && geometry ? geometry : originalGeometry;
    if (!display) {
      mesh.visible = false;
      return;
    }
    mesh.geometry = display;
    mesh.visible = true;
  }, [geometry, originalGeometry, showOriginal]);

  useEffect(() => {
    const mesh = meshRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const scene = sceneRef.current;
    if (!mesh || !camera || !controls || !scene || !originalGeometry) return;
    if (lastOriginalRef.current === originalGeometry) return;
    lastOriginalRef.current = originalGeometry;

    mesh.geometry = originalGeometry;
    mesh.visible = true;
    mesh.position.set(0, 0, 0);
    mesh.updateMatrixWorld(true);
    const rawBox = new Box3().setFromObject(mesh);
    const rawCenter = rawBox.getCenter(new Vector3());
    mesh.position.set(-rawCenter.x, -rawCenter.y, -rawCenter.z);
    mesh.updateMatrixWorld(true);

    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 1);
    const fov = (camera.fov * Math.PI) / 180;
    const distance = (maxDimension / 2 / Math.tan(fov / 2)) * 2.1;
    fitRef.current = { center, distance, maxDimension };

    camera.near = Math.max(0.05, distance / 400);
    camera.far = distance * 40;
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
    const gridSize = maxDimension * 2.4;
    const divisions = Math.min(140, Math.max(12, Math.round(maxDimension / 10)));
    const grid = new GridHelper(gridSize, divisions, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(0, 0, box.min.z - maxDimension * 0.002);
    grid.visible = showGridRef.current;
    scene.add(grid);
    gridRef.current = grid;

    applyView("iso");
  }, [applyView, originalGeometry]);

  return (
    <PanelTooltips>
      <div className={cn("relative", className)}>
        <div
          ref={containerRef}
          className="size-full overflow-hidden rounded-lg border bg-gradient-to-b from-muted/45 via-muted/15 to-background"
        />
        {originalGeometry ? (
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <IconAction
              label={showOriginal ? "Ver textura" : "Ver original"}
              icon={showOriginal ? EyeOff : Eye}
              active={showOriginal}
              onClick={onToggleShowOriginal}
            />
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
              label={showGrid ? "Ocultar cuadrícula" : "Mostrar cuadrícula"}
              icon={Grid3x3}
              active={showGrid}
              onClick={() => setShowGrid((value) => !value)}
            />
            <IconAction
              label={wireframe ? "Ocultar aristas" : "Mostrar aristas"}
              icon={Box}
              active={wireframe}
              onClick={() => setWireframe((value) => !value)}
            />
            <IconAction
              label={autoRotate ? "Detener rotación" : "Rotar automáticamente"}
              icon={Rotate3d}
              active={autoRotate}
              onClick={() => setAutoRotate((value) => !value)}
            />
          </div>
        ) : null}
        {showOriginal ? (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border bg-background/85 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
            Original
          </span>
        ) : null}
      </div>
    </PanelTooltips>
  );
}
