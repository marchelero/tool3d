"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { extractRegion } from "@/lib/image/canvas";
import { floodFillByColor } from "@/lib/image/flood-fill";
import type { BrushSettings, HistoryEntry, Rect } from "./types";
import { ZoomViewport } from "./zoom-viewport";

type EditorTool = "brush" | "wand";

interface EditorCanvasProps {
  workCanvas: HTMLCanvasElement | null;
  originalCanvas: HTMLCanvasElement | null;
  tool: EditorTool;
  brush: BrushSettings;
  tolerance: number;
  enabled: boolean;
  version: number;
  compare?: boolean;
  cropActive?: boolean;
  cropRect?: Rect | null;
  cropAspect?: number | null;
  onCropRectChange?: (rect: Rect | null) => void;
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

export function EditorCanvas({
  workCanvas,
  originalCanvas,
  tool,
  brush,
  tolerance,
  enabled,
  version,
  compare = false,
  cropActive = false,
  cropRect = null,
  cropAspect = null,
  onCropRectChange,
  onStroke,
}: EditorCanvasProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const strokeStartRef = useRef<ImageData | null>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const cropStartRef = useRef<Point | null>(null);

  const render = useCallback(() => {
    const display = displayRef.current;
    if (!display || !workCanvas) return;
    const ctx = display.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, display.width, display.height);
    ctx.drawImage(
      compare && originalCanvas ? originalCanvas : workCanvas,
      0,
      0
    );
    const lineWidth = Math.max(1, display.width / 600);

    const hover = hoverRef.current;
    if (hover && enabled && !cropActive && tool === "brush") {
      const radius = Math.max(1, brush.size / 2);
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

    if (cropActive && cropRect && cropRect.w > 0.5 && cropRect.h > 0.5) {
      const rx = Math.max(0, cropRect.x);
      const ry = Math.max(0, cropRect.y);
      const rw = Math.min(display.width - rx, cropRect.w);
      const rh = Math.min(display.height - ry, cropRect.h);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, display.width, ry);
      ctx.fillRect(0, ry + rh, display.width, display.height - (ry + rh));
      ctx.fillRect(0, ry, rx, rh);
      ctx.fillRect(rx + rw, ry, display.width - (rx + rw), rh);
      ctx.lineWidth = lineWidth * 2;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }, [
    workCanvas,
    originalCanvas,
    compare,
    enabled,
    tool,
    brush.size,
    cropActive,
    cropRect,
  ]);

  useEffect(() => {
    const display = displayRef.current;
    if (!display || !workCanvas) return;
    if (display.width !== workCanvas.width || display.height !== workCanvas.height) {
      display.width = workCanvas.width;
      display.height = workCanvas.height;
    }
    render();
  }, [workCanvas, version, render]);

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
    if (!workCanvas) return;
    event.preventDefault();

    if (cropActive) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = getPoint(event);
      cropStartRef.current = point;
      onCropRectChange?.({ x: point.x, y: point.y, w: 0, h: 0 });
      return;
    }

    if (!enabled) return;

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

    if (cropActive) {
      if (!cropStartRef.current) return;
      const start = cropStartRef.current;
      const maxX = workCanvas?.width ?? 0;
      const maxY = workCanvas?.height ?? 0;
      const clampedX = Math.max(0, Math.min(maxX, point.x));
      const clampedY = Math.max(0, Math.min(maxY, point.y));
      const dx = clampedX - start.x;
      const dy = clampedY - start.y;
      let x = Math.min(start.x, clampedX);
      let y = Math.min(start.y, clampedY);
      let w = Math.abs(dx);
      let h = Math.abs(dy);
      if (cropAspect && (w > 0 || h > 0)) {
        if (w / cropAspect > h) {
          h = w / cropAspect;
        } else {
          w = h * cropAspect;
        }
        const signX = dx >= 0 ? 1 : -1;
        const signY = dy >= 0 ? 1 : -1;
        const maxW = signX >= 0 ? maxX - start.x : start.x;
        const maxH = signY >= 0 ? maxY - start.y : start.y;
        const scale = Math.min(1, maxW / w, maxH / h);
        w *= scale;
        h *= scale;
        x = signX >= 0 ? start.x : start.x - w;
        y = signY >= 0 ? start.y : start.y - h;
      }
      onCropRectChange?.({ x, y, w, h });
      render();
      return;
    }

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
    if (cropActive) {
      cropStartRef.current = null;
      return;
    }
    finishStroke();
  };

  const handlePointerLeave = () => {
    hoverRef.current = null;
    if (tool === "brush" && !cropActive) {
      render();
    }
  };

  if (!workCanvas) return null;

  return (
    <ZoomViewport
      contentWidth={workCanvas.width}
      contentHeight={workCanvas.height}
      resetKey={workCanvas}
      enableKeyboard={enabled && !cropActive}
      background="checker"
    >
      <canvas
        ref={displayRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className="block h-full w-full touch-none select-none"
        style={{
          cursor: cropActive
            ? "crosshair"
            : enabled
              ? "crosshair"
              : "default",
        }}
      />
    </ZoomViewport>
  );
}
