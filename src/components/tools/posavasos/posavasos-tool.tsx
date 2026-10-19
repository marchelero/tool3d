"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  Coffee,
  Download,
  FileUp,
  Grid3x3,
  Hexagon,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Octagon,
  Palette,
  RotateCcw,
  Scaling,
  Shapes,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ModelViewer } from "./model-viewer";

const DESCRIPTION =
  "Diseña un posavasos listo para imprimir: elegí la forma y el tamaño, sumá una imagen vectorizada o un patrón (grabado o en relieve), agregá un borde y exportá el modelo.";

const BUILD_DELAY = 200;

type PanelTab = "base" | "design";

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
  const [panel, setPanel] = useState<PanelTab>("base");
  const [expanded, setExpanded] = useState(false);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PANEL_IDS.map((id) => [id, true]))
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const togglePanel = useCallback((id: string) => {
    setOpenPanels((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const allPanelsOpen = PANEL_IDS.every((id) => openPanels[id]);

  const toggleAllPanels = useCallback(() => {
    setOpenPanels((current) => {
      const everyOpen = PANEL_IDS.every((id) => current[id]);
      return Object.fromEntries(PANEL_IDS.map((id) => [id, !everyOpen]));
    });
  }, []);

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

  const bandLayers = useMemo(
    () =>
      settings.placement === "full"
        ? settings.layers
        : Math.min(settings.bandLayers, settings.layers),
    [settings.bandLayers, settings.layers, settings.placement]
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

  const usingHandoff = !svgLayers && availableLayers.length > 0 && !handoffDismissed;
  const showsImage = designKind === "image" || designKind === "mosaic";
  const showsPattern = designKind === "pattern";
  const showsMosaic = designKind === "mosaic";

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
          {expanded ? null : (
            <Button size="sm" variant="outline" onClick={handleNew}>
              <RotateCcw className="size-4" />
              Nuevo
            </Button>
          )}
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
              ) : null}
            </>
          )}
        </div>

        <div
          className={
            expanded
              ? "flex min-h-0 flex-col overflow-y-auto rounded-xl border bg-card p-4 shadow-xl"
              : "space-y-4"
          }
        >
          <Tabs
            value={panel}
            onValueChange={(value: string) => setPanel(value as PanelTab)}
            className="gap-4"
          >
            <div className="flex items-center gap-2">
              <TabsList className="grid h-9 flex-1 grid-cols-2">
                <TabsTrigger value="base">Base</TabsTrigger>
                <TabsTrigger value="design">Diseño</TabsTrigger>
              </TabsList>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={toggleAllPanels}
                aria-label={
                  allPanelsOpen
                    ? "Contraer todas las secciones"
                    : "Expandir todas las secciones"
                }
                title={allPanelsOpen ? "Contraer todo" : "Expandir todo"}
              >
                {allPanelsOpen ? (
                  <ChevronsDownUp className="size-4" />
                ) : (
                  <ChevronsUpDown className="size-4" />
                )}
              </Button>
            </div>

            <TabsContent value="design" className="space-y-2">
              <Panel
                id="design"
                icon={Palette}
                title="Diseño"
                summary={
                  designKind === "mosaic"
                    ? `${TILE_LABELS[settings.mosaicKind]} ×${settings.mosaicTileMm} mm`
                    : designKind === "image" && availableLayers.length > 0
                      ? `${availableLayers.length} color(es)`
                      : designKind === "pattern"
                        ? PATTERN_LABELS[settings.pattern]
                        : "en blanco"
                }
                open={openPanels.design}
                onToggle={togglePanel}
              >
                <div className="grid grid-cols-3 gap-1.5">
              {DESIGN_KINDS.map((kind) => {
                const KindIcon = kind.icon;
                const selected = designKind === kind.value;
                return (
                  <button
                    key={kind.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateSettings({ designKind: kind.value })}
                    className={`flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-[11px] transition-colors ${
                      selected
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <KindIcon className="size-4" />
                    {kind.label}
                  </button>
                );
              })}
            </div>

            {showsImage ? (
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
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">
                      {designKind === "mosaic"
                        ? `${availableLayers.length} color(es) para el mosaico.`
                        : usingHandoff
                          ? `Enviado desde Imagen: ${availableLayers.length} color(es) de ${sourceName}.`
                          : `${availableLayers.length} color(es) desde ${sourceName}.`}
                    </p>
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
                  <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <Coffee className="mt-0.5 size-3 shrink-0" />
                    {designKind === "mosaic"
                      ? "Cargá un SVG para repetirlo en mosaico sobre todo el posavasos."
                      : "Cargá un SVG con colores o vectorizá una imagen y usá \"Convertir en posavasos\"."}
                  </p>
                )}
              </div>
            ) : null}

            {showsPattern ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Patrón</Label>
                    <span className="text-[11px] text-muted-foreground">
                      {PATTERN_LABELS[settings.pattern]}
                    </span>
                  </div>
                  <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto pr-1">
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

            {showsPattern || designKind === "image" ? (
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
                {showsPattern && settings.designMode !== "through" ? (
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
                {settings.designInvert && showsPattern ? (
                  <p className="text-[11px] text-muted-foreground">
                    Ahora la red entre las celdas es la que sobresale (o se
                    rebaja) y las celdas quedan como huecos.
                  </p>
                ) : null}
              </div>
            ) : null}
              </Panel>
              {designKind === "none" || showsMosaic ? null : (
                <Panel
                  id="placement"
                  icon={Scaling}
                  title="Posición y escala"
                  summary={`${settings.scalePercent}% · ${settings.designRotation}°`}
                  open={openPanels.placement}
                  onToggle={togglePanel}
                >
                  {settings.designMode === "through" ? null : (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ubicación vertical</Label>
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
                            aria-pressed={
                              settings.placement === placement.value
                            }
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
                        <div className="space-y-1.5 pt-1.5">
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
                  )}

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

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Rotación del diseño</Label>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {settings.designRotation}°
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={345}
                      step={15}
                      value={[settings.designRotation]}
                      onValueChange={([value]) =>
                        updateSettings({ designRotation: value })
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Gira el diseño sobre el centro del posavasos.
                    </p>
                  </div>
                </Panel>
              )}

              {showsMosaic ? (
                <Panel
                  id="mosaic"
                  icon={LayoutGrid}
                  title="Mosaico"
                  summary={`${TILE_LABELS[settings.mosaicKind]} · ${settings.mosaicTileMm} mm · ${
                    DESIGN_MODES.find(
                      (mode) => mode.value === settings.mosaicMode
                    )?.label ?? ""
                  }`}
                  open={openPanels.mosaic}
                  onToggle={togglePanel}
                >
                  {availableLayers.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Cargá un SVG para armar el mosaico.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Tipo de mosaico</Label>
                          <span className="text-[11px] text-muted-foreground">
                            {TILE_LABELS[settings.mosaicKind]}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {tilePreviews.map((preview) => {
                            const active =
                              settings.mosaicKind === preview.kind;
                            return (
                              <button
                                key={preview.kind}
                                type="button"
                                title={preview.label}
                                aria-label={preview.label}
                                aria-pressed={active}
                                onClick={() =>
                                  updateSettings({
                                    mosaicKind: preview.kind,
                                  })
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

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Tamaño de la pieza</Label>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {settings.mosaicTileMm} mm
                          </span>
                        </div>
                        <Slider
                          min={4}
                          max={40}
                          step={1}
                          value={[settings.mosaicTileMm]}
                          onValueChange={([value]) =>
                            updateSettings({ mosaicTileMm: value })
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Separación</Label>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {settings.mosaicGapMm} mm
                          </span>
                        </div>
                        <Slider
                          min={0}
                          max={8}
                          step={0.5}
                          value={[settings.mosaicGapMm]}
                          onValueChange={([value]) =>
                            updateSettings({ mosaicGapMm: value })
                          }
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Rotación del mosaico</Label>
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {settings.mosaicRotation}°
                          </span>
                        </div>
                        <Slider
                          min={0}
                          max={345}
                          step={15}
                          value={[settings.mosaicRotation]}
                          onValueChange={([value]) =>
                            updateSettings({ mosaicRotation: value })
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Gira el mosaico completo sobre el centro del
                          posavasos.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Modo del mosaico</Label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {DESIGN_MODES.map((mode) => (
                            <Button
                              key={mode.value}
                              size="sm"
                              variant={
                                settings.mosaicMode === mode.value
                                  ? "default"
                                  : "outline"
                              }
                              aria-pressed={settings.mosaicMode === mode.value}
                              onClick={() =>
                                updateSettings({ mosaicMode: mode.value })
                              }
                            >
                              {mode.label}
                            </Button>
                          ))}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {settings.mosaicMode === "raise"
                            ? "El mosaico sobresale por encima de la superficie."
                            : settings.mosaicMode === "through"
                              ? "El mosaico atraviesa todas las capas y deja huecos pasantes."
                              : "El mosaico queda hundido, al ras del color."}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Ubicación del mosaico</Label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {PLACEMENTS.map((placement) => (
                            <Button
                              key={placement.value}
                              size="sm"
                              variant={
                                settings.mosaicPlacement === placement.value
                                  ? "default"
                                  : "outline"
                              }
                              aria-pressed={
                                settings.mosaicPlacement === placement.value
                              }
                              className="px-1 text-[11px]"
                              onClick={() =>
                                updateSettings({
                                  mosaicPlacement: placement.value,
                                })
                              }
                            >
                              {placement.label}
                            </Button>
                          ))}
                        </div>
                        {settings.mosaicPlacement !== "full" ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">
                                Capas del mosaico
                              </Label>
                              <span className="text-[11px] tabular-nums text-muted-foreground">
                                {Math.min(
                                  settings.mosaicLayers,
                                  settings.layers
                                )}
                              </span>
                            </div>
                            <Slider
                              min={1}
                              max={Math.max(1, settings.layers - 1)}
                              step={1}
                              value={[settings.mosaicLayers]}
                              onValueChange={([value]) =>
                                updateSettings({ mosaicLayers: value })
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    </>
                  )}
                </Panel>
              ) : null}
            </TabsContent>

            <TabsContent value="base" className="space-y-2">
              <Panel
                id="shape"
                icon={Shapes}
                title="Forma y medidas"
                summary={`${SHAPES.find((shape) => shape.value === settings.shape)?.label} · ${settings.widthMm.toFixed(0)} mm · ${settings.layers} capas`}
                open={openPanels.shape}
                onToggle={togglePanel}
              >
                <div className="grid grid-cols-4 gap-1.5">
                  {SHAPES.map((shape) => {
                    const ShapeIcon = shape.icon;
                    const selected = settings.shape === shape.value;
                    return (
                      <button
                        key={shape.value}
                        type="button"
                        aria-pressed={selected}
                        aria-label={shape.label}
                        title={shape.label}
                        onClick={() => updateSettings({ shape: shape.value })}
                        className={`flex h-12 items-center justify-center rounded-md border transition-colors ${
                          selected
                            ? "border-primary/60 bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <ShapeIcon className="size-5" />
                      </button>
                    );
                  })}
                </div>

                {settings.shape === "square" ? (
                  <div className="space-y-1.5">
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
                    onValueChange={([value]) =>
                      updateSettings({ widthMm: value })
                    }
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
              </Panel>

              <Panel
                id="border"
                icon={Palette}
                title="Color y borde"
                summary={
                  settings.borderEnabled
                    ? `${settings.baseColor} · borde ${settings.borderWidthMm.toFixed(1)} mm`
                    : settings.baseColor
                }
                open={openPanels.border}
                onToggle={togglePanel}
              >
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

                <div className="space-y-1.5">
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
                      ? "Borde activado"
                      : "Agregar borde elevado"}
                  </Button>
                  {settings.borderEnabled ? (
                    <div className="space-y-1.5 pt-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Ancho del borde</Label>
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
                  ) : null}
                  {settings.borderEnabled ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Altura del borde</Label>
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
                  ) : null}
                </div>
              </Panel>
            </TabsContent>
          </Tabs>

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

const PANEL_IDS = [
  "shape",
  "border",
  "design",
  "placement",
  "mosaic",
] as const;

function Panel({
  id,
  title,
  icon: Icon,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  summary?: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(id)}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </span>
        <span className="flex-1 text-sm font-medium">{title}</span>
        {summary ? (
          <span className="shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">
            {summary}
          </span>
        ) : null}
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {children}
        </div>
      ) : null}
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
