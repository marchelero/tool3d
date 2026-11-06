export interface RenderScheduler {
  invalidate(): void;
  dispose(): void;
}

export function createRenderScheduler(
  draw: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (frame: number) => void = cancelAnimationFrame
): RenderScheduler {
  let frame: number | null = null;
  let disposed = false;

  return {
    invalidate() {
      if (disposed || frame !== null) return;
      frame = requestFrame(() => {
        frame = null;
        if (!disposed) draw();
      });
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancelFrame(frame);
      frame = null;
    },
  };
}

export function viewerPixelRatio(devicePixelRatio: number): number {
  return Math.min(Math.max(devicePixelRatio || 1, 1), 1.5);
}
