"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Box,
  Coffee,
  Download,
  FileUp,
  Layers,
  Loader2,
  Palette,
  RotateCcw,
  Ruler,
  Shapes,
  SlidersHorizontal,
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
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_COASTER_SETTINGS,
  buildCoaster,
  type CoasterModel,
  type CoasterPlacement,
  type CoasterSettings,
  type CoasterShape,
  type DesignKind,
  type DesignMode,
} from "@/lib/3d/coaster";
import { piecesToMeshes, export3mf, exportStl, type MeshPiece } from "@/lib/3d/mesh";
import {
  clearPosavasosHandoff,
  handoffSnapshot,
  parsePosavasosHandoff,
  type HandoffLayer,
} from "@/lib/3d/handoff";
import {
  PATTERN_KINDS,
  PATTERN_LABELS,
  type PatternKind,
} from "@/lib/3d/patterns";
import { baseName } from "@/lib/image/download";
import { splitSvgByColor } from "@/lib/image/trace";
import { ModelViewer } from "./model-viewer";

const DESCRIPTION =
  "Diseña un posavasos listo para imprimir: elegí la forma y el tamaño, sumá una imagen vectorizada o un patrón (grabado o en relieve), agregá un labio y exportá el modelo.";

const BUILD_DELAY = 200;

interface BuiltModel {
  key: string;
  model: CoasterModel;
  meshes: MeshPiece[];
}

const subscribeHandoff = () => () => {};

const PLACEMENTS: { value: CoasterPlacement; label: string }[] = [
  { value: "top", label: "Arriba" },
  { value: "bottom", label: "Abajo" },
  { value: "full", label: "Todo el alto" },
];

const SHAPES: { value: CoasterShape; label: string }[] = [
  { value: "square", label: "Cuadrado" },
  { value: "round", label: "Redondo" },
  { value: "hex", label: "Hexágono" },
  { value: "oct", label: "Octágono" },
];

const DESIGN_KINDS: { value: DesignKind; label: string }[] = [
  { value: "none", label: "Sin diseño" },
  { value: "image", label: "Imagen" },
  { value: "pattern", label: "Patrón" },
];

const DESIGN_MODES: { value: DesignMode; label: string }[] = [
  { value: "engrave", label: "Grabado" },
  { value: "raise", label: "Relieve" },
  { value: "through", label: "Huecos" },
];

function svgSize(svgText: string): { width: number; height: number } {
  const viewBox = svgText.match(/viewBox="([\d.\-\s]+)"/);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const width = Number(svgText.match(/width="([\d.]+)/)?.[1] ?? 1000);
  const height = Number(svgText.match(/height="([\d.]+)/)?.[1] ?? 1000);
  return { width: width || 1000, height: height || 1000 };
}

function layersFromSvg(svgText: string): HandoffLayer[] {
  const { width, height } = svgSize(svgText);
  return splitSvgByColor(svgText, width, height).map((layer) => ({
    color: layer.color,
    svg: layer.svg,
  }));
}

export function PosavasoTool() {
  const rawHandoff = useSyncExternalStore(
    subscribeHandoff,
    handoffSnapshot,
    () => ""
  );
  const handoff = useMemo(() => parsePosavasosHandoff(rawHandoff), [rawHandoff]);

  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [svgLayers, setSvgLayers] = useState<HandoffLayer[] | null>(null);
  const [svgName, setSvgName] = useState<string | null>(null);
  const [settings, setSettings] = useState<CoasterSettings>(
    DEFAULT_COASTER_SETTINGS
  );
  const [built, setBuilt] = useState<BuiltModel | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"stl" | "3mf" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handoffLayers = useMemo(
    () => (handoffDismissed ? null : (handoff?.layers ?? null)),
    [handoff, handoffDismissed]
  );
  const availableLayers = useMemo(
    () => svgLayers ?? handoffLayers ?? [],
    [handoffLayers, svgLayers]
  );

  // El diseño que llega desde la herramienta de Imagen se usa como "imagen"
  // mientras el usuario no elija otro tipo de diseño.
  const designKind: DesignKind =
    settings.designKind === "none" && availableLayers.length > 0
      ? "image"
      : settings.designKind;

  const resolvedSettings = useMemo<CoasterSettings>(
    () => ({ ...settings, designKind }),
    [designKind, settings]
  );

  const layers = useMemo(
    () => (designKind === "image" ? availableLayers : []),
    [availableLayers, designKind]
  );

  const sourceName = useMemo(
    () => svgName ?? (handoff ? baseName(handoff.name) : "posavasos"),
    [handoff, svgName]
  );

  const buildKey = useMemo(
    () => `${JSON.stringify(resolvedSettings)}|${layers.length}|${sourceName}`,
    [layers.length, resolvedSettings, sourceName]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      try {
        const generated = buildCoaster(resolvedSettings, layers);
        if (cancelled) return;
        setBuilt({
          key: buildKey,
          model: generated,
          meshes: piecesToMeshes(generated.pieces),
        });
        setBuildError(null);
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        setBuildError(
          error instanceof Error
            ? error.message
            : "No se pudo generar el modelo"
        );
      }
    }, BUILD_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [buildKey, layers, resolvedSettings]);

  const model = built?.model ?? null;
  const meshes = built?.meshes ?? [];
  const building = built?.key !== buildKey && buildError === null;

  const updateSettings = useCallback((patch: Partial<CoasterSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const handleNew = useCallback(() => {
    clearPosavasosHandoff();
    setHandoffDismissed(true);
    setSvgLayers(null);
    setSvgName(null);
    setBuildError(null);
    setSettings(DEFAULT_COASTER_SETTINGS);
  }, []);

  const handleSvgFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = layersFromSvg(text);
      if (parsed.length === 0) {
        toast.error("El SVG no tiene colores para usar");
        return;
      }
      setHandoffDismissed(true);
      setSvgLayers(parsed);
      setSvgName(baseName(file.name));
      setSettings((current) => ({ ...current, designKind: "image" }));
      toast.success(`SVG cargado con ${parsed.length} color(es)`);
    } catch (error) {
      console.error(error);
      toast.error("No se pudo leer el SVG");
    }
  }, []);

  const handleExport = useCallback(
    async (format: "stl" | "3mf") => {
      if (!model || model.pieces.length === 0) return;
      setExporting(format);
      try {
        if (format === "stl") {
          await exportStl(model.pieces, `${sourceName}-posavasos`);
        } else {
          await export3mf(model.pieces, `${sourceName}-posavasos`);
        }
      } catch (error) {
        console.error(error);
        toast.error("No se pudo exportar el modelo");
      } finally {
        setExporting(null);
      }
    },
    [model, sourceName]
  );

  const bandLayers = useMemo(
    () =>
      settings.placement === "full"
        ? settings.layers
        : Math.min(settings.bandLayers, settings.layers),
    [settings.bandLayers, settings.layers, settings.placement]
  );

  const usingHandoff = !svgLayers && availableLayers.length > 0 && !handoffDismissed;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Posavasos</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Posavasos
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {designKind === "image" && availableLayers.length > 0
              ? `${availableLayers.length} color(es) desde ${sourceName}`
              : designKind === "pattern"
                ? `Patrón ${PATTERN_LABELS[settings.pattern]}`
                : "Modelo en blanco"}
            {model
              ? ` · ${model.totalHeightMm.toFixed(2)} mm de alto`
              : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/tools/image">
              <ArrowLeft className="size-4" />
              Ir a Imagen
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={handleNew}>
            <RotateCcw className="size-4" />
            Nuevo
          </Button>
          <Button
            size="sm"
            disabled={!model || (!!exporting && exporting !== "stl")}
            onClick={() => void handleExport("stl")}
          >
            {exporting === "stl" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            STL
          </Button>
          <Button
            size="sm"
            disabled={!model || (!!exporting && exporting !== "3mf")}
            onClick={() => void handleExport("3mf")}
          >
            {exporting === "3mf" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            3MF
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="relative">
            <ModelViewer
              meshes={meshes}
              widthMm={settings.widthMm}
              heightMm={model?.totalHeightMm ?? 0}
              className="h-[52vh] min-h-[380px] w-full"
            />
            {building ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-sm">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Generando modelo…
                </span>
              </div>
            ) : null}
          </div>

          {buildError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
              <p className="text-xs font-medium text-destructive">
                No se pudo generar el modelo
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Probá ajustar el diseño o presionar Nuevo. Detalle: {buildError}
              </p>
            </div>
          ) : null}

          {model ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Alto total"
                value={`${model.totalHeightMm.toFixed(2)} mm`}
              />
              <Stat
                label={
                  settings.designMode === "raise"
                    ? "Relieve"
                    : settings.designMode === "through"
                      ? "Calado"
                      : "Grabado"
                }
                value={
                  settings.designMode === "through"
                    ? `${model.totalHeightMm.toFixed(2)} mm`
                    : `${model.bandMm.toFixed(2)} mm`
                }
              />
              <Stat
                label="Diseño"
                value={
                  designKind === "none"
                    ? "Sin diseño"
                    : `${model.designWidthMm.toFixed(1)} mm`
                }
              />
              <Stat label="Colores" value={String(model.colors.length)} />
            </div>
          ) : null}

          {model && model.colors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Colores:</span>
              <span
                className="size-4 rounded-sm border"
                style={{ backgroundColor: settings.baseColor }}
                title="Base"
              />
              {model.colors.map((color) => (
                <span
                  key={color}
                  className="size-4 rounded-sm border"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Palette className="size-3.5" />
                Diseño
              </p>
              <span className="text-[11px] text-muted-foreground">
                {designKind === "image" && availableLayers.length > 0
                  ? `${availableLayers.length} color(es)`
                  : designKind === "pattern"
                    ? PATTERN_LABELS[settings.pattern]
                    : "en blanco"}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {DESIGN_KINDS.map((kind) => (
                <Button
                  key={kind.value}
                  size="sm"
                  variant={
                    designKind === kind.value ? "default" : "outline"
                  }
                  aria-pressed={designKind === kind.value}
                  className="px-1 text-[11px]"
                  onClick={() => updateSettings({ designKind: kind.value })}
                >
                  {kind.label}
                </Button>
              ))}
            </div>

            {designKind === "image" ? (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".svg,image/svg+xml"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleSvgFile(file);
                    event.target.value = "";
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="size-4" />
                  {availableLayers.length > 0 ? "Cambiar SVG" : "Cargar SVG"}
                </Button>
                {availableLayers.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {usingHandoff
                      ? `Enviado desde Imagen: ${availableLayers.length} color(es) de ${sourceName}.`
                      : `${availableLayers.length} color(es) desde ${sourceName}.`}
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <Coffee className="mt-0.5 size-3 shrink-0" />
                    Cargá un SVG con colores o vectorizá una imagen y usá
                    &quot;Convertir en posavasos&quot;.
                  </p>
                )}
              </div>
            ) : null}

            {designKind === "pattern" ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Patrón</Label>
                  <Select
                    value={settings.pattern}
                    onValueChange={(value: string) =>
                      updateSettings({ pattern: value as PatternKind })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PATTERN_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {PATTERN_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    El patrón cubre toda la superficie y se recorta al contorno
                    del posavasos.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Tamaño de celda</Label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {settings.patternCellMm.toFixed(1)} mm
                    </span>
                  </div>
                  <Slider
                    min={3}
                    max={25}
                    step={0.5}
                    value={[settings.patternCellMm]}
                    onValueChange={([value]) =>
                      updateSettings({ patternCellMm: value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Grosor</Label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {settings.patternThicknessMm.toFixed(1)} mm
                    </span>
                  </div>
                  <Slider
                    min={0.5}
                    max={6}
                    step={0.1}
                    value={[settings.patternThicknessMm]}
                    onValueChange={([value]) =>
                      updateSettings({ patternThicknessMm: value })
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="coaster-pattern-color" className="text-xs">
                    Color del patrón
                  </Label>
                  <input
                    id="coaster-pattern-color"
                    type="color"
                    value={settings.patternColor}
                    onChange={(event) =>
                      updateSettings({ patternColor: event.target.value })
                    }
                    className="h-8 w-14 cursor-pointer rounded-md border bg-transparent"
                  />
                </div>
              </div>
            ) : null}

            {designKind !== "none" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Modo</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {DESIGN_MODES.map((mode) => (
                    <Button
                      key={mode.value}
                      size="sm"
                      variant={
                        settings.designMode === mode.value
                          ? "default"
                          : "outline"
                      }
                      aria-pressed={settings.designMode === mode.value}
                      onClick={() =>
                        updateSettings({ designMode: mode.value })
                      }
                    >
                      {mode.label}
                    </Button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {settings.designMode === "raise"
                    ? "El diseño sobresale por encima de la superficie."
                    : settings.designMode === "through"
                      ? "El diseño atraviesa todas las capas y deja huecos pasantes."
                      : "El diseño queda hundido, al ras del color."}
                </p>
                {designKind === "pattern" &&
                settings.designMode !== "through" ? (
                  <Button
                    size="sm"
                    variant={settings.designInvert ? "default" : "outline"}
                    aria-pressed={settings.designInvert}
                    className="w-full"
                    onClick={() =>
                      updateSettings({ designInvert: !settings.designInvert })
                    }
                  >
                    Invertir
                  </Button>
                ) : null}
                {settings.designInvert && designKind === "pattern" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Ahora la red entre las celdas es la que sobresale (o se
                    rebaja) y las celdas quedan como huecos.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Shapes className="size-3.5" />
                Forma
              </p>
              <span className="text-[11px] text-muted-foreground">
                {settings.layers} capas
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {SHAPES.map((shape) => (
                <Button
                  key={shape.value}
                  size="sm"
                  variant={
                    settings.shape === shape.value ? "default" : "outline"
                  }
                  aria-pressed={settings.shape === shape.value}
                  onClick={() => updateSettings({ shape: shape.value })}
                >
                  {shape.label}
                </Button>
              ))}
            </div>
            {settings.shape === "square" ? (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Redondeo de puntas</Label>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {settings.cornerMm.toFixed(1)} mm
                  </span>
                </div>
                <Slider
                  min={2}
                  max={Math.max(2, settings.widthMm / 2 - 2)}
                  step={0.5}
                  value={[settings.cornerMm]}
                  onValueChange={([value]) =>
                    updateSettings({ cornerMm: value })
                  }
                />
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Ruler className="size-3.5" />
              Medidas
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
                  {settings.shape === "round"
                    ? "Diámetro"
                    : settings.shape === "square"
                      ? "Lado"
                      : "Ancho"}
                </Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {settings.widthMm.toFixed(0)} mm
                </span>
              </div>
              <Slider
                min={50}
                max={140}
                step={1}
                value={[settings.widthMm]}
                onValueChange={([value]) => updateSettings({ widthMm: value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="coaster-layers" className="text-xs">
                  Capas totales
                </Label>
                <Input
                  id="coaster-layers"
                  type="number"
                  min={2}
                  max={60}
                  value={settings.layers}
                  onChange={(event) =>
                    updateSettings({
                      layers: Math.max(
                        2,
                        Math.min(60, Number(event.target.value) || 2)
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coaster-layer-height" className="text-xs">
                  Altura de capa (mm)
                </Label>
                <Input
                  id="coaster-layer-height"
                  type="number"
                  min={0.06}
                  max={0.4}
                  step={0.02}
                  value={settings.layerHeightMm}
                  onChange={(event) =>
                    updateSettings({
                      layerHeightMm: Math.max(
                        0.06,
                        Math.min(0.4, Number(event.target.value) || 0.2)
                      ),
                    })
                  }
                />
              </div>
            </div>
            {designKind === "image" ? (
              <div className="space-y-1.5">
                <Label htmlFor="coaster-margin" className="text-xs">
                  Margen desde el borde: {settings.marginMm.toFixed(0)} mm
                </Label>
                <Slider
                  min={0}
                  max={20}
                  step={1}
                  value={[settings.marginMm]}
                  onValueChange={([value]) =>
                    updateSettings({ marginMm: value })
                  }
                />
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Layers className="size-3.5" />
              Borde
            </p>
            <Button
              size="sm"
              variant={settings.borderEnabled ? "default" : "outline"}
              aria-pressed={settings.borderEnabled}
              className="w-full"
              onClick={() =>
                updateSettings({ borderEnabled: !settings.borderEnabled })
              }
            >
              {settings.borderEnabled
                ? "Labio activado"
                : "Agregar labio elevado"}
            </Button>
            {settings.borderEnabled ? (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Ancho del labio</Label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {settings.borderWidthMm.toFixed(1)} mm
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={Math.max(2, settings.widthMm / 4)}
                    step={0.5}
                    value={[settings.borderWidthMm]}
                    onValueChange={([value]) =>
                      updateSettings({ borderWidthMm: value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Altura del labio</Label>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {settings.borderLayers} capas
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={12}
                    step={1}
                    value={[settings.borderLayers]}
                    onValueChange={([value]) =>
                      updateSettings({ borderLayers: value })
                    }
                  />
                </div>
              </>
            ) : null}
          </div>

          {settings.designMode === "through" ? null : (
            <>
              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Box className="size-3.5" />
                    Ubicación del diseño
                  </p>
                  <span className="text-[11px] text-muted-foreground">
                    {bandLayers} de {settings.layers} capas
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {PLACEMENTS.map((placement) => (
                    <Button
                      key={placement.value}
                      size="sm"
                      variant={
                        settings.placement === placement.value
                          ? "default"
                          : "outline"
                      }
                      aria-pressed={settings.placement === placement.value}
                      className="px-1 text-[11px]"
                      onClick={() =>
                        updateSettings({ placement: placement.value })
                      }
                    >
                      {placement.label}
                    </Button>
                  ))}
                </div>
                {settings.placement !== "full" ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Capas del relieve</Label>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {bandLayers}
                      </span>
                    </div>
                    <Slider
                      min={1}
                      max={Math.max(1, settings.layers - 1)}
                      step={1}
                      value={[settings.bandLayers]}
                      onValueChange={([value]) =>
                        updateSettings({ bandLayers: value })
                      }
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-3">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              Ajustes
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Escala del diseño</Label>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {settings.scalePercent}%
                </span>
              </div>
              <Slider
                min={20}
                max={300}
                step={5}
                value={[settings.scalePercent]}
                onValueChange={([value]) =>
                  updateSettings({ scalePercent: value })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Podés pasar del 100%: lo que quede fuera del posavasos se
                recorta.
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="coaster-base-color" className="text-xs">
                Color de la base
              </Label>
              <input
                id="coaster-base-color"
                type="color"
                value={settings.baseColor}
                onChange={(event) =>
                  updateSettings({ baseColor: event.target.value })
                }
                className="h-8 w-14 cursor-pointer rounded-md border bg-transparent"
              />
            </div>
          </div>

          <Separator />

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => setSettings(DEFAULT_COASTER_SETTINGS)}
          >
            Restablecer medidas
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
