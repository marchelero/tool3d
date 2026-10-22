const TAG_PATTERN = /<[^>]*>/g;

export interface SvgShape {
  fill: string | null;
  markup: string;
  groups: string[];
}

function tagName(tag: string): string | null {
  const match = tag.match(/^<\s*\/?\s*([a-zA-Z][\w:-]*)/);
  return match ? match[1].toLowerCase() : null;
}

function isClosingTag(tag: string): boolean {
  return /^<\s*\//.test(tag);
}

function isSelfClosingTag(tag: string): boolean {
  return /\/>\s*$/.test(tag);
}

function attributeValue(tag: string, name: string): string | null {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = tag.match(pattern);
  return match ? match[1] : null;
}

function elementFill(tag: string): string | null {
  const fill = attributeValue(tag, "fill");
  if (fill !== null) return fill;
  const style = attributeValue(tag, "style");
  if (!style) return null;
  const match = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i);
  return match ? match[1].trim() : null;
}

function groupAttributes(tag: string): string {
  return tag
    .replace(/^<\s*g\b/i, "")
    .replace(/\/?>\s*$/, "")
    .trim();
}

export function collectSvgShapes(svg: string): SvgShape[] {
  const shapes: SvgShape[] = [];
  const groupStack: string[] = [];
  const fillStack: (string | null)[] = [];
  TAG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(svg)) !== null) {
    const tag = match[0];
    const name = tagName(tag);
    if (name === "g") {
      if (isClosingTag(tag)) {
        groupStack.pop();
        fillStack.pop();
        continue;
      }
      const fill = elementFill(tag) ?? fillStack[fillStack.length - 1] ?? null;
      if (!isSelfClosingTag(tag)) {
        groupStack.push(groupAttributes(tag));
        fillStack.push(fill);
      }
      continue;
    }

    if (name !== "path" && name !== "rect") continue;
    if (isClosingTag(tag)) continue;

    const fill = elementFill(tag) ?? fillStack[fillStack.length - 1] ?? null;
    shapes.push({
      fill,
      markup: tag,
      groups: [...groupStack],
    });
  }

  return shapes;
}

export function filterSvgShapes(
  svg: string,
  keep: (fill: string | null) => boolean
): string {
  const fillStack: (string | null)[] = [];
  let skippedClosing: string | null = null;
  let result = "";
  let lastIndex = 0;
  TAG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TAG_PATTERN.exec(svg)) !== null) {
    result += svg.slice(lastIndex, match.index);
    lastIndex = TAG_PATTERN.lastIndex;
    const tag = match[0];
    const name = tagName(tag);
    const closing = isClosingTag(tag);

    if (name === "g") {
      if (closing) {
        fillStack.pop();
      } else if (!isSelfClosingTag(tag)) {
        fillStack.push(
          elementFill(tag) ?? fillStack[fillStack.length - 1] ?? null
        );
      }
      result += tag;
      continue;
    }

    if (name !== "path" && name !== "rect") {
      result += tag;
      continue;
    }

    if (closing) {
      if (skippedClosing === name) {
        skippedClosing = null;
      } else {
        result += tag;
      }
      continue;
    }

    const fill = elementFill(tag) ?? fillStack[fillStack.length - 1] ?? null;
    if (keep(fill)) {
      result += tag;
    } else if (!isSelfClosingTag(tag)) {
      skippedClosing = name;
    }
  }

  result += svg.slice(lastIndex);
  return result;
}

export function removeEmptyGroups(svg: string): string {
  const emptyGroup = /<g\b[^>]*>\s*<\/g>/gi;
  let result = svg;
  let previous = "";
  while (result !== previous) {
    previous = result;
    result = result.replace(emptyGroup, "");
  }
  return result;
}
