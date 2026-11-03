/**
 * Lector XML mínimo tipo SAX, suficiente para 3MF. Funciona en Web Workers
 * (donde no existe DOMParser) y en Node.
 */
export interface XmlHandler {
  open(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

const ENTITY_RE = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g;

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(ENTITY_RE, (_, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default:
        return e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10));
    }
  });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

export function parseXml(src: string, handler: XmlHandler): void {
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (handler.text && lt > i) {
      const t = src.slice(i, lt);
      if (t.trim()) handler.text(decodeEntities(t));
    }
    const c1 = src.charCodeAt(lt + 1);
    if (c1 === 63 /* ? */) {
      const e = src.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c1 === 33 /* ! */) {
      if (src.startsWith('<!--', lt)) {
        const e = src.indexOf('-->', lt + 4);
        i = e < 0 ? n : e + 3;
      } else if (src.startsWith('<![CDATA[', lt)) {
        const e = src.indexOf(']]>', lt + 9);
        if (handler.text) handler.text(src.slice(lt + 9, e < 0 ? n : e));
        i = e < 0 ? n : e + 3;
      } else {
        const e = src.indexOf('>', lt + 2);
        i = e < 0 ? n : e + 1;
      }
      continue;
    }
    if (c1 === 47 /* / */) {
      const e = src.indexOf('>', lt + 2);
      const name = src.slice(lt + 2, e < 0 ? n : e).trim();
      handler.close?.(name);
      i = e < 0 ? n : e + 1;
      continue;
    }
    // Etiqueta de apertura
    let j = lt + 1;
    while (j < n && !isSpace(src.charCodeAt(j)) && src[j] !== '>' && src[j] !== '/') j++;
    const name = src.slice(lt + 1, j);
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(src.charCodeAt(j))) j++;
      if (j >= n) break;
      const ch = src[j];
      if (ch === '>') {
        j++;
        break;
      }
      if (ch === '/') {
        selfClosing = true;
        const e = src.indexOf('>', j);
        j = e < 0 ? n : e + 1;
        break;
      }
      let k = j;
      while (k < n && src[k] !== '=' && !isSpace(src.charCodeAt(k)) && src[k] !== '>' && src[k] !== '/') k++;
      const aname = src.slice(j, k);
      while (k < n && isSpace(src.charCodeAt(k))) k++;
      if (src[k] !== '=') {
        attrs[aname] = '';
        j = k;
        continue;
      }
      k++;
      while (k < n && isSpace(src.charCodeAt(k))) k++;
      const q = src[k];
      if (q === '"' || q === "'") {
        const e = src.indexOf(q, k + 1);
        attrs[aname] = decodeEntities(src.slice(k + 1, e < 0 ? n : e));
        j = e < 0 ? n : e + 1;
      } else {
        let e = k;
        while (e < n && !isSpace(src.charCodeAt(e)) && src[e] !== '>') e++;
        attrs[aname] = decodeEntities(src.slice(k, e));
        j = e;
      }
    }
    handler.open(name, attrs, selfClosing);
    if (selfClosing) handler.close?.(name);
    i = j;
  }
}

/** Nombre local sin prefijo de espacio de nombres. */
export function localName(name: string): string {
  const c = name.indexOf(':');
  return c < 0 ? name : name.slice(c + 1);
}
