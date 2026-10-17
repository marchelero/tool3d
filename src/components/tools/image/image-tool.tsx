"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Eraser,
  ImagePlus,
  Loader2,
  Paintbrush,
  Palette,
  Redo2,
  RotateCcw,
  Scissors,
  Sparkles,
  Undo2,
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
import {
  DEFAULT_TRACE_SETTINGS,
  prepareTraceImageData,
  rgbToHex,
  splitSvgByColor,
  svgToDataUrl,
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
import type { BrushSettings, HistoryEntry } from "./types";

type Status = "empty" | "ready" | "removing";

interface ProgressState {
  label: string;
  percent: number;
}

const MAX_HISTORY = 30;

function describeProgress(key: string): string {
  if (key.includes("fetch") || key.includes("download")) {
    return "Descargando modelo";
  }
  if (key.includes("compute") || key.includes("inference")) {
    return "Procesando imagen";
  }
  return "Procesando";
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
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [traceSettings, setTraceSettings] =
    useState<TraceSettings>(DEFAULT_TRACE_SETTINGS);
  const [svg, setSvg] = useState<string | null>(null);
  const [layers, setLayers] = useState<ColorLayer[] | null>(null);
  const [busy, setBusy] = useState<"trace" | "split" | null>(null);

  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);

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
        setOriginalCanvas(source);
        setWorkCanvas(work);
        setFileName(file.name);
        setSvg(null);
        setLayers(null);
        resetHistory();
        setStatus("ready");
        setVersion((value) => value + 1);
      } catch {
        toast.error("No se pudo cargar la imagen");
      }
    },
    [resetHistory]
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
      setSvg(null);
      setLayers(null);
      resetHistory();
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
  }, [originalCanvas, resetHistory]);

  const handleResetEdits = useCallback(() => {
    if (!originalCanvas) return;
    const work = createCanvas(originalCanvas.width, originalCanvas.height);
    get2d(work, true).drawImage(originalCanvas, 0, 0);
    setWorkCanvas(work);
    setSvg(null);
    setLayers(null);
    resetHistory();
    setVersion((value) => value + 1);
  }, [originalCanvas, resetHistory]);

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

  const handleGenerateSvg = useCallback(async () => {
    if (!workCanvas) return;
    const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    setBusy("trace");
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const data = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
      const prepared = prepareTraceImageData(data, traceSettings);
      const result = tracePreparedImage(prepared, traceSettings);
      if (!/<path\b/.test(result)) {
        toast.error("No se detectó ninguna forma. Ajusta el umbral de fondo.");
        setSvg(null);
        return;
      }
      setSvg(result);
      toast.success("SVG generado");
    } catch (error) {
      console.error(error);
      toast.error("No se pudo vectorizar la imagen");
    } finally {
      setBusy(null);
    }
  }, [workCanvas, traceSettings]);

  const handleSplitByColor = useCallback(async () => {
    if (!workCanvas) return;
    const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    setBusy("split");
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const data = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
      const prepared = prepareTraceImageData(data, traceSettings);
      const result = tracePreparedImage(prepared, traceSettings);
      if (!/<path\b/.test(result)) {
        toast.error("No se detectó ninguna forma. Ajusta el umbral de fondo.");
        setSvg(null);
        setLayers(null);
        return;
      }
      const colorLayers = splitSvgByColor(
        result,
        prepared.width,
        prepared.height
      );
      setSvg(result);
      setLayers(colorLayers);
      if (colorLayers.length <= 1) {
        toast.info("Solo se detectó un color. Prueba aumentando los colores.");
      } else {
        toast.success(`${colorLayers.length} capas de color generadas`);
      }
    } catch (error) {
      console.error(error);
      toast.error("No se pudo dividir por color");
    } finally {
      setBusy(null);
    }
  }, [workCanvas, traceSettings]);

  const handleDownloadSvg = useCallback(() => {
    if (!svg) return;
    downloadText(svg, `${baseName(fileName)}.svg`);
  }, [svg, fileName]);

  const handleDownloadLayer = useCallback(
    (layer: ColorLayer, index: number) => {
      const hex = rgbToHex(layer.rgb).replace("#", "");
      downloadText(layer.svg, `${baseName(fileName)}-color-${index + 1}-${hex}.svg`);
    },
    [fileName]
  );

  const handleDownloadAllLayers = useCallback(async () => {
    if (!layers || layers.length === 0) return;
    try {
      await downloadZip(
        layers.map((layer, index) => ({
          name: `${baseName(fileName)}-color-${index + 1}-${rgbToHex(
            layer.rgb
          ).replace("#", "")}.svg`,
          content: layer.svg,
        })),
        `${baseName(fileName)}-capas.zip`
      );
      toast.success("Capas descargadas");
    } catch {
      toast.error("No se pudo crear el ZIP");
    }
  }, [layers, fileName]);

  const handleNewImage = useCallback(() => {
    setOriginalCanvas(null);
    setWorkCanvas(null);
    setFileName("");
    setStatus("empty");
    setSvg(null);
    setLayers(null);
    setProgress(null);
    resetHistory();
  }, [resetHistory]);

  const busyLabel = busy === "trace" ? "Vectorizando" : "Dividiendo colores";

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
            <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
              <Button
                size="sm"
                variant={brush.mode === "erase" ? "default" : "ghost"}
                aria-pressed={brush.mode === "erase"}
                onClick={() => setBrush((value) => ({ ...value, mode: "erase" }))}
              >
                <Eraser className="size-3.5" />
                Borrar
              </Button>
              <Button
                size="sm"
                variant={brush.mode === "restore" ? "default" : "ghost"}
                aria-pressed={brush.mode === "restore"}
                onClick={() =>
                  setBrush((value) => ({ ...value, mode: "restore" }))
                }
              >
                <Paintbrush className="size-3.5" />
                Restaurar
              </Button>
            </div>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <div className="flex min-w-40 flex-1 items-center gap-2">
              <Label htmlFor="brush-size" className="text-xs text-muted-foreground">
                Pincel
              </Label>
              <Slider
                id="brush-size"
                min={8}
                max={200}
                step={2}
                value={[brush.size]}
                onValueChange={(values: number[]) =>
                  setBrush((value) => ({ ...value, size: values[0] }))
                }
                className="flex-1"
              />
              <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                {brush.size}
              </span>
            </div>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <div className="flex items-center gap-1">
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
            <EditorCanvas
              workCanvas={workCanvas}
              originalCanvas={originalCanvas}
              brush={brush}
              enabled={status === "ready" && busy === null}
              version={version}
              onStroke={handleStroke}
            />
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
            {busy ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/70 backdrop-blur-sm">
                <Loader2 className="size-8 animate-spin text-primary" />
                <p className="text-sm font-medium">{busyLabel}…</p>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <Tabs defaultValue="background" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="background">Fondo</TabsTrigger>
              <TabsTrigger value="vector">Vector</TabsTrigger>
              <TabsTrigger value="colors">Colores</TabsTrigger>
            </TabsList>

            <TabsContent value="background" className="mt-4 space-y-4">
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

                  <Separator />

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={handleResetEdits}
                  >
                    <RotateCcw className="size-4" />
                    Volver a la original
                  </Button>

                  <p className="text-xs text-muted-foreground">
                    Usa el pincel <strong>Borrar</strong> para eliminar restos de
                    fondo y <strong>Restaurar</strong> para recuperar partes de
                    la imagen que se hayan borrado por error.
                  </p>
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
                    Convierte la imagen en trazos vectoriales editables.
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
                        max={32}
                        step={1}
                        value={[traceSettings.numberofcolors]}
                        onValueChange={(values: number[]) =>
                          setTraceSettings((settings) => ({
                            ...settings,
                            numberofcolors: values[0],
                          }))
                        }
                      />
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

                  <Button
                    className="w-full"
                    onClick={handleGenerateSvg}
                    disabled={busy !== null}
                  >
                    {busy === "trace" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Scissors className="size-4" />
                    )}
                    Generar SVG
                  </Button>

                  {svg ? (
                    <div className="space-y-2">
                      <div className="flex max-h-48 items-center justify-center overflow-hidden rounded-md border bg-white p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={svgToDataUrl(svg)}
                          alt="Previsualización del SVG"
                          className="max-h-44 w-auto"
                        />
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleDownloadSvg}
                      >
                        <Download className="size-4" />
                        Descargar SVG
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="colors" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Palette className="size-4" />
                    Dividir por color
                  </CardTitle>
                  <CardDescription>
                    Genera un SVG por cada color detectado, ideal para impresión
                    multicolor o por capas.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Colores a detectar</Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {traceSettings.numberofcolors}
                      </span>
                    </div>
                    <Slider
                      min={2}
                      max={24}
                      step={1}
                      value={[traceSettings.numberofcolors]}
                      onValueChange={(values: number[]) =>
                        setTraceSettings((settings) => ({
                          ...settings,
                          numberofcolors: values[0],
                        }))
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="colors-alpha">Umbral de fondo</Label>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {traceSettings.alphaThreshold}
                      </span>
                    </div>
                    <Slider
                      id="colors-alpha"
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
                  </div>

                  <Button
                    className="w-full"
                    onClick={handleSplitByColor}
                    disabled={busy !== null}
                  >
                    {busy === "split" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Palette className="size-4" />
                    )}
                    Dividir por color
                  </Button>

                  {layers && layers.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-muted-foreground">
                          {layers.length} capa(s)
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleDownloadAllLayers}
                        >
                          <Download className="size-3.5" />
                          ZIP
                        </Button>
                      </div>
                      <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                        {layers.map((layer, index) => (
                          <div
                            key={`${layer.color}-${index}`}
                            className="flex items-center gap-2 rounded-md border p-2"
                          >
                            <span
                              className="size-6 shrink-0 rounded border"
                              style={{ backgroundColor: rgbToHex(layer.rgb) }}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">
                                {rgbToHex(layer.rgb)}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {layer.pathCount} trazo(s)
                              </p>
                            </div>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleDownloadLayer(layer, index)}
                              aria-label={`Descargar capa ${rgbToHex(layer.rgb)}`}
                            >
                              <Download className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
