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
import Image from "next/image";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  Circle,
  Coffee,
  Download,
  FileUp,
  Grid3x3,
  Hexagon,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Loader2,
  Move,
  Octagon,
  Palette,
  RotateCcw,
  Shapes,
  SlidersHorizontal,
  Square,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  type DesignKind,
  type DesignMode,
} from "@/lib/3d/coaster";
import { piecesToMeshes, export3mf, exportStl, type MeshPiece } from "@/lib/3d/mesh";
import {
  TILE_KINDS,
  TILE_LABELS,
  mosaicPreviewUrl,
} from "@/lib/3d/mosaic";
import {
  clearPosavasosHandoff,
  handoffSnapshot,
  parsePosavasosHandoff,
  type HandoffLayer,
} from "@/lib/3d/handoff";
import {
  PATTERN_KINDS,
  PATTERN_LABELS,
  patternPreviewUrl,
} from "@/lib/3d/patterns";
import { baseName } from "@/lib/image/download";
import { splitSvgByColor } from "@/lib/image/trace";
import {
  Field,
  GroupLabel,
  Hint,
  PanelSection,
  PanelTooltips,
  SegmentedControl,
  ToggleButton,
} from "@/components/tools/shared/panel";
import { ModelViewer } from "./model-viewer";

const DESCRIPTION =
  "Diseña un posavasos listo para imprimir: elegí la forma y el tamaño, sumá una imagen vectorizada o un patrón (grabado o en relieve), agregá un borde y exportá el modelo.";

const BUILD_DELAY = 200;

interface BuiltModel {
  key: string;
  model: CoasterModel;
  meshes: MeshPiece[];
}

const subscribeHandoff = () => () => {};

const PLACEMENTS: {
  value: CoasterPlacement;
  label: string;
  title: string;
}[] = [
  { value: "top", label: "Arriba", title: "Parte superior del posavasos" },
  { value: "bottom", label: "Abajo", title: "Parte inferior del posavasos" },
  { value: "full", label: "Completo", title: "Todo el espesor" },
];

const SHAPES: { value: CoasterShape; label: string; icon: LucideIcon }[] = [
  { value: "round", label: "Redondo", icon: Circle },
  { value: "square", label: "Cuadrado", icon: Square },
  { value: "hex", label: "Hexágono", icon: Hexagon },
  { value: "oct", label: "Octágono", icon: Octagon },
];

const DESIGN_KINDS: { value: DesignKind; label: string; icon: LucideIcon }[] = [
  { value: "none", label: "Sin diseño", icon: Ban },
  { value: "image", label: "Imagen", icon: ImageIcon },
  { value: "pattern", label: "Patrón", icon: LayoutGrid },
  { value: "mosaic", label: "Mosaico", icon: Grid3x3 },
];

const DESIGN_MODES: { value: DesignMode; label: string; title: string }[] = [
  { value: "engrave", label: "Grabado", title: "Hundido, al ras del color" },
  { value: "raise", label: "Relieve", title: "Sobresale de la superficie" },
  { value: "through", label: "Huecos", title: "Atraviesa todas las capas" },
];

const SIZE_PRESETS = [80, 90, 100, 120];

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
  const [expanded, setExpanded] = useState(false);
  const [designExplicit, setDesignExplicit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const handoffLayers = useMemo(
    () => (handoffDismissed ? null : (handoff?.layers ?? null)),
    [handoff, handoffDismissed]
  );
  const availableLayers = useMemo(
    () => svgLayers ?? handoffLayers ?? [],
    [handoffLayers, svgLayers]
  );

  // Lo que llega desde Imagen se usa como diseño mientras el usuario no elija
  // otro tipo a mano (por ejemplo, "Sin diseño").
  const designKind: DesignKind =
    settings.designKind === "none" &&
    availableLayers.length > 0 &&
    !designExplicit
      ? "image"
      : settings.designKind;

  const resolvedSettings = useMemo<CoasterSettings>(
    () => ({ ...settings, designKind }),
    [designKind, settings]
  );

  const layers = useMemo(
    () =>
      designKind === "image" || designKind === "mosaic" ? availableLayers : [],
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

  const updateDesignKind = useCallback(
    (kind: DesignKind) => {
      setDesignExplicit(true);
      updateSettings({ designKind: kind });
    },
    [updateSettings]
  );

  const handleNew = useCallback(() => {
    clearPosavasosHandoff();
    setHandoffDismissed(true);
    setSvgLayers(null);
    setSvgName(null);
    setBuildError(null);
    setDesignExplicit(false);
    setSettings(DEFAULT_COASTER_SETTINGS);
  }, []);

  const handleReset = useCallback(() => {
    setSettings((current) => ({
      ...current,
      shape: DEFAULT_COASTER_SETTINGS.shape,
      widthMm: DEFAULT_COASTER_SETTINGS.widthMm,
      cornerMm: DEFAULT_COASTER_SETTINGS.cornerMm,
      layers: DEFAULT_COASTER_SETTINGS.layers,
      layerHeightMm: DEFAULT_COASTER_SETTINGS.layerHeightMm,
      placement: DEFAULT_COASTER_SETTINGS.placement,
      bandLayers: DEFAULT_COASTER_SETTINGS.bandLayers,
      marginMm: DEFAULT_COASTER_SETTINGS.marginMm,
      scalePercent: DEFAULT_COASTER_SETTINGS.scalePercent,
      designRotation: DEFAULT_COASTER_SETTINGS.designRotation,
    }));
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
      setDesignExplicit(true);
      setSettings((current) =>
        current.designKind === "none"
          ? { ...current, designKind: "image" }
          : current
      );
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

  const patternPreviews = useMemo(
    () =>
      PATTERN_KINDS.map((kind) => ({
        kind,
        label: PATTERN_LABELS[kind],
        url: patternPreviewUrl(kind),
      })),
    []
  );

  const tilePreviews = useMemo(
    () =>
      TILE_KINDS.map((kind) => ({
        kind,
        label: TILE_LABELS[kind],
        url: mosaicPreviewUrl(kind),
      })),
    []
  );

  const usingHandoff =
    !svgLayers && availableLayers.length > 0 && !handoffDismissed;
  const showsImage = designKind === "image" || designKind === "mosaic";
  const showsPattern = designKind === "pattern";
  const showsMosaic = designKind === "mosaic";
  const shapeLabel =
    SHAPES.find((shape) => shape.value === settings.shape)?.label ?? "";
  const placementLabel =
    PLACEMENTS.find((placement) => placement.value === settings.placement)
      ?.label ?? "";
  const baseHeightMm = settings.layers * settings.layerHeightMm;

  const designSummary =
    designKind === "mosaic"
      ? `Mosaico · ${TILE_LABELS[settings.mosaicKind]}`
      : designKind === "image"
        ? availableLayers.length > 0
          ? `${availableLayers.length} color(es)`
          : "Sin SVG"
        : designKind === "pattern"
          ? PATTERN_LABELS[settings.pattern]
          : "Sin diseño";

  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-50 flex flex-col bg-background"
          : "mx-auto w-full max-w-7xl px-4 py-8"
      }
    >
      <header
        className={
          expanded
            ? "flex shrink-0 items-center justify-between gap-2 border-b bg-card/60 px-4 py-2"
            : "mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        }
      >
        {expanded ? (
          <p className="text-sm font-medium">Posavasos · vista ampliada</p>
        ) : (
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
                  : designKind === "mosaic"
                    ? `Mosaico ${TILE_LABELS[settings.mosaicKind]}`
                    : "Modelo en blanco"}
              {model
                ? ` · ${model.totalHeightMm.toFixed(2)} mm de alto`
                : null}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {expanded || !usingHandoff ? null : (
            <Button asChild size="sm" variant="outline">
              <Link href="/tools/image">
                <ArrowLeft className="size-4" />
                Ir a Imagen
              </Link>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleNew}>
            <RotateCcw className="size-4" />
            Nuevo
          </Button>
        </div>
      </header>

      <div
        className={
          expanded
            ? "grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]"
            : "grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
        }
      >
        <div
          className={
            expanded ? "flex min-h-0 flex-col" : "space-y-3 lg:sticky lg:top-8"
          }
        >
          <div
            className={expanded ? "relative min-h-0 flex-1" : "relative"}
          >
            <ModelViewer
              meshes={meshes}
              widthMm={settings.widthMm}
              heightMm={model?.totalHeightMm ?? 0}
              designMm={model?.designWidthMm ?? 0}
              expanded={expanded}
              onToggleExpanded={() => setExpanded((value) => !value)}
              className={
                expanded ? "size-full" : "h-[52vh] min-h-[380px] w-full"
              }
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

          {expanded ? null : (
            <>
              {buildError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
                  <p className="text-xs font-medium text-destructive">
                    No se pudo generar el modelo
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Probá ajustar el diseño o presionar Nuevo. Detalle:{" "}
                    {buildError}
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
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Colores:
                    </span>
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
                  <p className="text-[11px] text-muted-foreground">
                    3MF usa {model.colors.length + 1} filamentos (base +
                    colores); STL va en un solo color.
                  </p>
                  {model.colors.length + 1 > 4 ? (
                    <p className="flex items-center gap-1 text-[11px] text-amber-600">
                      <TriangleAlert className="size-3 shrink-0" />
                      Este diseño pide más filamentos que ranuras de un AMS (4).
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <aside
          aria-label="Controles del posavasos"
          className={
            expanded
              ? "min-h-0 space-y-3 overflow-y-auto rounded-xl border bg-card p-4 shadow-xl"
              : "space-y-3 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
          }
        >
          <PanelTooltips>
            <PanelSection
              icon={Shapes}
              title="Forma"
              summary={`${shapeLabel} · ${settings.widthMm.toFixed(0)} mm`}
            >
              <SegmentedControl
                label="Forma del posavasos"
                value={settings.shape}
                onValueChange={(value) => updateSettings({ shape: value })}
                columns={2}
                options={SHAPES}
              />

              <NumberSlider
                id="coaster-width"
                label={
                  settings.shape === "round"
                    ? "Diámetro"
                    : settings.shape === "square"
                      ? "Lado"
                      : "Ancho"
                }
                value={settings.widthMm}
                min={50}
                max={140}
                step={1}
                unit="mm"
                decimals={0}
                onChange={(value) => updateSettings({ widthMm: value })}
              />

              <div className="space-y-1.5">
                <GroupLabel>Tamaños rápidos</GroupLabel>
                <div className="grid grid-cols-4 gap-1.5">
                  {SIZE_PRESETS.map((preset) => {
                    const active = Math.round(settings.widthMm) === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        title={`${preset} mm`}
                        aria-label={`${preset} mm`}
                        aria-pressed={active}
                        onClick={() => updateSettings({ widthMm: preset })}
                        className={`h-7 rounded-md border text-[11px] tabular-nums transition-colors ${
                          active
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        {preset} mm
                      </button>
                    );
                  })}
                </div>
              </div>

              {settings.shape === "square" ? (
                <NumberSlider
                  id="coaster-corner"
                  label="Redondeo de puntas"
                  value={settings.cornerMm}
                  min={2}
                  max={Math.max(2, settings.widthMm / 2 - 2)}
                  step={0.5}
                  unit="mm"
                  onChange={(value) => updateSettings({ cornerMm: value })}
                />
              ) : null}
            </PanelSection>

            <PanelSection
              icon={Layers}
              title="Capas"
              summary={`${settings.layers} × ${settings.layerHeightMm} mm`}
            >
              <div className="grid grid-cols-2 gap-2">
                <Field label="Capas totales" htmlFor="coaster-layers">
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
                </Field>
                <Field
                  label="Altura de capa"
                  htmlFor="coaster-layer-height"
                  value={`${settings.layerHeightMm.toFixed(2)} mm`}
                >
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
                </Field>
              </div>
              <Hint>
                Altura base aproximada: {baseHeightMm.toFixed(2)} mm. El borde y
                el relieve pueden sumar altura.
              </Hint>
            </PanelSection>

            <PanelSection
              icon={SlidersHorizontal}
              title="Diseño"
              summary={designSummary}
            >
              <SegmentedControl
                label="Tipo de diseño"
                value={designKind}
                onValueChange={updateDesignKind}
                columns={2}
                options={DESIGN_KINDS}
              />

              {showsImage ? (
                <div className="space-y-2.5">
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
                    <div className="space-y-1.5 rounded-lg bg-muted/40 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] text-muted-foreground">
                          {designKind === "mosaic"
                            ? "Colores para el mosaico"
                            : usingHandoff
                              ? `Enviado desde Imagen · ${sourceName}`
                              : sourceName}
                        </p>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {availableLayers.length} color(es)
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {availableLayers.map((layer) => (
                          <span
                            key={layer.color}
                            className="size-4 rounded-sm border"
                            style={{ backgroundColor: layer.color }}
                            title={layer.color}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                      <Coffee className="mt-0.5 size-3 shrink-0" />
                      {designKind === "mosaic"
                        ? "Cargá un SVG para repetirlo en mosaico sobre todo el posavasos."
                        : "Cargá un SVG con colores o vectorizá una imagen y usá «Convertir en posavasos»."}
                    </p>
                  )}
                </div>
              ) : null}

              {showsPattern ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <GroupLabel>Motivo</GroupLabel>
                      <span className="text-[11px] text-muted-foreground">
                        {PATTERN_LABELS[settings.pattern]}
                      </span>
                    </div>
                    <div className="grid max-h-52 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
                      {patternPreviews.map((preview) => {
                        const active = settings.pattern === preview.kind;
                        return (
                          <button
                            key={preview.kind}
                            type="button"
                            title={preview.label}
                            aria-label={preview.label}
                            aria-pressed={active}
                            onClick={() =>
                              updateSettings({ pattern: preview.kind })
                            }
                            className={
                              active
                                ? "flex flex-col items-center gap-1 rounded-md border border-primary bg-primary/10 p-1.5"
                                : "flex flex-col items-center gap-1 rounded-md border border-border bg-card p-1.5 hover:border-primary/40"
                            }
                          >
                            <Image
                              src={preview.url}
                              alt=""
                              width={32}
                              height={32}
                              unoptimized
                              className="size-8 rounded-sm"
                            />
                            <span className="text-[10px] leading-none">
                              {preview.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <NumberSlider
                    id="coaster-pattern-cell"
                    label="Tamaño de celda"
                    value={settings.patternCellMm}
                    min={3}
                    max={25}
                    step={0.5}
                    unit="mm"
                    onChange={(value) =>
                      updateSettings({ patternCellMm: value })
                    }
                  />

                  <NumberSlider
                    id="coaster-pattern-thickness"
                    label="Grosor"
                    value={settings.patternThicknessMm}
                    min={0.5}
                    max={6}
                    step={0.1}
                    unit="mm"
                    onChange={(value) =>
                      updateSettings({ patternThicknessMm: value })
                    }
                  />

                  <Field label="Color del patrón" htmlFor="coaster-pattern-color">
                    <input
                      id="coaster-pattern-color"
                      type="color"
                      value={settings.patternColor}
                      onChange={(event) =>
                        updateSettings({ patternColor: event.target.value })
                      }
                      className="h-8 w-full cursor-pointer rounded-md border bg-transparent"
                    />
                  </Field>
                </div>
              ) : null}

              {designKind === "none" ? (
                <Hint>
                  El posavasos queda liso. Elegí Imagen, Patrón o Mosaico para
                  agregar un diseño.
                </Hint>
              ) : null}

              {designKind === "image" || designKind === "pattern" ? (
                <div className="space-y-2 border-t pt-3">
                  <GroupLabel>Modo</GroupLabel>
                  <SegmentedControl
                    label="Modo del diseño"
                    value={settings.designMode}
                    onValueChange={(value) =>
                      updateSettings({ designMode: value })
                    }
                    columns={3}
                    options={DESIGN_MODES}
                  />
                  <Hint>
                    {settings.designMode === "raise"
                      ? "El diseño sobresale por encima de la superficie."
                      : settings.designMode === "through"
                        ? "El diseño atraviesa todas las capas y deja huecos pasantes."
                        : "El diseño queda hundido, al ras del color."}
                  </Hint>
                  {showsPattern ? (
                    <>
                      <ToggleButton
                        active={settings.designInvert}
                        onClick={() =>
                          updateSettings({
                            designInvert: !settings.designInvert,
                          })
                        }
                        className="w-full"
                      >
                        Invertir patrón
                      </ToggleButton>
                      {settings.designInvert ? (
                        <Hint>
                          La red entre las celdas es la que sobresale (o se
                          rebaja) y las celdas quedan como huecos.
                        </Hint>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </PanelSection>

            {designKind === "image" || designKind === "pattern" ? (
              <PanelSection
                icon={Move}
                title="Posición"
                summary={`${placementLabel} · ${settings.scalePercent}% · ${settings.designRotation}°`}
              >
                {settings.designMode !== "through" ? (
                  <div className="space-y-2">
                    <GroupLabel>Ubicación vertical</GroupLabel>
                    <SegmentedControl
                      label="Ubicación vertical"
                      value={settings.placement}
                      onValueChange={(value) =>
                        updateSettings({ placement: value })
                      }
                      columns={3}
                      options={PLACEMENTS}
                    />
                    {settings.placement !== "full" ? (
                      <NumberSlider
                        id="coaster-band-layers"
                        label="Capas del relieve"
                        value={settings.bandLayers}
                        min={1}
                        max={Math.max(1, settings.layers - 1)}
                        step={1}
                        decimals={0}
                        onChange={(value) =>
                          updateSettings({ bandLayers: value })
                        }
                      />
                    ) : null}
                  </div>
                ) : (
                  <Hint>
                    El diseño atraviesa todo el espesor; no hace falta elegir una
                    ubicación vertical.
                  </Hint>
                )}

                <NumberSlider
                  id="coaster-scale"
                  label="Escala del diseño"
                  value={settings.scalePercent}
                  min={20}
                  max={300}
                  step={5}
                  unit="%"
                  decimals={0}
                  hint="Podés pasar del 100%: lo que quede fuera del posavasos se recorta."
                  onChange={(value) =>
                    updateSettings({ scalePercent: value })
                  }
                />

                <NumberSlider
                  id="coaster-rotation"
                  label="Rotación del diseño"
                  value={settings.designRotation}
                  min={0}
                  max={345}
                  step={15}
                  unit="°"
                  decimals={0}
                  hint="Gira el diseño sobre el centro del posavasos."
                  onChange={(value) =>
                    updateSettings({ designRotation: value })
                  }
                />

                {designKind === "image" ? (
                  <NumberSlider
                    id="coaster-margin"
                    label="Margen desde el borde"
                    value={settings.marginMm}
                    min={0}
                    max={20}
                    step={1}
                    unit="mm"
                    decimals={0}
                    onChange={(value) => updateSettings({ marginMm: value })}
                  />
                ) : null}
              </PanelSection>
            ) : null}

            {showsMosaic ? (
              <PanelSection
                icon={Grid3x3}
                title="Mosaico"
                summary={`${TILE_LABELS[settings.mosaicKind]} · ${settings.mosaicTileMm} mm`}
              >
                {availableLayers.length === 0 ? (
                  <Hint>
                    Cargá un SVG en Diseño para armar el mosaico.
                  </Hint>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <GroupLabel>Pieza</GroupLabel>
                        <span className="text-[11px] text-muted-foreground">
                          {TILE_LABELS[settings.mosaicKind]}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {tilePreviews.map((preview) => {
                          const active = settings.mosaicKind === preview.kind;
                          return (
                            <button
                              key={preview.kind}
                              type="button"
                              title={preview.label}
                              aria-label={preview.label}
                              aria-pressed={active}
                              onClick={() =>
                                updateSettings({ mosaicKind: preview.kind })
                              }
                              className={
                                active
                                  ? "flex flex-col items-center gap-1 rounded-md border border-primary bg-primary/10 p-1.5"
                                  : "flex flex-col items-center gap-1 rounded-md border bg-card p-1.5 transition-colors hover:border-primary/50"
                              }
                            >
                              <Image
                                src={preview.url}
                                alt={preview.label}
                                width={32}
                                height={32}
                                unoptimized
                                className="size-8 rounded-sm bg-white/70"
                              />
                              <span className="text-[10px] leading-none">
                                {preview.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <NumberSlider
                      id="coaster-mosaic-tile"
                      label="Tamaño de la pieza"
                      value={settings.mosaicTileMm}
                      min={4}
                      max={40}
                      step={1}
                      unit="mm"
                      decimals={0}
                      onChange={(value) =>
                        updateSettings({ mosaicTileMm: value })
                      }
                    />

                    <NumberSlider
                      id="coaster-mosaic-gap"
                      label="Separación"
                      value={settings.mosaicGapMm}
                      min={0}
                      max={8}
                      step={0.5}
                      unit="mm"
                      onChange={(value) =>
                        updateSettings({ mosaicGapMm: value })
                      }
                    />

                    <NumberSlider
                      id="coaster-mosaic-rotation"
                      label="Rotación del mosaico"
                      value={settings.mosaicRotation}
                      min={0}
                      max={345}
                      step={15}
                      unit="°"
                      decimals={0}
                      hint="Gira el mosaico completo sobre el centro del posavasos."
                      onChange={(value) =>
                        updateSettings({ mosaicRotation: value })
                      }
                    />

                    <div className="space-y-2 border-t pt-3">
                      <GroupLabel>Modo</GroupLabel>
                      <SegmentedControl
                        label="Modo del mosaico"
                        value={settings.mosaicMode}
                        onValueChange={(value) =>
                          updateSettings({ mosaicMode: value })
                        }
                        columns={3}
                        options={DESIGN_MODES}
                      />
                      <Hint>
                        {settings.mosaicMode === "raise"
                          ? "El mosaico sobresale por encima de la superficie."
                          : settings.mosaicMode === "through"
                            ? "El mosaico atraviesa todas las capas y deja huecos pasantes."
                            : "El mosaico queda hundido, al ras del color."}
                      </Hint>
                    </div>

                    <div className="space-y-2 border-t pt-3">
                      <GroupLabel>Ubicación</GroupLabel>
                      <SegmentedControl
                        label="Ubicación del mosaico"
                        value={settings.mosaicPlacement}
                        onValueChange={(value) =>
                          updateSettings({ mosaicPlacement: value })
                        }
                        columns={3}
                        options={PLACEMENTS}
                      />
                      {settings.mosaicPlacement !== "full" ? (
                        <NumberSlider
                          id="coaster-mosaic-layers"
                          label="Capas del mosaico"
                          value={settings.mosaicLayers}
                          min={1}
                          max={Math.max(1, settings.layers - 1)}
                          step={1}
                          decimals={0}
                          onChange={(value) =>
                            updateSettings({ mosaicLayers: value })
                          }
                        />
                      ) : null}
                    </div>
                  </>
                )}
              </PanelSection>
            ) : null}

            <PanelSection
              icon={Palette}
              title="Acabado"
              summary={
                settings.borderEnabled
                  ? `${settings.baseColor} · borde ${settings.borderWidthMm.toFixed(1)} mm`
                  : settings.baseColor
              }
            >
              <Field label="Color de la base" htmlFor="coaster-base-color">
                <input
                  id="coaster-base-color"
                  type="color"
                  value={settings.baseColor}
                  onChange={(event) =>
                    updateSettings({ baseColor: event.target.value })
                  }
                  className="h-9 w-full cursor-pointer rounded-md border bg-transparent"
                />
              </Field>

              <ToggleButton
                active={settings.borderEnabled}
                onClick={() =>
                  updateSettings({ borderEnabled: !settings.borderEnabled })
                }
                icon={Square}
                className="w-full"
              >
                Borde elevado
              </ToggleButton>

              {settings.borderEnabled ? (
                <>
                  <NumberSlider
                    id="coaster-border-width"
                    label="Ancho del borde"
                    value={settings.borderWidthMm}
                    min={1}
                    max={Math.max(2, settings.widthMm / 4)}
                    step={0.5}
                    unit="mm"
                    onChange={(value) =>
                      updateSettings({ borderWidthMm: value })
                    }
                  />
                  <NumberSlider
                    id="coaster-border-layers"
                    label="Altura del borde"
                    value={settings.borderLayers}
                    min={1}
                    max={12}
                    step={1}
                    unit="capas"
                    decimals={0}
                    onChange={(value) =>
                      updateSettings({ borderLayers: value })
                    }
                  />
                </>
              ) : null}
            </PanelSection>

            <PanelSection
              icon={Download}
              title="Exportar"
              summary={
                model
                  ? `${model.colors.length + 1} filamento(s)`
                  : "STL · 3MF"
              }
              defaultOpen={false}
            >
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  disabled={!model || (!!exporting && exporting !== "stl")}
                  title="STL: geometría en un solo color (sin información de color)"
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
                  title="3MF: conserva el color de cada filamento (para imprimir a color)"
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
              <Hint>
                STL guarda solo la geometría. 3MF conserva el color de cada
                pieza para imprimir a color.
              </Hint>
            </PanelSection>

            <Separator />

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              title="Vuelve forma, tamaño y capas a los valores por defecto (no borra el diseño)"
              onClick={handleReset}
            >
              Restablecer medidas
            </Button>
          </PanelTooltips>
        </aside>
      </div>
    </div>
  );
}

function NumberSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  decimals = 1,
  onChange,
  hint,
}: {
  id?: string;
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

  const formatted = String(Number(value.toFixed(decimals)));
  const display = editing ? draft : formatted;

  const commit = () => {
    setEditing(false);
    const parsed = Number(draft);
    if (Number.isNaN(parsed)) return;
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}
