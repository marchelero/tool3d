import { describe, expect, it, vi } from "vitest";
import { createRenderScheduler, viewerPixelRatio } from "./render-scheduler";

describe("viewer render scheduler", () => {
  it("coalesces invalidations into a single animation frame", () => {
    const callbacks: FrameRequestCallback[] = [];
    const draw = vi.fn();
    const scheduler = createRenderScheduler(
      draw,
      (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      vi.fn()
    );

    scheduler.invalidate();
    scheduler.invalidate();
    expect(callbacks).toHaveLength(1);
    expect(draw).not.toHaveBeenCalled();

    callbacks[0](0);
    expect(draw).toHaveBeenCalledOnce();
  });

  it("does not draw a queued frame after disposal", () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    const draw = vi.fn();
    const scheduler = createRenderScheduler(
      draw,
      (callback) => {
        callbacks.push(callback);
        return 7;
      },
      cancelFrame
    );

    scheduler.invalidate();
    scheduler.dispose();
    callbacks[0](0);

    expect(cancelFrame).toHaveBeenCalledWith(7);
    expect(draw).not.toHaveBeenCalled();
    expect(() => scheduler.invalidate()).not.toThrow();
    expect(callbacks).toHaveLength(1);
  });

  it("caps high-density canvas rendering without lowering standard displays", () => {
    expect(viewerPixelRatio(1)).toBe(1);
    expect(viewerPixelRatio(1.25)).toBe(1.25);
    expect(viewerPixelRatio(2)).toBe(1.5);
    expect(viewerPixelRatio(0)).toBe(1);
  });
});
