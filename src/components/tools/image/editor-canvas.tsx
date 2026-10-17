"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { extractRegion } from "@/lib/image/canvas";
import type { BrushSettings, HistoryEntry } from "./types";

interface EditorCanvasProps {
  workCanvas: HTMLCanvasElement | null;
  originalCanvas: HTMLCanvasElement | null;
  brush: BrushSettings;
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

export function EditorCanvas({
  workCanvas,
  originalCanvas,
  brush,
  enabled,
  version,
  onStroke,
}: EditorCanvasProps) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<Point | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<Point | null>(null);
  const strokeStartRef = useRef<ImageData | null>(null);
  const boundsRef = useRef<Bounds | null>(null);

  const render = useCallback(() => {
    const display = displayRef.current;
    if (!display || !workCanvas) return;
    const ctx = display.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, display.width, display.height);
    ctx.drawImage(workCanvas, 0, 0);

    const hover = hoverRef.current;
    if (hover && enabled) {
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
  }, [workCanvas, enabled, brush.size]);

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

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !workCanvas) return;
    event.preventDefault();
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
    if (drawingRef.current && lastRef.current) {
      paintLine(lastRef.current, point);
      lastRef.current = point;
    }
    render();
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
    render();
  };

  if (!workCanvas) return null;

  return (
    <div
      className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-xl border p-4"
      style={CHECKERBOARD_STYLE}
    >
      <canvas
        ref={displayRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className="block h-auto max-w-full touch-none select-none rounded-md"
        style={{ cursor: enabled ? "crosshair" : "default" }}
      />
    </div>
  );
}
