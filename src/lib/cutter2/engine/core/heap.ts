/**
 * Cola de prioridad mínima (montículo binario) sobre arreglos tipados.
 * Admite entradas duplicadas: los algoritmos (Dijkstra, watershed) descartan
 * las entradas obsoletas al extraerlas.
 */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  private n = 0;

  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  push(key: number, val: number): void {
    if (this.n === this.keys.length) this.grow();
    let i = this.n++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Clave mínima (sin extraer). */
  peekKey(): number {
    return this.keys[0];
  }

  /** Extrae el valor de clave mínima. La clave queda en `lastKey`. */
  lastKey = 0;
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const topVal = vals[0];
    this.lastKey = keys[0];
    const n = --this.n;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return topVal;
  }

  private grow(): void {
    const k = new Float64Array(this.keys.length * 2);
    k.set(this.keys);
    const v = new Int32Array(this.vals.length * 2);
    v.set(this.vals);
    this.keys = k;
    this.vals = v;
  }
}
