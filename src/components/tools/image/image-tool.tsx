"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Crop,
  Download,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Loader2,
  Paintbrush,
  Palette,
  Redo2,
  RotateCcw,
  RotateCw,
  Scissors,
  Sparkles,
  Undo2,
  Wand2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  blobToCanvas,
  canvasToBlob,
  createCanvas,
  get2d,
  imageFileToCanvas,
} from "@/lib/image/canvas";
import { removeBackgroundClient } from "@/lib/image/background";
import { canvasToBmp, canvasToIco } from "@/lib/image/export";
import {
  DEFAULT_TRACE_SETTINGS,
  estimateColorCount,
  filterSvgByColors,
  prepareTraceImageData,
  rgbToHex,
  splitSvgByColor,
  tracePreparedImage,
  type ColorLayer,
  type TraceSettings,
} from "@/lib/image/trace";
import {
  baseName,
  downloadBlob,
  downloadText,
  downloadZip,
} from "@/lib/image/download";

import { Dropzone } from "./dropzone";
import { EditorCanvas } from "./editor-canvas";
import { SvgPreview } from "./svg-preview";
import type { BrushSettings, HistoryEntry, Rect } from "./types";

type Status = "empty" | "ready" | "removing";
type TabValue = "background" | "vector";
type ExportFormat = "png" | "jpeg" | "webp" | "bmp" | "ico";

interface ProgressState {
  label: string;
  percent: number;
}

interface TraceResult {
  svg: string;
  width: number;
  height: number;
}

interface ResultFile {
  name: string;
  bytes: number;
  color?: string;
  onDownload: () => void;
}

const MAX_HISTORY = 30;
const TRACE_DEBOUNCE_MS = 400;
const MAX_COLORS = 32;
const DEFAULT_COLORS = 8;
const INITIAL_COLORS = 4;

function initialColorCount(detected: number): number {
  if (detected <= 0) return DEFAULT_COLORS;
  return Math.max(2, Math.min(INITIAL_COLORS, MAX_COLORS, detected));
}

function countColors(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  return estimateColorCount(
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    128
  );
}

function describeProgress(key: string): string {
  if (key.includes("fetch") || key.includes("download")) {
    return "Descargando modelo";
  }
  if (key.includes("compute") || key.includes("inference")) {
    return "Procesando imagen";
  }
  return "Procesando";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeTrace(
  canvas: HTMLCanvasElement,
  settings: TraceSettings
): TraceResult | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const prepared = prepareTraceImageData(data, settings);
  const svg = tracePreparedImage(prepared, settings);
  if (!/<path\b/.test(svg)) return null;
  return { svg, width: prepared.width, height: prepared.height };
}

type TransformKind = "rotL" | "rotR" | "flipH" | "flipV";

function transformCanvas(
  src: HTMLCanvasElement,
  kind: TransformKind
): HTMLCanvasElement {
  const swap = kind === "rotL" || kind === "rotR";
  const out = createCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = get2d(out, true);
  const w = src.width;
  const h = src.height;
  ctx.save();
  if (kind === "rotR") {
    ctx.translate(h, 0);
    ctx.rotate(Math.PI / 2);
  } else if (kind === "rotL") {
    ctx.translate(0, w);
    ctx.rotate(-Math.PI / 2);
  } else if (kind === "flipH") {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return out;
}

function ColorPalette({
  layers,
  excluded,
  onToggle,
}: {
  layers: ColorLayer[];
  excluded: ReadonlySet<string>;
  onToggle: (hex: string) => void;
}) {
  if (layers.length === 0) return null;
  const visibleCount = layers.filter(
    (layer) => !excluded.has(rgbToHex(layer.rgb))
  ).length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label>Colores detectados</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {visibleCount}/{layers.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {layers.map((layer) => {
          const hex = rgbToHex(layer.rgb);
          const off = excluded.has(hex);
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onToggle(hex)}
              aria-pressed={!off}
              title={
                off
                  ? `${hex} · excluido (clic para incluirlo)`
                  : `${hex} · ${layer.pathCount} trazo(s)`
              }
              className={`relative flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-md border text-[10px] transition hover:border-foreground/40 ${
                off ? "opacity-40" : ""
              }`}
            >
              <span
                className="size-6 rounded border"
                style={{ backgroundColor: hex }}
                aria-hidden
              />
              <span className="truncate px-0.5 text-muted-foreground">
                {hex}
              </span>
              {off ? (
                <X className="absolute right-0.5 top-0.5 size-3 text-destructive" />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Clic en un color para excluirlo o volver a incluirlo en el SVG.
      </p>
    </div>
  );
}

function FileList({
  files,
  onZip,
}: {
  files: ResultFile[];
  onZip?: () => void;
}) {
  if (files.length === 0) return null;
  const total = files.reduce((sum, file) => sum + file.bytes, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {files.length} archivo(s) · {formatBytes(total)}
        </p>
        {onZip ? (
          <Button size="sm" variant="outline" onClick={onZip}>
            <Download className="size-3.5" />
            ZIP
          </Button>
        ) : null}
      </div>
      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {files.map((file) => (
          <div
            key={file.name}
            className="flex items-center gap-2 rounded-md border p-2"
          >
            {file.color ? (
              <span
                className="size-6 shrink-0 rounded border"
                style={{ backgroundColor: file.color }}
                aria-hidden
              />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded border text-muted-foreground">
                <Scissors className="size-3.5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {file.color ? `${file.color} · ` : ""}
                {formatBytes(file.bytes)}
              </p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={file.onDownload}
              aria-label={`Descargar ${file.name}`}
            >
              <Download className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ImageTool() {
  const [originalCanvas, setOriginalCanvas] = useState<HTMLCanvasElement | null>(
    null
  );
  const [workCanvas, setWorkCanvas] = useState<HTMLCanvasElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState<Status>("empty");
  const [version, setVersion] = useState(0);
  const [brush, setBrush] = useState<BrushSettings>({
    mode: "erase",
    size: 40,
  });
  const [tool, setTool] = useState<"brush" | "wand">("brush");
  const [tolerance, setTolerance] = useState(20);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [traceSettings, setTraceSettings] =
    useState<TraceSettings>(DEFAULT_TRACE_SETTINGS);
  const [tab, setTab] = useState<TabValue>("background");
  const [excludedColors, setExcludedColors] = useState<Set<string>>(new Set());
  const [traceState, setTraceState] = useState<{
    key: string;
    result: TraceResult | null;
  } | null>(null);
  const [detectedColors, setDetectedColors] = useState(DEFAULT_COLORS);
  const [cropActive, setCropActive] = useState(false);
  const [cropRect, setCropRect] = useState<Rect | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportQuality, setExportQuality] = useState(92);

  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const pristineRef = useRef<HTMLCanvasElement | null>(null);

  const syncDetectedColors = useCallback((canvas: HTMLCanvasElement) => {
    const count = countColors(canvas);
    setDetectedColors(count);
    setTraceSettings((settings) => ({
      ...settings,
      numberofcolors: initialColorCount(count),
    }));
  }, []);

  const resetHistory = useCallback(() => {
    historyRef.current = [];
    historyIndexRef.current = -1;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("El archivo no es una imagen válida");
        return;
      }
      try {
        const source = await imageFileToCanvas(file);
        const work = createCanvas(source.width, source.height);
        get2d(work, true).drawImage(source, 0, 0);
        pristineRef.current = source;
        setOriginalCanvas(source);
        setWorkCanvas(work);
        setFileName(file.name);
        setExcludedColors(new Set());
        setTraceState(null);
        setCropActive(false);
        setCropRect(null);
        setTab("background");
        resetHistory();
        syncDetectedColors(work);
        setStatus("ready");
        setVersion((value) => value + 1);
      } catch {
        toast.error("No se pudo cargar la imagen");
      }
    },
    [resetHistory, syncDetectedColors]
  );

  const handleRemoveBackground = useCallback(async () => {
    if (!originalCanvas) return;
    setStatus("removing");
    setProgress({ label: "Preparando modelo", percent: 0 });
    try {
      const sourceBlob = await canvasToBlob(originalCanvas);
      const resultBlob = await removeBackgroundClient(sourceBlob, {
        onProgress: (key, current, total) => {
          const percent = total > 0 ? Math.round((current / total) * 100) : 0;
          setProgress({ label: describeProgress(key), percent });
        },
      });
      const cut = await blobToCanvas(resultBlob);
      const work = createCanvas(cut.width, cut.height);
      get2d(work, true).drawImage(cut, 0, 0);
      setWorkCanvas(work);
      setExcludedColors(new Set());
      setTraceState(null);
      resetHistory();
      syncDetectedColors(work);
      setVersion((value) => value + 1);
      setStatus("ready");
      toast.success("Fondo eliminado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo quitar el fondo");
      setStatus("ready");
    } finally {
      setProgress(null);
    }
  }, [originalCanvas, resetHistory, syncDetectedColors]);

  const handleResetEdits = useCallback(() => {
    const pristine = pristineRef.current;
    if (!pristine) return;
    const work = createCanvas(pristine.width, pristine.height);
    get2d(work, true).drawImage(pristine, 0, 0);
    const base = createCanvas(pristine.width, pristine.height);
    get2d(base, true).drawImage(pristine, 0, 0);
    setOriginalCanvas(base);
    setWorkCanvas(work);
    setExcludedColors(new Set());
    setTraceState(null);
    setCropActive(false);
    setCropRect(null);
    resetHistory();
    syncDetectedColors(work);
    setVersion((value) => value + 1);
  }, [resetHistory, syncDetectedColors]);

  const applyTransform = useCallback(
    (kind: TransformKind) => {
      if (!workCanvas || !originalCanvas) return;
      setWorkCanvas(transformCanvas(workCanvas, kind));
      setOriginalCanvas(transformCanvas(originalCanvas, kind));
      setCropActive(false);
      setCropRect(null);
      resetHistory();
      setTraceState(null);
      setVersion((value) => value + 1);
    },
    [workCanvas, originalCanvas, resetHistory]
  );

  const applyCrop = useCallback(() => {
    if (!workCanvas || !originalCanvas || !cropRect) return;
    const x = Math.max(0, Math.round(cropRect.x));
    const y = Math.max(0, Math.round(cropRect.y));
    const w = Math.min(workCanvas.width - x, Math.round(cropRect.w));
    const h = Math.min(workCanvas.height - y, Math.round(cropRect.h));
    if (w < 2 || h < 2) {
      toast.error("Selecciona un área válida para recortar");
      return;
    }
    const crop = (src: HTMLCanvasElement) => {
      const out = createCanvas(w, h);
      get2d(out, true).drawImage(src, -x, -y);
      return out;
    };
    setWorkCanvas(crop(workCanvas));
    setOriginalCanvas(crop(originalCanvas));
    setCropActive(false);
    setCropRect(null);
    resetHistory();
    setTraceState(null);
    setVersion((value) => value + 1);
  }, [workCanvas, originalCanvas, cropRect, resetHistory]);

  const cancelCrop = useCallback(() => {
    setCropActive(false);
    setCropRect(null);
  }, []);

  const handleStroke = useCallback((entry: HistoryEntry) => {
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    trimmed.push(entry);
    const limited = trimmed.slice(-MAX_HISTORY);
    historyRef.current = limited;
    historyIndexRef.current = limited.length - 1;
    setCanUndo(limited.length > 0);
    setCanRedo(false);
  }, []);

  const applyRegion = useCallback(
    (entry: HistoryEntry, data: ImageData) => {
      if (!workCanvas) return;
      const ctx = workCanvas.getContext("2d");
      if (!ctx) return;
      ctx.putImageData(data, entry.x, entry.y);
    },
    [workCanvas]
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current < 0) return;
    const entry = historyRef.current[historyIndexRef.current];
    applyRegion(entry, entry.before);
    historyIndexRef.current -= 1;
    setCanUndo(historyIndexRef.current >= 0);
    setCanRedo(true);
    setVersion((value) => value + 1);
  }, [applyRegion]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current + 1 >= historyRef.current.length) return;
    const entry = historyRef.current[historyIndexRef.current + 1];
    applyRegion(entry, entry.after);
    historyIndexRef.current += 1;
    setCanUndo(true);
    setCanRedo(historyIndexRef.current + 1 < historyRef.current.length);
    setVersion((value) => value + 1);
  }, [applyRegion]);

  const handleExportPng = useCallback(async () => {
    if (!workCanvas) return;
    try {
      const blob = await canvasToBlob(workCanvas);
      downloadBlob(blob, `${baseName(fileName)}.png`);
      toast.success("PNG descargado");
    } catch {
      toast.error("No se pudo exportar el PNG");
    }
  }, [workCanvas, fileName]);

  const handleExportImage = useCallback(async () => {
    if (!workCanvas) return;
    try {
      let blob: Blob;
      let ext: string;
      if (exportFormat === "bmp") {
        blob = canvasToBmp(workCanvas);
        ext = "bmp";
      } else if (exportFormat === "ico") {
        blob = await canvasToIco(workCanvas);
        ext = "ico";
      } else {
        let source = workCanvas;
        if (exportFormat === "jpeg") {
          const flat = createCanvas(workCanvas.width, workCanvas.height);
          const ctx = get2d(flat, true);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, flat.width, flat.height);
          ctx.drawImage(workCanvas, 0, 0);
          source = flat;
        }
        const type =
          exportFormat === "png"
            ? "image/png"
            : exportFormat === "jpeg"
              ? "image/jpeg"
              : "image/webp";
        const quality = exportFormat === "png" ? undefined : exportQuality / 100;
        blob = await canvasToBlob(source, type, quality);
        ext = exportFormat === "jpeg" ? "jpg" : exportFormat;
      }
      downloadBlob(blob, `${baseName(fileName)}.${ext}`);
      toast.success(`Imagen descargada (${ext.toUpperCase()})`);
    } catch {
      toast.error("No se pudo exportar la imagen");
    }
  }, [workCanvas, exportFormat, exportQuality, fileName]);

  const handleNewImage = useCallback(() => {
    setOriginalCanvas(null);
    setWorkCanvas(null);
    setFileName("");
    setStatus("empty");
    setTab("background");
    setExcludedColors(new Set());
    setTraceState(null);
    setDetectedColors(DEFAULT_COLORS);
    setCropActive(false);
    setCropRect(null);
    pristineRef.current = null;
    setProgress(null);
    resetHistory();
  }, [resetHistory]);

  const traceKey = useMemo(
    () => JSON.stringify([version, traceSettings]),
    [version, traceSettings]
  );

  useEffect(() => {
    if (tab === "background" || !workCanvas) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      let result: TraceResult | null = null;
      try {
        result = computeTrace(workCanvas, traceSettings);
      } catch (error) {
        console.error(error);
      }
      setTraceState({ key: traceKey, result });
    }, TRACE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, workCanvas, traceKey, traceSettings]);

  const traceResult = traceState ? traceState.result : null;
  const tracing =
    tab !== "background" &&
    workCanvas !== null &&
    (!traceState || traceState.key !== traceKey);

  const allLayers = useMemo(
    () =>
      traceResult
        ? splitSvgByColor(traceResult.svg, traceResult.width, traceResult.height)
        : [],
    [traceResult]
  );

  const visibleSvg = useMemo(
    () => (traceResult ? filterSvgByColors(traceResult.svg, excludedColors) : null),
    [traceResult, excludedColors]
  );

  const visibleLayers = useMemo(
    () => allLayers.filter((layer) => !excludedColors.has(rgbToHex(layer.rgb))),
    [allLayers, excludedColors]
  );

  const toggleColor = useCallback((hex: string) => {
    setExcludedColors((prev) => {
      const next = new Set(prev);
      if (next.has(hex)) {
        next.delete(hex);
      } else {
        next.add(hex);
      }
      return next;
    });
  }, []);

  const maxColors = Math.max(
    2,
    Math.min(MAX_COLORS, detectedColors || MAX_COLORS)
  );

  const vectorFiles = useMemo<ResultFile[]>(() => {
    if (!visibleSvg || visibleLayers.length === 0) return [];
    const name = `${baseName(fileName)}.svg`;
    return [
      {
        name,
        bytes: new Blob([visibleSvg]).size,
        onDownload: () => downloadText(visibleSvg, name),
      },
    ];
  }, [visibleSvg, visibleLayers.length, fileName]);

  const layerFiles = useMemo<ResultFile[]>(
    () =>
      visibleLayers.map((layer) => {
        const hex = rgbToHex(layer.rgb).replace("#", "");
        const name = `${baseName(fileName)}-${hex}.svg`;
        return {
          name,
          bytes: new Blob([layer.svg]).size,
          color: `#${hex}`,
          onDownload: () => downloadText(layer.svg, name),
        };
      }),
    [visibleLayers, fileName]
  );

  const handleDownloadAllLayers = useCallback(async () => {
    if (visibleLayers.length === 0) return;
    try {
      await downloadZip(
        visibleLayers.map((layer) => ({
          name: `${baseName(fileName)}-${rgbToHex(layer.rgb).replace("#", "")}.svg`,
          content: layer.svg,
        })),
        `${baseName(fileName)}-capas.zip`
      );
      toast.success("Capas descargadas");
    } catch {
      toast.error("No se pudo crear el ZIP");
    }
  }, [visibleLayers, fileName]);

  if (status === "empty") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="mb-6">
          <Badge>Imagen</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Herramienta de imagen
          </h1>
          <p className="text-sm text-muted-foreground">
            Sube una imagen para quitar el fondo, retocarla, vectorizarla y
            separarla por colores.
          </p>
        </div>
        <Dropzone onFile={handleFile} className="min-h-[55vh]" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Imagen</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Herramienta de imagen
          </h1>
          <p className="text-sm text-muted-foreground">
            {fileName}
            {workCanvas
              ? ` · ${workCanvas.width}×${workCanvas.height}px`
              : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleExportPng}>
            <Download className="size-4" />
            Descargar PNG
          </Button>
          <Button variant="outline" onClick={handleNewImage}>
            <ImagePlus className="size-4" />
            Nueva imagen
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              {tab !== "background" ? (
                <Scissors className="size-4" />
              ) : cropActive ? (
                <Crop className="size-4" />
              ) : tool === "wand" ? (
                <Wand2 className="size-4" />
              ) : (
                <Paintbrush className="size-4" />
              )}
              <span className="font-medium text-foreground">
                {tab !== "background"
                  ? "Vista vectorial"
                  : cropActive
                    ? "Recorte"
                    : tool === "wand"
                      ? "Varita mágica"
                      : "Pincel"}
              </span>
              {tab === "background" && !cropActive ? (
                <span>· {brush.mode === "erase" ? "Quitar" : "Mantener"}</span>
              ) : null}
            </div>

            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={handleUndo}
                disabled={!canUndo}
                aria-label="Deshacer"
                title="Deshacer"
              >
                <Undo2 className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={handleRedo}
                disabled={!canRedo}
                aria-label="Rehacer"
                title="Rehacer"
              >
                <Redo2 className="size-4" />
              </Button>
            </div>
          </div>

          <div className="relative">
            {tab === "background" ? (
              <EditorCanvas
                workCanvas={workCanvas}
                originalCanvas={originalCanvas}
                tool={tool}
                brush={brush}
                tolerance={tolerance}
                enabled={status === "ready"}
                version={version}
                cropActive={cropActive}
                cropRect={cropRect}
                onCropRectChange={setCropRect}
                onStroke={handleStroke}
              />
            ) : traceResult && visibleLayers.length > 0 && visibleSvg ? (
              <SvgPreview
                svg={visibleSvg}
                width={traceResult.width}
                height={traceResult.height}
                resetKey={workCanvas}
              />
            ) : (
              <div className="flex min-h-[50vh] items-center justify-center rounded-xl border p-6 text-center text-sm text-muted-foreground">
                {tracing
                  ? "Vectorizando…"
                  : traceResult
                    ? "Todos los colores están excluidos."
                    : "No se detectaron formas. Ajusta el umbral de fondo o los colores."}
              </div>
            )}

            {tracing && traceResult ? (
              <div className="absolute left-3 top-3 z-10 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
                Vectorizando…
              </div>
            ) : null}

            {status === "removing" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/70 backdrop-blur-sm">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm font-medium">
                  Quitando el fondo con IA…
                </p>
                <p className="text-xs text-muted-foreground">
                  Todo se procesa en tu navegador
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <Tabs
            value={tab}
            onValueChange={(value: string) => setTab(value as TabValue)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="background">Editar</TabsTrigger>
              <TabsTrigger value="vector">Vector</TabsTrigger>
            </TabsList>

            <TabsContent value="background" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Crop className="size-4" />
                    Transformar
                  </CardTitle>
                  <CardDescription>
                    Recorta, gira o voltea. Los cambios se aplican también a la
                    vectorización.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyTransform("rotL")}
                    >
                      <RotateCcw className="size-3.5" />
                      Girar izq.
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyTransform("rotR")}
                    >
                      <RotateCw className="size-3.5" />
                      Girar der.
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyTransform("flipH")}
                    >
                      <FlipHorizontal2 className="size-3.5" />
                      Voltear H
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyTransform("flipV")}
                    >
                      <FlipVertical2 className="size-3.5" />
                      Voltear V
                    </Button>
                  </div>

                  {cropActive ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Arrastra sobre la imagen para elegir el área a recortar.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" onClick={applyCrop}>
                          Aplicar recorte
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={cancelCrop}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setCropActive(true);
                        setCropRect(null);
                      }}
                    >
                      <Crop className="size-3.5" />
                      Recortar
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Quitar fondo</CardTitle>
                  <CardDescription>
                    IA local en tu navegador. Nada se sube a un servidor.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    className="w-full"
                    onClick={handleRemoveBackground}
                    disabled={status === "removing"}
                  >
                    {status === "removing" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    Quitar fondo
                  </Button>

                  {progress ? (
                    <div className="space-y-1">
                      <Progress value={progress.percent} />
                      <p className="text-xs text-muted-foreground">
                        {progress.label} · {progress.percent}%
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Wand2 className="size-4" />
                    Retoque manual
                  </CardTitle>
                  <CardDescription>
                    Borra o recupera zonas con el pincel o la varita mágica.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Herramienta</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={tool === "brush" ? "default" : "outline"}
                        aria-pressed={tool === "brush"}
                        onClick={() => setTool("brush")}
                      >
                        <Paintbrush className="size-3.5" />
                        Pincel
                      </Button>
                      <Button
                        size="sm"
                        variant={tool === "wand" ? "default" : "outline"}
                        aria-pressed={tool === "wand"}
                        onClick={() => setTool("wand")}
                      >
                        <Wand2 className="size-3.5" />
                        Varita
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Acción</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant={brush.mode === "erase" ? "default" : "outline"}
                        aria-pressed={brush.mode === "erase"}
                        onClick={() =>
                          setBrush((value) => ({ ...value, mode: "erase" }))
                        }
                      >
                        <Eraser className="size-3.5" />
                        Quitar
                      </Button>
                      <Button
                        size="sm"
                        variant={brush.mode === "restore" ? "default" : "outline"}
                        aria-pressed={brush.mode === "restore"}
                        onClick={() =>
                          setBrush((value) => ({ ...value, mode: "restore" }))
                        }
                      >
                        <Paintbrush className="size-3.5" />
                        Mantener
                      </Button>
                    </div>
                  </div>

                  {tool === "brush" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="brush-size">Tamaño del pincel</Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {brush.size}px
                        </span>
                      </div>
                      <Slider
                        id="brush-size"
                        min={8}
                        max={200}
                        step={2}
                        value={[brush.size]}
                        onValueChange={(values: number[]) =>
                          setBrush((value) => ({ ...value, size: values[0] }))
                        }
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="wand-tolerance">Tolerancia</Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {tolerance}%
                        </span>
                      </div>
                      <Slider
                        id="wand-tolerance"
                        min={0}
                        max={60}
                        step={1}
                        value={[tolerance]}
                        onValueChange={(values: number[]) =>
                          setTolerance(values[0])
                        }
                      />
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {tool === "wand"
                      ? "Toca una zona de la imagen para seleccionar y quitar (o mantener) regiones de color similar. Aumenta la tolerancia para abarcar más tonos."
                      : "Pinta sobre la imagen para quitar o mantener partes."}
                  </p>

                  <Separator />

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleResetEdits}
                  >
                    <RotateCcw className="size-4" />
                    Volver a la original
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Download className="size-4" />
                    Descargar imagen
                  </CardTitle>
                  <CardDescription>
                    Guarda el resultado con tus cambios (recorte, giro, fondo)
                    en el formato que necesites.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Formato</Label>
                    <Select
                      value={exportFormat}
                      onValueChange={(value: string) =>
                        setExportFormat(value as ExportFormat)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="png">PNG (transparente)</SelectItem>
                        <SelectItem value="jpeg">JPG (fondo blanco)</SelectItem>
                        <SelectItem value="webp">WebP</SelectItem>
                        <SelectItem value="bmp">BMP (fondo blanco)</SelectItem>
                        <SelectItem value="ico">ICO (icono 256px)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {exportFormat === "jpeg" || exportFormat === "webp" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Calidad</Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {exportQuality}%
                        </span>
                      </div>
                      <Slider
                        min={40}
                        max={100}
                        step={1}
                        value={[exportQuality]}
                        onValueChange={(values: number[]) =>
                          setExportQuality(values[0])
                        }
                      />
                    </div>
                  ) : null}

                  <Button className="w-full" onClick={handleExportImage}>
                    <Download className="size-4" />
                    Descargar
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vector" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Scissors className="size-4" />
                    Vectorizar a SVG
                  </CardTitle>
                  <CardDescription>
                    La vista previa de la izquierda se actualiza sola. Ajusta y
                    observa el resultado.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Modo</Label>
                    <Select
                      value={traceSettings.mode}
                      onValueChange={(value: string) =>
                        setTraceSettings((settings) => ({
                          ...settings,
                          mode: value as TraceSettings["mode"],
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="color">Color</SelectItem>
                        <SelectItem value="mono">Monocromo (silueta)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {traceSettings.mode === "color" ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label>Colores</Label>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {traceSettings.numberofcolors}
                        </span>
                      </div>
                      <Slider
                        min={2}
                        max={maxColors}
                        step={1}
                        value={[Math.min(traceSettings.numberofcolors, maxColors)]}
                        onValueChange={(values: number[]) =>
                          setTraceSettings((settings) => ({
                            ...settings,
                            numberofcolors: values[0],
                          }))
                        }
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {detectedColors > 0
                          ? detectedColors > MAX_COLORS
                            ? `La imagen tiene más de ${MAX_COLORS} colores distintos (tope del control).`
                            : `Se detectaron ~${detectedColors} colores distintos (tope del control).`
                          : "Cuántos colores distintos tendrá el SVG."}{" "}
                        Más colores = más detalle y más peso.
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Simplificar trazos</Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {traceSettings.pathomit}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={60}
                      step={1}
                      value={[traceSettings.pathomit]}
                      onValueChange={(values: number[]) =>
                        setTraceSettings((settings) => ({
                          ...settings,
                          pathomit: values[0],
                        }))
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Descarta formas más pequeñas que este valor (ruido).
                      Súbelo para un SVG más ligero; bájalo para conservar
                      detalles finos.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Suavizado</Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {traceSettings.blurradius}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={5}
                      step={1}
                      value={[traceSettings.blurradius]}
                      onValueChange={(values: number[]) =>
                        setTraceSettings((settings) => ({
                          ...settings,
                          blurradius: values[0],
                        }))
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Difumina antes de vectorizar para bordes más suaves y
                      limpios.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="vector-alpha">Umbral de fondo</Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {traceSettings.alphaThreshold}
                      </span>
                    </div>
                    <Slider
                      id="vector-alpha"
                      min={0}
                      max={255}
                      step={1}
                      value={[traceSettings.alphaThreshold]}
                      onValueChange={(values: number[]) =>
                        setTraceSettings((settings) => ({
                          ...settings,
                          alphaThreshold: values[0],
                        }))
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Súbelo si queda un fondo semitransparente; bájalo si
                      desaparecen detalles finos.
                    </p>
                  </div>

                  <Separator />

                  <ColorPalette
                    layers={allLayers}
                    excluded={excludedColors}
                    onToggle={toggleColor}
                  />

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Vector completo
                    </p>
                    <FileList files={vectorFiles} />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Palette className="size-3.5" />
                      Separado por colores
                    </p>
                    <FileList
                      files={layerFiles}
                      onZip={handleDownloadAllLayers}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
