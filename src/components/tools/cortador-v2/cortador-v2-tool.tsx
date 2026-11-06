"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  CircleDot,
  Loader2,
  MousePointerClick,
  Paintbrush,
  RotateCcw,
  RotateCw,
  Scissors,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Cutter2Client, EngineError } from "@/lib/cutter2/client";
import type {
  AnchorPoint,
  CutMethod,
  CutPreview,
  DocumentView,
  EngineApi,
  EngineMethod,
  ExportFormat,
  ExportResult,
  JointParams,
  JointPreview,
  ModelAnalysis,
  ModelInfo,
  PerimeterView,
  PieceGeometry,
  Placement,
  SelectionData,
  SuggestionView,
  SuggestionsResult,
  ToleranceProfile,
} from "@/lib/cutter2/worker/protocol";
import { Cutter2Viewer, type FaceHit, type ViewerMode, type ViewerPiece } from "./viewer";

type StepId = 1 | 2 | 3 | 4 | 5 | 6;
type EngineCall = <M extends EngineMethod>(methodName: M, ...args: Parameters<EngineApi[M]>) => ReturnType<EngineApi[M]>;

const CANCELLABLE_METHODS = new Set<EngineMethod>(["analyzeModel", "getSelectionData", "suggestPerimeters", "previewCut"]);

type PerimeterEditor = {
  view: PerimeterView;
  anchors: AnchorPoint[];
  locked: Record<number, number[]> | null;
  fixedPathId: string | null;
};

const STEPS: { id: StepId; title: string; hint: string }[] = [
  { id: 1, title: "Cargar modelo", hint: "STL o 3MF" },
  { id: 2, title: "Seleccionar pieza", hint: "Varita o pincel" },
  { id: 3, title: "Definir perímetro", hint: "Sugerir y ajustar" },
  { id: 4, title: "Previsualizar corte", hint: "Superficie y profundidad" },
  { id: 5, title: "Agregar encastre", hint: "Tetón o membrana" },
  { id: 6, title: "Exportar", hint: "STL o 3MF" },
];

function mm(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits).replace(".", ",")} mm`;
}

function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits).replace(".", ",");
}

function volume(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value / 1000).toFixed(2).replace(".", ",")} cm³`;
}

function regionsAtLevel(seg: { regionCount: number; merges: Float64Array }, threshold: number): Int32Array {
  const parent = new Int32Array(seg.regionCount);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const merges = seg.merges;
  for (let i = 0; i < merges.length; i += 3) {
    if (merges[i + 2] > threshold) break;
    const a = find(merges[i]);
    const b = find(merges[i + 1]);
    if (a !== b) parent[b] = a;
  }
  return parent;
}

function axisRotation(axis: "x" | "y" | "z", degrees: number): number[] {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (axis === "x") return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === "y") return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function alignRotation(normal: [number, number, number]): number[] {
  const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const a: [number, number, number] = [normal[0] / length, normal[1] / length, normal[2] / length];
  const b: [number, number, number] = [0, 0, -1];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  if (dot < -0.999999) {
    const helper: [number, number, number] = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const x: [number, number, number] = [
      a[1] * helper[2] - a[2] * helper[1],
      a[2] * helper[0] - a[0] * helper[2],
      a[0] * helper[1] - a[1] * helper[0],
    ];
    const l = Math.hypot(x[0], x[1], x[2]) || 1;
    const u: [number, number, number] = [x[0] / l, x[1] / l, x[2] / l];
    return [
      2 * u[0] * u[0] - 1, 2 * u[0] * u[1], 2 * u[0] * u[2],
      2 * u[1] * u[0], 2 * u[1] * u[1] - 1, 2 * u[1] * u[2],
      2 * u[2] * u[0], 2 * u[2] * u[1], 2 * u[2] * u[2] - 1,
    ];
  }
  if (dot > 0.999999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const s = Math.sqrt((1 + dot) * 2);
  const qx = cross[0] / s;
  const qy = cross[1] / s;
  const qz = cross[2] / s;
  const qw = s / 2;
  return [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
}

function downloadFile(file: { name: string; data: Uint8Array; mime: string }): void {
  const blob = new Blob([file.data as unknown as BlobPart], { type: file.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function CortadorV2Tool() {
  const clientRef = useRef<Cutter2Client | null>(null);
  const activeTaskRef = useRef<{ client: Cutter2Client; id: number } | null>(null);
  const cancelRequestedRef = useRef(false);
  const getClient = () => {
    if (!clientRef.current) clientRef.current = new Cutter2Client();
    return clientRef.current;
  };
  useEffect(() => () => clientRef.current?.dispose(), []);

  const [step, setStep] = useState<StepId>(1);
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [geoms, setGeoms] = useState<Record<string, PieceGeometry>>({});
  const [analysis, setAnalysis] = useState<ModelAnalysis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [fitKey, setFitKey] = useState("0");

  const [orientMode, setOrientMode] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const [selData, setSelData] = useState<SelectionData | null>(null);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [level, setLevel] = useState(0.3);
  const [selTool, setSelTool] = useState<"wand" | "brush-add" | "brush-remove">("wand");
  const [brush, setBrush] = useState(3);
  const [hoverFaces, setHoverFaces] = useState<Uint8Array | null>(null);
  const hoverRootRef = useRef(-1);
  const historyRef = useRef<{ undo: Uint8Array[]; redo: Uint8Array[] }>({ undo: [], redo: [] });
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const syncHistoryCounts = useCallback(() => {
    setHistoryCounts({ undo: historyRef.current.undo.length, redo: historyRef.current.redo.length });
  }, []);
  const strokeRef = useRef(false);
  const lastPaintRef = useRef(0);

  const [suggestions, setSuggestions] = useState<SuggestionsResult | null>(null);
  const [perimeters, setPerimeters] = useState<PerimeterEditor[]>([]);
  const perim = perimeters[0]?.view ?? null;
  const [magnet, setMagnet] = useState(0.6);
  const [smoothing, setSmoothing] = useState(0.35);
  const [hoverSuggestion, setHoverSuggestion] = useState<string | null>(null);
  const [separation, setSeparation] = useState<{ separates: boolean; message?: string } | null>(null);

  const [method, setMethod] = useState<CutMethod>("planar");
  const [depth, setDepth] = useState(0);
  const [bulge, setBulge] = useState(0);
  const [explode, setExplode] = useState(0);
  const [preview, setPreview] = useState<CutPreview | null>(null);
  const [names, setNames] = useState({ extracted: "Pieza", remainder: "Base" });
  const [forceCommit, setForceCommit] = useState(false);

  const [profiles, setProfiles] = useState<ToleranceProfile[]>([]);
  const [profileId, setProfileId] = useState("pla");
  const [jointParams, setJointParams] = useState<JointParams | null>(null);
  const [jointPreview, setJointPreview] = useState<JointPreview | null>(null);
  const [jointReason, setJointReason] = useState<{ seamId: string; text: string } | null>(null);

  const [format, setFormat] = useState<ExportFormat>("zip");
  const [placement, setPlacement] = useState<Placement>("original");
  const [baseName, setBaseName] = useState("Modelo");
  const [exportSel, setExportSel] = useState<Record<string, boolean>>({});
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  useEffect(() => {
    if (!viewerExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewerExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewerExpanded]);

  const call = useCallback<EngineCall>(<M extends EngineMethod>(methodName: M, ...args: Parameters<EngineApi[M]>) => {
    const client = getClient();
    const { id, promise } = client.call(methodName, args, {
      onProgress: (fraction, message) => {
        setProgress((current) => Math.min(1, Math.max(current, fraction)));
        if (message) setProgressMessage(message);
      },
    });
    if (CANCELLABLE_METHODS.has(methodName)) {
      activeTaskRef.current = { client, id };
      cancelRequestedRef.current = false;
      setCancelRequested(false);
      setCanCancel(true);
    }
    return promise.finally(() => {
      if (activeTaskRef.current?.id === id) {
        activeTaskRef.current = null;
        setCanCancel(false);
        setCancelRequested(false);
        cancelRequestedRef.current = false;
      }
    }) as ReturnType<EngineApi[M]>;
  }, []);

  const run = useCallback(async function run<T>(label: string, work: () => Promise<T>, quiet = false): Promise<T | null> {
    setBusy(label);
    setProgress(0);
    setProgressMessage(label);
    setCanCancel(false);
    activeTaskRef.current = null;
    cancelRequestedRef.current = false;
    setCancelRequested(false);
    try {
      return await work();
    } catch (error) {
      const failure = error as EngineError;
      if (failure?.cancelled) {
        toast.info("Operación cancelada. No se aplicaron cambios.");
        return null;
      }
      const message = failure?.message ?? "Algo salió mal.";
      if (!quiet) toast.error(message);
      return null;
    } finally {
      setBusy(null);
      setProgressMessage(null);
      setCanCancel(false);
      setCancelRequested(false);
      cancelRequestedRef.current = false;
      activeTaskRef.current = null;
    }
  }, []);

  const cancelActiveTask = useCallback(() => {
    const activeTask = activeTaskRef.current;
    if (!activeTask || cancelRequestedRef.current) return;
    cancelRequestedRef.current = true;
    setCancelRequested(true);
    setProgressMessage("Cancelando operación…");
    activeTask.client.cancel(activeTask.id);
  }, []);

  const syncDoc = useCallback((next: DocumentView) => {
    setDoc(next);
    setGeoms((previous) => {
      const map = { ...previous };
      for (const geometry of next.geometries) map[geometry.id] = geometry;
      const alive = new Set(next.pieces.map((piece) => piece.id));
      for (const id of Object.keys(map)) if (!alive.has(id)) delete map[id];
      return map;
    });
    setFitKey((key) => `${Number(key.split(":")[0] ?? 0) + 1}:${next.pieces.length}`);
  }, []);

  const activeId = doc?.activePieceId ?? doc?.pieces[0]?.id ?? null;
  const seamId = doc?.seams.find((seam) => !seam.joint)?.id ?? null;
  const activeGeom = activeId ? geoms[activeId] : undefined;

  // ------------------------------------------------------------ load model
  const loadFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer();
      const result = await run("Cargando el modelo", () => call("loadModel", file.name, buffer), false);
      if (!result) return;
      setModel(result.model);
      syncDoc(result.doc);
      setAnalysis(null);
      setBaseName(result.model.fileName.replace(/\.[^.]+$/, ""));
      setStep(1);
      setSelData(null);
      setMask(null);
      setPerimeters([]);
      setPreview(null);
      setSuggestions(null);
      setJointPreview(null);
      setJointParams(null);
      setExportResult(null);
      setExportSel({});
      const report = await run("Analizando la malla", () => call("analyzeModel", {}), true);
      if (report) setAnalysis(report);
    },
    [call, run, syncDoc]
  );

  const onPickFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  };

  const rotate = async (axis: "x" | "y" | "z", degrees: number) => {
    const next = await run("Girando el modelo", () => call("orientModel", axisRotation(axis, degrees)));
    if (next) {
      syncDoc(next);
      setSelData(null);
      setPerimeters([]);
      setPreview(null);
    }
  };

  const dropFaceOnBed = async (hit: FaceHit) => {
    setOrientMode(false);
    const next = await run("Apoyando la cara sobre la cama", () => call("orientModel", alignRotation(hit.normal)));
    if (next) {
      syncDoc(next);
      setSelData(null);
      setPerimeters([]);
      setPreview(null);
      toast.success("Cara apoyada sobre la cama.");
    }
  };

  // ------------------------------------------------------------- selection
  useEffect(() => {
    if (step < 2 || !activeId) return;
    if (selData?.pieceId === activeId) return;
    let cancelled = false;
    void (async () => {
      const data = await run("Analizando la pieza", () => call("getSelectionData", activeId));
      if (cancelled || !data) return;
      setSelData(data);
      setMask(new Uint8Array(data.faceAreas.length));
      setHoverFaces(null);
      setLevel(0.3);
      hoverRootRef.current = -1;
      historyRef.current = { undo: [], redo: [] };
      setHistoryCounts({ undo: 0, redo: 0 });
    })();
    return () => {
      cancelled = true;
    };
  }, [step, activeId, selData?.pieceId, call, run]);

  const roots = useMemo(() => (selData ? regionsAtLevel(selData, level) : null), [selData, level]);
  const regionFaces = useMemo(() => {
    if (!selData || !roots) return null;
    const map = new Map<number, number[]>();
    for (let face = 0; face < selData.faceRegion.length; face++) {
      const root = roots[selData.faceRegion[face]];
      const list = map.get(root);
      if (list) list.push(face);
      else map.set(root, [face]);
    }
    return map;
  }, [selData, roots]);

  const centroids = useMemo(() => {
    if (!activeGeom) return null;
    const count = activeGeom.indices.length / 3;
    const out = new Float32Array(count * 3);
    const positions = activeGeom.positions;
    for (let face = 0; face < count; face++) {
      const a = activeGeom.indices[face * 3] * 3;
      const b = activeGeom.indices[face * 3 + 1] * 3;
      const c = activeGeom.indices[face * 3 + 2] * 3;
      out[face * 3] = (positions[a] + positions[b] + positions[c]) / 3;
      out[face * 3 + 1] = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
      out[face * 3 + 2] = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    }
    return out;
  }, [activeGeom]);

  const selectionStats = useMemo(() => {
    if (!selData || !mask) return { faces: 0, area: 0 };
    let faces = 0;
    let area = 0;
    for (let face = 0; face < mask.length; face++) {
      if (mask[face]) {
        faces += 1;
        area += selData.faceAreas[face];
      }
    }
    return { faces, area };
  }, [selData, mask]);

  const commitMask = useCallback((next: Uint8Array, push: boolean) => {
    if (push) {
      const history = historyRef.current;
      if (mask) history.undo.push(mask);
      if (history.undo.length > 40) history.undo.shift();
      history.redo = [];
    }
    setMask(next);
    syncHistoryCounts();
  }, [mask, syncHistoryCounts]);

  const undoSelection = () => {
    const history = historyRef.current;
    const previous = history.undo.pop();
    if (!previous || !mask) return;
    history.redo.push(mask);
    setMask(previous);
    syncHistoryCounts();
  };

  const redoSelection = () => {
    const history = historyRef.current;
    const next = history.redo.pop();
    if (!next || !mask) return;
    history.undo.push(mask);
    setMask(next);
    syncHistoryCounts();
  };

  const invertSelection = () => {
    if (!mask) return;
    const next = mask.slice();
    for (let i = 0; i < next.length; i++) next[i] = next[i] ? 0 : 1;
    commitMask(next, true);
  };

  const clearSelection = () => {
    if (!mask) return;
    commitMask(new Uint8Array(mask.length), true);
  };

  const growSelection = (expand: boolean) => {
    if (!mask || !selData) return;
    const next = expand ? mask.slice() : new Uint8Array(mask.length);
    for (let face = 0; face < mask.length; face++) {
      if (!mask[face]) continue;
      let allNeighborsSelected = true;
      for (let edge = 0; edge < 3; edge++) {
        const neighbor = selData.faceAdj[face * 3 + edge];
        if (neighbor < 0) continue;
        if (expand) next[neighbor] = 1;
        else if (!mask[neighbor]) allNeighborsSelected = false;
      }
      if (!expand && allNeighborsSelected) next[face] = 1;
    }
    if (next.some((value, index) => value !== mask[index])) commitMask(next, true);
  };

  const facesInRadius = useCallback(
    (start: number, point: [number, number, number], radius: number): number[] => {
      if (!selData || !centroids) return [start];
      const adjacency = selData.faceAdj;
      const r2 = radius * radius;
      const out = [start];
      const seen = new Set<number>([start]);
      for (let i = 0; i < out.length; i++) {
        const face = out[i];
        for (let k = 0; k < 3; k++) {
          const other = adjacency[face * 3 + k];
          if (other < 0 || seen.has(other)) continue;
          seen.add(other);
          const dx = centroids[other * 3] - point[0];
          const dy = centroids[other * 3 + 1] - point[1];
          const dz = centroids[other * 3 + 2] - point[2];
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(other);
        }
      }
      return out;
    },
    [selData, centroids]
  );

  const paintFaces = (faces: number[], add: boolean) => {
    if (!mask) return;
    const next = mask.slice();
    let changed = false;
    for (const face of faces) {
      const value = add ? 1 : 0;
      if (next[face] !== value) {
        next[face] = value;
        changed = true;
      }
    }
    if (changed) commitMask(next, false);
  };

  const onPaintStart = () => {
    strokeRef.current = true;
    lastPaintRef.current = 0;
  };

  const onPaintDrag = (hit: FaceHit) => {
    if (!selTool.startsWith("brush")) return;
    const now = performance.now();
    if (now - lastPaintRef.current < 30) return;
    lastPaintRef.current = now;
    paintFaces(facesInRadius(hit.face, hit.point, brush), selTool === "brush-add");
    strokeRef.current = false;
  };

  const onSelectionClick = (hit: FaceHit, mods: { ctrl: boolean; shift: boolean; alt: boolean }) => {
    if (selTool !== "wand" || !selData || !mask || !roots || !regionFaces) return;
    const root = roots[selData.faceRegion[hit.face]];
    const faces = regionFaces.get(root);
    if (!faces) return;
    const allSelected = faces.every((face) => mask[face] === 1);
    const mode = mods.alt ? "remove" : mods.ctrl ? (allSelected ? "remove" : "add") : mods.shift ? "add" : "replace";
    const next = mode === "replace" ? new Uint8Array(mask.length) : mask.slice();
    let count = 0;
    for (const face of faces) {
      next[face] = mode === "remove" ? 0 : 1;
      count += next[face];
    }
    commitMask(next, true);
    if (mode === "add") toast.info("Sumaste otra parte: se cortan juntas y salen en una sola pieza.");
    else if (mode === "remove") toast.info(count > 0 ? "Quitaste la región de la selección." : "La selección quedó vacía.");
  };

  const onFaceHover = (face: number | null) => {
    if (step !== 2 || selTool !== "wand" || !selData || !roots || !regionFaces) {
      if (hoverFaces) setHoverFaces(null);
      return;
    }
    if (face == null) {
      hoverRootRef.current = -1;
      setHoverFaces(null);
      return;
    }
    const root = roots[selData.faceRegion[face]];
    if (root === hoverRootRef.current) return;
    hoverRootRef.current = root;
    const faces = regionFaces.get(root);
    if (!faces) {
      setHoverFaces(null);
      return;
    }
    const overlay = new Uint8Array(selData.faceAreas.length);
    for (const f of faces) overlay[f] = 1;
    setHoverFaces(overlay);
  };

  // ------------------------------------------------------------- perimeter
  const recomputePerimeter = useCallback(
    async (loopIndex: number, points: AnchorPoint[], locks: Record<number, number[]> | null, fixed: string | null) => {
      if (!activeId) return;
      const view = await run("Calculando el perímetro", () =>
        call("computePerimeter", activeId, {
          points,
          closed: true,
          magnet,
          smoothing,
          locked: locks ?? undefined,
          fixedPathId: fixed ?? undefined,
        })
      );
      if (!view) return;
      setPerimeters((current) => current.map((loop, index) =>
        index === loopIndex ? { view, anchors: points, locked: locks, fixedPathId: fixed } : loop
      ));
      setSeparation(null);
    },
    [activeId, call, run, magnet, smoothing]
  );

  const applySuggestion = useCallback(
    async (suggestion: SuggestionView) => {
      const loops = suggestion.loops?.length
        ? suggestion.loops
        : [{ controlPoints: suggestion.controlPoints, locked: suggestion.locked ?? undefined }];
      if (!activeId) return;
      const next: PerimeterEditor[] = [];
      for (const [index, loop] of loops.entries()) {
        const view = await run("Calculando el perímetro", () => call("computePerimeter", activeId, {
          points: loop.controlPoints,
          closed: true,
          magnet,
          smoothing,
          locked: loop.locked,
        }));
        if (!view) return;
        next.push({ view, anchors: loop.controlPoints, locked: loop.locked ?? null, fixedPathId: null });
        if (index < loops.length - 1) setProgress((index + 1) / loops.length);
      }
      setPerimeters(next);
      setSeparation(null);
    },
    [activeId, call, run, magnet, smoothing]
  );

  const suggestPerimeter = async () => {
    if (!activeId || !mask) return;
    if (selectionStats.faces === 0) {
      toast.warning("Primero elegí una región con la varita o el pincel.");
      return;
    }
    if (selData && selectionStats.faces >= selData.faceAreas.length) {
      toast.warning(
        "La selección cubre la pieza entera. Elegí solo la parte que querés separar (por ejemplo, la protuberancia)."
      );
      return;
    }
    const result = await run("Buscando el borde", () => call("suggestPerimeters", activeId, mask));
    if (!result) return;
    setSuggestions(result);
    const fromSelection = result.suggestions.length === 0 && !!result.selectionBoundary;
    const first =
      result.suggestions.find((item) => item.kind === "suave") ??
      result.suggestions[0] ??
      result.selectionBoundary ??
      null;
    if (first) await applySuggestion(first);
    if (!fromSelection && result.suggestions.length > 0) {
      const extra = result.suggestions.length - 1;
      toast.success(
        extra > 0
          ? `Detectamos un posible perímetro y ${extra} alternativa${extra === 1 ? "" : "s"}.`
          : "Detectamos un posible perímetro."
      );
    }
    if (result.message) toast.info(result.message);
    if (fromSelection) toast.info("Usamos el borde de la selección como perímetro. Podés ajustarlo a mano.");
    if (!first) {
      toast.warning(
        result.message ?? "No encontramos un borde claro. Probá con otra sensibilidad o elegí menos superficie."
      );
    }
  };

  const moveControl = async (loopIndex: number, index: number, hit: FaceHit | null, final: boolean) => {
    if (!final || !hit) return;
    const editor = perimeters[loopIndex];
    if (!editor) return;
    const next = editor.anchors.slice();
    if (!next[index]) return;
    next[index] = { face: hit.face, bary: hit.bary };
    const locks = editor.locked ? { ...editor.locked } : null;
    if (locks) {
      const count = next.length;
      delete locks[index];
      delete locks[(index - 1 + count) % count];
      delete locks[(index + 1) % count];
    }
    await recomputePerimeter(loopIndex, next, locks, null);
  };

  const insertControl = async (loopIndex: number, hit: FaceHit) => {
    const editor = perimeters[loopIndex];
    if (!editor || editor.anchors.length === 0) return;
    const { view } = editor;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < view.controlPositions.length; i++) {
      const point = view.controlPositions[i];
      const distance = Math.hypot(point[0] - hit.point[0], point[1] - hit.point[1], point[2] - hit.point[2]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    const next = editor.anchors.slice();
    next.splice(best + 1, 0, { face: hit.face, bary: hit.bary });
    await recomputePerimeter(loopIndex, next, null, null);
  };

  const fitPlane = async () => {
    if (!activeId || perimeters.length === 0) return;
    const fitted: PerimeterEditor[] = [];
    let maxShift = 0;
    for (const editor of perimeters) {
      const result = await run("Ajustando al plano", () => call("fitPerimeterToPlane", activeId, editor.view.key));
      if (!result) return;
      fitted.push({ view: result.view, anchors: result.controlPoints, locked: null, fixedPathId: result.fixedPathId });
      maxShift = Math.max(maxShift, result.maxShift);
    }
    setPerimeters(fitted);
    setSeparation({ separates: true });
    toast.success(`Perímetro ajustado al plano: se desplazó como máximo ${mm(maxShift)}.`);
  };

  const discardAdjustments = async () => {
    if (!activeId || perimeters.length === 0) return;
    const reset: PerimeterEditor[] = [];
    for (const editor of perimeters) {
      const view = await run("Restaurando el perímetro", () => call("computePerimeter", activeId, {
        points: editor.anchors,
        closed: true,
        magnet,
        smoothing,
        locked: editor.locked ?? undefined,
      }));
      if (!view) return;
      reset.push({ ...editor, view, fixedPathId: null });
    }
    setPerimeters(reset);
    setSeparation(null);
  };

  const confirmPerimeter = async () => {
    if (!activeId || perimeters.length === 0) {
      toast.warning("Primero tocá «Sugerir borde» para crear el perímetro.");
      return;
    }
    const keys = perimeters.map((loop) => loop.view.key);
    const result = await run("Verificando el perímetro", () => call("checkSeparation", activeId, keys));
    if (!result) return;
    setSeparation(result);
    if (!result.separates) {
      toast.error(result.message ?? "El perímetro no separa la pieza en dos.");
      return;
    }
    setStep(4);
  };

  // ------------------------------------------------------------------ cut
  const doPreview = useCallback(async () => {
    if (!activeId || perimeters.length === 0 || !mask) return;
    const keys = perimeters.map((loop) => loop.view.key);
    const result = await run("Previsualizando el corte", () =>
      call("previewCut", activeId, keys, {
        method,
        depth,
        bulge: method === "curved" ? bulge : 0,
        selection: mask,
      })
    );
    if (result) setPreview(result);
  }, [activeId, perimeters, mask, method, depth, bulge, call, run]);

  useEffect(() => {
    if (step !== 4 || perimeters.length === 0) return;
    const timer = setTimeout(() => void doPreview(), 280);
    return () => clearTimeout(timer);
  }, [step, doPreview, perimeters.length]);

  const commitCut = async () => {
    if (!preview) return;
    const next = await run("Guardando el corte", () => call("commitCut", preview.previewId, names, forceCommit));
    if (!next) return;
    syncDoc(next);
    setPreview(null);
    setPerimeters([]);
    setSuggestions(null);
    setMask(null);
    setSelData(null);
    setSeparation(null);
    setExplode(0);
    toast.success(`Corte aplicado: ${names.extracted} y ${names.remainder}.`);
    setStep(5);
  };

  // ---------------------------------------------------------------- joints
  useEffect(() => {
    if (step !== 5) return;
    if (profiles.length === 0) {
      void (async () => {
        const list = await run("Leyendo los perfiles de tolerancia", () => call("toleranceProfiles"), true);
        if (list) setProfiles(list);
      })();
    }
  }, [step, profiles.length, call, run]);

  useEffect(() => {
    if (step !== 5 || !seamId) return;
    let cancelled = false;
    void (async () => {
      const result = await run("Buscando el encastre", () => call("suggestJoint", seamId, profileId), true);
      if (cancelled) return;
      if (result?.params) {
        setJointParams(result.params);
        setJointReason(null);
      } else {
        setJointParams(null);
        setJointReason({ seamId, text: result?.reason ?? "No hay lugar para un encastre en esta unión." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, seamId, profileId, call, run]);

  useEffect(() => {
    if (step !== 5 || !seamId || !jointParams || jointParams.type === "none") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await run("Generando el encastre con booleanas", () => call("previewJoint", seamId, jointParams), true);
      if (!cancelled && result) setJointPreview(result);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, seamId, jointParams, call, run]);

  const commitJoint = async () => {
    if (!jointPreview) return;
    const next = await run("Aplicando el encastre", () => call("commitJoint", jointPreview.previewId));
    if (!next) return;
    syncDoc(next);
    setJointPreview(null);
    toast.success("Encastre aplicado.");
  };

  const patchJoint = (patch: Partial<JointParams>) => {
    setJointParams((current) => (current ? { ...current, ...patch } : current));
  };

  // ---------------------------------------------------------------- export
  const exportable = useMemo(() => (doc?.pieces ?? []).filter((piece) => piece.valid), [doc]);
  const exportPieces = doc?.pieces ?? [];

  const doExport = async () => {
    const ids = exportable.filter((piece) => exportSel[piece.id] !== false).map((piece) => piece.id);
    if (ids.length === 0) {
      toast.warning("Elegí al menos una pieza para exportar.");
      return;
    }
    const result = await run("Exportando", () => call("exportFiles", { pieceIds: ids, format, placement, baseName }));
    if (!result) return;
    setExportResult(result);
    for (let i = 0; i < result.files.length; i++) {
      const file = result.files[i];
      setTimeout(() => downloadFile(file), i * 180);
    }
    toast.success(
      `Se exportaron ${result.files.length} archivo(s)${
        result.skipped.length ? `; ${result.skipped.length} pieza(s) quedaron afuera por no ser válidas` : ""
      }.`
    );
  };

  // ------------------------------------------------------------------ undo
  const undo = async () => {
    const next = await run("Deshaciendo", () => call("undo"));
    if (next) {
      syncDoc(next);
      setPreview(null);
      setPerimeters([]);
      setSelData(null);
      setMask(null);
    }
  };

  const redo = async () => {
    const next = await run("Rehaciendo", () => call("redo"));
    if (next) {
      syncDoc(next);
      setPreview(null);
      setPerimeters([]);
      setSelData(null);
      setMask(null);
    }
  };

  // ----------------------------------------------------------- viewer data
  const viewerPieces = useMemo<ViewerPiece[]>(() => {
    const spread = explode * 22;
    if (step === 4 && preview) {
      const normal = preview.seam.normal;
      const others = (doc?.pieces ?? [])
        .filter((piece) => piece.id !== activeId && geoms[piece.id])
        .map<ViewerPiece>((piece) => ({
          id: piece.id,
          positions: geoms[piece.id].positions,
          indices: geoms[piece.id].indices,
          color: piece.color,
          capMask: geoms[piece.id].capMask,
          opacity: 0.25,
        }));
      return [
        {
          id: preview.extracted.id,
          positions: preview.extracted.positions,
          indices: preview.extracted.indices,
          color: "#f59e0b",
          capMask: preview.extracted.capMask,
          offset: [normal[0] * spread, normal[1] * spread, normal[2] * spread],
        },
        {
          id: preview.remainder.id,
          positions: preview.remainder.positions,
          indices: preview.remainder.indices,
          color: "#94a3b8",
          capMask: preview.remainder.capMask,
          offset: [normal[0] * spread * -0.3, normal[1] * spread * -0.3, normal[2] * spread * -0.3],
        },
        ...others,
      ];
    }
    if (step === 5 && jointPreview) {
      const seam = doc?.seams.find((item) => item.id === jointPreview.seamId);
      const normal = seam?.info.normal ?? [0, 0, 1];
      return [
        {
          id: jointPreview.extracted.id,
          positions: jointPreview.extracted.positions,
          indices: jointPreview.extracted.indices,
          color: "#f59e0b",
          capMask: jointPreview.extracted.capMask,
          offset: [normal[0] * spread, normal[1] * spread, normal[2] * spread],
        },
        {
          id: jointPreview.remainder.id,
          positions: jointPreview.remainder.positions,
          indices: jointPreview.remainder.indices,
          color: "#94a3b8",
          capMask: jointPreview.remainder.capMask,
          offset: [normal[0] * spread * -0.3, normal[1] * spread * -0.3, normal[2] * spread * -0.3],
        },
      ];
    }
    const viewedSeamId = step === 5 && jointPreview ? jointPreview.seamId : seamId;
    const viewedSeam = doc?.seams.find((item) => item.id === viewedSeamId) ?? doc?.seams[doc.seams.length - 1];
    return (doc?.pieces ?? []).flatMap<ViewerPiece>((piece) => {
      const geometry = geoms[piece.id];
      if (!geometry) return [];
      const dim = step <= 3 && activeId && piece.id !== activeId;
      const offsetDirection = piece.id === viewedSeam?.extractedId ? 1 : piece.id === viewedSeam?.remainderId ? -0.3 : 0;
      const offset = viewedSeam && step >= 4 && offsetDirection !== 0
        ? [
            viewedSeam.info.normal[0] * spread * offsetDirection,
            viewedSeam.info.normal[1] * spread * offsetDirection,
            viewedSeam.info.normal[2] * spread * offsetDirection,
          ] as const
        : undefined;
      return [
        {
          id: piece.id,
          positions: geometry.positions,
          indices: geometry.indices,
          color: piece.color,
          capMask: geometry.capMask,
          opacity: dim ? 0.3 : 1,
          offset,
        },
      ];
    });
  }, [preview, jointPreview, doc, geoms, explode, activeId, seamId, step]);

  const suggestedLines = useMemo(() => {
    const all = [...(suggestions?.suggestions ?? []), ...(suggestions?.selectionBoundary ? [suggestions.selectionBoundary] : [])];
    const hovered = all.find((item) => item.id === hoverSuggestion);
    return hovered ? hovered.loops.map((loop) => loop.polyline) : [];
  }, [suggestions, hoverSuggestion]);

  const seamLines = useMemo(() => {
    if (step < 5) return [];
    return (doc?.seams ?? []).map((seam) => seam.loop);
  }, [doc, step]);

  const viewerMode: ViewerMode = step === 3 ? "perimeter" : step === 1 && orientMode ? "orient" : step === 2 ? "select" : "orbit";

  const currentStep = STEPS.find((item) => item.id === step) ?? STEPS[0];
  const pendingSeams = doc?.seams.filter((seam) => !seam.joint).length ?? 0;
  const totalSeams = doc?.seams.length ?? 0;
  const perimeterLength = perimeters.reduce((total, editor) => total + editor.view.length, 0);
  const perimeterControlCount = perimeters.reduce((total, editor) => total + editor.view.controlPositions.length, 0);
  const perimeterValid = perimeters.length > 0 && perimeters.every((editor) => editor.view.closed && editor.view.valid);
  const perimeterIssues = perimeters.flatMap((editor) => editor.view.issues);
  const hasFixedPerimeter = perimeters.some((editor) => editor.fixedPathId !== null);

  return (
    <div className={viewerExpanded
      ? "fixed inset-0 z-50 grid h-dvh min-h-0 w-full grid-rows-[minmax(12rem,36dvh)_minmax(0,1fr)] overflow-hidden bg-background lg:grid-cols-[minmax(0,1fr)_27rem] lg:grid-rows-1"
      : "grid h-[calc(100dvh-3.5rem)] min-h-0 w-full grid-rows-[minmax(12rem,36dvh)_minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_27rem] lg:grid-rows-1"}>
      <aside className="order-2 flex min-h-0 min-w-0 flex-col border-t bg-card/40 lg:order-2 lg:border-l lg:border-t-0">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Scissors className="size-4 text-primary" />
            <h1 className="text-sm font-semibold tracking-tight">Cortador v2</h1>
            <Badge variant="secondary" className="ml-auto text-[10px]">
              Motor corto
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cortes por perímetro 3D con tapas planas o curvas, encastres y validación de sólidos.
          </p>
          <nav aria-label="Pasos del cortador">
            <ol className="mt-3 flex flex-wrap gap-1">
              {STEPS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={item.id === step ? "step" : undefined}
                    onClick={() => setStep(item.id)}
                    className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                      item.id === step
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {item.id}. {item.title}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{currentStep.title}</h2>
              <p className="text-xs text-muted-foreground">{currentStep.hint}</p>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" onClick={undo} disabled={!doc?.canUndo || !!busy} title="Deshacer" aria-label="Deshacer última acción">
                <RotateCcw className="size-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={redo} disabled={!doc?.canRedo || !!busy} title="Rehacer" aria-label="Rehacer última acción">
                <RotateCw className="size-4" />
              </Button>
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-4">
              <label
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropActive(true);
                }}
                onDragLeave={() => setDropActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropActive(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void loadFile(file);
                }}
                className={`relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
                  dropActive ? "border-primary bg-primary/10" : "hover:border-primary/60 hover:bg-accent/40"
                }`}
              >
                <input
                  type="file"
                  accept=".stl,.3mf"
                  className="absolute inset-0 z-10 cursor-pointer opacity-0"
                  onChange={onPickFile}
                  aria-label="Elegir archivo STL o 3MF"
                />
                <Upload className="size-5 text-muted-foreground" />
                <span className="text-sm font-medium">{model ? model.fileName : "Arrastrá un STL o 3MF"}</span>
                <span className="text-xs text-muted-foreground">STL binario o ASCII y 3MF (incluye Bambu Studio)</span>
              </label>

              {model && (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border bg-background/60 px-2 py-1.5">
                    <dt className="text-muted-foreground">Formato</dt>
                    <dd className="font-medium uppercase">{model.format}</dd>
                  </div>
                  <div className="rounded-md border bg-background/60 px-2 py-1.5">
                    <dt className="text-muted-foreground">Triángulos</dt>
                    <dd className="font-medium">{model.fileTriangleCount.toLocaleString("es-AR")}</dd>
                  </div>
                  {analysis && (
                    <>
                      <div className="rounded-md border bg-background/60 px-2 py-1.5">
                        <dt className="text-muted-foreground">Dimensiones</dt>
                        <dd className="font-medium">
                          {num(analysis.dimensions[0])} × {num(analysis.dimensions[1])} × {num(analysis.dimensions[2])} mm
                        </dd>
                      </div>
                      <div className="rounded-md border bg-background/60 px-2 py-1.5">
                        <dt className="text-muted-foreground">Volumen</dt>
                        <dd className="font-medium">{volume(analysis.volume)}</dd>
                      </div>
                      <div className="rounded-md border bg-background/60 px-2 py-1.5">
                        <dt className="text-muted-foreground">Componentes</dt>
                        <dd className="font-medium">{analysis.components.length}</dd>
                      </div>
                      <div className="rounded-md border bg-background/60 px-2 py-1.5">
                        <dt className="text-muted-foreground">Estado de la malla</dt>
                        <dd className="font-medium">
                          {analysis.status === "ok" ? "Lista para cortar" : analysis.status === "warning" ? "Con avisos" : "Revisar"}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              )}

              {analysis && analysis.messages.length > 0 && (
                <div className="space-y-1">
                  {analysis.messages.slice(0, 6).map((message, index) => (
                    <p
                      key={`${message.text}-${index}`}
                      className={`rounded-md px-2 py-1 text-[11px] ${
                        message.severity === "error"
                          ? "bg-destructive/10 text-destructive"
                          : message.severity === "warning"
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {message.text}
                    </p>
                  ))}
                </div>
              )}

              {analysis && (
                <details className="rounded-md border px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium">Diagnóstico técnico</summary>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    <li>Bordes abiertos: {analysis.boundaryEdges}</li>
                    <li>Aristas no-manifold: {analysis.nonManifoldEdges}</li>
                    <li>Normales inconsistentes: {analysis.inconsistentEdges}</li>
                    <li>Caras degeneradas: {analysis.degenerateFaces}</li>
                    <li>Componentes independientes: {analysis.components.length}</li>
                    <li>
                      Superficies que se atraviesan:{" "}
                      {analysis.selfIntersections.checked
                        ? analysis.selfIntersections.withinComponent + analysis.selfIntersections.betweenComponents
                        : "sin revisar"}
                    </li>
                  </ul>
                </details>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Orientación</Label>
                <div className="flex flex-wrap gap-1">
                  {(["x", "y", "z"] as const).map((axis) => (
                    <div key={axis} className="flex items-center gap-1 rounded-md border px-1 py-0.5">
                      <span className="w-3 text-center text-[11px] font-medium uppercase">{axis}</span>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void rotate(axis, -15)}>
                        −15°
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => void rotate(axis, 15)}>
                        +15°
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  variant={orientMode ? "default" : "outline"}
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setOrientMode((value) => !value);
                    toast.info("Tocá una cara del modelo para apoyarla sobre la cama.");
                  }}
                >
                  <MousePointerClick className="mr-1.5 size-3.5" />
                  Apoyar una cara sobre la cama
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {!selData ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Analizando la pieza…
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        { id: "wand", label: "Varita", icon: Wand2 },
                        { id: "brush-add", label: "Pincel +", icon: Paintbrush },
                        { id: "brush-remove", label: "Pincel −", icon: Paintbrush },
                      ] as const
                    ).map((option) => {
                      const Icon = option.icon;
                      return (
                        <Button
                          key={option.id}
                          variant={selTool === option.id ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelTool(option.id)}
                        >
                          <Icon className="mr-1 size-3.5" />
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>

                  {selTool === "wand" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <Label>Sensibilidad</Label>
                        <span className="text-muted-foreground">
                          {level < 0.15 ? "Fina" : level < 0.45 ? "Media" : "Amplia"}
                        </span>
                      </div>
                      <Slider value={[level]} min={0} max={0.9} step={0.01} onValueChange={([value]) => setLevel(value)} />
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Más fina separa detalles chicos; más amplia agrupa regiones grandes.
                      </p>
                      <dl className="rounded-md border bg-background/60 px-2 py-1.5 text-[11px]">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Clic</dt>
                          <dd>elegir región</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Ctrl + clic</dt>
                          <dd>sumar otra parte al mismo corte</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Alt + clic</dt>
                          <dd>quitar región</dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <Label>Radio del pincel</Label>
                        <span className="text-muted-foreground">{mm(brush)}</span>
                      </div>
                      <Slider value={[brush]} min={0.5} max={20} step={0.5} onValueChange={([value]) => setBrush(value)} />
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {selectionStats.faces.toLocaleString("es-AR")} caras · {num(selectionStats.area, 0)} mm²
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={undoSelection}
                        disabled={historyCounts.undo === 0}
                      >
                        Deshacer
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={redoSelection}
                        disabled={historyCounts.redo === 0}
                      >
                        Rehacer
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="flex-1" onClick={invertSelection}>
                      Invertir
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={clearSelection}>
                      Limpiar
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => growSelection(true)} disabled={selectionStats.faces === 0}>
                      Expandir
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => growSelection(false)} disabled={selectionStats.faces === 0}>
                      Contraer
                    </Button>
                  </div>
                  {selectionStats.faces === 0 && (
                    <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                      Elegí con la varita la parte que querés cortar. Ctrl + clic suma otra zona al mismo corte.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Button variant="outline" size="sm" className="w-full" onClick={() => void suggestPerimeter()} disabled={!!busy}>
                <Sparkles className="mr-1.5 size-3.5" />
                Sugerir borde
              </Button>

              {suggestions && (
                <div className="space-y-1">
                  {[...suggestions.suggestions, ...(suggestions.selectionBoundary ? [suggestions.selectionBoundary] : [])].map(
                    (suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onMouseEnter={() => setHoverSuggestion(suggestion.id)}
                        onMouseLeave={() => setHoverSuggestion(null)}
                        onClick={() => void applySuggestion(suggestion)}
                        className="w-full rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors hover:border-primary/60 hover:bg-accent/40"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{suggestion.label}</span>
                          <span className="text-muted-foreground">{Math.round(suggestion.confidence * 100)}%</span>
                        </span>
                        <span className="block text-muted-foreground">{suggestion.description}</span>
                      </button>
                    )
                  )}
                  {suggestions.message && (
                    <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">{suggestions.message}</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <Label>Imán a bordes naturales</Label>
                  <span className="text-muted-foreground">{Math.round(magnet * 100)}%</span>
                </div>
                <Slider value={[magnet]} min={0} max={1} step={0.05} onValueChange={([value]) => setMagnet(value)} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <Label>Suavizado de curva</Label>
                  <span className="text-muted-foreground">{Math.round(smoothing * 100)}%</span>
                </div>
                <Slider value={[smoothing]} min={0} max={1} step={0.05} onValueChange={([value]) => setSmoothing(value)} />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Atrae los tramos hacia valles y cambios de forma, sin mover tus puntos.
                </p>
              </div>

              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => void fitPlane()} disabled={perimeters.length === 0 || !!busy}>
                  Cierre plano
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => void discardAdjustments()}
                  disabled={perimeters.length === 0 || !!busy}
                >
                  Descartar ajustes
                </Button>
              </div>

              {perimeters.length > 0 && (
                <dl className="space-y-1 rounded-md border bg-background/60 px-2 py-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Perímetros</dt>
                    <dd>{perimeters.length}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Longitud</dt>
                    <dd>{mm(perimeterLength)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Puntos de control</dt>
                    <dd>{perimeterControlCount}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Estado</dt>
                    <dd>{perimeterValid ? "Cerrado y válido" : "Revisar tramos"}</dd>
                  </div>
                  {hasFixedPerimeter && <p className="text-muted-foreground">Cierre plano aplicado.</p>}
                </dl>
              )}

              {perimeterIssues.length > 0 && (
                <ul className="space-y-1">
                  {perimeterIssues.slice(0, 5).map((issue, index) => (
                    <li key={`${issue.code}-${index}`} className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              {separation && (
                <p
                  className={`rounded-md px-2 py-1.5 text-[11px] ${
                    separation.separates ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {separation.separates ? "El perímetro separa la pieza en dos." : separation.message}
                </p>
              )}
              <p className="text-[11px] leading-snug text-muted-foreground">
                Arrastrá los puntos para ajustar. Doble clic sobre la curva agrega un punto.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-1">
                <Button variant={method === "planar" ? "default" : "outline"} size="sm" onClick={() => setMethod("planar")}>
                  Superficie plana
                </Button>
                <Button variant={method === "curved" ? "default" : "outline"} size="sm" onClick={() => setMethod("curved")}>
                  Superficie curva
                </Button>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {method === "planar"
                  ? "Cara posterior plana: la pieza se imprime apoyada sobre ella. Ideal para narices, ojos y protuberancias."
                  : "Curva la superficie hacia una de las piezas: membrana mínima para uniones orgánicas."}
              </p>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <Label>Profundidad del corte</Label>
                  <span className="text-muted-foreground">{mm(depth)}</span>
                </div>
                <Slider value={[depth]} min={0} max={25} step={0.5} onValueChange={([value]) => setDepth(value)} />
              </div>

              {method === "curved" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <Label>Abombado</Label>
                    <span className="text-muted-foreground">{Math.round(bulge * 100)}%</span>
                  </div>
                  <Slider value={[bulge]} min={0} max={1} step={0.05} onValueChange={([value]) => setBulge(value)} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Pieza cortada</Label>
                  <Input value={names.extracted} onChange={(event) => setNames((n) => ({ ...n, extracted: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Pieza restante</Label>
                  <Input value={names.remainder} onChange={(event) => setNames((n) => ({ ...n, remainder: event.target.value }))} />
                </div>
              </div>

              {preview && (
                <div className="space-y-1 text-[11px]">
                  <p
                    className={`rounded-md px-2 py-1.5 ${
                      preview.valid
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : preview.forceable
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {preview.valid
                      ? "Las dos piezas son válidas para exportar: cerradas, manifold y sin autointersecciones."
                      : preview.forceable
                        ? "Hay autointersecciones en la tapa. Podés forzar el corte y revisarlo."
                        : "El corte no produce dos sólidos válidos."}
                  </p>
                  <dl className="space-y-0.5 rounded-md border bg-background/60 px-2 py-1.5">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Volumen original</dt>
                      <dd>{volume(preview.volumes.original)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Pieza cortada</dt>
                      <dd>{volume(preview.volumes.extracted)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Pieza restante</dt>
                      <dd>{volume(preview.volumes.remainder)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Tapa</dt>
                      <dd>
                        {preview.cap.method === "planar" ? "Plana" : "Curva"} · {preview.cap.triangles} triángulos
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Desvío del plano</dt>
                      <dd>{mm(preview.cap.maxDeviation, 2)}</dd>
                    </div>
                  </dl>
                  {preview.issues.length > 0 && (
                    <ul className="space-y-1">
                      {preview.issues.slice(0, 4).map((issue, index) => (
                        <li
                          key={`${issue.code ?? issue.message}-${index}`}
                          className={`rounded-md px-2 py-1 ${
                            issue.severity === "error"
                              ? "bg-destructive/10 text-destructive"
                              : issue.severity === "warning"
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!preview.valid && (
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={forceCommit}
                        onChange={(event) => setForceCommit(event.target.checked)}
                      />
                      Forzar el corte igual
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              {totalSeams === 0 && (
                <p className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
                  Todavía no hay uniones. Hacé un corte para poder agregar un encastre.
                </p>
              )}

              {totalSeams > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {pendingSeams > 0
                    ? `Estás en la parte ${totalSeams - pendingSeams + 1}; al aplicar el encastre o seguir sin él, pasás a la siguiente.`
                    : "Todas las uniones ya tienen encastre."}
                </p>
              )}

              {seamId && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Perfil de tolerancia</Label>
                    <Select value={profileId} onValueChange={setProfileId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((profileItem) => (
                          <SelectItem key={profileItem.id} value={profileItem.id}>
                            {profileItem.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {profiles.find((item) => item.id === profileId)?.description ??
                        "Cada impresora y material necesita una holgura distinta."}
                    </p>
                  </div>

                  {jointParams ? (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Tipo de encastre</Label>
                        <Select value={jointParams.type} onValueChange={(value) => patchJoint({ type: value as JointParams["type"] })}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Sin encastre</SelectItem>
                            <SelectItem value="peg">Tetón circular</SelectItem>
                            <SelectItem value="double-peg">Doble tetón</SelectItem>
                            <SelectItem value="key">Llave</SelectItem>
                            <SelectItem value="dovetail">Cola de milano</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {jointParams.type !== "none" && (
                        <>
                          {(
                            [
                              { key: "diameter", label: "Diámetro", max: 20, step: 0.2 },
                              { key: "depth", label: "Profundidad", max: 15, step: 0.2 },
                              { key: "clearance", label: "Holgura radial", max: 0.8, step: 0.01 },
                              { key: "depthClearance", label: "Holgura de fondo", max: 1.2, step: 0.01 },
                              { key: "angle", label: "Rotación", max: 180, step: 5 },
                              { key: "tilt", label: "Inclinación", max: 45, step: 1 },
                              { key: "offsetU", label: "Desplazamiento U", max: 20, step: 0.2 },
                              { key: "offsetV", label: "Desplazamiento V", max: 20, step: 0.2 },
                            ] as const
                          ).map((control) => (
                            <div key={control.key} className="space-y-1">
                              <div className="flex items-center justify-between text-[11px]">
                                <span>{control.label}</span>
                                <span className="text-muted-foreground">
                                  {control.key === "angle" || control.key === "tilt"
                                    ? `${num(jointParams[control.key], 0)}°`
                                    : mm(jointParams[control.key], 2)}
                                </span>
                              </div>
                              <Slider
                                value={[jointParams[control.key]]}
                                min={control.key === "offsetU" || control.key === "offsetV" ? -control.max : 0}
                                max={control.max}
                                step={control.step}
                                onValueChange={([value]) => patchJoint({ [control.key]: value } as Partial<JointParams>)}
                              />
                            </div>
                          ))}

                          <div className="flex items-center justify-between rounded-md border px-2 py-1.5 text-[11px]">
                            <span>El macho va en</span>
                            <Select value={jointParams.maleOn} onValueChange={(value) => patchJoint({ maleOn: value as JointParams["maleOn"] })}>
                              <SelectTrigger className="h-7 w-28 text-[11px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="extracted">Pieza cortada</SelectItem>
                                <SelectItem value="body">Pieza restante</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                      {jointReason?.seamId === seamId ? jointReason.text : "Buscando el encastre…"}
                    </p>
                  )}

                  {jointPreview && (
                    <div className="space-y-1 text-[11px]">
                      <p
                        className={`rounded-md px-2 py-1.5 ${
                          jointPreview.valid
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {jointPreview.valid
                          ? "El encastre es válido: no hay interferencias y la pieza entra en línea recta."
                          : "El encastre no es válido todavía."}
                      </p>
                      <dl className="space-y-0.5 rounded-md border bg-background/60 px-2 py-1.5">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Interferencia</dt>
                          <dd>{jointPreview.metrics.interferenceVolume.toFixed(2)} mm³</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Entra en línea recta</dt>
                          <dd>{jointPreview.metrics.assemblyClear ? "Sí" : "No"}</dd>
                        </div>
                      </dl>
                      {jointPreview.issues.slice(0, 4).map((issue, index) => (
                        <p
                          key={`${issue.code}-${index}`}
                          className={`rounded-md px-2 py-1 ${
                            issue.severity === "error"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          }`}
                        >
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1">
                {doc?.seams.map((seam) => (
                  <div key={seam.id} className="flex items-center justify-between rounded-md border px-2 py-1 text-[11px]">
                    <span>{seam.parentName}</span>
                    <Badge variant={seam.joint ? "default" : "secondary"} className="text-[10px]">
                      {seam.joint ? "Con encastre" : "Sin encastre"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">Piezas a exportar</Label>
                <div className="space-y-1">
                  {exportPieces.map((piece) => (
                    <label
                      key={piece.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-[11px]"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          disabled={!piece.valid}
                          checked={piece.valid && exportSel[piece.id] !== false}
                          onChange={(event) => setExportSel((current) => ({ ...current, [piece.id]: event.target.checked }))}
                        />
                        <span className="font-medium">{piece.name}</span>
                      </span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {volume(piece.volume)}
                        {!piece.valid && <Badge variant="destructive" className="text-[10px]">no válida</Badge>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Formato</Label>
                  <Select value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stl">STL binario</SelectItem>
                      <SelectItem value="zip">ZIP con STL</SelectItem>
                      <SelectItem value="3mf">3MF</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Posición</Label>
                  <Select value={placement} onValueChange={(value) => setPlacement(value as Placement)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="print">Apoyadas en la cama</SelectItem>
                      <SelectItem value="original">Posición original</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Nombre base</Label>
                <Input value={baseName} onChange={(event) => setBaseName(event.target.value)} />
              </div>

              {exportResult && (
                <div className="space-y-1 text-[11px]">
                  <p className="rounded-md bg-emerald-500/10 px-2 py-1.5 text-emerald-700 dark:text-emerald-400">
                    Se exportaron {exportResult.files.length} archivo(s)
                    {exportResult.skipped.length ? `; ${exportResult.skipped.length} pieza(s) quedaron afuera` : ""}.
                  </p>
                  {exportResult.files.map((file) => (
                    <div key={file.name} className="flex items-center justify-between rounded-md border px-2 py-1">
                      <span className="truncate">{file.name}</span>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => downloadFile(file)}>
                        Descargar
                      </Button>
                    </div>
                  ))}
                  {exportResult.skipped.map((item) => (
                    <p key={item.id} className="text-destructive">
                      {item.name}: {item.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {step >= 4 && (
            <div className="mt-4 space-y-1.5 rounded-md border bg-background/50 p-2.5">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor="cutter2-manual-separation">Separación manual de piezas</Label>
                <span className="text-muted-foreground">{Math.round(explode * 100)}%</span>
              </div>
              <Slider
                id="cutter2-manual-separation"
                value={[explode]}
                min={0}
                max={1}
                step={0.02}
                onValueChange={([value]) => setExplode(value)}
                aria-label="Separación manual de piezas"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                Mové las piezas para inspeccionar las tapas y el encastre. Solo cambia la vista: no recalcula el corte ni modifica la exportación.
              </p>
            </div>
          )}
        </div>

        <div className="border-t px-4 py-3">
          {busy && (
            <div className="mb-2 space-y-2">
              <div role="status" aria-live="polite" className="space-y-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  <span>{progressMessage ?? busy}</span>
                  {progress > 0 && <span className="ml-auto">{Math.round(progress * 100)}%</span>}
                </div>
                <div
                  className="h-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={progressMessage ?? busy}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                >
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.max(4, progress * 100)}%` }} />
                </div>
              </div>
              {canCancel && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-9 w-full"
                  aria-label={cancelRequested ? "Cancelando operación" : "Cancelar operación"}
                  onClick={cancelActiveTask}
                  disabled={cancelRequested}
                >
                  {cancelRequested ? "Cancelando…" : "Cancelar"}
                </Button>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setStep((current) => (Math.max(1, current - 1) as StepId))}
              disabled={step === 1}
            >
              <ArrowLeft className="mr-1 size-3.5" />
              Atrás
            </Button>

            {step === 1 && (
              <Button size="sm" className="flex-1" onClick={() => setStep(2)} disabled={!doc || !!busy}>
                Seguir
                <ArrowRight className="ml-1 size-3.5" />
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" className="flex-1" onClick={() => setStep(3)} disabled={selectionStats.faces === 0 || !!busy}>
                Definir perímetro
                <ArrowRight className="ml-1 size-3.5" />
              </Button>
            )}
            {step === 3 && (
              <Button size="sm" className="flex-1" onClick={() => void confirmPerimeter()} disabled={!perim || !!busy}>
                Previsualizar
                <ArrowRight className="ml-1 size-3.5" />
              </Button>
            )}
            {step === 4 && (
              <Button size="sm" className="flex-1" onClick={() => void commitCut()} disabled={!preview || !!busy || (!preview.valid && !forceCommit)}>
                <Scissors className="mr-1 size-3.5" />
                Guardar corte
              </Button>
            )}
            {step === 5 && (
              <div className="flex flex-1 gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep(6)} disabled={!!busy}>
                  Seguir sin encastre
                </Button>
                <Button size="sm" className="flex-1" onClick={() => void commitJoint()} disabled={!jointPreview || !!busy}>
                  <CircleDot className="mr-1 size-3.5" />
                  Aplicar encastre
                </Button>
              </div>
            )}
            {step === 6 && (
              <Button size="sm" className="flex-1" onClick={() => void doExport()} disabled={!!busy}>
                <Box className="mr-1 size-3.5" />
                Exportar
              </Button>
            )}
          </div>
          {step === 5 && pendingSeams === 0 && totalSeams > 0 && (
            <Button variant="ghost" size="sm" className="mt-2 w-full text-[11px]" onClick={() => setStep(2)}>
              Volver a cortar otra pieza
            </Button>
          )}
          {step === 6 && (
            <Button variant="ghost" size="sm" className="mt-2 w-full text-[11px]" onClick={() => setStep(2)}>
              Volver a cortar
            </Button>
          )}
        </div>
      </aside>

      <div className="relative order-1 min-h-0 min-w-0 bg-gradient-to-b from-muted/40 to-background lg:order-1">
        <Cutter2Viewer
          pieces={viewerPieces}
          activePieceId={activeId}
          selection={step === 2 || step === 3 ? mask : null}
          hoverFaces={step === 2 ? hoverFaces : null}
          perimeters={step === 3 ? perimeters.map((editor) => editor.view) : []}
          suggestedLines={suggestedLines}
          seamLines={seamLines}
          mode={viewerMode}
          fitKey={fitKey}
          expanded={viewerExpanded}
          onToggleExpanded={() => setViewerExpanded((value) => !value)}
          showRings={step === 1}
          paintEnabled={step === 2 && selTool !== "wand"}
          brushRadius={brush}
          onFaceClick={(hit, mods) => {
            if (step === 1 && orientMode) void dropFaceOnBed(hit);
            else if (step === 2) onSelectionClick(hit, mods);
          }}
          onFaceHover={onFaceHover}
          onPaintStart={onPaintStart}
          onPaintDrag={onPaintDrag}
          onPerimeterMove={(loopIndex, index, hit, final) => void moveControl(loopIndex, index, hit, final)}
          onPerimeterInsert={(loopIndex, hit) => void insertPerimeterPoint(loopIndex, hit)}
        />
        {!doc && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border bg-card/80 px-4 py-3 text-center text-xs text-muted-foreground shadow-sm backdrop-blur">
              Cargá un STL o 3MF para empezar
            </div>
          </div>
        )}
      </div>
    </div>
  );

  function insertPerimeterPoint(loopIndex: number, hit: FaceHit) {
    void insertControl(loopIndex, hit);
  }
}
