"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileBox,
  FileText,
  FileUp,
  FolderOpen,
  Layers,
  Link2,
  Loader2,
  Move,
  MousePointer2,
  Plus,
  Rotate3d,
  RotateCcw,
  Ruler,
  Redo2,
  Save,
  Scissors,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Wand2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import {
  GroupLabel,
  Hint,
  PanelSection,
} from "@/components/tools/shared/panel";
import { baseName, downloadText } from "@/lib/image/download";
import {
  KEYCHAIN_SHAPES,
  SHAPE_LABELS,
  type KeychainShape,
} from "@/lib/3d/shapes";
import { getManifoldWasmUrl } from "@/lib/cutter/manifold";
import { loadModelFile } from "@/lib/cutter/load-model";
import {
  downloadAllStl,
  downloadCutter3mf,
  downloadPartStl,
} from "@/lib/cutter/export";
import {
  finalizeParts,
  opsToSpecs,
  repairModel,
  singlePart,
} from "@/lib/cutter/prepare";
import type {
  ComponentCutOp,
  CutAxis,
  CurveAxis,
  CurveCutOp,
  CutOp,
  CutterPartView,
  LoadedModel,
  PlaneCutOp,
  RegionCutOp,
  ShapeCutOp,
} from "@/lib/cutter/types";
import { CutterProcessor } from "@/lib/cutter/worker-client";
import { loadProject, saveProject } from "@/lib/cutter/project";
import { buildAssemblyReport } from "@/lib/cutter/report";
import {
  selectZone,
  zoneFromFaces,
  zoneToPlaneOp,
  type ZoneOptions,
  type ZoneResult,
} from "@/lib/cutter/zones";
import type { RepairStep } from "@/lib/mesh/types";
import { CutterViewer, type FacePick } from "./cutter-viewer";

const DESCRIPTION =
  "Partí un STL o 3MF en piezas imprimibles con cortes rectos, curvos o con la forma que elijas. Repará la malla y exportá cada pieza watertight.";

const AXIS_LABEL: Record<CutAxis, string> = { x: "X", y: "Y", z: "Z" };
const CUT_SHAPES = KEYCHAIN_SHAPES.filter((shape) => shape !== "silhouette");

function opLabel(op: CutOp): string {
  if (op.kind === "plane") return `Plano ${AXIS_LABEL[op.axis]}`;
  if (op.kind === "curve") return `Onda ${AXIS_LABEL[op.axis]}`;
  if (op.kind === "shape") return `Forma ${SHAPE_LABELS[op.shape]}`;
  if (op.kind === "components") return "Objetos";
  return op.label ?? "Zona";
}

function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatVolume(volume: number): string {
  if (volume >= 1000) return `${formatNumber(volume / 1000, 2)} cm³`;
  if (volume >= 10) return `${formatNumber(volume, 1)} mm³`;
  return `${formatNumber(volume, 2)} mm³`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
  }
  return `${formatNumber(bytes / 1024, 0)} KB`;
}

function normalToAxis(normal: [number, number, number]): CutAxis {
  const [ax, ay, az] = normal.map((value) => Math.abs(value));
  return az >= ax && az >= ay ? "z" : ax >= ay ? "x" : "y";
}

function planeRange(
  model: LoadedModel,
  axis: CutAxis,
  normal?: [number, number, number]
): [number, number] {
  if (!normal) {
    const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    return [model.bounds.min[index], model.bounds.max[index]];
  }
  const [nx, ny, nz] = normal;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const x of [model.bounds.min[0], model.bounds.max[0]]) {
    for (const y of [model.bounds.min[1], model.bounds.max[1]]) {
      for (const z of [model.bounds.min[2], model.bounds.max[2]]) {
        const value = x * nx + y * ny + z * nz;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
  }
  return [minimum, maximum];
}

function nextOpId(ops: CutOp[], prefix: string): string {
  return `${prefix}-${ops.length + 1}-${Math.random().toString(36).slice(2, 7)}`;
}

function allPartsValid(parts: CutterPartView[]): boolean {
  return parts.every(
    (part) => part.diagnostics.watertight && part.diagnostics.outward
  );
}

function JointSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix = "mm",
  digits = 2,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
  digits?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-[11px] text-muted-foreground">{label}</span>
      <Slider
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        className="flex-1"
      />
      <span className="w-11 text-right text-[11px] tabular-nums">
        {value.toFixed(digits)}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </div>
  );
}

function StepRow({ step }: { step: RepairStep }) {
  if (!step.changed) return null;
  return (
    <li className="flex items-start gap-2 text-xs">
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
      <span className="text-muted-foreground">
        <span className="font-medium text-foreground">{step.name}</span>:{" "}
        {step.before} → {step.after}
        {step.note ? ` · ${step.note}` : ""}
      </span>
    </li>
  );
}

export function CortadorTool() {
  const processorRef = useRef<CutterProcessor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const regionToastAtRef = useRef(0);

  const [model, setModel] = useState<LoadedModel | null>(null);
  const [parts, setParts] = useState<CutterPartView[]>([]);
  const [ops, setOps] = useState<CutOp[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [busy, setBusy] = useState<{ label: string; progress: number } | null>(
    null
  );
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairSteps, setRepairSteps] = useState<RepairStep[]>([]);
  const [repairWarnings, setRepairWarnings] = useState<string[]>([]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [exploded, setExploded] = useState(0);
  const [moveMode, setMoveMode] = useState(false);
  const [partOffsets, setPartOffsets] = useState<
    Record<string, [number, number, number]>
  >({});
  const [showPlanes, setShowPlanes] = useState(true);
  const [activeCutId, setActiveCutId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{
    id: string;
    axis: CutAxis;
    target: "plane" | "curve" | "shape";
  } | null>(null);
  const [layoutOnBed, setLayoutOnBed] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [zone, setZone] = useState<{ partId: string; zone: ZoneResult } | null>(
    null
  );
  const [zoneOptions, setZoneOptions] = useState<ZoneOptions>({
    tolerance: 35,
    useColor: true,
    useAngle: true,
    contiguous: true,
  });
  const [zoneDepth, setZoneDepth] = useState(4);
  const [history, setHistory] = useState<CutOp[][]>([]);
  const [future, setFuture] = useState<CutOp[][]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProject()
        .then((project) => setHasSaved(Boolean(project)))
        .catch(() => setHasSaved(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      processorRef.current?.cancel();
    };
  }, []);

  const resetModelState = useCallback((loaded: LoadedModel) => {
    setModel(loaded);
    const single = singlePart(loaded);
    setParts([single]);
    setSelectedPartId(single.id);
    setOps([]);
    setDirty(false);
    setPreviewing(false);
    setRepairSteps([]);
    setRepairWarnings([]);
    setExploded(0);
    setMoveMode(false);
    setPartOffsets({});
    setError(null);
    setZone(null);
    setPickMode(false);
    setPlacing(null);
    setActiveCutId(null);
    setHistory([]);
    setFuture([]);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const loaded = await loadModelFile(file);
        setSourceFile(file);
        resetModelState(loaded);
        if (loaded.warnings.length > 0) {
          toast.info(loaded.warnings[0]);
        }
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar el archivo";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [resetModelState]
  );

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragging(false);
    }
  };

  const handleRepair = useCallback(() => {
    if (!model) return;
    setRepairing(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const repaired = repairModel(model.mesh);
        setModel({
          ...model,
          mesh: repaired.mesh,
          diagnostics: repaired.diagnostics,
        });
        const single: CutterPartView = {
          id: "0",
          name: "Pieza 1",
          mesh: repaired.mesh,
          color: "#7dd3fc",
          volume: repaired.diagnostics.volume,
          diagnostics: repaired.diagnostics,
        };
        setParts([single]);
        setSelectedPartId(single.id);
        setRepairSteps(repaired.steps);
        setRepairWarnings(repaired.warnings);
        setOps([]);
        setDirty(false);
        setZone(null);
        setPickMode(false);
        setPlacing(null);
        setActiveCutId(null);
        setMoveMode(false);
        setPartOffsets({});
        setExploded(0);
        setHistory([]);
        setFuture([]);
        if (repaired.diagnostics.watertight) {
          toast.success("La malla quedó cerrada y lista para cortar");
        } else {
          toast.warning(
            "La malla sigue abierta. Probá con otro archivo o reparala en tu slicer."
          );
        }
      } catch (repairError) {
        const message =
          repairError instanceof Error
            ? repairError.message
            : "No se pudo reparar la malla";
        setError(message);
        toast.error(message);
      } finally {
        setRepairing(false);
      }
    }, 30);
  }, [model]);

  const commitOps = (next: CutOp[]) => {
    setHistory((current) => [...current.slice(-39), ops]);
    setFuture([]);
    setOps(next);
    setDirty(true);
  };

  const addPlane = (axis: CutAxis) => {
    if (!model) return;
    const [minimum, maximum] = planeRange(model, axis);
    const id = nextOpId(ops, "plane");
    commitOps([
      ...ops,
      {
        id,
        kind: "plane",
        axis,
        offset: (minimum + maximum) / 2,
        enabled: true,
      },
    ]);
    setShowPlanes(true);
    setPlacing(null);
    setPickMode(false);
    setMoveMode(false);
    setActiveCutId(id);
    toast.info("Arrastrá el plano o el aro ámbar y después aplicá el corte.");
  };

  const addCurve = (axis: CurveAxis) => {
    if (!model) return;
    const alongIndex = axis === "x" ? 0 : 1;
    const alongSize = model.bounds.size[alongIndex];
    const acrossIndex = axis === "x" ? 2 : 0;
    const amplitude = Math.min(6, model.bounds.size[2] * 0.22);
    const id = nextOpId(ops, "curve");
    commitOps([
      ...ops,
      {
        id,
        kind: "curve",
        axis,
        offset: model.bounds.center[acrossIndex],
        amplitude,
        wavelength: Math.max(10, alongSize * 0.5),
        phase: 0,
        enabled: true,
      },
    ]);
    setShowPlanes(true);
    setPlacing({ id, axis: "z", target: "curve" });
    setPickMode(false);
  };

  const addShape = (shape: KeychainShape = "star") => {
    if (!model) return;
    const [sizeX, sizeY] = model.bounds.size;
    const width = Math.max(4, Math.min(sizeX, sizeY) * 0.55);
    const id = nextOpId(ops, "shape");
    commitOps([
      ...ops,
      {
        id,
        kind: "shape",
        shape,
        width,
        height: width,
        rotationDeg: 0,
        offsetX: 0,
        offsetY: 0,
        enabled: true,
      },
    ]);
    setShowPlanes(true);
    setPlacing({ id, axis: "z", target: "shape" });
    setPickMode(false);
  };

  const updatePlane = (id: string, patch: Partial<PlaneCutOp>) => {
    setOps((current) =>
      current.map((op) =>
        op.id === id && op.kind === "plane" ? { ...op, ...patch } : op
      )
    );
    setDirty(true);
  };

  const handleTransformCut = (
    id: string,
    incoming: [number, number, number],
    offset: number
  ) => {
    const length = Math.hypot(incoming[0], incoming[1], incoming[2]) || 1;
    const normal: [number, number, number] = [
      incoming[0] / length,
      incoming[1] / length,
      incoming[2] / length,
    ];
    updatePlane(id, { normal, offset, axis: normalToAxis(normal) });
  };

  const updateCurve = (id: string, patch: Partial<CurveCutOp>) => {
    setOps((current) =>
      current.map((op) =>
        op.id === id && op.kind === "curve" ? { ...op, ...patch } : op
      )
    );
    setDirty(true);
  };

  const updateShape = (id: string, patch: Partial<ShapeCutOp>) => {
    setOps((current) =>
      current.map((op) =>
        op.id === id && op.kind === "shape" ? { ...op, ...patch } : op
      )
    );
    setDirty(true);
  };

  const applyPlacement = (
    offset: number,
    point: [number, number, number]
  ) => {
    if (!placing || !model) return;
    if (placing.target === "curve") {
      updateCurve(placing.id, { offset });
      return;
    }
    if (placing.target === "shape") {
      updateShape(placing.id, {
        offsetX: point[0] - model.bounds.center[0],
        offsetY: point[1] - model.bounds.center[1],
      });
      return;
    }
    updatePlane(placing.id, { offset });
  };

  const removeOp = (id: string) => {
    commitOps(ops.filter((op) => op.id !== id));
    if (placing?.id === id) setPlacing(null);
    if (activeCutId === id) setActiveCutId(null);
  };

  const moveOp = (id: string, direction: -1 | 1) => {
    const index = ops.findIndex((op) => op.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ops.length) return;
    const next = [...ops];
    [next[index], next[target]] = [next[target], next[index]];
    commitOps(next);
  };

  const clearCuts = () => {
    commitOps([]);
    setPlacing(null);
    setActiveCutId(null);
  };

  const undo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setFuture([ops, ...future].slice(0, 40));
    setOps(previous);
    setDirty(true);
    setPlacing(null);
    setZone(null);
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setHistory([...history.slice(-39), ops]);
    setOps(next);
    setDirty(true);
    setPlacing(null);
    setZone(null);
  };

  const handleMovePart = useCallback(
    (partId: string, offset: [number, number, number]) => {
      setPartOffsets((current) => ({ ...current, [partId]: offset }));
    },
    []
  );

  const handlePickFace = useCallback(
    (pick: FacePick) => {
      if (!model) return;
      const part = parts.find((item) => item.id === pick.partId);
      if (!part) return;
      const colors =
        model.faceColors && parts.length === 1 ? model.faceColors : null;
      try {
        const result = selectZone(
          part.mesh,
          pick.faceIndex,
          { ...zoneOptions, useColor: zoneOptions.useColor && Boolean(colors) },
          colors
        );
        let nextZone = result;
        if (
          pick.action !== "replace" &&
          zone &&
          zone.partId === part.id
        ) {
          const faces = new Set(zone.zone.faces);
          let changed = false;
          if (pick.action === "add") {
            for (const face of result.faces) {
              if (!faces.has(face)) {
                faces.add(face);
                changed = true;
              }
            }
          } else {
            for (const face of result.faces) {
              if (faces.delete(face)) changed = true;
            }
          }
          if (!changed) return;
          nextZone = zoneFromFaces(part.mesh, faces, colors);
        }
        setZone({ partId: part.id, zone: nextZone });
        setSelectedPartId(part.id);
        if (nextZone.boundaryLoops.length === 0 && pick.action === "replace") {
          toast.warning(
            "La zona cubre toda la pieza. Bajá la tolerancia para limitarla."
          );
        }
      } catch (zoneError) {
        if (pick.action === "subtract") {
          setZone(null);
          return;
        }
        const message =
          zoneError instanceof Error
            ? zoneError.message
            : "No se pudo detectar la zona";
        toast.error(message);
      }
    },
    [model, parts, zone, zoneOptions]
  );

  const runCuts = useCallback((nextOps: CutOp[], source: LoadedModel | null = model, preview = false) => {
    if (!source) return;
    const specs = opsToSpecs(nextOps, source);
    if (specs.length === 0) {
      if (preview) return;
      setPreviewing(false);
      const single = singlePart(source);
      setParts([single]);
      setSelectedPartId(single.id);
      setPartOffsets({});
      setExploded(0);
      setDirty(false);
      return;
    }
    processorRef.current?.cancel();
    const processor = new CutterProcessor();
    processorRef.current = processor;
    setBusy({ label: "Cortando la pieza", progress: 0 });
    setError(null);

    processor
      .cut(source.mesh, specs, getManifoldWasmUrl(), (progress, phase) => {
        setBusy({ label: phase, progress });
      })
      .then((result) => {
        const candidates = finalizeParts(result.parts);
        const views = candidates.filter((part) => part.volume > 1e-4);
        const discarded = candidates.length - views.length;
        if (views.length === 0) {
          const message =
            "El corte no generó piezas válidas. Revisá los planos o la zona.";
          setError(message);
          toast.error(message);
          return;
        }
        if (discarded > 0) {
          toast.info(`${discarded} fragmento(s) sin volumen descartados`);
        }
        setParts(views);
        setPreviewing(preview);
        if (result.warnings && result.warnings.length > 0) {
          toast.warning(result.warnings[0]);
        }
        setSelectedPartId(views[0]?.id ?? null);
        if (!preview) {
          setDirty(false);
          setZone(null);
          setPickMode(false);
          setPlacing(null);
          setActiveCutId(null);
          setMoveMode(false);
        }
        setPartOffsets({});
        setExploded(views.length > 1 ? (preview ? 0.12 : 0.3) : 0);
        const componentOnly =
          views.length <= 1 &&
          nextOps.some((op) => op.kind === "components");
        const invalid = views.filter(
          (part) =>
            !part.diagnostics.watertight || !part.diagnostics.outward
        );
        if (invalid.length > 0) {
          toast.warning(
            `${invalid.length} pieza(s) no quedaron cerradas. Revisá el diagnóstico antes de exportar.`
          );
        }
        if (preview) {
          toast.info(
            `Vista previa: ${views.length} pieza(s). Ajustá el corte o pulsá Aplicar cortes para confirmar.`
          );
        } else if (invalid.length === 0) {
          if (componentOnly) {
            toast.info(
              "El modelo es una sola cáscara: no hay objetos separados. Usá cortes, la varita o Separar formas automáticamente."
            );
          } else {
            toast.success(
              `${views.length} pieza${views.length === 1 ? "" : "s"} lista${
                views.length === 1 ? "" : "s"
              } en ${formatNumber(result.ms, 0)} ms`
            );
          }
        }
      })
      .catch((cutError: unknown) => {
        const message =
          cutError instanceof Error
            ? cutError.message
            : "No se pudo cortar la pieza";
        if (message === "cancelado") return;
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        setBusy(null);
      });
  }, [model]);

  const applyCuts = useCallback(() => {
    setPlacing(null);
    runCuts(ops);
  }, [ops, runCuts]);

  const handleSuggest = () => {
    if (!model) return;
    processorRef.current?.cancel();
    const processor = new CutterProcessor();
    processorRef.current = processor;
    setBusy({ label: "Buscando cortes naturales", progress: 0 });
    processor
      .suggest(model.mesh, getManifoldWasmUrl(), (progress, phase) => {
        setBusy({ label: phase, progress });
      })
      .then((result) => {
        if (result.suggestions.length === 0) {
          toast.info(
            "No se detectaron estrechamientos claros. Probá un corte manual."
          );
          return;
        }
        const added: PlaneCutOp[] = result.suggestions.map((suggestion, index) => ({
          id: nextOpId(ops, `auto${index}`),
          kind: "plane",
          axis: suggestion.axis,
          offset: suggestion.offset,
          enabled: true,
        }));
        const next = [...ops, ...added];
        setHistory((current) => [...current.slice(-39), ops]);
        setFuture([]);
        setOps(next);
        setDirty(true);
        setShowPlanes(true);
        setPlacing(null);
        toast.success(
          `${result.suggestions.length} corte${
            result.suggestions.length === 1 ? "" : "s"
          } sugerido${
            result.suggestions.length === 1 ? "" : "s"
          } en ${formatNumber(result.ms, 0)} ms`
        );
        if (model) {
          const source = model;
          window.setTimeout(() => runCuts(next, source, true), 80);
        }
      })
      .catch((suggestError: unknown) => {
        const message =
          suggestError instanceof Error
            ? suggestError.message
            : "No se pudo analizar la pieza";
        if (message === "cancelado") return;
        toast.error(message);
      })
      .finally(() => setBusy(null));
  };

  const handleAutoSeparate = () => {
    if (!model) return;
    processorRef.current?.cancel();
    const processor = new CutterProcessor();
    processorRef.current = processor;
    setBusy({ label: "Buscando uniones entre formas", progress: 0 });
    processor
      .separate(model.mesh, getManifoldWasmUrl(), (progress, phase) => {
        setBusy({ label: phase, progress });
      })
      .then((result) => {
        if (result.planes.length === 0) {
          toast.info(
            "No encontré uniones claras. Probá la varita o un corte manual."
          );
          return;
        }
        const added: PlaneCutOp[] = result.planes.map((plane, index) => ({
          id: nextOpId(ops, `seam${index}`),
          kind: "plane",
          axis: normalToAxis(plane.normal),
          normal: plane.normal,
          offset: plane.offset,
          enabled: true,
        }));
        const next = [...ops, ...added];
        setHistory((current) => [...current.slice(-39), ops]);
        setFuture([]);
        setOps(next);
        setDirty(true);
        setShowPlanes(true);
        setPlacing(null);
        setPickMode(false);
        setActiveCutId(added[0]?.id ?? null);
        toast.success(
          `${added.length} unión${
            added.length === 1 ? "" : "es"
          } detectada${added.length === 1 ? "" : "s"}. Revisá los planos y pulsá Aplicar cortes.`
        );
        if (model) {
          const source = model;
          window.setTimeout(() => runCuts(next, source, true), 80);
        }
      })
      .catch((separateError: unknown) => {
        const message =
          separateError instanceof Error
            ? separateError.message
            : "No se pudo separar la pieza";
        if (message === "cancelado") return;
        toast.error(message);
      })
      .finally(() => setBusy(null));
  };

  const handleSeparateComponents = () => {
    if (!model) return;
    const op: ComponentCutOp = {
      id: nextOpId(ops, "components"),
      kind: "components",
      enabled: true,
    };
    const next = [...ops, op];
    setHistory((current) => [...current.slice(-39), ops]);
    setFuture([]);
    setOps(next);
    setDirty(true);
    setPlacing(null);
    setPickMode(false);
    setActiveCutId(null);
    if (model) runCuts(next, model, true);
  };

  const handleEditRegionNode = useCallback(
    (
      id: string,
      ringIndex: number,
      pointIndex: number,
      point: [number, number]
    ) => {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      const next: [number, number] = [
        Number(point[0].toFixed(2)),
        Number(point[1].toFixed(2)),
      ];
      setOps((current) =>
        current.map((op) => {
          if (op.id !== id || op.kind !== "region") return op;
          return {
            ...op,
            rings: op.rings.map((ring, index) =>
              index === ringIndex
                ? ring.map((item, itemIndex) =>
                    itemIndex === pointIndex ? next : item
                  )
                : ring
            ),
          };
        })
      );
      setDirty(true);
      setZone(null);
      setActiveCutId(id);
      const now = Date.now();
      if (now - regionToastAtRef.current >= 2000) {
        regionToastAtRef.current = now;
        toast.info("Contorno ajustado. Pulsá Aplicar cortes.");
      }
    },
    []
  );

  const handleZoneCut = useCallback(() => {
    if (!zone) return;
    setPlacing(null);
    try {
      const op = zoneToPlaneOp(zone.zone, nextOpId(ops, "zone"));
      const next = [...ops, op];
      setHistory((current) => [...current.slice(-39), ops]);
      setFuture([]);
      setOps(next);
      setDirty(true);
      setShowPlanes(true);
      setActiveCutId(op.id);
      setZone(null);
      toast.info(
        "Plano ajustable agregado. Movelo o giralo hasta la base de la pieza y pulsá Aplicar cortes."
      );
    } catch (zoneError) {
      const message =
        zoneError instanceof Error
          ? zoneError.message
          : "No se pudo separar la zona";
      toast.error(message);
    }
  }, [ops, zone]);

  const handleNew = () => {
    processorRef.current?.cancel();
    setModel(null);
    setParts([]);
    setOps([]);
    setError(null);
    setRepairSteps([]);
    setRepairWarnings([]);
    setSelectedPartId(null);
    setBusy(null);
    setPreviewing(false);
    setZone(null);
    setPickMode(false);
    setPlacing(null);
    setActiveCutId(null);
    setMoveMode(false);
    setPartOffsets({});
    setHistory([]);
    setFuture([]);
    setSourceFile(null);
  };

  const handleSaveProject = async () => {
    if (!model || !sourceFile) return;
    try {
      await saveProject(model.fileName, sourceFile, ops);
      setHasSaved(true);
      toast.success("Proyecto guardado en este navegador");
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar el proyecto";
      toast.error(message);
    }
  };

  const handleOpenProject = async () => {
    setLoading(true);
    try {
      const project = await loadProject();
      if (!project) {
        toast.info("No hay ningún proyecto guardado");
        return;
      }
      const file = new File([project.file.bytes], project.file.name, {
        type: project.file.type,
      });
      const loaded = await loadModelFile(file);
      setSourceFile(file);
      resetModelState(loaded);
      setOps(project.ops);
      setHistory([]);
      setFuture([]);
      setDirty(true);
      runCuts(project.ops, loaded);
      toast.success(`Proyecto «${project.name}» restaurado`);
    } catch (openError) {
      const message =
        openError instanceof Error
          ? openError.message
          : "No se pudo abrir el proyecto";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const exportable = useMemo(
    () =>
      Boolean(model) &&
      !busy &&
      !dirty &&
      parts.length > 0 &&
      allPartsValid(parts),
    [busy, dirty, model, parts]
  );

  const base = model ? baseName(model.fileName) : "cortador";

  const handleDownloadStl = () => {
    if (parts.length === 1) {
      downloadPartStl(parts[0], base);
    } else {
      void downloadAllStl(parts, base).then(() => {
        toast.success("STL por pieza descargados");
      });
    }
  };

  const handleDownload3mf = () => {
    downloadCutter3mf(parts, base, layoutOnBed);
    toast.success("3MF descargado");
  };

  const handleDownloadReport = () => {
    if (!model) return;
    const report = buildAssemblyReport({
      fileName: model.fileName,
      parts,
      ops,
      totalVolume,
    });
    downloadText(report, `${base}-ensamblaje.md`, "text/markdown");
    toast.success("Informe descargado");
  };

  const watertight = model?.diagnostics.watertight ?? false;
  const outward = model?.diagnostics.outward ?? false;
  const canCut = Boolean(model) && watertight && outward && !busy;
  const activeCuts = ops.filter((op) => op.enabled).length;
  const planeOps = ops.filter(
    (op): op is PlaneCutOp => op.kind === "plane"
  );
  const activePlane = planeOps.find((op) => op.id === activeCutId) ?? null;
  const activeTilt = activePlane
    ? Math.round(
        (Math.acos(
          Math.min(
            1,
            Math.max(
              ...(activePlane.normal ?? [
                activePlane.axis === "x" ? 1 : 0,
                activePlane.axis === "y" ? 1 : 0,
                activePlane.axis === "z" ? 1 : 0,
              ]).map((value) => Math.abs(value))
            )
          )
        ) *
          180) /
          Math.PI
      )
    : 0;
  const curveOps = ops.filter(
    (op): op is CurveCutOp => op.kind === "curve"
  );
  const shapeOps = ops.filter(
    (op): op is ShapeCutOp => op.kind === "shape"
  );
  const regionOps = ops.filter(
    (op): op is RegionCutOp => op.kind === "region"
  );
  const totalVolume = parts.reduce((sum, part) => sum + part.volume, 0);
  const zoneHasColors = Boolean(model?.faceColors) && parts.length === 1;

  return (
    <div
      className="relative mx-auto w-full max-w-7xl px-4 py-8"
      data-testid="cortador-root"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.3mf,model/stl,model/3mf,application/sla"
        className="sr-only"
        onChange={handleInput}
      />

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Badge>Cortador</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Cortador de piezas 3D
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>
          <p
            className="mt-1 truncate text-xs text-muted-foreground"
            title={model ? model.fileName : undefined}
          >
            {model
              ? `${model.fileName} · ${formatNumber(
                  model.diagnostics.triangles,
                  0
                )} triángulos · ${model.bounds.size
                  .map((value) => formatNumber(value, 1))
                  .join(" × ")} mm`
              : "Cargá un STL o 3MF para empezar. Todo se procesa en tu navegador."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || Boolean(busy)}
          >
            <Upload className="size-4" />
            Cargar
          </Button>
          {model ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="save-project"
              onClick={handleSaveProject}
              disabled={!sourceFile || Boolean(busy) || loading}
            >
              <Save className="size-4" />
              Guardar
            </Button>
          ) : null}
          {hasSaved ? (
            <Button
              size="sm"
              variant="outline"
              data-testid="open-project"
              onClick={handleOpenProject}
              disabled={loading || Boolean(busy)}
            >
              <FolderOpen className="size-4" />
              Abrir
            </Button>
          ) : null}
          {model ? (
            <Button size="sm" variant="ghost" onClick={handleNew}>
              <RotateCcw className="size-4" />
              Nuevo
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Deshacer"
            data-testid="undo"
            disabled={history.length === 0 || Boolean(busy)}
            onClick={undo}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Rehacer"
            data-testid="redo"
            disabled={future.length === 0 || Boolean(busy)}
            onClick={redo}
          >
            <Redo2 className="size-4" />
          </Button>
        </div>
      </header>

      {!model ? (
        <div
          className={`flex min-h-[420px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : ""
          }`}
        >
          {loading ? (
            <Loader2 className="size-10 animate-spin text-primary" />
          ) : (
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <FileUp className="size-7" />
            </span>
          )}
          <div className="space-y-1">
            <p className="text-base font-medium">
              {loading ? "Leyendo el modelo…" : "Arrastrá tu STL o 3MF"}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Hasta 120 MB y 3 millones de triángulos. Un objeto por archivo.
              Nada se sube a un servidor.
            </p>
          </div>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            <Upload className="size-4" />
            Elegir archivo
          </Button>
          {error ? (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5" />
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="min-w-0 space-y-3">
            <div className="relative">
              <CutterViewer
                parts={parts}
                cuts={showPlanes ? ops : []}
                selectedPartId={selectedPartId}
                exploded={exploded}
                pickMode={pickMode}
                onPickFace={handlePickFace}
                moveMode={moveMode}
                partOffsets={partOffsets}
                onMovePart={handleMovePart}
                activeCutId={activeCutId}
                showCutPreviews={!previewing}
                onTransformCut={handleTransformCut}
                onEditRegionNode={handleEditRegionNode}
                placement={
                  placing
                    ? {
                        axis: placing.axis,
                        onPreview: (offset, point) =>
                          applyPlacement(offset, point),
                        onCommit: (offset, point) => {
                          applyPlacement(offset, point);
                          setPlacing(null);
                          toast.info(
                            "Corte ubicado. Aplicá para separar las piezas."
                          );
                        },
                      }
                    : null
                }
                selection={
                  zone
                    ? {
                        partId: zone.partId,
                        faces: zone.zone.faces,
                        loops: zone.zone.boundaryLoops,
                      }
                    : null
                }
                className="h-[58vh] min-h-[440px] w-full"
              />
              {!busy && (activePlane || (dirty && activeCuts > 0)) ? (
                <div className="absolute right-3 bottom-3 z-10 flex items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
                  {activePlane ? (
                    <div className="px-1">
                      <p className="text-[11px] font-medium">
                        Plano {AXIS_LABEL[activePlane.axis]}
                      </p>
                      <p className="text-[10px] tabular-nums text-muted-foreground">
                        {formatNumber(activePlane.offset, 1)} mm · inclinación{" "}
                        {activeTilt}°
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Arrastrá el plano o el aro ámbar; Shift también inclina.
                      </p>
                    </div>
                  ) : (
                    <p className="px-1 text-[11px] font-medium">
                      {activeCuts} corte{activeCuts === 1 ? "" : "s"} pendiente
                      {activeCuts === 1 ? "" : "s"}
                    </p>
                  )}
                  {dirty && activeCuts > 0 ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="preview-cuts"
                        onClick={() => runCuts(ops, model, true)}
                        disabled={!canCut}
                      >
                        <Eye className="size-4" />
                        Vista previa
                      </Button>
                      <Button
                        size="sm"
                        data-testid="apply-pending-cuts"
                        onClick={applyCuts}
                        disabled={!canCut}
                      >
                        <Scissors className="size-4" />
                        Aplicar cortes ({activeCuts})
                      </Button>
                    </>
                  ) : activePlane ? (
                    <Button
                      size="sm"
                      data-testid="apply-active-cut"
                      onClick={applyCuts}
                      disabled={!canCut}
                    >
                      <Scissors className="size-4" />
                      Aplicar corte
                    </Button>
                  ) : null}
                  {dirty && activeCuts > 0 ? (
                    <p className="max-w-[170px] px-1 text-[10px] leading-tight text-muted-foreground">
                      La vista previa muestra las piezas en colores, pero no
                      habilita la exportación.
                    </p>
                  ) : null}
                  {activePlane ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Cerrar control del plano"
                      onClick={() => setActiveCutId(null)}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {busy ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/75 backdrop-blur-sm">
                  <Loader2 className="size-7 animate-spin text-primary" />
                  <p className="text-sm font-medium">{busy.label}</p>
                  <Progress
                    value={Math.round(busy.progress * 100)}
                    className="w-56"
                  />
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {Math.round(busy.progress * 100)}%
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="cancel-job"
                    onClick={() => {
                      processorRef.current?.cancel();
                      setBusy(null);
                      toast.info("Operación cancelada");
                    }}
                  >
                    <X className="size-3.5" />
                    Cancelar
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Layers className="size-4" />
                  Piezas
                  <span className="text-xs font-normal text-muted-foreground">
                    ({parts.length})
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatVolume(totalVolume)}
                  </span>
                  {parts.length > 1 ? (
                    <>
                      <Button
                        size="xs"
                        variant={moveMode ? "default" : "outline"}
                        data-testid="toggle-move-parts"
                        onClick={() => {
                          setMoveMode((value) => !value);
                          setPickMode(false);
                          setPlacing(null);
                        }}
                      >
                        <Move className="size-3.5" />
                        {moveMode ? "Moviendo" : "Mover"}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setExploded((value) => (value > 0 ? 0 : 0.35));
                        }}
                      >
                        {exploded > 0 ? "Juntar" : "Separar"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              <ul className="divide-y">
                {parts.map((part) => {
                  const selected = part.id === selectedPartId;
                  const valid =
                    part.diagnostics.watertight && part.diagnostics.outward;
                  return (
                    <li
                      key={part.id}
                      className={`flex items-center gap-3 px-3 py-2 transition-colors ${
                        selected ? "bg-primary/5" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPartId(part.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className="size-3 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: part.color }}
                        />
                        <span className="truncate text-sm font-medium">
                          {part.name}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {formatVolume(part.volume)}
                        </span>
                        {valid ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                        ) : (
                          <TriangleAlert className="size-3.5 shrink-0 text-amber-600" />
                        )}
                      </button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Descargar ${part.name}`}
                        onClick={() => downloadPartStl(part, base)}
                        disabled={!valid}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {parts.length > 1 ? (
                <div className="flex items-center gap-2 border-t px-3 py-2">
                  <span className="text-[11px] text-muted-foreground">
                    Vista explotada
                  </span>
                  <Slider
                    aria-label="Vista explotada"
                    min={0}
                    max={1}
                    step={0.01}
                    value={[exploded]}
                    onValueChange={([value]) => setExploded(value)}
                    className="flex-1"
                  />
                  {Object.keys(partOffsets).length > 0 ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => setPartOffsets({})}
                    >
                      Ubicar
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {moveMode ? (
                <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                  Arrastrá las piezas en el visor para revisar el ensamble.
                  «Ubicar» las devuelve a su posición. La exportación conserva
                  su propia disposición.
                </p>
              ) : null}
            </div>

            {error ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <TriangleAlert className="size-3.5 shrink-0" />
                {error}
              </p>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-2">
            <PanelSection
              icon={FileBox}
              title="Modelo"
              summary={`${formatNumber(model.diagnostics.triangles, 0)} tri`}
            >
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-muted/60 px-2.5 py-2">
                  <p className="text-muted-foreground">Formato</p>
                  <p className="mt-0.5 font-medium uppercase">
                    {model.format}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 px-2.5 py-2">
                  <p className="text-muted-foreground">Peso</p>
                  <p className="mt-0.5 font-medium">
                    {formatBytes(model.fileSize)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 px-2.5 py-2">
                  <p className="text-muted-foreground">Volumen</p>
                  <p className="mt-0.5 font-medium">
                    {formatVolume(model.diagnostics.volume)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 px-2.5 py-2">
                  <p className="text-muted-foreground">Componentes</p>
                  <p className="mt-0.5 font-medium">
                    {model.diagnostics.components}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge variant={watertight ? "secondary" : "destructive"}>
                  {watertight ? (
                    <ShieldCheck className="size-3" />
                  ) : (
                    <TriangleAlert className="size-3" />
                  )}
                  {watertight ? "Malla cerrada" : "Malla abierta"}
                </Badge>
                {!outward ? (
                  <Badge variant="destructive">Normales invertidas</Badge>
                ) : null}
                {model.diagnostics.openEdges > 0 ? (
                  <Badge variant="outline">
                    {formatNumber(model.diagnostics.openEdges, 0)} bordes
                    abiertos
                  </Badge>
                ) : null}
                {model.diagnostics.nonManifoldEdges > 0 ? (
                  <Badge variant="outline">
                    {formatNumber(model.diagnostics.nonManifoldEdges, 0)} aristas
                    no manifold
                  </Badge>
                ) : null}
                {model.hasColors ? (
                  <Badge variant="outline">Color 3MF</Badge>
                ) : null}
              </div>

              {model.warnings.map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
                >
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  {warning}
                </p>
              ))}

              {!watertight || !outward ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
                  <p className="text-xs font-medium">
                    Repará la malla antes de cortar
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Se sueldan vértices, se orientan las caras y se cierran los
                    agujeros. El reporte queda visible y la exportación se
                    bloquea si no queda cerrada.
                  </p>
                </div>
              ) : null}

              <Button
                variant={watertight && outward ? "outline" : "default"}
                size="sm"
                className="w-full"
                onClick={handleRepair}
                disabled={repairing || Boolean(busy)}
              >
                {repairing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Wrench className="size-4" />
                )}
                {repairing ? "Reparando…" : "Reparar malla"}
              </Button>

              {repairSteps.filter((step) => step.changed).length > 0 ? (
                <div className="space-y-1">
                  <GroupLabel>Reparación aplicada</GroupLabel>
                  <ul className="space-y-1">
                    {repairSteps.map((step) => (
                      <StepRow key={step.name} step={step} />
                    ))}
                  </ul>
                </div>
              ) : null}
              {repairWarnings.map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400"
                >
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  {warning}
                </p>
              ))}
            </PanelSection>

            <PanelSection
              icon={Wand2}
              title="Zonas"
              summary={
                zone
                  ? `${zone.zone.triangles} caras`
                  : pickMode
                    ? "Pintá una zona"
                    : "Varita 3D"
              }
            >
              <Button
                size="sm"
                className="w-full"
                data-testid="auto-separate"
                onClick={handleAutoSeparate}
                disabled={!canCut}
              >
                <Sparkles className="size-4" />
                Separar formas automáticamente
              </Button>
              <Hint>
                Detecta uniones cóncavas entre formas, como un cilindro pegado a
                una esfera, y propone los cortes sin que tengas que medir.
              </Hint>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                data-testid="separate-components"
                onClick={handleSeparateComponents}
                disabled={!canCut}
              >
                <Layers className="size-4" />
                Separar objetos
              </Button>
              <Hint>
                Separa las cáscaras independientes del modelo en piezas, sin
                medir ni cortar. Si es una sola cáscara unida, usá «Separar
                formas automáticamente».
              </Hint>
              <Button
                size="sm"
                variant={pickMode ? "default" : "outline"}
                className="w-full"
                onClick={() => {
                  setPickMode((value) => !value);
                  if (!pickMode) {
                    setZoneOptions((current) => ({
                      ...current,
                      contiguous: true,
                    }));
                  }
                  setPlacing(null);
                }}
                disabled={!canCut}
              >
                <Wand2 className="size-4" />
                {pickMode ? "Pintá la zona en el visor" : "Activar varita"}
              </Button>
              <Hint>
                Zona conectada crece por la superficie y se detiene en bordes
                marcados. Caras sueltas busca parches con orientación parecida.
              </Hint>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                Tolerancia
                <Slider
                  aria-label="Tolerancia de la varita"
                  min={0}
                  max={100}
                  step={1}
                  value={[zoneOptions.tolerance]}
                  onValueChange={([value]) =>
                    setZoneOptions((current) => ({
                      ...current,
                      tolerance: value,
                    }))
                  }
                  className="flex-1"
                />
                <span className="w-8 text-right tabular-nums">
                  {zoneOptions.tolerance}
                </span>
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  size="xs"
                  variant={zoneOptions.useColor ? "secondary" : "outline"}
                  onClick={() =>
                    setZoneOptions((current) => ({
                      ...current,
                      useColor: !current.useColor,
                    }))
                  }
                  disabled={!zoneHasColors}
                >
                  Color
                </Button>
                <Button
                  size="xs"
                  variant={zoneOptions.useAngle ? "secondary" : "outline"}
                  onClick={() =>
                    setZoneOptions((current) => ({
                      ...current,
                      useAngle: !current.useAngle,
                    }))
                  }
                >
                  Ángulo
                </Button>
                  <Button
                    size="xs"
                    variant={zoneOptions.contiguous ? "secondary" : "outline"}
                    onClick={() =>
                      setZoneOptions((current) => ({
                        ...current,
                        contiguous: !current.contiguous,
                      }))
                    }
                  >
                    {zoneOptions.contiguous ? "Conectada" : "Sueltas"}
                  </Button>
                </div>
                {!zoneOptions.contiguous ? (
                  <p className="text-[11px] text-muted-foreground">
                    Caras sueltas selecciona parches parecidos aunque no estén
                    unidos. Para un bulto entero usá Zona conectada.
                  </p>
                ) : null}
                {zoneOptions.useColor && !zoneHasColors ? (
                <p className="text-[11px] text-muted-foreground">
                  La varita por color está disponible en un 3MF con colores y
                  antes de cortar. Ahora usa ángulos.
                </p>
              ) : null}

              {zone ? (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">
                      {zone.zone.triangles} caras ·{" "}
                      {formatNumber(zone.zone.area, 0)} mm²
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Quitar selección"
                      onClick={() => setZone(null)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Eje {AXIS_LABEL[zone.zone.axis]} · borde{" "}
                    {zone.zone.boundaryLoops.length} ·{" "}
                    {zone.zone.color ?? "sin color"}
                  </p>
                  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    Profundidad
                    <Slider
                      aria-label="Profundidad de la zona"
                      min={0.5}
                      max={Math.max(
                        2,
                        Math.min(...model.bounds.size) * 0.5
                      )}
                      step={0.5}
                      value={[zoneDepth]}
                      onValueChange={([value]) => setZoneDepth(value)}
                      className="flex-1"
                    />
                    <span className="w-12 text-right tabular-nums">
                      {formatNumber(zoneDepth, 1)} mm
                    </span>
                  </label>
                  <Button
                    size="sm"
                    className="w-full"
                    data-testid="separate-zone"
                    onClick={handleZoneCut}
                    disabled={!canCut}
                  >
                    <Scissors className="size-4" />
                    Separar zona
                  </Button>
                  <Hint>
                    La zona se corta con una tapa de esa profundidad. Seguí
                    pintando para ampliarla, usá Shift para sumar y Alt para
                    restar caras.
                  </Hint>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-3 text-center text-[11px] text-muted-foreground">
                  Activá la varita y arrastrá sobre el modelo para pintar la
                  zona.
                </p>
              )}
            </PanelSection>

            <PanelSection
              icon={Scissors}
              title="Cortes"
              summary={`${activeCuts} activo${activeCuts === 1 ? "" : "s"}`}
            >
              {ops.length > 0 ? (
                <div className="space-y-1.5">
                  <GroupLabel>Orden de cortes</GroupLabel>
                  {ops.map((op, index) => (
                    <div
                      key={op.id}
                      className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1"
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold tabular-nums">
                        {index + 1}
                      </span>
                      <span className="flex-1 truncate text-xs">
                        {opLabel(op)}
                      </span>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Subir corte"
                        data-testid={`move-up-${op.id}`}
                        disabled={index === 0 || Boolean(busy)}
                        onClick={() => moveOp(op.id, -1)}
                      >
                        <ChevronUp className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Bajar corte"
                        data-testid={`move-down-${op.id}`}
                        disabled={index === ops.length - 1 || Boolean(busy)}
                        onClick={() => moveOp(op.id, 1)}
                      >
                        <ChevronDown className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label="Eliminar corte"
                        disabled={Boolean(busy)}
                        onClick={() => removeOp(op.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <GroupLabel>Rectos</GroupLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {(["x", "y", "z"] as CutAxis[]).map((axis) => (
                  <Button
                    key={axis}
                    size="sm"
                    variant="outline"
                    data-testid={`add-plane-${axis}`}
                    onClick={() => addPlane(axis)}
                    disabled={!canCut}
                  >
                    <Plus className="size-3.5" />
                    Plano {AXIS_LABEL[axis]}
                  </Button>
                ))}
              </div>

              {planeOps.length > 0 ? (
                <div className="space-y-2">
                  {planeOps.map((plane) => {
                    const [minimum, maximum] = planeRange(
                      model,
                      plane.axis,
                      plane.normal
                    );
                    const joint = plane.joint;
                    return (
                      <div
                        key={plane.id}
                        className="space-y-2 rounded-lg border bg-muted/30 p-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-medium">
                            <span className="flex size-5 items-center justify-center rounded bg-background text-[10px] font-semibold">
                              {AXIS_LABEL[plane.axis]}
                            </span>
                            Plano {AXIS_LABEL[plane.axis]}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <Button
                              size="icon-xs"
                              variant={
                                activeCutId === plane.id ? "default" : "ghost"
                              }
                              aria-label="Mover o girar el plano"
                              data-testid={`gizmo-${plane.id}`}
                              onClick={() => {
                                setShowPlanes(true);
                                setPickMode(false);
                                setMoveMode(false);
                                setPlacing(null);
                                setActiveCutId(plane.id);
                              }}
                            >
                              <Rotate3d className="size-3.5" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant={
                                placing?.id === plane.id ? "default" : "ghost"
                              }
                              aria-label="Ubicar con el mouse"
                              onClick={() => {
                                setShowPlanes(true);
                                setPickMode(false);
                                setPlacing({
                                  id: plane.id,
                                  axis: plane.axis,
                                  target: "plane",
                                });
                              }}
                            >
                              <MousePointer2 className="size-3.5" />
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={
                                plane.enabled
                                  ? "Desactivar corte"
                                  : "Activar corte"
                              }
                              onClick={() =>
                                updatePlane(plane.id, {
                                  enabled: !plane.enabled,
                                })
                              }
                            >
                              {plane.enabled ? (
                                <Eye className="size-3.5" />
                              ) : (
                                <EyeOff className="size-3.5" />
                              )}
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Eliminar corte"
                              onClick={() => removeOp(plane.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                        {placing?.id === plane.id ? (
                          <p className="text-[11px] text-sky-700 dark:text-sky-400">
                            Mové el mouse sobre la pieza. La sombra muestra el
                            corte; hacé clic para fijarlo.
                          </p>
                        ) : activeCutId === plane.id ? (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400">
                            Arrastrá el plano para moverlo y el aro ámbar para
                            inclinarlo. Después usá «Aplicar corte».
                          </p>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Slider
                            aria-label={`Posición del plano ${AXIS_LABEL[plane.axis]}`}
                            min={minimum}
                            max={maximum}
                            step={0.1}
                            value={[plane.offset]}
                            onValueChange={([value]) =>
                              updatePlane(plane.id, { offset: value })
                            }
                            disabled={!plane.enabled}
                            className="flex-1"
                          />
                          <Input
                            type="number"
                            aria-label={`Coordenda ${AXIS_LABEL[plane.axis]}`}
                            className="h-7 w-20 text-right text-xs tabular-nums"
                            value={Number(plane.offset.toFixed(1))}
                            min={minimum}
                            max={maximum}
                            step={0.1}
                            onChange={(event) =>
                              updatePlane(plane.id, {
                                offset: Number(event.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2 rounded-md border border-dashed p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1 text-[11px] font-medium">
                              <Link2 className="size-3" />
                              Encastre
                            </span>
                            <Button
                              size="xs"
                              variant={joint ? "default" : "outline"}
                              data-testid="toggle-joint"
                              onClick={() =>
                                updatePlane(plane.id, {
                                  joint: joint
                                    ? undefined
                                    : {
                                        diameter: 5,
                                        length: 6,
                                        clearance: 0.2,
                                      },
                                })
                              }
                            >
                              {joint ? "Quitar" : "Agregar"}
                            </Button>
                          </div>
                          {joint ? (
                            <div className="space-y-1.5">
                              <JointSlider
                                label="Diámetro"
                                value={joint.diameter}
                                min={2}
                                max={12}
                                step={0.5}
                                onChange={(diameter) =>
                                  updatePlane(plane.id, {
                                    joint: { ...joint, diameter },
                                  })
                                }
                              />
                              <JointSlider
                                label="Largo"
                                value={joint.length}
                                min={2}
                                max={12}
                                step={0.5}
                                onChange={(length) =>
                                  updatePlane(plane.id, {
                                    joint: { ...joint, length },
                                  })
                                }
                              />
                              <div className="flex items-center gap-1.5">
                                <span className="w-16 text-[11px] text-muted-foreground">
                                  Forma
                                </span>
                                <Button
                                  size="xs"
                                  variant={
                                    (joint.variant ?? "dowel") === "dowel"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() =>
                                    updatePlane(plane.id, {
                                      joint: { ...joint, variant: "dowel" },
                                    })
                                  }
                                >
                                  Espiga
                                </Button>
                                <Button
                                  size="xs"
                                  variant={
                                    joint.variant === "keyed"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() =>
                                    updatePlane(plane.id, {
                                      joint: { ...joint, variant: "keyed" },
                                    })
                                  }
                                >
                                  Llave
                                </Button>
                                <Button
                                  size="xs"
                                  variant={
                                    joint.variant === "dovetail"
                                      ? "default"
                                      : "outline"
                                  }
                                  onClick={() =>
                                    updatePlane(plane.id, {
                                      joint: { ...joint, variant: "dovetail" },
                                    })
                                  }
                                >
                                  Milano
                                </Button>
                              </div>
                              <JointSlider
                                label={
                                  joint.count === 2 ? "Doble tetón" : "Cantidad"
                                }
                                value={joint.count ?? 1}
                                min={1}
                                max={4}
                                step={1}
                                suffix=""
                                digits={0}
                                onChange={(count) =>
                                  updatePlane(plane.id, {
                                    joint: { ...joint, count },
                                  })
                                }
                              />
                              <JointSlider
                                label="Holgura"
                                value={joint.clearance}
                                min={0.05}
                                max={0.4}
                                step={0.05}
                                onChange={(clearance) =>
                                  updatePlane(plane.id, {
                                    joint: { ...joint, clearance },
                                  })
                                }
                              />
                              <p className="text-[10px] text-muted-foreground">
                                {joint.count === 2
                                  ? "Doble tetón: "
                                  : `${joint.count ?? 1} tetón${
                                      (joint.count ?? 1) === 1 ? "" : "es"
                                    }: `}
                                espiga en una pieza y alojamiento en la otra.
                                Holgura recomendada: 0.15 mm con boquilla de 0.4
                                mm.
                              </p>
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground">
                              Suma una espiga y su alojamiento para volver a
                              unir las piezas.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <GroupLabel>Curvos</GroupLabel>
              <div className="grid grid-cols-2 gap-1.5">
                {(["x", "y"] as CurveAxis[]).map((axis) => (
                  <Button
                    key={axis}
                    size="sm"
                    variant="outline"
                    data-testid={`add-curve-${axis}`}
                    onClick={() => addCurve(axis)}
                    disabled={!canCut}
                  >
                    <Plus className="size-3.5" />
                    Onda {AXIS_LABEL[axis]}
                  </Button>
                ))}
              </div>
              <Hint>
                Una onda sinusoidal que atraviesa la pieza. Cambiá amplitud,
                largo de onda y fase para ajustarla.
              </Hint>

              {curveOps.map((curve) => {
                const acrossIndex = curve.axis === "x" ? 2 : 0;
                const alongIndex = curve.axis === "x" ? 0 : 1;
                const minimum = model.bounds.min[acrossIndex];
                const maximum = model.bounds.max[acrossIndex];
                const alongSize = model.bounds.size[alongIndex];
                return (
                  <div
                    key={curve.id}
                    className="space-y-2 rounded-lg border bg-muted/30 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        Onda en {AXIS_LABEL[curve.axis]}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon-xs"
                          variant={
                            placing?.id === curve.id ? "default" : "ghost"
                          }
                          aria-label="Ubicar la onda con el mouse"
                          onClick={() => {
                            setShowPlanes(true);
                            setPickMode(false);
                            setPlacing({
                              id: curve.id,
                              axis: "z",
                              target: "curve",
                            });
                          }}
                        >
                          <MousePointer2 className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={
                            curve.enabled ? "Desactivar corte" : "Activar corte"
                          }
                          onClick={() =>
                            updateCurve(curve.id, { enabled: !curve.enabled })
                          }
                        >
                          {curve.enabled ? (
                            <Eye className="size-3.5" />
                          ) : (
                            <EyeOff className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Eliminar corte"
                          onClick={() => removeOp(curve.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {placing?.id === curve.id ? (
                      <p className="text-[11px] text-sky-700 dark:text-sky-400">
                        Mové el mouse sobre la pieza y hacé clic para fijar la
                        altura de la onda.
                      </p>
                    ) : null}
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Altura
                      <Slider
                        aria-label="Altura de la onda"
                        min={minimum}
                        max={maximum}
                        step={0.1}
                        value={[curve.offset]}
                        onValueChange={([value]) =>
                          updateCurve(curve.id, { offset: value })
                        }
                        disabled={!curve.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {formatNumber(curve.offset, 1)}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Amplitud
                      <Slider
                        aria-label="Amplitud de la onda"
                        min={0}
                        max={Math.max(8, model.bounds.size[2] * 0.5)}
                        step={0.1}
                        value={[curve.amplitude]}
                        onValueChange={([value]) =>
                          updateCurve(curve.id, { amplitude: value })
                        }
                        disabled={!curve.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {formatNumber(curve.amplitude, 1)} mm
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Largo de onda
                      <Slider
                        aria-label="Largo de onda"
                        min={5}
                        max={Math.max(20, alongSize * 2)}
                        step={0.5}
                        value={[curve.wavelength]}
                        onValueChange={([value]) =>
                          updateCurve(curve.id, { wavelength: value })
                        }
                        disabled={!curve.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {formatNumber(curve.wavelength, 1)} mm
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Fase
                      <Slider
                        aria-label="Fase de la onda"
                        min={0}
                        max={360}
                        step={5}
                        value={[Math.round((curve.phase * 180) / Math.PI)]}
                        onValueChange={([value]) =>
                          updateCurve(curve.id, {
                            phase: (value * Math.PI) / 180,
                          })
                        }
                        disabled={!curve.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {Math.round((curve.phase * 180) / Math.PI)}°
                      </span>
                    </label>
                  </div>
                );
              })}

              <GroupLabel>Por forma</GroupLabel>
              <div className="grid grid-cols-3 gap-1.5">
                {CUT_SHAPES.map((shape) => (
                  <Button
                    key={shape}
                    size="xs"
                    variant="outline"
                    onClick={() => addShape(shape)}
                    disabled={!canCut}
                  >
                    {SHAPE_LABELS[shape]}
                  </Button>
                ))}
              </div>
              <Hint>
                La forma funciona como un cortante de galletitas: la zona de
                adentro se separa del resto. Al agregarla, hacé clic sobre la
                pieza para ubicarla.
              </Hint>

              {shapeOps.map((shape) => {
                const [sizeX, sizeY] = model.bounds.size;
                return (
                  <div
                    key={shape.id}
                    className="space-y-2 rounded-lg border bg-muted/30 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">
                        {SHAPE_LABELS[shape.shape]}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon-xs"
                          variant={
                            placing?.id === shape.id ? "default" : "ghost"
                          }
                          aria-label="Ubicar la forma con el mouse"
                          onClick={() => {
                            setShowPlanes(true);
                            setPickMode(false);
                            setPlacing({
                              id: shape.id,
                              axis: "z",
                              target: "shape",
                            });
                          }}
                        >
                          <MousePointer2 className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={
                            shape.enabled ? "Desactivar corte" : "Activar corte"
                          }
                          onClick={() =>
                            updateShape(shape.id, { enabled: !shape.enabled })
                          }
                        >
                          {shape.enabled ? (
                            <Eye className="size-3.5" />
                          ) : (
                            <EyeOff className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Eliminar corte"
                          onClick={() => removeOp(shape.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    {placing?.id === shape.id ? (
                      <p className="text-[11px] text-sky-700 dark:text-sky-400">
                        Hacé clic en la pieza para centrar la forma en ese punto.
                      </p>
                    ) : null}
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Ancho
                      <Slider
                        aria-label="Ancho de la forma"
                        min={2}
                        max={Math.max(4, sizeX)}
                        step={0.5}
                        value={[shape.width]}
                        onValueChange={([value]) =>
                          updateShape(shape.id, { width: value })
                        }
                        disabled={!shape.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {formatNumber(shape.width, 1)} mm
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Alto
                      <Slider
                        aria-label="Alto de la forma"
                        min={2}
                        max={Math.max(4, sizeY)}
                        step={0.5}
                        value={[shape.height]}
                        onValueChange={([value]) =>
                          updateShape(shape.id, { height: value })
                        }
                        disabled={!shape.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {formatNumber(shape.height, 1)} mm
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      Rotación
                      <Slider
                        aria-label="Rotación de la forma"
                        min={0}
                        max={360}
                        step={5}
                        value={[shape.rotationDeg]}
                        onValueChange={([value]) =>
                          updateShape(shape.id, { rotationDeg: value })
                        }
                        disabled={!shape.enabled}
                        className="flex-1"
                      />
                      <span className="w-12 text-right tabular-nums">
                        {shape.rotationDeg}°
                      </span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        X
                        <Input
                          type="number"
                          aria-label="Desplazamiento X de la forma"
                          className="h-7 text-right text-xs tabular-nums"
                          value={Number(shape.offsetX.toFixed(1))}
                          step={1}
                          onChange={(event) =>
                            updateShape(shape.id, {
                              offsetX: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        Y
                        <Input
                          type="number"
                          aria-label="Desplazamiento Y de la forma"
                          className="h-7 text-right text-xs tabular-nums"
                          value={Number(shape.offsetY.toFixed(1))}
                          step={1}
                          onChange={(event) =>
                            updateShape(shape.id, {
                              offsetY: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                );
              })}

              {regionOps.length > 0 ? (
                <div className="space-y-2">
                  <GroupLabel>Zonas separadas</GroupLabel>
                  {regionOps.map((region) => (
                    <div
                      key={region.id}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-2.5 py-2"
                    >
                      <span className="text-xs font-medium">
                        {region.label} · eje {AXIS_LABEL[region.axis]}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={
                            region.enabled ? "Desactivar corte" : "Activar corte"
                          }
                          onClick={() => {
                            setOps((current) =>
                              current.map((op) =>
                                op.id === region.id
                                  ? { ...op, enabled: !op.enabled }
                                  : op
                              )
                            );
                            setDirty(true);
                          }}
                        >
                          {region.enabled ? (
                            <Eye className="size-3.5" />
                          ) : (
                            <EyeOff className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label="Eliminar corte"
                          onClick={() => removeOp(region.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Hint>
                    Arrastrá los nodos azules del contorno para ajustar la zona
                    antes de aplicar.
                  </Hint>
                </div>
              ) : null}

              {ops.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  Todavía no hay cortes. La pieza se exporta entera.
                </p>
              ) : null}

              <div className="flex items-center justify-between">
                {planeOps.length > 0 ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPlanes((value) => !value)}
                  >
                    {showPlanes ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                    {showPlanes ? "Ocultar planos" : "Ver planos"}
                  </Button>
                ) : (
                  <span />
                )}
              <Button
                size="sm"
                variant="secondary"
                className="w-full"
                data-testid="suggest-cuts"
                onClick={handleSuggest}
                disabled={!canCut}
              >
                <Sparkles className="size-3.5" />
                Sugerir cortes por forma
              </Button>
              <Hint>
                Analiza la sección de la pieza en los tres ejes y propone planos
                en los estrechamientos naturales.
              </Hint>

              {ops.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={clearCuts}>
                    <X className="size-3.5" />
                    Quitar todos
                  </Button>
                ) : null}
              </div>

              <Button
                className="w-full"
                data-testid="apply-cuts"
                onClick={applyCuts}
                disabled={!canCut || ops.length === 0}
              >
                <Scissors className="size-4" />
                {dirty ? "Aplicar cortes" : "Recalcular piezas"}
              </Button>
              {dirty ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Los cortes cambiaron. Aplicá para actualizar las piezas.
                </p>
              ) : null}
            </PanelSection>

            <PanelSection
              icon={Download}
              title="Exportar"
              summary={`${parts.length} pieza${parts.length === 1 ? "" : "s"}`}
            >
              <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <Ruler className="size-3.5" />
                  Volumen total
                </span>
                <span className="font-medium tabular-nums">
                  {formatVolume(totalVolume)}
                </span>
              </div>
              {!exportable ? (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                  {dirty
                    ? "Aplicá los cortes pendientes."
                    : "La exportación se habilita cuando todas las piezas son watertight."}
                </p>
              ) : null}
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadStl}
                  disabled={!exportable}
                >
                  <Download className="size-3.5" />
                  {parts.length > 1 ? "STL (.zip)" : "STL"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload3mf}
                  disabled={!exportable}
                >
                  <FileBox className="size-3.5" />
                  3MF
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadReport}
                  disabled={parts.length === 0}
                >
                  <FileText className="size-3.5" />
                  Informe
                </Button>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={layoutOnBed}
                  onChange={(event) => setLayoutOnBed(event.target.checked)}
                  className="size-3.5 accent-primary"
                />
                Distribuir las piezas en la cama (3MF)
              </label>
              <Hint>
                El STL por pieza conserva las coordenadas originales. El 3MF
                incluye un color por pieza y la distribución opcional.
              </Hint>
            </PanelSection>
          </aside>
        </div>
      )}

      {dragging ? (
        <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-background/85 backdrop-blur">
          <div className="text-center">
            <Upload className="mx-auto size-8 text-primary" />
            <p className="mt-2 text-sm font-medium">Soltá el archivo acá</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
