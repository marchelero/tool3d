export type BrushVec3 = [number, number, number];

export function brushCursorPose(
  point: BrushVec3,
  normal: BrushVec3,
  pieceOffset: BrushVec3,
  radius: number
): { position: BrushVec3; normal: BrushVec3; radius: number } {
  const length = Math.hypot(...normal);
  const unitNormal: BrushVec3 = length > 1e-12
    ? [normal[0] / length, normal[1] / length, normal[2] / length]
    : [0, 0, 1];
  const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  const lift = Math.max(0.02, safeRadius * 0.002);

  return {
    position: [
      point[0] + pieceOffset[0] + unitNormal[0] * lift,
      point[1] + pieceOffset[1] + unitNormal[1] * lift,
      point[2] + pieceOffset[2] + unitNormal[2] * lift,
    ],
    normal: unitNormal,
    radius: safeRadius,
  };
}
