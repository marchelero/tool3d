declare module "@jscad/stl-serializer" {
  export const mimeType: string;
  export function serialize(
    options: { binary?: boolean },
    ...objects: unknown[]
  ): ArrayBuffer[];
  const serializer: {
    mimeType: string;
    serialize: typeof serialize;
  };
  export default serializer;
}

declare module "@jscad/3mf-serializer" {
  export const mimeType: string;
  export function serialize(
    options: {
      unit?: string;
      defaultcolor?: [number, number, number, number];
    },
    ...objects: unknown[]
  ): ArrayBuffer[];
  const serializer: {
    mimeType: string;
    serialize: typeof serialize;
  };
  export default serializer;
}
