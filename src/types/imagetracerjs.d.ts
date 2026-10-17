declare module "imagetracerjs" {
  export interface PaletteColor {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  export interface TraceOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    rightangleenhance?: boolean;
    colorsampling?: 0 | 1 | 2;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    layering?: number;
    strokewidth?: number;
    linefilter?: boolean;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
    blurradius?: number;
    blurdelta?: number;
    pal?: PaletteColor[];
  }

  export interface ImageTracerStatic {
    imagedataToSVG(
      imgData: ImageData,
      options?: string | TraceOptions
    ): string;
    imagedataToTracedata(
      imgData: ImageData,
      options?: string | TraceOptions
    ): unknown;
    imageToSVG(
      url: string,
      callback: (svg: string) => void,
      options?: string | TraceOptions
    ): void;
    appendSVGString(svg: string, parentId: string): void;
  }

  const ImageTracer: ImageTracerStatic;
  export default ImageTracer;
}
