import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { COASTER_CAMERA_UP, coasterViewDirection } from "./model-viewer-view";

describe("coasterViewDirection", () => {
  const up = new Vector3(...COASTER_CAMERA_UP);

  it("mantiene todas las vistas separadas del eje up de OrbitControls", () => {
    const presets = ["iso", "front", "back", "left", "right", "top", "bottom"] as const;

    for (const preset of presets) {
      expect(Math.abs(coasterViewDirection(preset).dot(up))).toBeLessThan(0.999);
    }
  });

  it("conserva las vistas superior/inferior con la inclinación correcta", () => {
    expect(coasterViewDirection("top").z).toBeGreaterThan(0.99);
    expect(coasterViewDirection("bottom").z).toBeLessThan(-0.99);
    expect(COASTER_CAMERA_UP).toEqual([0, 0, 1]);
  });
});
