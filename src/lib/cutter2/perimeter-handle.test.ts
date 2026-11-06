import { describe, expect, it } from "vitest";
import {
  isPerimeterHandleVisibleInViewport,
  nearestPerimeterHandle,
  PERIMETER_HANDLE_MARKER,
  type ScreenHandle,
} from "./perimeter-handle";

describe("perimeter handle markers", () => {
  it("keeps visible markers screen-sized when zoom changes", () => {
    expect(PERIMETER_HANDLE_MARKER.sizeAttenuation).toBe(false);
    expect(PERIMETER_HANDLE_MARKER.outlineSize).toBeGreaterThan(2.4);
    expect(PERIMETER_HANDLE_MARKER.fillSize).toBeGreaterThan(2.4);
  });
});

describe("nearestPerimeterHandle", () => {
  it("picks the closest handle inside the screen-space hit radius", () => {
    const handles: ScreenHandle[] = [
      { loopIndex: 0, index: 1, x: 104, y: 100 },
      { loopIndex: 1, index: 3, x: 111, y: 100 },
    ];

    expect(nearestPerimeterHandle(handles, 100, 100)).toEqual({ loopIndex: 0, index: 1 });
  });

  it("does not grab a handle outside the screen-space hit radius", () => {
    const handles: ScreenHandle[] = [{ loopIndex: 0, index: 0, x: 119, y: 100 }];

    expect(nearestPerimeterHandle(handles, 100, 100)).toBeNull();
  });
});

describe("isPerimeterHandleVisibleInViewport", () => {
  it("accepts points inside the clip-space bounds, including the edges", () => {
    expect(isPerimeterHandleVisibleInViewport({ x: -1, y: 1, z: 0 })).toBe(true);
    expect(isPerimeterHandleVisibleInViewport({ x: 1, y: -1, z: 1 })).toBe(true);
  });

  it("rejects points behind the camera or outside the visible frustum", () => {
    expect(isPerimeterHandleVisibleInViewport({ x: 0, y: 0, z: -1.01 })).toBe(false);
    expect(isPerimeterHandleVisibleInViewport({ x: 0, y: 0, z: 1.01 })).toBe(false);
    expect(isPerimeterHandleVisibleInViewport({ x: 1.01, y: 0, z: 0 })).toBe(false);
    expect(isPerimeterHandleVisibleInViewport({ x: Number.NaN, y: 0, z: 0 })).toBe(false);
  });
});
