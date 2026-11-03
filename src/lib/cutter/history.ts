export interface HistoryTransition<T> {
  value: T;
  past: T[];
  future: T[];
}

const HISTORY_LIMIT = 40;

export function undoHistory<T>(
  current: T,
  past: T[],
  future: T[]
): HistoryTransition<T> | null {
  const value = past[past.length - 1];
  if (value === undefined) return null;

  return {
    value,
    past: past.slice(0, -1),
    future: [current, ...future].slice(0, HISTORY_LIMIT),
  };
}

export function redoHistory<T>(
  current: T,
  past: T[],
  future: T[]
): HistoryTransition<T> | null {
  const value = future[0];
  if (value === undefined) return null;

  return {
    value,
    past: [...past, current].slice(-HISTORY_LIMIT),
    future: future.slice(1),
  };
}
