export interface HandoffLayer {
  color: string;
  svg: string;
}

export interface PosavasosHandoff {
  name: string;
  width: number;
  height: number;
  layers: HandoffLayer[];
  savedAt: number;
}

const STORAGE_KEY = "tool3d:handoff:posavasos";

export function parsePosavasosHandoff(raw: string): PosavasosHandoff | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PosavasosHandoff;
    if (!parsed || !Array.isArray(parsed.layers) || parsed.layers.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function handoffSnapshot(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writePosavasosHandoff(data: PosavasosHandoff): boolean {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readPosavasosHandoff(): PosavasosHandoff | null {
  return parsePosavasosHandoff(handoffSnapshot());
}

export function clearPosavasosHandoff(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sin almacenamiento disponible
  }
}
