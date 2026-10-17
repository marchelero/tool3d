"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { extractRegion } from "@/lib/image/canvas";
import { floodFillByColor } from "@/lib/image/flood-fill";
import type { BrushSettings, HistoryEntry } from "./types";

type EditorTool = "brush" | "wand";

interface EditorCanvasProps {
  workCanvas: HTMLCanvasElement | null;
  originalCanvas: HTMLCanvasElement | null;
  tool: EditorTool;
  brush: BrushSettings;
  tolerance: number;
  enabled: boolean;
  version: number;
  onStroke: (entry: HistoryEntry) => void;
}

interface Point {
  x: number;
  y: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage:
    "linear-gradient(45deg, #e4e4e7 25%, transparent 25%), linear-gradient(-45deg, #e4e4e7 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e4e4e7 75%), linear-gradient(-45deg, transparent 75%, #e4e4e7 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

export function EditorCanvas({
  workCanvas,
  originalCanvas,
  tool,
  brush,
  tolerance,
  enabled,
  version,
  onStroke,
}: EditorCanvasProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const strokeStartRef = useRef<ImageData | null>(null);
  const boundsRef = useRef<Bounds | null>(null);

  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(1);

  const render = useCallback(() => {
    const display = displayRef.current;
    if (!display || !workCanvas) return;
    const ctx = display.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, display.width, display.height);
    ctx.drawImage(workCanvas, 0, 0);

    const hover = hoverRef.current;
    if (hover && enabled && tool === "brush") {
      const radius = Math.max(1, brush.size / 2);
      const lineWidth = Math.max(1, display.width / 600);
      ctx.save();
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = lineWidth * 2.5;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, radius, 0, Math.PI * 2);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.stroke();
      ctx.restore();
    }
  }, [workCanvas, enabled, tool, brush.size]);

  useEffect(() => {
    const display = displayRef.current;
    if (!display || !workCanvas) return;
    if (display.width !== workCanvas.width || display.height !== workCanvas.height) {
      display.width = workCanvas.width;
      display.height = workCanvas.height;
    }
    render();
  }, [workCanvas, version, render]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !workCanvas) return;
    let resetPending = lastCanvasRef.current !== workCanvas;
    lastCanvasRef.current = workCanvas;
    const update = () => {
      const available = viewport.clientWidth - 32;
      const next = available > 0 ? Math.min(1, available / workCanvas.width) : 1;
      setFitScale(next);
      if (resetPending) {
        resetPending = false;
        setZoom(1);
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [workCanvas]);

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
    if (!enabled) return;
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
  }, [enabled, zoom, zoomTo]);

  const getPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const display = displayRef.current;
    if (!display) return { x: 0, y: 0 };
    const rect = display.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (display.width / rect.width),
      y: (event.clientY - rect.top) * (display.height / rect.height),
    };
  };

  const paintCircle = (point: Point) => {
    if (!workCanvas || !originalCanvas) return;
    const ctx = workCanvas.getContext("2d");
    if (!ctx) return;
    const radius = Math.max(1, brush.size / 2);
    const bounds = boundsRef.current;
    if (bounds) {
      bounds.minX = Math.min(bounds.minX, point.x - radius);
      bounds.minY = Math.min(bounds.minY, point.y - radius);
      bounds.maxX = Math.max(bounds.maxX, point.x + radius);
      bounds.maxY = Math.max(bounds.maxY, point.y + radius);
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    if (brush.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fill();
    } else {
      ctx.clip();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(originalCanvas, 0, 0);
    }
    ctx.restore();
  };

  const paintLine = (from: Point, to: Point) => {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.max(1, brush.size / 5);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      paintCircle({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      });
    }
  };

  const applyWand = (point: Point) => {
    if (!workCanvas || !originalCanvas) return;
    const ctx = workCanvas.getContext("2d");
    if (!ctx) return;

    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    const source = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
    const region = floodFillByColor(source, x, y, tolerance);
    if (!region) return;

    const { mask, minX, minY, maxX, maxY } = region;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const before = ctx.getImageData(minX, minY, w, h);
    const target = ctx.getImageData(minX, minY, w, h);

    const sameSize =
      originalCanvas.width === workCanvas.width &&
      originalCanvas.height === workCanvas.height;
    const originalCtx = originalCanvas.getContext("2d");
    const original =
      sameSize && originalCtx
        ? originalCtx.getImageData(minX, minY, w, h)
        : null;

    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const globalX = minX + col;
        const globalY = minY + row;
        if (!mask[globalY * workCanvas.width + globalX]) continue;
        const index = (row * w + col) * 4;

        if (brush.mode === "restore") {
          if (!original) continue;
          target.data[index] = original.data[index];
          target.data[index + 1] = original.data[index + 1];
          target.data[index + 2] = original.data[index + 2];
          target.data[index + 3] = original.data[index + 3];
        } else {
          target.data[index] = 0;
          target.data[index + 1] = 0;
          target.data[index + 2] = 0;
          target.data[index + 3] = 0;
        }
      }
    }

    ctx.putImageData(target, minX, minY);
    const after = ctx.getImageData(minX, minY, w, h);
    onStroke({ x: minX, y: minY, w, h, before, after });
    render();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !workCanvas) return;
    event.preventDefault();

    if (tool === "wand") {
      applyWand(getPoint(event));
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    drawingRef.current = true;
    lastRef.current = point;
    hoverRef.current = point;
    const ctx = workCanvas.getContext("2d");
    if (!ctx) return;
    strokeStartRef.current = ctx.getImageData(
      0,
      0,
      workCanvas.width,
      workCanvas.height
    );
    const radius = Math.max(1, brush.size / 2);
    boundsRef.current = {
      minX: point.x - radius,
      minY: point.y - radius,
      maxX: point.x + radius,
      maxY: point.y + radius,
    };
    paintCircle(point);
    render();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getPoint(event);
    hoverRef.current = point;
    if (tool === "brush" && drawingRef.current && lastRef.current) {
      paintLine(lastRef.current, point);
      lastRef.current = point;
    }
    if (tool === "brush") {
      render();
    }
  };

  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const start = strokeStartRef.current;
    const bounds = boundsRef.current;
    strokeStartRef.current = null;
    boundsRef.current = null;
    lastRef.current = null;
    if (!start || !bounds || !workCanvas) return;

    const x = Math.max(0, Math.floor(bounds.minX));
    const y = Math.max(0, Math.floor(bounds.minY));
    const w = Math.min(workCanvas.width - x, Math.ceil(bounds.maxX) - x);
    const h = Math.min(workCanvas.height - y, Math.ceil(bounds.maxY) - y);
    if (w <= 0 || h <= 0) return;

    const before = extractRegion(start, x, y, w, h);
    const ctx = workCanvas.getContext("2d");
    if (!ctx) return;
    const after = ctx.getImageData(x, y, w, h);
    onStroke({ x, y, w, h, before, after });
  };

  const handlePointerUp = () => {
    finishStroke();
  };

  const handlePointerLeave = () => {
    hoverRef.current = null;
    if (tool === "brush") {
      render();
    }
  };

  if (!workCanvas) return null;

  const displayWidth = workCanvas.width * fitScale * zoom;

  return (
    <div className="relative">
      <div
        ref={viewportRef}
        className="max-h-[70vh] overflow-auto rounded-xl border p-4"
        style={CHECKERBOARD_STYLE}
      >
        <div className="flex w-max min-w-full items-center justify-center">
          <canvas
            ref={displayRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            className="block touch-none select-none rounded-md"
            style={{
              width: displayWidth,
              height: "auto",
              cursor: enabled ? "crosshair" : "default",
            }}
          />
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
