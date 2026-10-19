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
