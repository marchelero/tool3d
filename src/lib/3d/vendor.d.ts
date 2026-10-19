declare module "clipper-lib" {
  interface IntPoint {
    X: number;
    Y: number;
  }
  type Paths = IntPoint[][];

  interface ClipperInstance {
    AddPaths(paths: Paths, polyType: number, closed: boolean): void;
    Execute(
      clipType: number,
      solution: Paths,
      subjFillType: number,
      clipFillType: number
    ): boolean;
  }

  interface ClipperOffsetInstance {
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
  }

  interface ClipperLibModule {
    Clipper: { new (): ClipperInstance; Area(path: IntPoint[]): number };
    Paths: { new (): Paths };
    ClipperOffset: {
      new (miterLimit: number, arcTolerance: number): ClipperOffsetInstance;
    };
    ClipType: {
      ctUnion: number;
      ctDifference: number;
      ctIntersection: number;
      ctXor: number;
    };
    PolyType: { ptSubject: number; ptClip: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number };
    JoinType: { jtRound: number; jtMiter: number };
    EndType: { etClosedPolygon: number; etClosedLine: number };
  }

  const ClipperLib: ClipperLibModule;
  export default ClipperLib;
}

declare module "opentype.js" {
  interface PathCommand {
    type: string;
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  interface OpenTypePath {
    commands: PathCommand[];
    toPathData(decimalPlaces?: number): string;
    getBoundingBox(): BoundingBox;
  }

  interface OpenTypeFont {
    unitsPerEm: number;
    numGlyphs: number;
    ascender: number;
    descender: number;
    getPath(
      text: string,
      x: number,
      y: number,
      fontSize: number,
      options?: { kerning?: boolean; letterSpacing?: number }
    ): OpenTypePath;
    getAdvanceWidth(
      text: string,
      fontSize: number,
      options?: { kerning?: boolean; letterSpacing?: number }
    ): number;
  }

  export function parse(buffer: ArrayBuffer): OpenTypeFont;
  export type { OpenTypeFont, OpenTypePath };
}

declare module "cdt2d" {
  interface Cdt2dOptions {
    exterior?: boolean;
    interior?: boolean;
    delaunay?: boolean;
  }

  const cdt2d: (
    points: number[][],
    edges: number[][],
    options?: Cdt2dOptions
  ) => number[][];

  export default cdt2d;
}
