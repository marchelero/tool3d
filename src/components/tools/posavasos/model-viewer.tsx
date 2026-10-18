"use client";

import { useEffect, useRef } from "react";
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
  className?: string;
}

export function ModelViewer({
  meshes,
  widthMm,
  heightMm,
  className,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<Group | null>(null);

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
    };
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

    for (const piece of meshes) {
      const material = new MeshStandardMaterial({
        color: piece.hex,
        roughness: 0.62,
        metalness: 0.04,
        side: DoubleSide,
        flatShading: false,
      });
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

    camera.position.set(
      center.x + distance * 0.62,
      center.y - distance * 0.62,
      center.z + distance * 0.55
    );
    camera.near = Math.max(0.5, distance / 200);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }, [meshes]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div
        ref={containerRef}
        className="size-full overflow-hidden rounded-lg border bg-gradient-to-b from-muted/40 to-muted/10"
      />
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
        {Math.round(widthMm * 10) / 10} mm · {Math.round(heightMm * 100) / 100}{" "}
        mm de alto
      </div>
      <div className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
        Arrastra para girar · rueda para acercar
      </div>
    </div>
  );
}
