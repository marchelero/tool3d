import type { ReactNode } from "react";
import {
  Box,
  Grid3x3,
  Maximize2,
  Minimize2,
  RefreshCw,
  Rotate3d,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export type ModelViewPreset = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";

export interface ModelViewerExtraAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
}

interface StandardModelViewerToolbarProps {
  expanded: boolean;
  onToggleExpanded: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onViewPreset: (preset: ModelViewPreset) => void;
  gridVisible: boolean;
  onToggleGrid: () => void;
  wireframeVisible: boolean;
  onToggleWireframe: () => void;
  extraActions?: ModelViewerExtraAction[];
}

const PRESETS: Array<{ id: ModelViewPreset; label: string; abbreviation: string; icon: ReactNode }> = [
  { id: "iso", label: "Vista isométrica", abbreviation: "Iso", icon: <Rotate3d className="size-4" /> },
  { id: "front", label: "Vista frontal", abbreviation: "Fr", icon: <Scan className="size-4" /> },
  { id: "back", label: "Vista posterior", abbreviation: "At", icon: <Scan className="size-4" /> },
  { id: "left", label: "Vista izquierda", abbreviation: "Iz", icon: <Scan className="size-4" /> },
  { id: "right", label: "Vista derecha", abbreviation: "De", icon: <Scan className="size-4" /> },
  { id: "top", label: "Vista superior", abbreviation: "Ar", icon: <Scan className="size-4" /> },
  { id: "bottom", label: "Vista inferior", abbreviation: "Ab", icon: <Scan className="size-4" /> },
];

export function StandardModelViewerToolbar({
  expanded,
  onToggleExpanded,
  onZoomIn,
  onZoomOut,
  onCenter,
  onViewPreset,
  gridVisible,
  onToggleGrid,
  wireframeVisible,
  onToggleWireframe,
  extraActions = [],
}: StandardModelViewerToolbarProps) {
  return (
    <div
      role="group"
      aria-label="Controles del visor 3D"
      className="pointer-events-auto absolute top-2 right-2 z-30 flex max-h-[calc(100%-1rem)] flex-col gap-1.5 overflow-y-auto overscroll-contain rounded-lg border border-border/80 bg-background/85 p-1.5 shadow-md backdrop-blur-sm"
    >
      <div role="group" aria-label="Tamaño del visor y zoom" className="flex flex-col gap-1">
        <ToolbarButton
          label={expanded ? "Restaurar visor" : "Expandir visor"}
          onClick={onToggleExpanded}
          ariaExpanded={expanded}
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </ToolbarButton>
        <ToolbarButton label="Acercar" onClick={onZoomIn}>
          <ZoomIn className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Alejar" onClick={onZoomOut}>
          <ZoomOut className="size-4" />
        </ToolbarButton>
      </div>

      <div className="mx-1 border-t" />

      <div role="group" aria-label="Vistas del modelo" className="flex flex-col gap-1">
        <ToolbarButton label="Centrar modelo" onClick={onCenter}>
          <RefreshCw className="size-4" />
        </ToolbarButton>
        {PRESETS.map((preset) => (
          <ToolbarButton key={preset.id} label={preset.label} onClick={() => onViewPreset(preset.id)}>
            <span aria-hidden="true" className="text-[10px] font-semibold leading-none">
              {preset.abbreviation}
            </span>
          </ToolbarButton>
        ))}
      </div>

      <div className="mx-1 border-t" />

      <div role="group" aria-label="Visualización del modelo" className="flex flex-col gap-1">
        <ToolbarButton
          label={gridVisible ? "Ocultar cuadrícula" : "Mostrar cuadrícula"}
          onClick={onToggleGrid}
          pressed={gridVisible}
        >
          <Grid3x3 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          label={wireframeVisible ? "Ver sólido" : "Activar alambre"}
          onClick={onToggleWireframe}
          pressed={wireframeVisible}
        >
          <Box className="size-4" />
        </ToolbarButton>
        {extraActions.map((action) => (
          <ToolbarButton
            key={action.id}
            label={action.label}
            onClick={action.onClick}
            pressed={action.active}
          >
            {action.icon}
          </ToolbarButton>
        ))}
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  pressed,
  ariaExpanded,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  ariaExpanded?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={ariaExpanded}
      title={label}
      onClick={onClick}
      className={`flex size-11 shrink-0 items-center justify-center rounded-md border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pressed ? "border-primary/50 bg-primary/15 text-primary hover:bg-primary/25" : ""}`}
    >
      {children}
    </button>
  );
}
