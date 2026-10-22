"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  ArrowUpDown,
  BookOpen,
  Box,
  Download,
  FileUp,
  Grid3x3,
  Layers,
  Loader2,
  Lock,
  RotateCcw,
  Shield,
  Sparkles,
  TriangleAlert,
  Unlock,
  Upload,
  Waves,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  GroupLabel,
  Hint,
  IconAction,
  PanelSection,
  PanelTooltips,
  SegmentedControl,
  ToggleButton,
} from "@/components/tools/shared/panel";
import { baseName } from "@/lib/image/download";
import { loadStlFile, type LoadedStl } from "@/lib/texturizer/load-stl";
import {
  downloadStl,
  estimateStlBytes,
  stlFromMesh,
  stlFromSoup,
} from "@/lib/texturizer/export-stl";
import {
  buildTextureTile,
  customTextureFromFile,
  TEXTURE_LABELS,
} from "@/lib/texturizer/textures";
import {
  DEFAULT_TEXTURIZER_SETTINGS,
  type AmplitudeUnit,
  type MaskAction,
  type MaskFaces,
  type MaskSettings,
  type ProcessOptions,
  type ProcessResult,
  type ProjectionMode,
  type TextureSelection,
  type TextureTile,
  type TexturizerSettings,
} from "@/lib/texturizer/types";
import { TexturizerProcessor } from "@/lib/texturizer/worker-client";
import { TextureGallery } from "./texture-gallery";
import { TexturizerViewer } from "./texturizer-viewer";
import {
  BufferAttribute,
  BufferGeometry,
} from "three";

const DESCRIPTION =
  "Cargá un STL y esculpí su superficie con texturas reales. Ajustá proyección, profundidad y máscara, revisá el relieve en 3D y exportá un STL listo para imprimir.";

const PREVIEW_TRIANGLE_BUDGET = 650_000;
const EXPORT_TRIANGLE_BUDGET = 1_500_000;
const PROCESS_DELAY = 280;
const TILE_SIZE = 256;

const PROJECTION_OPTIONS: {
  value: ProjectionMode;
  label: string;
  title: string;
}[] = [
  {
    value: "triplanar",
    label: "Triplanar",
    title: "Mezcla las tres orientaciones según la normal",
  },
  { value: "xy", label: "XY", title: "Proyecta sobre el plano XY" },
  { value: "xz", label: "XZ", title: "Proyecta sobre el plano XZ" },
  { value: "yz", label: "YZ", title: "Proyecta sobre el plano YZ" },
];

const MASK_ACTION_OPTIONS: { value: MaskAction; label: string }[] = [
  { value: "include", label: "Incluir" },
  { value: "exclude", label: "Excluir" },
];

const MASK_FACE_OPTIONS: { value: MaskFaces; label: string }[] = [
  { value: "top", label: "Arriba" },
  { value: "bottom", label: "Abajo" },
  { value: "both", label: "Ambas" },
];

const RESOLUTION_PRESETS = [
  { value: 2, label: "Rápida" },
  { value: 1, label: "Media" },
  { value: 0.6, label: "Fina" },
];

const numberFormat = new Intl.NumberFormat("es-AR");

function formatNumber(value: number): string {
  return numberFormat.format(Math.round(value));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function geometryFromResult(result: ProcessResult): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(result.positions, 3)
  );
  geometry.setAttribute("normal", new BufferAttribute(result.normals, 3));
  geometry.setIndex(new BufferAttribute(result.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeAfterFrames(geometry: BufferGeometry | null): void {
  if (!geometry) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => geometry.dispose());
  });
}

function ValueSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  decimals = 2,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const formatted = value.toFixed(decimals);
  const display = editing ? draft : formatted;
  const commit = () => {
    setEditing(false);
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    onChange(Math.min(max, Math.max(min, parsed)));
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={display}
            onFocus={() => {
              setDraft(formatted);
              setEditing(true);
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-7 w-16 px-1.5 text-right text-[11px] tabular-nums"
          />
          {unit ? (
            <span className="text-[11px] text-muted-foreground">{unit}</span>
          ) : null}
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        aria-label={label}
        onValueChange={([next]) => onChange(next)}
      />
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TexturizerTool() {
  const [model, setModel] = useState<LoadedStl | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState<TexturizerSettings>(
    DEFAULT_TEXTURIZER_SETTINGS
  );
  const [customTile, setCustomTile] = useState<TextureTile | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [processed, setProcessed] = useState<ProcessResult | null>(null);
  const [processedGeometry, setProcessedGeometry] =
    useState<BufferGeometry | null>(null);
  const [processing, setProcessing] = useState<{
    progress: number;
    phase: string;
  } | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);
  const modelRef = useRef<LoadedStl | null>(null);
  const processedGeometryRef = useRef<BufferGeometry | null>(null);
  const processorRef = useRef<TexturizerProcessor | null>(null);
  const exportProcessorRef = useRef<TexturizerProcessor | null>(null);
  const processTokenRef = useRef(0);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    return () => {
      processorRef.current?.cancel();
      exportProcessorRef.current?.cancel();
      processedGeometryRef.current?.dispose();
      modelRef.current?.geometry.dispose();
    };
  }, []);

  const updateSettings = (patch: Partial<TexturizerSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  };

  const updateMask = (patch: Partial<MaskSettings>) => {
    setSettings((previous) => ({
      ...previous,
      mask: { ...previous.mask, ...patch },
    }));
  };

  const minDimension = model
    ? Math.min(model.bounds.size[0], model.bounds.size[1], model.bounds.size[2])
    : 0;

  const amplitudeMm =
    settings.amplitudeUnit === "percent"
      ? (settings.amplitude / 100) * minDimension
      : settings.amplitude;

  const activeTile = useMemo<TextureTile | null>(() => {
    if (!settings.texture) return null;
    if (settings.texture === "custom") return customTile;
    return buildTextureTile(settings.texture, TILE_SIZE);
  }, [customTile, settings.texture]);

  const hasTexture = Boolean(settings.texture && activeTile);
  const outputTriangles = processed
    ? processed.triangles
    : model && (!hasTexture || amplitudeMm <= 0)
      ? model.triangles
      : null;
  const openEdges = processed?.openEdges ?? model?.openEdges ?? 0;
  const nonManifoldEdges =
    processed?.nonManifoldEdges ?? model?.nonManifoldEdges ?? 0;
  const estimatedBytes = estimateStlBytes(
    outputTriangles ?? model?.triangles ?? 0
  );
  const reliefMm = settings.symmetric ? amplitudeMm * 2 : amplitudeMm;
  const reliefLimitMm = Math.max(0.01, minDimension * 0.1);
  const amplitudeWarning = model !== null && reliefMm > reliefLimitMm;
  const safeAmplitudeMm = Math.max(
    0.01,
    reliefLimitMm / (settings.symmetric ? 2 : 1)
  );
  const applySafeAmplitude = () => {
    if (!model) return;
    if (settings.amplitudeUnit === "mm") {
      updateSettings({ amplitude: Number(safeAmplitudeMm.toFixed(2)) });
    } else {
      updateSettings({
        amplitude: Number(
          ((safeAmplitudeMm / minDimension) * 100).toFixed(1)
        ),
      });
    }
  };

  useEffect(() => {
    if (
      !model ||
      !activeTile ||
      !settings.texture ||
      amplitudeMm <= 0 ||
      !settings.previewEnabled
    ) {
      const resetTimer = setTimeout(() => {
        setProcessing(null);
        setProcessed(null);
        setProcessError(null);
        const previous = processedGeometryRef.current;
        processedGeometryRef.current = null;
        setProcessedGeometry(null);
        if (previous) disposeAfterFrames(previous);
      }, 0);
      return () => clearTimeout(resetTimer);
    }

    let cancelled = false;
    const token = processTokenRef.current + 1;
    processTokenRef.current = token;

    const timer = setTimeout(() => {
      if (cancelled) return;
      setProcessError(null);
      setProcessing({ progress: 0, phase: "Preparando" });
      processorRef.current?.cancel();
      const processor = new TexturizerProcessor();
      processorRef.current = processor;
      const options: ProcessOptions = {
        targetEdgeMm: settings.resolutionMm,
        maxTriangles: PREVIEW_TRIANGLE_BUDGET,
        amplitudeMm,
        symmetric: settings.symmetric,
        projection: settings.projection,
        scaleU: settings.scaleU,
        scaleV: settings.scaleV,
        offsetU: settings.offsetU,
        offsetV: settings.offsetV,
        rotationDeg: settings.rotationDeg,
        smoothing: settings.smoothing,
        repairMesh: settings.repairMesh,
        surfaceSmoothing: settings.surfaceSmoothing,
        mask: settings.mask,
        tile: activeTile,
      };
      processor
        .process(model.positions, options, (progress, phase) => {
          if (cancelled || processTokenRef.current !== token) return;
          setProcessing({ progress, phase });
        })
        .then((result) => {
          if (cancelled || processTokenRef.current !== token) return;
          const geometry = geometryFromResult(result);
          const previous = processedGeometryRef.current;
          processedGeometryRef.current = geometry;
          setProcessedGeometry(geometry);
          setProcessed(result);
          setProcessing(null);
          if (previous) disposeAfterFrames(previous);
        })
        .catch((error) => {
          if (cancelled || processTokenRef.current !== token) return;
          if (error instanceof Error && error.message === "cancelado") return;
          setProcessing(null);
          setProcessError(
            error instanceof Error
              ? error.message
              : "No se pudo aplicar la textura"
          );
        });
    }, PROCESS_DELAY);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      processTokenRef.current += 1;
      processorRef.current?.cancel();
    };
  }, [activeTile, amplitudeMm, model, settings]);

  const handleFile = async (file: File) => {
    const isStl =
      file.name.toLowerCase().endsWith(".stl") ||
      file.type === "model/stl" ||
      file.type === "application/sla" ||
      file.type === "application/vnd.ms-pki.stl";
    if (!isStl) {
      toast.error("Elegí un archivo STL");
      return;
    }
    setLoadingModel(true);
    setProcessError(null);
    const previousModel = modelRef.current;
    try {
      const loaded = await loadStlFile(file);
      setModel(loaded);
      modelRef.current = loaded;
      setProcessed(null);
      const previousGeometry = processedGeometryRef.current;
      processedGeometryRef.current = null;
      setProcessedGeometry(null);
      if (previousGeometry) disposeAfterFrames(previousGeometry);
      if (previousModel) disposeAfterFrames(previousModel.geometry);
      toast.success(
        `STL cargado · ${formatNumber(loaded.triangles)} triángulos`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo cargar el STL"
      );
    } finally {
      setLoadingModel(false);
    }
  };

  const handleModelInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void handleFile(file);
  };

  const handleCustomInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Elegí una imagen PNG, JPG o WebP");
      return;
    }
    setCustomLoading(true);
    try {
      const tile = await customTextureFromFile(file, TILE_SIZE);
      setCustomTile(tile);
      setCustomName(file.name);
      updateSettings({ texture: "custom" });
      toast.success("Mapa personalizado cargado");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo cargar el mapa"
      );
    } finally {
      setCustomLoading(false);
    }
  };

  const handleNew = () => {
    processorRef.current?.cancel();
    exportProcessorRef.current?.cancel();
    processTokenRef.current += 1;
    const previousGeometry = processedGeometryRef.current;
    processedGeometryRef.current = null;
    disposeAfterFrames(previousGeometry);
    if (modelRef.current) disposeAfterFrames(modelRef.current.geometry);
    modelRef.current = null;
    setModel(null);
    setProcessed(null);
    setProcessedGeometry(null);
    setProcessing(null);
    setProcessError(null);
    setSettings(DEFAULT_TEXTURIZER_SETTINGS);
    setCustomTile(null);
    setCustomName(null);
    setExporting(false);
    setExportProgress(0);
    if (modelInputRef.current) modelInputRef.current.value = "";
    if (customInputRef.current) customInputRef.current.value = "";
  };

  const selectTexture = (texture: TextureSelection | null) => {
    updateSettings({ texture });
  };

  const clearCustomTexture = () => {
    setCustomTile(null);
    setCustomName(null);
    setSettings((previous) => ({
      ...previous,
      texture: previous.texture === "custom" ? null : previous.texture,
    }));
  };

  const clearTexture = () => {
    updateSettings({ texture: null });
  };

  const resetTextureSettings = () => {
    setSettings((previous) => ({
      ...DEFAULT_TEXTURIZER_SETTINGS,
      texture: previous.texture,
    }));
  };

  const updateScale = (axis: "u" | "v", value: number) => {
    setSettings((previous) => {
      if (previous.lockAspect) {
        return { ...previous, scaleU: value, scaleV: value };
      }
      return axis === "u"
        ? { ...previous, scaleU: value }
        : { ...previous, scaleV: value };
    });
  };

  const toggleLock = () => {
    setSettings((previous) =>
      previous.lockAspect
        ? { ...previous, lockAspect: false }
        : { ...previous, lockAspect: true, scaleV: previous.scaleU }
    );
  };

  const changeAmplitudeUnit = (unit: AmplitudeUnit) => {
    setSettings((previous) => {
      if (unit === previous.amplitudeUnit) return previous;
      if (!model) return { ...previous, amplitudeUnit: unit };
      const dimension = Math.min(
        model.bounds.size[0],
        model.bounds.size[1],
        model.bounds.size[2]
      );
      if (dimension <= 0) return { ...previous, amplitudeUnit: unit };
      const currentMm =
        previous.amplitudeUnit === "percent"
          ? (previous.amplitude / 100) * dimension
          : previous.amplitude;
      return {
        ...previous,
        amplitudeUnit: unit,
        amplitude:
          unit === "percent"
            ? Math.min(30, (currentMm / dimension) * 100)
            : Math.min(10, currentMm),
      };
    });
  };

  const handleExport = async () => {
    if (!model || exporting) return;
    setExporting(true);
    setExportProgress(0);
    try {
      if (!activeTile || !settings.texture || amplitudeMm <= 0) {
        downloadStl(
          stlFromSoup(model.positions),
          `${baseName(model.fileName)}-texturizado.stl`
        );
        toast.success("STL exportado");
        return;
      }
      const processor = new TexturizerProcessor();
      exportProcessorRef.current = processor;
      const options: ProcessOptions = {
        targetEdgeMm: settings.resolutionMm,
        maxTriangles: EXPORT_TRIANGLE_BUDGET,
        amplitudeMm,
        symmetric: settings.symmetric,
        projection: settings.projection,
        scaleU: settings.scaleU,
        scaleV: settings.scaleV,
        offsetU: settings.offsetU,
        offsetV: settings.offsetV,
        rotationDeg: settings.rotationDeg,
        smoothing: settings.smoothing,
        repairMesh: settings.repairMesh,
        surfaceSmoothing: settings.surfaceSmoothing,
        mask: settings.mask,
        tile: activeTile,
      };
      const result = await processor.process(
        model.positions,
        options,
        (progress) => setExportProgress(progress)
      );
      downloadStl(
        stlFromMesh(result.positions, result.indices),
        `${baseName(model.fileName)}-texturizado.stl`
      );
      if (result.capped) {
        toast.warning(
          "STL exportado, pero se alcanzó el presupuesto de triángulos"
        );
      } else {
        toast.success(
          `STL exportado · ${formatNumber(result.triangles)} triángulos`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message === "cancelado") return;
      toast.error(
        error instanceof Error ? error.message : "No se pudo exportar el STL"
      );
    } finally {
      exportProcessorRef.current = null;
      setExporting(false);
      setExportProgress(0);
    }
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragging(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragging(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const dimensions = model
    ? `${model.bounds.size[0].toFixed(1)} × ${model.bounds.size[1].toFixed(
        1
      )} × ${model.bounds.size[2].toFixed(1)} mm`
    : "—";

  const selectedTextureLabel =
    settings.texture === "custom"
      ? (customName ?? TEXTURE_LABELS.custom)
      : settings.texture
        ? TEXTURE_LABELS[settings.texture]
        : "Sin textura";

  const maskSummary = settings.mask.excludeBase
    ? "Base excluida"
    : settings.mask.enabled
      ? "Activa"
      : "Inactiva";

  const resolutionSummary = processing
    ? `${Math.round(processing.progress * 100)}%`
    : processed
      ? `${formatNumber(processed.triangles)} tri`
      : `${settings.resolutionMm.toFixed(2)} mm`;

  return (
    <div
      className="mx-auto w-full max-w-7xl px-4 py-8"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={modelInputRef}
        type="file"
        accept=".stl,model/stl,application/sla,application/vnd.ms-pki.stl"
        className="sr-only"
        onChange={handleModelInput}
      />
      <input
        ref={customInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={handleCustomInput}
      />

      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Texturizador</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Texturizador STL
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {model
              ? `${model.fileName} · ${formatNumber(
                  model.triangles
                )} triángulos · ${dimensions}`
              : "Cargá un STL para empezar. Todo se procesa en tu navegador."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleNew}>
            <RotateCcw className="size-4" />
            Nuevo
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-3">
          <div className="relative">
            <TexturizerViewer
              originalGeometry={model?.geometry ?? null}
              geometry={processedGeometry}
              showOriginal={!settings.previewEnabled}
              onToggleShowOriginal={() =>
                updateSettings({ previewEnabled: !settings.previewEnabled })
              }
              className="h-[58vh] min-h-[440px] w-full"
            />

            {!model ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/75 p-6 text-center backdrop-blur-sm">
                <span className="flex size-12 items-center justify-center rounded-xl border bg-card text-primary shadow-sm">
                  <FileUp className="size-5" />
                </span>
                <div>
                  <p className="font-medium">Cargá un STL</p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Arrastralo sobre esta ventana o elegí un archivo. Tu modelo
                    no se sube a ningún servidor.
                  </p>
                </div>
                <Button onClick={() => modelInputRef.current?.click()}>
                  <Upload className="size-4" />
                  Elegir STL
                </Button>
                <Hint>STL binario o ASCII · hasta 120 MB · 3M triángulos</Hint>
              </div>
            ) : null}

            {loadingModel ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-sm">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Leyendo STL…
                </span>
              </div>
            ) : null}

            {processing ? (
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 sm:right-auto sm:w-80 rounded-lg border bg-background/92 p-3 shadow-lg backdrop-blur">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                    <span className="truncate text-muted-foreground">
                      {processing.phase}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {Math.round(processing.progress * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{
                      width: `${Math.max(
                        4,
                        Math.round(processing.progress * 100)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {dragging ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
                <p className="rounded-md bg-background/90 px-3 py-1.5 text-sm font-medium text-primary">
                  Soltá el STL
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Entrada"
              value={model ? formatNumber(model.triangles) : "—"}
              hint="triángulos"
            />
            <Stat
              label="Salida"
              value={outputTriangles ? formatNumber(outputTriangles) : "—"}
              hint="triángulos"
            />
            <Stat label="Dimensiones" value={dimensions} />
            <Stat
              label="STL estimado"
              value={model ? formatBytes(estimatedBytes) : "—"}
              hint={processing ? "textura en proceso" : "sin comprimir"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Malla:{" "}
              <span className="text-foreground">
                {openEdges === 0 && nonManifoldEdges === 0
                  ? "cerrada"
                  : `${formatNumber(openEdges)} borde(s) abiertos`}
              </span>
            </span>
            {nonManifoldEdges > 0 ? (
              <span>{formatNumber(nonManifoldEdges)} borde(s) no manifold</span>
            ) : null}
            {processed ? (
              <span>
                Máscara:{" "}
                <span className="text-foreground">
                  {formatNumber(processed.maskedTriangles)} caras
                </span>
              </span>
            ) : null}
            {processed ? (
              <span>
                Proceso:{" "}
                <span className="text-foreground">
                  {processed.elapsedMs.toFixed(0)} ms
                </span>
              </span>
            ) : null}
          </div>

          {openEdges > 0 || nonManifoldEdges > 0 ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3.5" />
                La malla no está cerrada
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                La textura se puede aplicar igual, pero revisá la pieza antes de
                imprimir. No se repara la malla en esta versión.
              </p>
            </div>
          ) : null}

          {amplitudeWarning ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3.5" />
                Amplitud alta
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                El relieve total es {reliefMm.toFixed(2)} mm
                {minDimension > 0
                  ? ` (${Math.round((reliefMm / minDimension) * 100)}% de la dimensión menor, ${minDimension.toFixed(1)} mm)`
                  : ""}
                . Puede deformar la pieza o dejar paredes demasiado finas.
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={applySafeAmplitude}
              >
                Ajustar a {safeAmplitudeMm.toFixed(2)} mm
              </Button>
            </div>
          ) : null}

          {processed?.capped ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/8 px-3 py-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3.5" />
                Presupuesto de vista previa alcanzado
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                La textura se aplicó con detalle parcial. Probá una arista más
                grande; la exportación usa un presupuesto mayor.
              </p>
            </div>
          ) : null}

          {processError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">
                No se pudo aplicar la textura
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {processError}
              </p>
            </div>
          ) : null}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <PanelTooltips>
            <PanelSection
              icon={BookOpen}
              title="Guía rápida"
              summary="Paso a paso"
              defaultOpen={false}
            >
              <ol className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                <li>
                  <strong className="text-foreground">1. Modelo:</strong>{" "}
                  cargá o arrastrá un STL. Todo se procesa en tu navegador.
                </li>
                <li>
                  <strong className="text-foreground">2. Malla:</strong>{" "}
                  reparala si tiene normales invertidas o ruido; suavizá solo si
                  el escaneo lo necesita.
                </li>
                <li>
                  <strong className="text-foreground">3. Textura:</strong>{" "}
                  elegí un patrón, subí un mapa propio o usá “Sin textura” para
                  ver la malla original. Los tonos claros suben la superficie;
                  los oscuros la hunden.
                </li>
                <li>
                  <strong className="text-foreground">4. Proyección:</strong>{" "}
                  triplanar para piezas orgánicas; XY/XZ/YZ para caras planas.
                  Escala 1 = un mosaico cada 10 mm.
                </li>
                <li>
                  <strong className="text-foreground">5. Relieve:</strong>{" "}
                  amplitud es la altura del texturizado; simétrico sube y baja;
                  suavizado limpia el mapa.
                </li>
                <li>
                  <strong className="text-foreground">6. Máscara:</strong>{" "}
                  protegé caras por ángulo, por ejemplo la base plana de una
                  pieza; suavizá el borde para evitar escalones.
                </li>
                <li>
                  <strong className="text-foreground">7. Resolución:</strong>{" "}
                  arista más chica = más detalle y triángulos. La vista previa
                  usa hasta 650.000; la exportación hasta 1.500.000.
                </li>
                <li>
                  <strong className="text-foreground">8. Exportar:</strong>{" "}
                  descarga un STL binario con las mismas unidades y orientación.
                </li>
              </ol>
              <Hint>
                Si aparece “Presupuesto de vista previa alcanzado”, subí la
                arista objetivo. Si aparece “Amplitud alta”, usá el botón
                “Ajustar” del aviso.
              </Hint>
            </PanelSection>

            <PanelSection
              icon={Box}
              title="Modelo"
              summary={
                model ? `${formatNumber(model.triangles)} tri` : "Sin modelo"
              }
            >
              <Button
                className="w-full"
                variant="outline"
                onClick={() => modelInputRef.current?.click()}
              >
                <FileUp className="size-4" />
                {model ? "Reemplazar STL" : "Cargar STL"}
              </Button>
              {model ? (
                <div className="space-y-1 rounded-lg border bg-muted/20 px-2.5 py-2">
                  <p className="truncate text-xs font-medium">
                    {model.fileName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatBytes(model.fileSize)} ·{" "}
                    {formatNumber(model.triangles)} triángulos
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {dimensions}
                  </p>
                </div>
              ) : (
                <Hint>
                  STL binario o ASCII. El archivo se queda en tu navegador.
                </Hint>
              )}
              <Button
                className="w-full"
                size="sm"
                variant="ghost"
                onClick={handleNew}
                disabled={!model}
              >
                <RotateCcw className="size-4" />
                Nuevo proyecto
              </Button>
            </PanelSection>

            <PanelSection
              icon={Wrench}
              title="Malla"
              summary="Reparar · suavizar"
              defaultOpen={false}
            >
              <ToggleButton
                active={settings.repairMesh}
                onClick={() =>
                  updateSettings({ repairMesh: !settings.repairMesh })
                }
                icon={Wrench}
                className="w-full"
              >
                Reparar al procesar
              </ToggleButton>
              <Hint>
                Unifica el sentido de las caras, elimina duplicadas y corrige
                normales invertidas. Útil para modelos de escaneo.
              </Hint>
              <ValueSlider
                id="surface-smoothing"
                label="Suavizar superficie"
                value={settings.surfaceSmoothing}
                min={0}
                max={3}
                step={1}
                decimals={0}
                onChange={(value) =>
                  updateSettings({ surfaceSmoothing: value })
                }
                hint="0 conserva el detalle original. Más pasadas reducen ruido y también detalles finos."
              />
            </PanelSection>

            <PanelSection
              icon={Sparkles}
              title="Textura"
              summary={selectedTextureLabel}
            >
              <TextureGallery
                selected={settings.texture}
                customTile={customTile}
                customName={customName}
                onSelect={selectTexture}
                onCustomClick={() => customInputRef.current?.click()}
                onClearCustom={clearCustomTexture}
              />
              <Button
                className="w-full"
                size="sm"
                variant="outline"
                onClick={() => customInputRef.current?.click()}
                disabled={customLoading}
              >
                {customLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {customLoading ? "Cargando mapa…" : "Subir mapa propio"}
              </Button>
              <Hint>
                24 patrones procedurales, “Sin textura” para ver la malla
                original, o subí tu propio mapa. Los tonos claros elevan la
                superficie y los oscuros la hunden. Usá imágenes en escala de
                grises para un control más preciso.
              </Hint>
              <Button
                className="w-full"
                size="sm"
                variant="ghost"
                onClick={clearTexture}
                disabled={!settings.texture}
              >
                <X className="size-4" />
                Quitar textura
              </Button>
            </PanelSection>

            <PanelSection
              icon={Layers}
              title="Proyección"
              summary={PROJECTION_OPTIONS.find(
                (option) => option.value === settings.projection
              )?.label}
            >
              <SegmentedControl<ProjectionMode>
                label="Proyección de la textura"
                value={settings.projection}
                onValueChange={(value) =>
                  updateSettings({ projection: value })
                }
                options={PROJECTION_OPTIONS}
                columns={2}
              />
              <div className="flex items-center justify-between">
                <GroupLabel>Escala</GroupLabel>
                <IconAction
                  label={
                    settings.lockAspect
                      ? "Desbloquear proporción"
                      : "Bloquear proporción"
                  }
                  icon={settings.lockAspect ? Lock : Unlock}
                  active={settings.lockAspect}
                  onClick={toggleLock}
                />
              </div>
              <ValueSlider
                id="texture-scale-u"
                label="Escala U"
                value={settings.scaleU}
                min={0.2}
                max={4}
                step={0.05}
                unit="×"
                decimals={2}
                onChange={(value) => updateScale("u", value)}
              />
              <ValueSlider
                id="texture-scale-v"
                label="Escala V"
                value={settings.scaleV}
                min={0.2}
                max={4}
                step={0.05}
                unit="×"
                decimals={2}
                onChange={(value) => updateScale("v", value)}
              />
              <ValueSlider
                id="texture-offset-u"
                label="Desplazamiento U"
                value={settings.offsetU}
                min={-1}
                max={1}
                step={0.01}
                decimals={2}
                onChange={(value) => updateSettings({ offsetU: value })}
              />
              <ValueSlider
                id="texture-offset-v"
                label="Desplazamiento V"
                value={settings.offsetV}
                min={-1}
                max={1}
                step={0.01}
                decimals={2}
                onChange={(value) => updateSettings({ offsetV: value })}
              />
              <ValueSlider
                id="texture-rotation"
                label="Rotación"
                value={settings.rotationDeg}
                min={0}
                max={360}
                step={1}
                unit="°"
                decimals={0}
                onChange={(value) => updateSettings({ rotationDeg: value })}
              />
              <Hint>
                Escala 1 = un mosaico cada 10 mm. Triplanar evita UVs y
                funciona bien en piezas orgánicas; los planos son más
                predecibles en caras rectas.
              </Hint>
            </PanelSection>

            <PanelSection
              icon={Waves}
              title="Relieve"
              summary={
                settings.amplitudeUnit === "mm"
                  ? `${settings.amplitude.toFixed(2)} mm`
                  : `${settings.amplitude.toFixed(1)}%`
              }
            >
              <ToggleButton
                active={settings.symmetric}
                onClick={() =>
                  updateSettings({ symmetric: !settings.symmetric })
                }
                icon={ArrowUpDown}
                className="w-full"
              >
                Desplazamiento simétrico
              </ToggleButton>
              <Hint>
                {settings.symmetric
                  ? "El gris medio queda neutro, el blanco sale y el negro entra."
                  : "Solo empuja hacia afuera: el negro no modifica la superficie."}
              </Hint>
              <SegmentedControl<AmplitudeUnit>
                label="Unidad de amplitud"
                value={settings.amplitudeUnit}
                onValueChange={changeAmplitudeUnit}
                options={[
                  { value: "mm", label: "Milímetros" },
                  { value: "percent", label: "Porcentaje" },
                ]}
                columns={2}
              />
              <ValueSlider
                id="texture-amplitude"
                label="Amplitud"
                value={settings.amplitude}
                min={0}
                max={settings.amplitudeUnit === "mm" ? 5 : 30}
                step={0.05}
                unit={settings.amplitudeUnit === "mm" ? "mm" : "%"}
                decimals={2}
                onChange={(value) => updateSettings({ amplitude: value })}
                hint={
                  model
                    ? `Equivale a ${amplitudeMm.toFixed(2)} mm sobre la pieza.`
                    : undefined
                }
              />
              <ValueSlider
                id="texture-smoothing"
                label="Suavizado"
                value={settings.smoothing}
                min={0}
                max={1}
                step={0.01}
                decimals={2}
                onChange={(value) => updateSettings({ smoothing: value })}
                hint="Reduce el aliasing del mapa, a costa de perder detalle fino."
              />
              <Hint>
                Usá el ojo del visor para comparar el original con la textura.
              </Hint>
            </PanelSection>

            <PanelSection
              icon={Shield}
              title="Máscara"
              summary={maskSummary}
              defaultOpen={false}
            >
              <ToggleButton
                active={settings.mask.enabled}
                onClick={() => updateMask({ enabled: !settings.mask.enabled })}
                icon={Shield}
                className="w-full"
              >
                Activar máscara por ángulo
              </ToggleButton>
              <SegmentedControl<MaskAction>
                label="Acción de la máscara"
                value={settings.mask.action}
                onValueChange={(value) => updateMask({ action: value })}
                options={MASK_ACTION_OPTIONS}
                columns={2}
              />
              <SegmentedControl<MaskFaces>
                label="Caras de la máscara"
                value={settings.mask.faces}
                onValueChange={(value) => updateMask({ faces: value })}
                options={MASK_FACE_OPTIONS}
                columns={3}
              />
              <ValueSlider
                id="mask-angle"
                label="Ángulo máximo"
                value={settings.mask.maxAngleDeg}
                min={0}
                max={89}
                step={1}
                unit="°"
                decimals={0}
                onChange={(value) => updateMask({ maxAngleDeg: value })}
                hint="0° solo caras horizontales; 90° casi cualquier orientación."
              />
              <ValueSlider
                id="mask-feather"
                label="Suavizar borde"
                value={settings.mask.feather}
                min={0}
                max={5}
                step={1}
                decimals={0}
                onChange={(value) => updateMask({ feather: value })}
                hint="Difumina el límite de la máscara para evitar escalones entre la zona texturizada y la lisa."
              />
              <ToggleButton
                active={settings.mask.excludeBase}
                onClick={() =>
                  updateMask({ excludeBase: !settings.mask.excludeBase })
                }
                icon={Shield}
                className="w-full"
              >
                Excluir base de apoyo
              </ToggleButton>
              <Hint>
                Incluir texturiza solo las caras seleccionadas. Excluir las
                protege. La base excluida no recibe relieve.
              </Hint>
              <Button
                className="w-full"
                size="sm"
                variant="ghost"
                onClick={() => updateMask(DEFAULT_TEXTURIZER_SETTINGS.mask)}
                disabled={!settings.mask.enabled && !settings.mask.excludeBase}
              >
                <X className="size-4" />
                Limpiar máscara
              </Button>
            </PanelSection>

            <PanelSection
              icon={Grid3x3}
              title="Resolución"
              summary={resolutionSummary}
              defaultOpen={false}
            >
              <ValueSlider
                id="texture-resolution"
                label="Arista objetivo"
                value={settings.resolutionMm}
                min={0.3}
                max={5}
                step={0.1}
                unit="mm"
                decimals={2}
                onChange={(value) => updateSettings({ resolutionMm: value })}
                hint="Más chico = más detalle y más triángulos."
              />
              <div className="grid grid-cols-3 gap-1.5">
                {RESOLUTION_PRESETS.map((preset) => {
                  const active =
                    Math.abs(settings.resolutionMm - preset.value) < 0.001;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        updateSettings({ resolutionMm: preset.value })
                      }
                      className={`h-7 rounded-md border text-[11px] transition-colors ${
                        active
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Vista previa</span>
                  <span className="tabular-nums">
                    {processed
                      ? `${formatNumber(processed.triangles)} / ${formatNumber(
                          PREVIEW_TRIANGLE_BUDGET
                        )}`
                      : `— / ${formatNumber(PREVIEW_TRIANGLE_BUDGET)}`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(
                        100,
                        ((processed?.triangles ?? 0) /
                          PREVIEW_TRIANGLE_BUDGET) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>
              <Hint>
                La exportación usa la misma resolución con un presupuesto mayor
                (hasta {formatNumber(EXPORT_TRIANGLE_BUDGET)} triángulos).
              </Hint>
            </PanelSection>

            <PanelSection
              icon={Download}
              title="Exportar"
              summary={
                model ? formatBytes(estimatedBytes) : "Sin modelo"
              }
              defaultOpen={false}
            >
              <Button
                className="w-full"
                onClick={handleExport}
                disabled={!model || exporting || loadingModel}
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {exporting
                  ? `Exportando ${Math.round(exportProgress * 100)}%`
                  : "Exportar STL"}
              </Button>
              <Hint>
                STL binario. Conserva unidades y orientación. Si no hay textura,
                se exporta el original.
              </Hint>
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="Triángulos"
                  value={
                    outputTriangles ? formatNumber(outputTriangles) : "—"
                  }
                />
                <Stat label="Peso" value={formatBytes(estimatedBytes)} />
              </div>
            </PanelSection>

            <Button
              className="w-full text-muted-foreground"
              size="sm"
              variant="ghost"
              onClick={resetTextureSettings}
            >
              <RotateCcw className="size-4" />
              Restablecer textura
            </Button>
          </PanelTooltips>
        </aside>
      </div>
    </div>
  );
}
