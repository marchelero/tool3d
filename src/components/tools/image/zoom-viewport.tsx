"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

const CHECKERBOARD_STYLE: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
};

export type ZoomBackground = "checker" | "white" | "dark";

const BACKGROUND_STYLES: Record<ZoomBackground, CSSProperties> = {
  checker: CHECKERBOARD_STYLE,
  white: { backgroundColor: "#ffffff" },
  dark: { backgroundColor: "#18181b" },
};

interface ZoomViewportProps {
  contentWidth: number;
  contentHeight: number;
  resetKey?: unknown;
  enableKeyboard?: boolean;
  background?: ZoomBackground;
  children: ReactNode;
}

export function ZoomViewport({
  contentWidth,
  contentHeight,
  resetKey,
  enableKeyboard = false,
  background = "checker",
  children,
}: ZoomViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastKeyRef = useRef<unknown>(resetKey);

  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || contentWidth <= 0) return;
    let resetPending = lastKeyRef.current !== resetKey;
    lastKeyRef.current = resetKey;
    const update = () => {
      const available = viewport.clientWidth - 32;
      const next = available > 0 ? Math.min(1, available / contentWidth) : 1;
      setFitScale(next);
      if (resetPending) {
        resetPending = false;
        setZoom(1);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [contentWidth, resetKey]);

  const zoomTo = useCallback(
    (next: number, focalX?: number, focalY?: number) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      const viewport = viewportRef.current;
      const scale = fitScale * zoom;
      const nextScale = fitScale * clamped;
      if (!viewport || scale <= 0 || nextScale <= 0) {
        setZoom(clamped);
        return;
      }
      const fx = focalX ?? viewport.clientWidth / 2;
      const fy = focalY ?? viewport.clientHeight / 2;
      const contentX = (viewport.scrollLeft + fx) / scale;
      const contentY = (viewport.scrollTop + fy) / scale;
      setZoom(clamped);
      requestAnimationFrame(() => {
        viewport.scrollLeft = contentX * nextScale - fx;
        viewport.scrollTop = contentY * nextScale - fy;
      });
    },
    [fitScale, zoom]
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomTo(zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoom, zoomTo]);

  useEffect(() => {
    if (!enableKeyboard) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomTo(zoom * ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomTo(zoom / ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        zoomTo(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableKeyboard, zoom, zoomTo]);

  const displayWidth = contentWidth * fitScale * zoom;
  const displayHeight = contentHeight * fitScale * zoom;

  return (
    <div className="relative">
      <div
        ref={viewportRef}
        className="max-h-[70vh] overflow-auto rounded-xl border p-4"
        style={BACKGROUND_STYLES[background]}
      >
        <div className="flex w-max min-w-full items-center justify-center">
          <div
            style={{ width: displayWidth, height: displayHeight }}
            className="shrink-0"
          >
            {children}
          </div>
        </div>
      </div>

      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => zoomTo(zoom / ZOOM_STEP)}
          aria-label="Alejar"
          title="Alejar (Ctrl + rueda)"
          disabled={zoom <= MIN_ZOOM}
        >
          <ZoomOut className="size-3.5" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => zoomTo(1)}
          className="min-w-12 justify-center tabular-nums"
          title="Ajustar a la ventana (0)"
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => zoomTo(zoom * ZOOM_STEP)}
          aria-label="Acercar"
          title="Acercar (Ctrl + rueda)"
          disabled={zoom >= MAX_ZOOM}
        >
          <ZoomIn className="size-3.5" />
        </Button>
        <Separator orientation="vertical" className="mx-0.5 h-4" />
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => zoomTo(1)}
          aria-label="Ajustar a la ventana"
          title="Ajustar a la ventana"
        >
          <Maximize2 className="size-3.5" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => zoomTo(1 / fitScale)}
          className="justify-center tabular-nums"
          title="Tamaño real (1:1)"
          disabled={fitScale >= 1}
        >
          1:1
        </Button>
      </div>
    </div>
  );
}
