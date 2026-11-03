import { describe, expect, it } from "vitest";
import { redoHistory, undoHistory } from "./history";

describe("cutter operation history", () => {
  it("moves the current operation snapshot to the future on undo", () => {
    const before = ["plane-1"];
    const current = ["plane-1", "plane-2"];
    const future = [["plane-3"]];

    expect(undoHistory(current, [before], future)).toEqual({
      value: before,
      past: [],
      future: [current, ...future],
    });
  });

  it("restores the next future snapshot on redo", () => {
    const current = ["plane-1"];
    const next = ["plane-1", "plane-2"];

    expect(redoHistory(current, [[]], [next])).toEqual({
      value: next,
      past: [[], current],
      future: [],
    });
  });

  it("does not mutate input stacks and respects the 40-step limit", () => {
    const current = ["current"];
    const past = Array.from({ length: 41 }, (_, id) => [String(id)]);
    const future = Array.from({ length: 41 }, (_, id) => [String(id)]);

    const undone = undoHistory(current, past, []);
    const redone = redoHistory(current, [], future);

    expect(undone?.past).toHaveLength(40);
    expect(redone?.future).toHaveLength(40);
    expect(past).toHaveLength(41);
    expect(future).toHaveLength(41);
  });
});
