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
import { toast } from "sonner";
import {
  ArrowLeft,
  Ban,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleDot,
  Coffee,
  Diamond,
  Download,
  FileUp,
  GripVertical,
  Heart,
  Hexagon,
  Image as ImageIcon,
  Loader2,
  Move,
  Octagon,
  Palette,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Scan,
  Scaling,
  Shapes,
  Shield,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  Type,
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
  DEFAULT_KEYCHAIN_SETTINGS,
  buildKeychain,
  type KeychainDesignKind,
  type KeychainDesignMode,
  type KeychainModel,
  type KeychainSettings,
  type KeychainTextLine,
} from "@/lib/3d/keychain";
import { SHAPE_LABELS, type KeychainShape } from "@/lib/3d/shapes";
import { KEYCHAIN_FONTS, buildTextLayers, loadFont } from "@/lib/3d/text";
import {
  export3mf,
  exportStl,
  piecesToMeshes,
  type MeshPiece,
} from "@/lib/3d/mesh";
import {
  clearPosavasosHandoff,
  handoffSnapshot,
  parsePosavasosHandoff,
  type HandoffLayer,
} from "@/lib/3d/handoff";
import { baseName } from "@/lib/image/download";
import { splitSvgByColor } from "@/lib/image/trace";
import { ModelViewer, type RingDrag } from "../posavasos/model-viewer";

const DESCRIPTION =
  "Diseña un llavero plano listo para imprimir: elegí la forma, sumá una imagen vectorizada o hasta 3 líneas de texto, definí el estilo y la anilla, y exportá el modelo.";

const BUILD_DELAY = 200;

const PANEL_IDS = ["shape", "ring", "border", "design", "placement"] as const;

type PanelTab = "base" | "design";

interface BuiltModel {
  key: string;
  model: KeychainModel;
  meshes: MeshPiece[];
}

const subscribeHandoff = () => () => {};

const SHAPES: { value: KeychainShape; icon: LucideIcon }[] = [
  { value: "round", icon: Circle },
  { value: "square", icon: Square },
  { value: "rectangle", icon: RectangleHorizontal },
  { value: "diamond", icon: Diamond },
  { value: "star", icon: Star },
  { value: "hex", icon: Hexagon },
  { value: "oct", icon: Octagon },
  { value: "heart", icon: Heart },
  { value: "shield", icon: Shield },
  { value: "silhouette", icon: Scan },
];

const DESIGN_KINDS: {
  value: KeychainDesignKind;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "none", label: "Sin diseño", icon: Ban },
  { value: "image", label: "Imagen", icon: ImageIcon },
  { value: "text", label: "Texto", icon: Type },
];

const DESIGN_MODES: {
  value: KeychainDesignMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "flat",
    label: "Al ras",
    hint: "El diseño queda integrado, a la misma altura que la superficie.",
  },
  {
    value: "engrave",
    label: "Grabado",
    hint: "El diseño queda hundido todo el rebaje: el color va al fondo del hueco.",
  },
  {
    value: "raise",
    label: "Relieve",
    hint: "El diseño sobresale por encima de la superficie.",
  },
  {
    value: "layered",
    label: "Por capa-color",
    hint: "Cada color del diseño se apila en su propia capa, en relieve.",
  },
];

const SIZE_PRESETS = [40, 50, 60, 80];

const RING_PLACEMENTS: {
  value: KeychainSettings["ringPlacement"];
  label: string;
}[] = [
  { value: "tab", label: "Asa externa" },
  { value: "inside", label: "Dentro" },
];

const HEIGHT_SHAPES: KeychainShape[] = [
  "rectangle",
  "diamond",
  "star",
  "heart",
  "shield",
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

export function KeychainTool() {
  const rawHandoff = useSyncExternalStore(
    subscribeHandoff,
    handoffSnapshot,
    () => ""
  );
  const handoff = useMemo(() => parsePosavasosHandoff(rawHandoff), [rawHandoff]);

  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [svgLayers, setSvgLayers] = useState<HandoffLayer[] | null>(null);
  const [svgName, setSvgName] = useState<string | null>(null);
  const [settings, setSettings] = useState<KeychainSettings>(
    DEFAULT_KEYCHAIN_SETTINGS
  );
  const [built, setBuilt] = useState<BuiltModel | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"stl" | "3mf" | null>(null);
  const [panel, setPanel] = useState<PanelTab>("base");
  const [expanded, setExpanded] = useState(false);
  const [ringDragActive, setRingDragActive] = useState(false);
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
  const imageLayers = useMemo(
    () => svgLayers ?? handoffLayers ?? [],
    [handoffLayers, svgLayers]
  );

  const designKind: KeychainDesignKind =
    settings.designKind === "none" && imageLayers.length > 0
      ? "image"
      : settings.designKind;

  const resolvedSettings = useMemo<KeychainSettings>(
    () => ({ ...settings, designKind }),
    [designKind, settings]
  );

  const layerColors = useMemo(
    () =>
      designKind === "text"
        ? settings.textLines.map((line) => line.color)
        : imageLayers.map((layer) => layer.color),
    [designKind, imageLayers, settings.textLines]
  );

  const [layerOrder, setLayerOrder] = useState<number[]>([]);
  const orderedIndexes = useMemo(() => {
    const count = layerColors.length;
    const kept = layerOrder.filter((index) => index >= 0 && index < count);
    const missing = Array.from({ length: count }, (_, i) => i).filter(
      (index) => !kept.includes(index)
    );
    return [...kept, ...missing];
  }, [layerColors.length, layerOrder]);

  const sourceName = useMemo(
    () => svgName ?? (handoff ? baseName(handoff.name) : "llavero"),
    [handoff, svgName]
  );

  const buildKey = useMemo(
    () =>
      `${JSON.stringify(resolvedSettings)}|${imageLayers.length}|${orderedIndexes.join(",")}|${sourceName}`,
    [imageLayers.length, orderedIndexes, resolvedSettings, sourceName]
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let layers: HandoffLayer[] = [];
          if (designKind === "image") {
            layers = imageLayers;
          } else if (designKind === "text") {
            const font = await loadFont(settings.fontId);
            layers = buildTextLayers(font, settings.textLines, {
              letterSpacingMm: settings.textLetterSpacingMm,
              lineGapMm: settings.textLineGapMm,
            });
          }
          if (cancelled) return;
          layers = orderedIndexes
            .map((index) => layers[index])
            .filter((layer): layer is HandoffLayer => Boolean(layer));
          const generated = buildKeychain(resolvedSettings, layers);
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
      })();
    }, BUILD_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    buildKey,
    designKind,
    imageLayers,
    orderedIndexes,
    resolvedSettings,
    settings.fontId,
    settings.textLineGapMm,
    settings.textLines,
    settings.textLetterSpacingMm,
  ]);

  const model = built?.model ?? null;
  const meshes = built?.meshes ?? [];
  const building = built?.key !== buildKey && buildError === null;

  const updateSettings = useCallback((patch: Partial<KeychainSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const ringCenterX = model?.ringCenter?.x ?? null;
  const ringCenterY = model?.ringCenter?.y ?? null;

  const ringDrag = useMemo<RingDrag | undefined>(() => {
    if (!settings.ringEnabled || ringCenterX === null || ringCenterY === null) {
      return undefined;
    }
    return {
      active: ringDragActive,
      x: ringCenterX,
      y: ringCenterY,
      radius: settings.ringHoleMm / 2,
      wall: settings.ringWallMm,
      onCommit: (x, y) => updateSettings({ ringPosX: x, ringPosY: y }),
    };
  }, [
    ringCenterX,
    ringCenterY,
    ringDragActive,
    settings.ringEnabled,
    settings.ringHoleMm,
    settings.ringWallMm,
    updateSettings,
  ]);

  const updateTextLine = useCallback(
    (index: number, patch: Partial<KeychainTextLine>) => {
      setSettings((current) => ({
        ...current,
        textLines: current.textLines.map((line, i) =>
          i === index ? { ...line, ...patch } : line
        ),
      }));
    },
    []
  );

  const addTextLine = useCallback(() => {
    setSettings((current) =>
      current.textLines.length >= 3
        ? current
        : {
            ...current,
            textLines: [
              ...current.textLines,
              { text: "Texto", sizeMm: 10, color: "#2b3440" },
            ],
          }
    );
  }, []);

  const removeTextLine = useCallback((index: number) => {
    setSettings((current) => ({
      ...current,
      textLines:
        current.textLines.length <= 1
          ? current.textLines
          : current.textLines.filter((_, i) => i !== index),
    }));
  }, []);

  const handleNew = useCallback(() => {
    clearPosavasosHandoff();
    setHandoffDismissed(true);
    setSvgLayers(null);
    setSvgName(null);
    setBuildError(null);
    setSettings(DEFAULT_KEYCHAIN_SETTINGS);
  }, []);

  const handleReset = useCallback(() => {
    setSettings((current) => ({
      ...current,
      shape: DEFAULT_KEYCHAIN_SETTINGS.shape,
      widthMm: DEFAULT_KEYCHAIN_SETTINGS.widthMm,
      heightMm: DEFAULT_KEYCHAIN_SETTINGS.heightMm,
      cornerMm: DEFAULT_KEYCHAIN_SETTINGS.cornerMm,
      starPoints: DEFAULT_KEYCHAIN_SETTINGS.starPoints,
      starInnerRatio: DEFAULT_KEYCHAIN_SETTINGS.starInnerRatio,
      layers: DEFAULT_KEYCHAIN_SETTINGS.layers,
      layerHeightMm: DEFAULT_KEYCHAIN_SETTINGS.layerHeightMm,
      bandLayers: DEFAULT_KEYCHAIN_SETTINGS.bandLayers,
      scalePercent: DEFAULT_KEYCHAIN_SETTINGS.scalePercent,
      designRotation: DEFAULT_KEYCHAIN_SETTINGS.designRotation,
      ringHoleMm: DEFAULT_KEYCHAIN_SETTINGS.ringHoleMm,
      ringWallMm: DEFAULT_KEYCHAIN_SETTINGS.ringWallMm,
      ringBossLayers: DEFAULT_KEYCHAIN_SETTINGS.ringBossLayers,
      ringPlacement: DEFAULT_KEYCHAIN_SETTINGS.ringPlacement,
      ringBoss: DEFAULT_KEYCHAIN_SETTINGS.ringBoss,
      ringPosX: DEFAULT_KEYCHAIN_SETTINGS.ringPosX,
      ringPosY: DEFAULT_KEYCHAIN_SETTINGS.ringPosY,
      fillHoles: DEFAULT_KEYCHAIN_SETTINGS.fillHoles,
      borderWidthMm: DEFAULT_KEYCHAIN_SETTINGS.borderWidthMm,
      borderLayers: DEFAULT_KEYCHAIN_SETTINGS.borderLayers,
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
          await exportStl(model.pieces, `${sourceName}-llavero`);
        } else {
          await export3mf(model.pieces, `${sourceName}-llavero`);
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

  const usingHandoff =
    !svgLayers && imageLayers.length > 0 && !handoffDismissed;
  const showsImage = designKind === "image";
  const showsText = designKind === "text";
  const showsDesign = designKind !== "none";

  const widthLabel =
    settings.shape === "round" ||
    settings.shape === "hex" ||
    settings.shape === "oct"
      ? "Diámetro"
      : settings.shape === "square"
        ? "Lado"
        : "Ancho";
  const hasHeight = HEIGHT_SHAPES.includes(settings.shape);

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
          <p className="text-sm font-medium">Llavero · vista ampliada</p>
        ) : (
          <div>
            <Badge>Llaveros</Badge>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Llavero
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {DESCRIPTION}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {showsImage && imageLayers.length > 0
                ? `${imageLayers.length} color(es) desde ${sourceName}`
                : showsText
                  ? `${settings.textLines.length} línea(s) de texto`
                  : "Modelo en blanco"}
              {model ? ` · ${model.totalHeightMm.toFixed(2)} mm de alto` : null}
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
          <div className={expanded ? "relative min-h-0 flex-1" : "relative"}>
            <ModelViewer
              meshes={meshes}
              widthMm={settings.widthMm}
              heightMm={model?.totalHeightMm ?? 0}
              designMm={model?.designWidthMm ?? 0}
              expanded={expanded}
              onToggleExpanded={() => setExpanded((value) => !value)}
              ringDrag={ringDrag}
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
                    label="Estilo"
                    value={
                      DESIGN_MODES.find(
                        (mode) => mode.value === settings.designMode
                      )?.label ?? ""
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
                    3MF usa {model.colors.length + 1} filamentos (base + colores);
                    STL va en un solo color.
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

        <div
          className={
            expanded
              ? "flex min-h-0 flex-col overflow-y-auto rounded-xl border bg-card p-4 shadow-xl"
              : "space-y-4 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto lg:pr-1"
          }
        >
          <Tabs
            value={panel}
            onValueChange={(value: string) => setPanel(value as PanelTab)}
            className="gap-4"
          >
            <div
              className={
                expanded
                  ? "flex items-center gap-2"
                  : "sticky -top-1 z-10 -mx-1 flex items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur"
              }
            >
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
              {showsDesign ? (
                <div className="space-y-2.5 rounded-xl border bg-card p-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Palette className="size-3.5" />
                    </span>
                    <span className="flex-1 text-sm font-medium">Estilo</span>
                    <span className="text-[11px] text-muted-foreground">
                      {
                        DESIGN_MODES.find(
                          (mode) => mode.value === settings.designMode
                        )?.label
                      }
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
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
                        onClick={() => updateSettings({ designMode: mode.value })}
                      >
                        {mode.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {DESIGN_MODES.find(
                      (mode) => mode.value === settings.designMode
                    )?.hint}
                  </p>
                </div>
              ) : null}

              <Panel
                id="design"
                icon={Type}
                title="Diseño"
                summary={
                  showsImage && imageLayers.length > 0
                    ? `${imageLayers.length} color(es)`
                    : showsText
                      ? `${settings.textLines.length} línea(s)`
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

                {showsDesign ? (
                  <div className="space-y-1.5">
                    <Button
                      size="sm"
                      variant={settings.fillHoles ? "default" : "outline"}
                      aria-pressed={settings.fillHoles}
                      className="w-full"
                      onClick={() =>
                        updateSettings({ fillHoles: !settings.fillHoles })
                      }
                    >
                      {settings.fillHoles
                        ? "Huecos rellenados"
                        : "Mantener huecos"}
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      Rellena los huecos internos del diseño (útil en letras o
                      formas finas).
                    </p>
                  </div>
                ) : null}

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
                      {imageLayers.length > 0 ? "Cambiar SVG" : "Cargar SVG"}
                    </Button>
                    {imageLayers.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-muted-foreground">
                          {usingHandoff
                            ? `Enviado desde Imagen: ${imageLayers.length} color(es) de ${sourceName}.`
                            : `${imageLayers.length} color(es) desde ${sourceName}.`}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {imageLayers.map((layer) => (
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
                        Cargá un SVG con colores o vectorizá una imagen y usá
                        &quot;Convertir en llavero&quot;.
                      </p>
                    )}
                  </div>
                ) : null}

                {showsText ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Fuente</Label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {KEYCHAIN_FONTS.map((font) => (
                          <Button
                            key={font.id}
                            size="sm"
                            variant={
                              settings.fontId === font.id ? "default" : "outline"
                            }
                            aria-pressed={settings.fontId === font.id}
                            className="px-1 text-[11px]"
                            onClick={() => updateSettings({ fontId: font.id })}
                          >
                            {font.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Líneas de texto</Label>
                      {settings.textLines.map((line, index) => (
                        <div
                          key={index}
                          className="space-y-1.5 rounded-lg border p-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <Input
                              value={line.text}
                              placeholder="Texto"
                              onChange={(event) =>
                                updateTextLine(index, { text: event.target.value })
                              }
                              className="h-8"
                            />
                            <input
                              type="color"
                              value={line.color}
                              aria-label="Color del texto"
                              onChange={(event) =>
                                updateTextLine(index, { color: event.target.value })
                              }
                              className="h-8 w-9 shrink-0 cursor-pointer rounded-md border bg-transparent"
                            />
                            {settings.textLines.length > 1 ? (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label="Quitar línea"
                                onClick={() => removeTextLine(index)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            ) : null}
                          </div>
                          <NumberSlider
                            id={`keychain-line-${index}-size`}
                            label="Tamaño"
                            value={line.sizeMm}
                            min={4}
                            max={30}
                            step={0.5}
                            unit="mm"
                            onChange={(value) =>
                              updateTextLine(index, { sizeMm: value })
                            }
                          />
                        </div>
                      ))}
                      {settings.textLines.length < 3 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={addTextLine}
                        >
                          <Plus className="size-4" />
                          Agregar línea
                        </Button>
                      ) : null}
                    </div>

                    <NumberSlider
                      id="keychain-text-spacing"
                      label="Separación entre letras"
                      value={settings.textLetterSpacingMm}
                      min={0}
                      max={6}
                      step={0.25}
                      unit="mm"
                      onChange={(value) =>
                        updateSettings({ textLetterSpacingMm: value })
                      }
                    />
                    <NumberSlider
                      id="keychain-text-gap"
                      label="Separación entre líneas"
                      value={settings.textLineGapMm}
                      min={0}
                      max={12}
                      step={0.5}
                      unit="mm"
                      onChange={(value) =>
                        updateSettings({ textLineGapMm: value })
                      }
                    />
                  </div>
                ) : null}

                {layerColors.length > 1 ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Orden de capas</Label>
                    <p className="text-[11px] text-muted-foreground">
                      Arrastrá para ordenar (aplica a &quot;Por capa-color&quot;).
                      El primero va abajo; el último, arriba.
                    </p>
                    <LayerOrderList
                      colors={layerColors}
                      order={orderedIndexes}
                      onReorder={setLayerOrder}
                    />
                  </div>
                ) : null}
              </Panel>

              {showsDesign ? (
                <Panel
                  id="placement"
                  icon={Scaling}
                  title="Posición y escala"
                  summary={`${settings.scalePercent}% · ${settings.designRotation}°`}
                  open={openPanels.placement}
                  onToggle={togglePanel}
                >
                  {settings.designMode === "raise" ||
                  settings.designMode === "flat" ||
                  settings.designMode === "engrave" ? (
                    <NumberSlider
                      id="keychain-band-layers"
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

                  <NumberSlider
                    id="keychain-scale"
                    label="Tamaño del diseño"
                    value={settings.scalePercent}
                    min={20}
                    max={300}
                    step={5}
                    unit="%"
                    decimals={0}
                    hint="100% = lo más grande que entra. Podés pasar del 100%: lo que quede fuera del llavero se recorta."
                    onChange={(value) => updateSettings({ scalePercent: value })}
                  />

                  <NumberSlider
                    id="keychain-rotation"
                    label="Rotación del diseño"
                    value={settings.designRotation}
                    min={0}
                    max={345}
                    step={15}
                    unit="°"
                    decimals={0}
                    hint="Gira el diseño sobre el centro del llavero."
                    onChange={(value) =>
                      updateSettings({ designRotation: value })
                    }
                  />
                </Panel>
              ) : null}
            </TabsContent>

            <TabsContent value="base" className="space-y-2">
              <Panel
                id="shape"
                icon={Shapes}
                title="Forma y medidas"
                summary={`${SHAPE_LABELS[settings.shape]} · ${settings.widthMm.toFixed(0)} mm · ${settings.layers} capas`}
                open={openPanels.shape}
                onToggle={togglePanel}
              >
                <div className="grid grid-cols-5 gap-1.5">
                  {SHAPES.map((shape) => {
                    const ShapeIcon = shape.icon;
                    const selected = settings.shape === shape.value;
                    return (
                      <button
                        key={shape.value}
                        type="button"
                        aria-pressed={selected}
                        aria-label={SHAPE_LABELS[shape.value]}
                        title={SHAPE_LABELS[shape.value]}
                        onClick={() => updateSettings({ shape: shape.value })}
                        className={`flex h-11 items-center justify-center rounded-md border transition-colors ${
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
                <p className="text-[11px] text-muted-foreground">
                  {SHAPE_LABELS[settings.shape]}
                  {settings.shape === "silhouette"
                    ? " · la forma sigue el contorno de la imagen."
                    : null}
                </p>

                <NumberSlider
                  id="keychain-width"
                  label={widthLabel}
                  value={settings.widthMm}
                  min={20}
                  max={120}
                  step={1}
                  unit="mm"
                  decimals={0}
                  onChange={(value) => updateSettings({ widthMm: value })}
                />

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    Tamaño:
                  </span>
                  {SIZE_PRESETS.map((preset) => {
                    const active = Math.round(settings.widthMm) === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={active}
                        onClick={() => updateSettings({ widthMm: preset })}
                        className={`rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors ${
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

                {hasHeight ? (
                  <NumberSlider
                    id="keychain-height"
                    label="Alto"
                    value={settings.heightMm}
                    min={20}
                    max={120}
                    step={1}
                    unit="mm"
                    decimals={0}
                    onChange={(value) => updateSettings({ heightMm: value })}
                  />
                ) : null}

                {settings.shape === "square" ||
                settings.shape === "rectangle" ? (
                  <NumberSlider
                    id="keychain-corner"
                    label="Redondeo de puntas"
                    value={settings.cornerMm}
                    min={0}
                    max={Math.max(
                      1,
                      Math.min(settings.widthMm, settings.heightMm) / 2 - 1
                    )}
                    step={0.5}
                    unit="mm"
                    onChange={(value) => updateSettings({ cornerMm: value })}
                  />
                ) : null}

                {settings.shape === "star" ? (
                  <>
                    <NumberSlider
                      id="keychain-star-points"
                      label="Puntas"
                      value={settings.starPoints}
                      min={3}
                      max={12}
                      step={1}
                      decimals={0}
                      onChange={(value) =>
                        updateSettings({ starPoints: value })
                      }
                    />
                    <NumberSlider
                      id="keychain-star-inner"
                      label="Profundidad de las puntas"
                      value={settings.starInnerRatio}
                      min={0.2}
                      max={0.85}
                      step={0.05}
                      decimals={2}
                      onChange={(value) =>
                        updateSettings({ starInnerRatio: value })
                      }
                    />
                  </>
                ) : null}

                {settings.shape === "silhouette" ? (
                  <NumberSlider
                    id="keychain-silhouette-offset"
                    label="Reborde de la silueta"
                    value={settings.silhouetteOffsetMm}
                    min={1}
                    max={10}
                    step={0.5}
                    unit="mm"
                    onChange={(value) =>
                      updateSettings({ silhouetteOffsetMm: value })
                    }
                  />
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="keychain-layers" className="text-xs">
                      Capas totales
                    </Label>
                    <Input
                      id="keychain-layers"
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
                    <Label htmlFor="keychain-layer-height" className="text-xs">
                      Altura de capa (mm)
                    </Label>
                    <Input
                      id="keychain-layer-height"
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
              </Panel>

              <Panel
                id="ring"
                icon={CircleDot}
                title="Anilla"
                summary={
                  settings.ringEnabled
                    ? `agujero ${settings.ringHoleMm.toFixed(1)} mm`
                    : "sin anilla"
                }
                open={openPanels.ring}
                onToggle={togglePanel}
              >
                <Button
                  size="sm"
                  variant={settings.ringEnabled ? "default" : "outline"}
                  aria-pressed={settings.ringEnabled}
                  className="w-full"
                  onClick={() =>
                    updateSettings({ ringEnabled: !settings.ringEnabled })
                  }
                >
                  {settings.ringEnabled ? "Anilla activada" : "Agregar anilla"}
                </Button>
                {settings.ringEnabled ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ubicación</Label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {RING_PLACEMENTS.map((option) => (
                          <Button
                            key={option.value}
                            size="sm"
                            variant={
                              settings.ringPlacement === option.value
                                ? "default"
                                : "outline"
                            }
                            aria-pressed={
                              settings.ringPlacement === option.value
                            }
                            onClick={() => {
                              setRingDragActive(false);
                              updateSettings({
                                ringPlacement: option.value,
                                ringPosX: null,
                                ringPosY: null,
                              });
                            }}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <NumberSlider
                      id="keychain-ring-hole"
                      label="Diámetro del agujero"
                      value={settings.ringHoleMm}
                      min={2}
                      max={10}
                      step={0.5}
                      unit="mm"
                      onChange={(value) =>
                        updateSettings({ ringHoleMm: value })
                      }
                    />
                    <NumberSlider
                      id="keychain-ring-wall"
                      label="Margen hasta el borde"
                      value={settings.ringWallMm}
                      min={1}
                      max={8}
                      step={0.5}
                      unit="mm"
                      onChange={(value) =>
                        updateSettings({ ringWallMm: value })
                      }
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm"
                        variant={ringDragActive ? "default" : "outline"}
                        aria-pressed={ringDragActive}
                        onClick={() => setRingDragActive((value) => !value)}
                      >
                        <Move className="size-4" />
                        {ringDragActive ? "Moviendo" : "Mover anilla"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          settings.ringPosX === null &&
                          settings.ringPosY === null
                        }
                        onClick={() => {
                          setRingDragActive(false);
                          updateSettings({ ringPosX: null, ringPosY: null });
                        }}
                      >
                        <RotateCcw className="size-4" />
                        Centrar
                      </Button>
                    </div>
                    {ringDragActive ? (
                      <p className="text-[11px] text-muted-foreground">
                        Mové el mouse sobre el modelo: verás la silueta del
                        círculo. Hacé clic para colocar la anilla.
                      </p>
                    ) : null}
                    <Button
                      size="sm"
                      variant={settings.ringBoss ? "default" : "outline"}
                      aria-pressed={settings.ringBoss}
                      className="w-full"
                      onClick={() =>
                        updateSettings({ ringBoss: !settings.ringBoss })
                      }
                    >
                      {settings.ringBoss ? "Aro activado" : "Agregar aro"}
                    </Button>
                    {settings.ringBoss ? (
                      <NumberSlider
                        id="keychain-ring-boss-layers"
                        label="Altura del aro"
                        value={settings.ringBossLayers}
                        min={1}
                        max={8}
                        step={1}
                        unit="capas"
                        decimals={0}
                        onChange={(value) =>
                          updateSettings({ ringBossLayers: value })
                        }
                      />
                    ) : null}
                  </>
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
                  <Label htmlFor="keychain-base-color" className="text-xs">
                    Color de la base
                  </Label>
                  <input
                    id="keychain-base-color"
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
                    <NumberSlider
                      id="keychain-border-width"
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
                  ) : null}
                  {settings.borderEnabled ? (
                    <NumberSlider
                      id="keychain-border-layers"
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
            title="Vuelve forma, tamaño y capas a los valores por defecto (no borra el diseño)"
            onClick={handleReset}
          >
            Restablecer medidas
          </Button>
        </div>
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
      {hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

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

function LayerOrderList({
  colors,
  order,
  onReorder,
}: {
  colors: string[];
  order: number[];
  onReorder: (next: number[]) => void;
}) {
  const dragPos = useRef<number | null>(null);

  const move = (from: number, to: number) => {
    const next = order.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onReorder(next);
  };

  return (
    <div className="space-y-1">
      {order.map((layerIndex, pos) => {
        let hint = "";
        if (pos === 0) hint = "abajo";
        else if (pos === order.length - 1) hint = "arriba";
        return (
          <div
            key={layerIndex}
            draggable
            onDragStart={() => {
              dragPos.current = pos;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (dragPos.current !== null && dragPos.current !== pos) {
                move(dragPos.current, pos);
              }
              dragPos.current = null;
            }}
            className="flex cursor-grab items-center gap-2 rounded-md border bg-card px-2 py-1.5 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className="size-4 shrink-0 rounded-sm border"
              style={{ backgroundColor: colors[layerIndex] }}
            />
            <span className="text-[11px]">Nivel {pos + 1}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              {hint}
            </span>
          </div>
        );
      })}
    </div>
  );
}
