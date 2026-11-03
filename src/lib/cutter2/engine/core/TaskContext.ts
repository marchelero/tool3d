/**
 * Contexto de tarea: progreso y cancelación cooperativa.
 *
 * Las operaciones largas llaman a `checkpoint()` entre fases. Ese punto cede
 * el control al bucle de eventos del worker, de modo que un mensaje de
 * cancelación pueda procesarse, y lanza CancelledError si corresponde.
 */
export class CancelledError extends Error {
  constructor() {
    super('Operación cancelada');
    this.name = 'CancelledError';
  }
}

export interface TaskContext {
  /** Informa progreso (0..1) con un mensaje opcional para la interfaz. */
  progress(fraction: number, message?: string): void;
  /** Cede el control y verifica la cancelación. */
  checkpoint(message?: string, fraction?: number): Promise<void>;
  readonly cancelled: boolean;
  throwIfCancelled(): void;
}

class NullContext implements TaskContext {
  readonly cancelled = false;
  progress(): void {}
  async checkpoint(): Promise<void> {}
  throwIfCancelled(): void {}
}

export const NULL_CONTEXT: TaskContext = new NullContext();

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class WorkerTaskContext implements TaskContext {
  private _cancelled = false;
  private lastYield = 0;
  constructor(private readonly onProgress: (fraction: number, message?: string) => void) {}

  get cancelled(): boolean {
    return this._cancelled;
  }

  cancel(): void {
    this._cancelled = true;
  }

  progress(fraction: number, message?: string): void {
    this.onProgress(Math.max(0, Math.min(1, fraction)), message);
  }

  async checkpoint(message?: string, fraction?: number): Promise<void> {
    if (message !== undefined || fraction !== undefined) this.progress(fraction ?? -1, message);
    const now = Date.now();
    if (now - this.lastYield > 15) {
      this.lastYield = now;
      await yieldNow();
    }
    this.throwIfCancelled();
  }

  throwIfCancelled(): void {
    if (this._cancelled) throw new CancelledError();
  }
}

/** Error geométrico con un mensaje apto para la interfaz y detalles técnicos. */
export class GeometryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'GeometryError';
  }
}
