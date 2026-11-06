import { Vector3 } from "three";
import type { ModelViewPreset } from "@/components/tools/shared/model-viewer-toolbar";

export const COASTER_CAMERA_UP: [number, number, number] = [0, 0, 1];

const POLE_TILT = (3 * Math.PI) / 180;
const POLE_HORIZONTAL = Math.sin(POLE_TILT);
const POLE_VERTICAL = Math.cos(POLE_TILT);

export function coasterViewDirection(preset: ModelViewPreset): Vector3 {
  const directions: Record<ModelViewPreset, Vector3> = {
    iso: new Vector3(0.62, -0.62, 0.55).normalize(),
    front: new Vector3(0, -1, 0),
    back: new Vector3(0, 1, 0),
    left: new Vector3(-1, 0, 0),
    right: new Vector3(1, 0, 0),
    top: new Vector3(0, -POLE_HORIZONTAL, POLE_VERTICAL),
    bottom: new Vector3(0, -POLE_HORIZONTAL, -POLE_VERTICAL),
  };
  return directions[preset];
}
