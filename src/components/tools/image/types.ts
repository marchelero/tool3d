export type BrushMode = "erase" | "restore";

export interface BrushSettings {
  mode: BrushMode;
  size: number;
}

export interface HistoryEntry {
  x: number;
  y: number;
  w: number;
  h: number;
  before: ImageData;
  after: ImageData;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
