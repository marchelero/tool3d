import { describe, expect, it } from "vitest";
import { brushCursorPose } from "./brush-cursor";

describe("brush cursor placement", () => {
  it("positions the cursor above the hit using the brush radius", () => {
    const pose = brushCursorPose([1, 2, 3], [0, 0, 2], [10, 20, 30], 5);

    expect(pose.position).toEqual([11, 22, 33.02]);
    expect(pose.normal).toEqual([0, 0, 1]);
    expect(pose.radius).toBe(5);
  });

  it("uses a finite surface normal and clamps invalid radii", () => {
    const pose = brushCursorPose([0, 0, 0], [0, 0, 0], [0, 0, 0], Number.NaN);

    expect(pose.normal).toEqual([0, 0, 1]);
    expect(pose.radius).toBe(0);
    expect(pose.position.every(Number.isFinite)).toBe(true);
  });
});
