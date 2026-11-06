export interface ScreenHandle {
  loopIndex: number;
  index: number;
  x: number;
  y: number;
}

export interface ClipSpacePoint {
  x: number;
  y: number;
  z: number;
}

export const PERIMETER_HANDLE_MARKER = {
  hitRadius: 18,
  outlineSize: 12,
  fillSize: 6,
  sizeAttenuation: false,
} as const;

export function isPerimeterHandleVisibleInViewport(point: ClipSpacePoint): boolean {
  return [point.x, point.y, point.z].every((coordinate) =>
    Number.isFinite(coordinate) && coordinate >= -1 && coordinate <= 1
  );
}

export function nearestPerimeterHandle(
  handles: readonly ScreenHandle[],
  x: number,
  y: number
): Pick<ScreenHandle, "loopIndex" | "index"> | null {
  let nearest: ScreenHandle | null = null;
  let nearestDistance: number = PERIMETER_HANDLE_MARKER.hitRadius;

  for (const handle of handles) {
    const distance = Math.hypot(handle.x - x, handle.y - y);
    if (distance <= nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }

  return nearest ? { loopIndex: nearest.loopIndex, index: nearest.index } : null;
}
