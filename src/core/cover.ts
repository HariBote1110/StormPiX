import { emitDirect } from './cost.ts';
import type { DrawOp, Rgb } from './types.ts';

export interface LabelImage {
  readonly width: number;
  readonly height: number;
  readonly indices: Uint16Array;
  /** When present, zero-valued pixels are transparent and are not covered. */
  readonly changed?: Uint8Array;
}

function numberText(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

function rectCost(x: number, y: number, w: number, h: number): number {
  return `screen.drawRectF(${numberText(x)},${numberText(y)},${numberText(w)},${numberText(h)})`.length;
}

function rectangleOps(indices: ArrayLike<number>, width: number, height: number, palette: readonly Rgb[], improve: boolean, changed?: Uint8Array): DrawOp[] {
  type Rectangle = { colour: number; x: number; y: number; w: number; h: number };
  const rectangles: Rectangle[] = [];
  const active = new Map<string, Rectangle>();
  for (let y = 0; y < height; y += 1) {
    const next = new Map<string, Rectangle>();
    let x = 0;
    while (x < width) {
      if (changed && changed[y * width + x] === 0) {
        x += 1;
        continue;
      }
      const colour = indices[y * width + x] ?? 0;
      let runWidth = 1;
      while (x + runWidth < width && changed?.[y * width + x + runWidth] !== 0 && indices[y * width + x + runWidth] === colour) runWidth += 1;
      const key = `${colour}:${x}:${runWidth}`;
      const previous = active.get(key);
      if (previous && previous.y + previous.h === y) {
        previous.h += 1;
        next.set(key, previous);
      } else {
        next.set(key, { colour, x, y, w: runWidth, h: 1 });
      }
      x += runWidth;
    }
    for (const [key, rectangle] of active) if (!next.has(key)) rectangles.push(rectangle);
    active.clear();
    for (const [key, rectangle] of next) active.set(key, rectangle);
  }
  rectangles.push(...active.values());

  // Adjacent merges are accepted only when their measured call cost falls.
  // Scanline runs and identical vertical runs are already maximal, so this
  // pass is normally empty but makes the character objective explicit.
  if (improve && rectangles.length > 1) {
    const merged: Rectangle[] = [];
    const seen = new Set<number>();
    for (let index = 0; index < rectangles.length; index += 1) {
      if (seen.has(index)) continue;
      const rectangle = rectangles[index] as Rectangle;
      let bestIndex = -1;
      let bestSavings = 0;
      for (let otherIndex = index + 1; otherIndex < rectangles.length; otherIndex += 1) {
        if (seen.has(otherIndex)) continue;
        const other = rectangles[otherIndex] as Rectangle;
        if (rectangle.colour !== other.colour) continue;
        const horizontal = rectangle.y === other.y && rectangle.h === other.h && (rectangle.x + rectangle.w === other.x || other.x + other.w === rectangle.x);
        const vertical = rectangle.x === other.x && rectangle.w === other.w && (rectangle.y + rectangle.h === other.y || other.y + other.h === rectangle.y);
        if (!horizontal && !vertical) continue;
        const candidate = horizontal
          ? { x: Math.min(rectangle.x, other.x), y: rectangle.y, w: rectangle.w + other.w, h: rectangle.h }
          : { x: rectangle.x, y: Math.min(rectangle.y, other.y), w: rectangle.w, h: rectangle.h + other.h };
        const savings = rectCost(rectangle.x, rectangle.y, rectangle.w, rectangle.h) + rectCost(other.x, other.y, other.w, other.h) - rectCost(candidate.x, candidate.y, candidate.w, candidate.h);
        if (savings > bestSavings) {
          bestSavings = savings;
          bestIndex = otherIndex;
        }
      }
      if (bestIndex >= 0) {
        const other = rectangles[bestIndex] as Rectangle;
        const horizontal = rectangle.y === other.y;
        merged.push({ colour: rectangle.colour, x: horizontal ? Math.min(rectangle.x, other.x) : rectangle.x, y: horizontal ? rectangle.y : Math.min(rectangle.y, other.y), w: horizontal ? rectangle.w + other.w : rectangle.w, h: horizontal ? rectangle.h : rectangle.h + other.h });
        seen.add(bestIndex);
      } else {
        merged.push(rectangle);
      }
      seen.add(index);
    }
    rectangles.length = 0;
    rectangles.push(...merged);
  }

  const ops: DrawOp[] = [];
  for (const colour of [...new Set(rectangles.map((rectangle) => rectangle.colour))].sort((a, b) => a - b)) {
    const rgb = palette[colour] ?? [0, 0, 0];
    ops.push({ type: 'setColour', r: rgb[0], g: rgb[1], b: rgb[2] });
    for (const rectangle of rectangles) {
      if (rectangle.colour !== colour) continue;
      ops.push({ type: 'rectF', x: rectangle.x, y: rectangle.y, w: rectangle.w, h: rectangle.h });
    }
  }
  return ops;
}

/** Baseline: one horizontal run per row, with no vertical or cost-aware merge. */
export function coverScanline(image: LabelImage, palette: readonly Rgb[]): DrawOp[] {
  const ops: DrawOp[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let x = 0;
    while (x < image.width) {
      const colour = image.indices[y * image.width + x] ?? 0;
      let width = 1;
      while (x + width < image.width && image.indices[y * image.width + x + width] === colour) width += 1;
      const rgb = palette[colour] ?? [0, 0, 0];
      ops.push({ type: 'setColour', r: rgb[0], g: rgb[1], b: rgb[2] });
      ops.push({ type: 'rectF', x, y, w: width, h: 1 });
      x += width;
    }
  }
  return ops;
}

/** Largest-cheapest-first covering; its score uses emitted rectangle characters, not area. */
export function cover(image: LabelImage, palette: readonly Rgb[]): DrawOp[] {
  return rectangleOps(image.indices, image.width, image.height, palette, true, image.changed);
}

export function coverCost(ops: readonly DrawOp[]): number {
  return emitDirect(ops).length;
}
