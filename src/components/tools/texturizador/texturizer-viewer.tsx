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
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Box3,
  BufferGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  PerspectiveCamera,
  Raycaster,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IconAction, PanelTooltips } from "@/components/tools/shared/panel";
import { cn } from "@/lib/utils";
import type { ProjectionMode, TextureTile } from "@/lib/texturizer/types";

interface FitState {
  center: Vector3;
  distance: number;
  maxDimension: number;
}

export interface HdPreviewSettings {
  projection: ProjectionMode;
  origin: [number, number, number];
  scaleU: number;
  scaleV: number;
  offsetU: number;
  offsetV: number;
  rotationDeg: number;
  amplitudeMm: number;
  symmetric: boolean;
  baseMm: number;
}

const HD_VERTEX_HEADER = `
varying vec3 vHdPosition;
varying vec3 vHdNormal;
`;

const HD_FRAGMENT_HEADER = `
uniform sampler2D uHeightMap;
uniform float uHdEnabled;
uniform float uRelief;
uniform float uProjection;
uniform vec3 uOrigin;
uniform float uScaleU;
uniform float uScaleV;
uniform float uOffsetU;
uniform float uOffsetV;
uniform float uRotation;
uniform float uBaseMm;
varying vec3 vHdPosition;
varying vec3 vHdNormal;

float hdSampleHeight(vec2 uv) {
  vec2 p = vec2(uv.x * uScaleU, uv.y * uScaleV) / uBaseMm;
  float c = cos(uRotation);
  float s = sin(uRotation);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  q += vec2(uOffsetU, uOffsetV);
  return texture2D(uHeightMap, q).r;
}

vec2 hdPlanarUv(vec3 q) {
  if (uProjection < 1.5) return q.xy;
  if (uProjection < 2.5) return q.xz;
  return q.yz;
}

float hdHeight(vec3 p, vec3 n) {
  if (uProjection < 0.5) {
    vec3 weights = pow(abs(n), vec3(4.0));
    float total = weights.x + weights.y + weights.z;
    if (total < 1e-6) return hdSampleHeight(p.xy);
    weights /= total;
    return hdSampleHeight(p.zy) * weights.x
      + hdSampleHeight(p.xz) * weights.y
      + hdSampleHeight(p.xy) * weights.z;
  }
  vec3 q = p - uOrigin;
  if (uProjection > 3.5 && uProjection < 4.5) {
    float radius = length(q.xy);
    float angle = atan(q.y, q.x);
    return hdSampleHeight(vec2(angle * max(radius, 1e-4), q.z));
  }
  if (uProjection > 4.5) {
    float radius = length(q);
    if (radius < 1e-6) return hdSampleHeight(vec2(0.0));
    float angle = atan(q.y, q.x);
    float polar = acos(clamp(q.z / radius, -1.0, 1.0));
    return hdSampleHeight(vec2(angle * radius, polar * radius));
  }
  return hdSampleHeight(hdPlanarUv(q));
}
`;

const HD_NORMAL_BLOCK = `
#include <normal_fragment_maps>
if (uHdEnabled > 0.5) {
  vec3 hdP = vHdPosition;
  vec3 hdN = normalize(vHdNormal);
  float hdEps = 0.18;
  float h0 = hdHeight(hdP, hdN);
  float hx = hdHeight(hdP + vec3(hdEps, 0.0, 0.0), hdN);
  float hy = hdHeight(hdP + vec3(0.0, hdEps, 0.0), hdN);
  float hz = hdHeight(hdP + vec3(0.0, 0.0, hdEps), hdN);
  vec3 hdGrad = vec3(hx - h0, hy - h0, hz - h0) / hdEps;
  vec3 hdBumped = normalize(hdN - hdGrad * uRelief);
  normal = normalize(mat3(viewMatrix) * hdBumped);
}
`;

function projectionIndex(projection: ProjectionMode): number {
  if (projection === "xy") return 1;
  if (projection === "xz") return 2;
  if (projection === "yz") return 3;
  if (projection === "cylindrical") return 4;
  if (projection === "spherical") return 5;
  return 0;
}

function createHeightTexture(tile: TextureTile): DataTexture {
  const { size, data } = tile;
  const pixels = new Uint8Array(size * size * 4);
  for (let index = 0; index < data.length; index += 1) {
    const value = Math.max(0, Math.min(1, data[index]));
    const byte = Math.round(value * 255);
    const offset = index * 4;
    pixels[offset] = byte;
    pixels[offset + 1] = byte;
    pixels[offset + 2] = byte;
    pixels[offset + 3] = 255;
  }
  const texture = new DataTexture(
    pixels,
    size,
    size,
    RGBAFormat,
    UnsignedByteType
  );
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createFallbackTexture(): DataTexture {
  const texture = new DataTexture(
    new Uint8Array([0, 0, 0, 255]),
    1,
    1,
    RGBAFormat,
    UnsignedByteType
  );
  texture.needsUpdate = true;
  return texture;
}

export function TexturizerViewer({
  originalGeometry,
  geometry,
  showOriginal,
  onToggleShowOriginal,
  heightTile,
  hdSettings,
  paintMode = false,
  paintRadius = 3,
  onPaint,
  className,
}: {
  originalGeometry: BufferGeometry | null;
  geometry: BufferGeometry | null;
  showOriginal: boolean;
  onToggleShowOriginal: () => void;
  heightTile: TextureTile | null;
  hdSettings: HdPreviewSettings | null;
  paintMode?: boolean;
  paintRadius?: number;
  onPaint?: (x: number, y: number, z: number) => void;
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
  const hdTextureRef = useRef<DataTexture | null>(null);
  const fallbackTextureRef = useRef<DataTexture | null>(null);
  const hdUniformsRef = useRef({
    uHeightMap: { value: null as Texture | null },
    uHdEnabled: { value: 0 },
    uRelief: { value: 0 },
    uProjection: { value: 0 },
    uOrigin: { value: new Vector3() },
    uScaleU: { value: 1 },
    uScaleV: { value: 1 },
    uOffsetU: { value: 0 },
    uOffsetV: { value: 0 },
    uRotation: { value: 0 },
    uBaseMm: { value: 10 },
  });
  const paintModeRef = useRef(false);
  const paintRadiusRef = useRef(paintRadius);
  const onPaintRef = useRef(onPaint);
  const paintingRef = useRef(false);
  const lastPaintRef = useRef<Vector3 | null>(null);

  useEffect(() => {
    paintModeRef.current = paintMode;
    paintRadiusRef.current = paintRadius;
    onPaintRef.current = onPaint;
    const controls = controlsRef.current;
    if (controls) controls.enabled = !paintMode;
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.domElement.style.cursor = paintMode ? "crosshair" : "";
      renderer.domElement.style.touchAction = paintMode ? "none" : "";
    }
  }, [onPaint, paintMode, paintRadius]);

  const [showGrid, setShowGrid] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [hdPreview, setHdPreview] = useState(false);
  const showGridRef = useRef(showGrid);
  const hdAvailable = Boolean(heightTile && hdSettings);

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

    const fallback = createFallbackTexture();
    fallbackTextureRef.current = fallback;
    hdUniformsRef.current.uHeightMap.value = fallback;
    const material = new MeshStandardMaterial({
      color: 0xb8c1cc,
      roughness: 0.56,
      metalness: 0.05,
      side: DoubleSide,
      flatShading: false,
      wireframe: false,
    });
    const hdUniforms = hdUniformsRef.current;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, hdUniforms);
      shader.vertexShader =
        HD_VERTEX_HEADER +
        shader.vertexShader
          .replace(
            "#include <beginnormal_vertex>",
            "#include <beginnormal_vertex>\n  vHdNormal = normalize(mat3(modelMatrix) * objectNormal);"
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\n  vHdPosition = transformed;"
          );
      shader.fragmentShader =
        HD_FRAGMENT_HEADER +
        shader.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          HD_NORMAL_BLOCK
        );
    };
    material.customProgramCacheKey = () => "texturizer-hd-v1";
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

    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const paintAt = (event: PointerEvent) => {
      if (!paintModeRef.current || !onPaintRef.current) return;
      const mesh = meshRef.current;
      if (!mesh || !mesh.visible) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit) return;
      const local = mesh.worldToLocal(hit.point.clone());
      const last = lastPaintRef.current;
      if (
        last &&
        last.distanceTo(local) < Math.max(0.15, paintRadiusRef.current * 0.3)
      ) {
        return;
      }
      lastPaintRef.current = local.clone();
      onPaintRef.current(local.x, local.y, local.z);
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!paintModeRef.current || event.button !== 0) return;
      event.preventDefault();
      paintingRef.current = true;
      lastPaintRef.current = null;
      renderer.domElement.setPointerCapture(event.pointerId);
      paintAt(event);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!paintingRef.current) return;
      event.preventDefault();
      paintAt(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!paintingRef.current) return;
      paintingRef.current = false;
      lastPaintRef.current = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("pointercancel", handlePointerUp);
    renderer.domElement.addEventListener("pointerleave", handlePointerUp);

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
        handlePointerDown
      );
      renderer.domElement.removeEventListener(
        "pointermove",
        handlePointerMove
      );
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener(
        "pointercancel",
        handlePointerUp
      );
      renderer.domElement.removeEventListener(
        "pointerleave",
        handlePointerUp
      );
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
      fallbackTextureRef.current?.dispose();
      fallbackTextureRef.current = null;
      hdTextureRef.current?.dispose();
      hdTextureRef.current = null;
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
    const uniforms = hdUniformsRef.current;
    if (!heightTile) {
      uniforms.uHeightMap.value =
        fallbackTextureRef.current ?? uniforms.uHeightMap.value;
      uniforms.uHdEnabled.value = 0;
      return;
    }
    const current = hdTextureRef.current;
    if (
      !current ||
      current.image.width !== heightTile.size ||
      current.image.height !== heightTile.size ||
      current.userData.tileData !== heightTile.data
    ) {
      current?.dispose();
      const texture = createHeightTexture(heightTile);
      texture.userData.tileData = heightTile.data;
      hdTextureRef.current = texture;
      uniforms.uHeightMap.value = texture;
    } else {
      uniforms.uHeightMap.value = current;
    }
  }, [heightTile]);

  useEffect(() => {
    const uniforms = hdUniformsRef.current;
    if (!hdSettings) {
      uniforms.uHdEnabled.value = 0;
      return;
    }
    uniforms.uProjection.value = projectionIndex(hdSettings.projection);
    uniforms.uOrigin.value.set(...hdSettings.origin);
    uniforms.uScaleU.value = hdSettings.scaleU;
    uniforms.uScaleV.value = hdSettings.scaleV;
    uniforms.uOffsetU.value = hdSettings.offsetU;
    uniforms.uOffsetV.value = hdSettings.offsetV;
    uniforms.uRotation.value =
      (hdSettings.rotationDeg * Math.PI) / 180;
    uniforms.uBaseMm.value = hdSettings.baseMm;
    uniforms.uRelief.value =
      Math.max(0, hdSettings.amplitudeMm) *
      (hdSettings.symmetric ? 2 : 1) *
      0.35;
  }, [hdSettings]);

  useEffect(() => {
    const uniforms = hdUniformsRef.current;
    uniforms.uHdEnabled.value =
      hdPreview && hdAvailable && !showOriginal && geometry ? 1 : 0;
  }, [geometry, hdAvailable, hdPreview, showOriginal]);

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
            {hdAvailable ? (
              <IconAction
                label={
                  hdPreview
                    ? "Ocultar vista HD"
                    : "Activar vista HD (solo visual)"
                }
                icon={Sparkles}
                active={hdPreview}
                onClick={() => setHdPreview((value) => !value)}
              />
            ) : null}
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
        {paintMode ? (
          <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-primary/40 bg-background/90 px-2 py-1 text-[10px] font-medium text-primary shadow-sm backdrop-blur">
            Pincel: arrastrá sobre el modelo · radio {paintRadius.toFixed(1)} mm
          </span>
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
