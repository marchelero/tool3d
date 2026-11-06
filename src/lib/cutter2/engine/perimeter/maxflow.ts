import { NULL_CONTEXT, type TaskContext } from '../core/TaskContext';

const CHECKPOINT_INTERVAL = 512;

/**
 * Flujo máximo / corte mínimo (Dinic) con capacidades reales. Se usa para
 * encontrar el lazo cerrado de costo mínimo que separa una región de su
 * entorno (dualidad corte mínimo en el grafo dual ↔ ciclo separador mínimo).
 */
export class MaxFlow {
  private head: Int32Array;
  private to: number[] = [];
  private cap: number[] = [];
  private next: number[] = [];
  private level: Int32Array;
  private it: Int32Array;

  constructor(readonly n: number) {
    this.head = new Int32Array(n).fill(-1);
    this.level = new Int32Array(n);
    this.it = new Int32Array(n);
  }

  addEdge(u: number, v: number, c: number, cRev = 0): void {
    this.to.push(v);
    this.cap.push(c);
    this.next.push(this.head[u]);
    this.head[u] = this.to.length - 1;
    this.to.push(u);
    this.cap.push(cRev);
    this.next.push(this.head[v]);
    this.head[v] = this.to.length - 1;
  }

  private async bfs(s: number, t: number, eps: number, task: TaskContext): Promise<boolean> {
    const level = this.level;
    level.fill(-1);
    const q = new Int32Array(this.n);
    let qh = 0, qt = 0;
    let scanned = 0;
    q[qt++] = s;
    level[s] = 0;
    while (qh < qt) {
      const u = q[qh++];
      for (let e = this.head[u]; e >= 0; e = this.next[e]) {
        if (++scanned % CHECKPOINT_INTERVAL === 0) await task.checkpoint();
        const v = this.to[e];
        if (level[v] < 0 && this.cap[e] > eps) {
          level[v] = level[u] + 1;
          q[qt++] = v;
        }
      }
    }
    return level[t] >= 0;
  }

  /** Flujo máximo de s a t. */
  async solve(s: number, t: number, eps = 1e-12, task: TaskContext = NULL_CONTEXT): Promise<number> {
    let flow = 0;
    let scanned = 0;
    const stackNode: number[] = [];
    const stackEdge: number[] = [];
    await task.checkpoint();
    while (await this.bfs(s, t, eps, task)) {
      for (let i = 0; i < this.n; i++) {
        this.it[i] = this.head[i];
        if (++scanned % CHECKPOINT_INTERVAL === 0) await task.checkpoint();
      }
      // DFS iterativo
      for (;;) {
        stackNode.length = 0;
        stackEdge.length = 0;
        stackNode.push(s);
        let found = false;
        while (stackNode.length) {
          const u = stackNode[stackNode.length - 1];
          if (u === t) {
            found = true;
            break;
          }
          let advanced = false;
          for (; this.it[u] >= 0; this.it[u] = this.next[this.it[u]]) {
            if (++scanned % CHECKPOINT_INTERVAL === 0) await task.checkpoint();
            const e = this.it[u];
            const v = this.to[e];
            if (this.cap[e] > eps && this.level[v] === this.level[u] + 1) {
              stackNode.push(v);
              stackEdge.push(e);
              advanced = true;
              break;
            }
          }
          if (!advanced) {
            this.level[u] = -1; // nodo muerto
            stackNode.pop();
            if (stackEdge.length) {
              const e = stackEdge.pop()!;
              const w = stackNode[stackNode.length - 1];
              this.it[w] = this.next[e];
            }
          }
        }
        if (!found) break;
        let push = Infinity;
        for (const e of stackEdge) push = Math.min(push, this.cap[e]);
        for (const e of stackEdge) {
          this.cap[e] -= push;
          this.cap[e ^ 1] += push;
        }
        flow += push;
        await task.checkpoint();
        if (!Number.isFinite(push)) break;
      }
    }
    return flow;
  }

  /** Nodos alcanzables desde s en el residual (lado S del corte mínimo). */
  async sourceSide(s: number, eps = 1e-12, task: TaskContext = NULL_CONTEXT): Promise<Uint8Array> {
    const mark = new Uint8Array(this.n);
    const stack = [s];
    let scanned = 0;
    mark[s] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = this.head[u]; e >= 0; e = this.next[e]) {
        if (++scanned % CHECKPOINT_INTERVAL === 0) await task.checkpoint();
        const v = this.to[e];
        if (!mark[v] && this.cap[e] > eps) {
          mark[v] = 1;
          stack.push(v);
        }
      }
    }
    return mark;
  }
}
