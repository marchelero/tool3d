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
  Loader2,
  Ruler,
  Shapes,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_COASTER_SETTINGS,
  buildCoaster,
  type CoasterModel,
  type CoasterPlacement,
  type CoasterSettings,
  type CoasterShape,
} from "@/lib/3d/coaster";
import { piecesToMeshes, export3mf, exportStl, type MeshPiece } from "@/lib/3d/mesh";
import {
  handoffSnapshot,
  parsePosavasosHandoff,
  type HandoffLayer,
} from "@/lib/3d/handoff";
import { baseName } from "@/lib/image/download";
import { splitSvgByColor } from "@/lib/image/trace";
import { ModelViewer } from "./model-viewer";

const DESCRIPTION =
  "Convierte el diseño vectorizado en un posavasos con relieve: elegí la forma, el diámetro y en qué capas va el diseño, y exportá el modelo listo para imprimir.";

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
  { value: "round", label: "Redondo" },
  { value: "rounded-square", label: "Cuadrado" },
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

  const [svgLayers, setSvgLayers] = useState<HandoffLayer[] | null>(null);
  const [svgName, setSvgName] = useState<string | null>(null);
  const [settings, setSettings] = useState<CoasterSettings>(DEFAULT_COASTER_SETTINGS);
  const [built, setBuilt] = useState<BuiltModel | null>(null);
  const [exporting, setExporting] = useState<"stl" | "3mf" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const layers = useMemo(
    () => svgLayers ?? handoff?.layers ?? [],
    [handoff, svgLayers]
  );
  const sourceName = useMemo(
    () => svgName ?? (handoff ? baseName(handoff.name) : "posavasos"),
    [handoff, svgName]
  );

  const buildKey = useMemo(
    () =>
      layers.length === 0
        ? ""
        : `${JSON.stringify(settings)}|${layers.length}|${sourceName}`,
    [layers, settings, sourceName]
  );

  useEffect(() => {
    if (layers.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      try {
        const generated = buildCoaster(settings, layers);
        if (cancelled) return;
        setBuilt({
          key: buildKey,
          model: generated,
          meshes: piecesToMeshes(generated.pieces),
        });
      } catch (error) {
        console.error(error);
        toast.error("No se pudo generar el modelo");
      }
    }, BUILD_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [buildKey, layers, settings]);

  const model = built?.model ?? null;
  const meshes = built?.meshes ?? [];
  const building = layers.length > 0 && built?.key !== buildKey;

  const updateSettings = useCallback((patch: Partial<CoasterSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const handleSvgFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = layersFromSvg(text);
      if (parsed.length === 0) {
        toast.error("El SVG no tiene colores para usar");
        return;
      }
      setSvgLayers(parsed);
      setSvgName(baseName(file.name));
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

  const hasModel = layers.length > 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Posavasos</Badge>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Posavasos con imagen
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {DESCRIPTION}
          </p>
          {hasModel ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {layers.length} color(es) desde {sourceName}
              {model
                ? ` · diseño de ${model.designWidthMm.toFixed(1)}×${model.designHeightMm.toFixed(1)} mm`
                : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/tools/image">
              <ArrowLeft className="size-4" />
              Ir a Imagen
            </Link>
          </Button>
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
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4" />
            Cargar SVG
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

      {!hasModel ? (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-muted/20 px-6 text-center">
          <Coffee className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">Todavía no hay un diseño</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Vectorizá una imagen en la herramienta de Imagen y usá el paso
            &quot;Convertir en posavasos&quot;, o cargá un SVG con colores acá.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp className="size-4" />
            Cargar SVG
          </Button>
        </div>
      ) : (
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

            {model ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Alto total"
                  value={`${model.totalHeightMm.toFixed(2)} mm`}
                />
                <Stat label="Relieve" value={`${model.bandMm.toFixed(2)} mm`} />
                <Stat
                  label="Diseño"
                  value={`${model.designWidthMm.toFixed(1)} mm`}
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
              <div className="grid grid-cols-2 gap-1.5">
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
              {settings.shape === "rounded-square" ? (
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
                    {settings.shape === "round" ? "Diámetro" : "Lado"}
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
                        layers: Math.max(2, Math.min(60, Number(event.target.value) || 2)),
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
              <div className="space-y-1.5">
                <Label htmlFor="coaster-margin" className="text-xs">
                  Margen desde el borde: {settings.marginMm.toFixed(0)} mm
                </Label>
                <Slider
                  min={0}
                  max={20}
                  step={1}
                  value={[settings.marginMm]}
                  onValueChange={([value]) => updateSettings({ marginMm: value })}
                />
              </div>
            </div>

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

            <Separator />

            <div className="space-y-3">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <SlidersHorizontal className="size-3.5" />
                Diseño
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
                  max={100}
                  step={1}
                  value={[settings.scalePercent]}
                  onValueChange={([value]) =>
                    updateSettings({ scalePercent: value })
                  }
                />
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
      )}
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
