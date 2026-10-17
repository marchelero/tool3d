"use client";

import { useMemo, useState } from "react";
import { Grid2x2, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { svgToDataUrl } from "@/lib/image/trace";
import { ZoomViewport, type ZoomBackground } from "./zoom-viewport";

interface SvgPreviewProps {
  svg: string;
  width: number;
  height: number;
  resetKey?: unknown;
}

const BACKGROUND_OPTIONS: {
  value: ZoomBackground;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "checker", label: "Fondo con cuadros (transparente)", icon: Grid2x2 },
  { value: "white", label: "Fondo blanco", icon: Sun },
  { value: "dark", label: "Fondo oscuro", icon: Moon },
];

export function SvgPreview({ svg, width, height, resetKey }: SvgPreviewProps) {
  const src = useMemo(() => svgToDataUrl(svg), [svg]);
  const [background, setBackground] = useState<ZoomBackground>("checker");

  return (
    <div className="relative">
      <ZoomViewport
        contentWidth={width}
        contentHeight={height}
        resetKey={resetKey}
        enableKeyboard
        background={background}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Vista previa del SVG"
          className="block h-full w-full select-none"
        />
      </ZoomViewport>

      <div className="absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
        {BACKGROUND_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <Button
              key={option.value}
              size="icon-xs"
              variant={background === option.value ? "default" : "ghost"}
              onClick={() => setBackground(option.value)}
              aria-label={option.label}
              aria-pressed={background === option.value}
              title={option.label}
            >
              <Icon className="size-3.5" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
