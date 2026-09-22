import type { Bitmap, DrawOp, PixelCertainty } from './types.ts';
import { CERTAIN, UNCERTAIN } from './types.ts';

// Rasterisation semantics ported from PhySim2/media/raster.js (MIT, © Shannon-Toppo).

export interface RenderedWithMask {
  readonly bitmap: Bitmap;
  readonly certainty: Uint8Array;
  readonly mask: Uint8Array;
}

/** Kept for API compatibility; the documented rule below determines the value. */
export const CIRCLE_SEGMENT_TABLE: readonly { readonly minimumRadius: number; readonly segments: number }[] = [
  { minimumRadius: 0, segments: 8 },
];

// CG pixel 4x5 mono glyphs (ASCII 0x20..0x7e) are kept as a compact table.
// Ported from PhySim2/media/pixelFont.js (MIT, © Shannon-Toppo).
// This is the complete printable-ASCII source table; unknown glyphs use tofu.
const PIXEL_FONT: Record<string, readonly string[]> = {
  ' ': ['....','....','....','....','....'],
  A:['.##.','#..#','####','#..#','#..#'], B:['###.','#..#','###.','#..#','###.'], C:['.##.','#..#','#...','#..#','.##.'], D:['###.','#..#','#..#','#..#','###.'], E:['####','#...','###.','#...','####'], F:['####','#...','###.','#...','#...'], G:['.##.','#...','#.##','#..#','.##.'], H:['#..#','#..#','####','#..#','#..#'], I:['.#..','.#..','.#..','.#..','.#..'], J:['...#','...#','...#','#..#','.##.'], K:['#..#','#.#.','##..','#.#.','#..#'], L:['#...','#...','#...','#...','####'], M:['#..#','####','#..#','#..#','#..#'], N:['#..#','##.#','#.##','#..#','#..#'], O:['.##.','#..#','#..#','#..#','.##.'], P:['###.','#..#','###.','#...','#...'], Q:['.##.','#..#','#..#','#.##','.###'], R:['###.','#..#','###.','#.#.','#..#'], S:['.###','#...','.##.','...#','###.'], T:['###.','.#..','.#..','.#..','.#..'], U:['#..#','#..#','#..#','#..#','.##.'], V:['#.#.','#.#.','#.#.','#.#.','.#..'], W:['#..#','#..#','#..#','####','#..#'], X:['#..#','#..#','.##.','#..#','#..#'], Y:['#.#.','#.#.','.#..','.#..','.#..'], Z:['####','...#','.##.','#...','####'],
  0:['.##.','#.##','##.#','#..#','.##.'], 1:['..#.','.##.','..#.','..#.','..#.'], 2:['.##.','#..#','..#.','.#..','####'], 3:['###.','...#','.##.','...#','###.'], 4:['#..#','#..#','####','...#','...#'], 5:['####','#...','###.','...#','###.'], 6:['.##.','#...','###.','#..#','.##.'], 7:['####','...#','..#.','..#.','..#.'], 8:['.##.','#..#','.##.','#..#','.##.'], 9:['.##.','#..#','.###','...#','.##.'],
  '.':['....','....','....','....','.#..'], ',':['....','....','....','.#..','#...'], ':':['....','.#..','....','.#..','....'], ';':['....','.#..','....','.#..','.#..'], '!':['.#..','.#..','.#..','....','.#..'], '?':['##..','..#.','.#..','....','.#..'], "'":['.#..','.#..','....','....','....'], '"':['#.#.','#.#.','....','....','....'], '+':['....','.#..','###.','.#..','....'], '-':['....','....','###.','....','....'], '*':['#..#','.##.','####','.##.','#..#'], '/':['..#.','..#.','.#..','#...','#...'], '\\':['#...','#...','.#..','..#.','..#.'], '`':['.#..','..#.','....','....','....'], '=':['....','###.','....','###.','....'], '%':['##..','...#','.##.','#...','..##'], '(':['..#.','.#..','.#..','.#..','..#.'], ')':['.#..','..#.','..#.','..#.','.#..'], '[':['.##.','.#..','.#..','.#..','.##.'], ']':['.##.','..#.','..#.','..#.', '.##.'], '{':['.##.','.#..','##..','.#..','.##.'], '}':['##..','.#..','.##.','.#..','##..'], '<':['..#.','.#..','#...','.#..','..#.'], '>':['#...','.#..','..#.','.#..','#...'], '_':['....','....','....','....','####'], '|':['.#..','.#..','....','.#..','.#..'], '#':['#.#.','####','#.#.','####','#.#.'], '^':['.#..','#.#.','....','....','....'], '~':['....','.#.#','#.#.','....','....'], '@':['.##.','#..#','#.##','#...','.###'], '$':['.###','#.#.','.##.','.#.#','###.'], '&':['.#..','#.#.','.#..','#.#.','.#.#'],
};
const TOFU_GLYPH = ['####', '#..#', '#..#', '#..#', '####'] as const;

export function floorCoord(value: number): number {
  const limit = 1_073_741_824;
  return Math.floor(Math.max(-limit, Math.min(limit, value)));
}
export const floor_coord = floorCoord;

function roundCoord(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function validateDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

function clippedRange(start: number, end: number, limit: number): [number, number] | undefined {
  const low = Math.max(0, Math.ceil(Math.min(start, end)));
  const high = Math.min(limit - 1, Math.floor(Math.max(start, end)));
  return low <= high ? [low, high] : undefined;
}

function blendChannel(source: number, alpha: number, destination: number): number {
  return Math.floor((source * alpha + destination * (255 - alpha) + 127) / 255);
}

function renderInternal(ops: readonly DrawOp[], width: number, height: number): RenderedWithMask {
  validateDimension(width, 'width');
  validateDimension(height, 'height');
  const data = new Uint8ClampedArray(width * height * 4);
  const certainty = new Uint8Array(width * height);
  certainty.fill(CERTAIN);
  let colour = { r: 0, g: 0, b: 0, a: 255 };

  const paintPixel = (x: number, y: number, state: PixelCertainty = CERTAIN): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixel = y * width + x;
    const offset = pixel * 4;
    const alpha = Math.max(0, Math.min(255, Math.round(colour.a)));
    data[offset] = alpha === 255 ? colour.r : blendChannel(colour.r, alpha, data[offset] ?? 0);
    data[offset + 1] = alpha === 255 ? colour.g : blendChannel(colour.g, alpha, data[offset + 1] ?? 0);
    data[offset + 2] = alpha === 255 ? colour.b : blendChannel(colour.b, alpha, data[offset + 2] ?? 0);
    data[offset + 3] = blendChannel(alpha, alpha, data[offset + 3] ?? 0);
    certainty[pixel] = CERTAIN;
  };

  const fillRect = (x: number, y: number, w: number, h: number): void => {
    if (![x, y, w, h].every(Number.isFinite)) return;
    const x0 = Math.round(x * 256) / 256, x1 = Math.round((x + w) * 256) / 256;
    const y0 = Math.round(y * 256) / 256, y1 = Math.round((y + h) * 256) / 256;
    if (x0 === x1 || y0 === y1) return;
    const rangeX = clippedRange(Math.ceil(Math.min(x0, x1)), Math.ceil(Math.max(x0, x1)) - 1, width);
    const rangeY = clippedRange(Math.floor(Math.min(y0, y1)), Math.floor(Math.max(y0, y1)) - 1, height);
    if (!rangeX || !rangeY) return;
    for (let py = rangeY[0]; py <= rangeY[1]; py += 1) for (let px = rangeX[0]; px <= rangeX[1]; px += 1) paintPixel(px, py);
  };

  // Ported from PhySim2/media/raster.js (MIT, © Shannon-Toppo): exact 1/256 diamond-exit line rule.
  const drawLine = (x1: number, y1: number, x2: number, y2: number): void => {
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    if (Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2)) > 65_536) {
      let low = 0, high = 1;
      const dx = x2 - x1, dy = y2 - y1;
      for (const [p, q] of [[-dx, x1 + 64], [dx, width + 64 - x1], [-dy, y1 + 64], [dy, height + 64 - y1]] as const) {
        if (p === 0) { if (q < 0) return; continue; }
        const t = q / p;
        if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low > high) return;
      }
      const originalX = x1, originalY = y1;
      x1 = originalX + dx * low;
      y1 = originalY + dy * low;
      x2 = originalX + dx * high;
      y2 = originalY + dy * high;
    }
    const X1 = Math.round(x1 * 256), Y1 = Math.round(y1 * 256), X2 = Math.round(x2 * 256), Y2 = Math.round(y2 * 256);
    if (X1 === X2 && Y1 === Y2) return;
    const xMajor = Math.abs(X2 - X1) >= Math.abs(Y2 - Y1);
    const A1 = xMajor ? X1 : Y1, B1 = xMajor ? Y1 : X1, A2 = xMajor ? X2 : Y2, B2 = xMajor ? Y2 : X2;
    const sign = A2 > A1 ? 1 : -1, dA = (A2 - A1) * sign, dB = (B2 - B1) * sign;
    const floorDiv = (n: number, d: number): number => {
      const remainder = ((n % d) + d) % d;
      return (n - remainder) / d;
    };
    const onSegment = (px: number, py: number): boolean => (X2 - X1) * (py - Y1) === (Y2 - Y1) * (px - X1) && px >= Math.min(X1, X2) && px <= Math.max(X1, X2) && py >= Math.min(Y1, Y2) && py <= Math.max(Y1, Y2);
    const corners: readonly (readonly [number, number])[] = xMajor ? [[0, -128]] : [[128, 0], [0, -128]];
    const owns = (X: number, Y: number, cx: number, cy: number): boolean => {
      const distance = Math.abs(X - cx) + Math.abs(Y - cy);
      return distance < 128 || (distance === 128 && corners.some(([ox, oy]) => X - cx === ox && Y - cy === oy));
    };
    const meets = (cx: number, cy: number): boolean => {
      const dx = X2 - X1, dy = Y2 - Y1;
      let loN = 0, loD = 1, hiN = 1, hiD = 1, loOpen = false, hiOpen = false;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const a = sx * (X1 - cx) + sy * (Y1 - cy), b = sx * dx + sy * dy;
        if (b === 0) { if (a >= 128) return false; continue; }
        const numerator = b > 0 ? 128 - a : a - 128;
        const denominator = Math.abs(b);
        if (b > 0) {
          if (numerator * hiD <= hiN * denominator) { hiN = numerator; hiD = denominator; hiOpen = true; }
        } else if (numerator * loD >= loN * denominator) { loN = numerator; loD = denominator; loOpen = true; }
      }
      const order = loN * hiD - hiN * loD;
      return order < 0 || (order === 0 && !loOpen && !hiOpen);
    };
    const limit = (xMajor ? width : height) - 1;
    for (let p = Math.max(0, Math.floor(Math.min(A1, A2) / 256) - 1); p <= Math.min(limit, Math.ceil(Math.max(A1, A2) / 256) + 1); p += 1) {
      const n = B1 * dA + (p * 256 - A1) * dB;
      const q = xMajor ? floorDiv(n + 128 * dA, 256 * dA) : -floorDiv(-(n - 128 * dA), 256 * dA);
      const cx = (xMajor ? p : q) * 256, cy = (xMajor ? q : p) * 256;
      if (owns(X2, Y2, cx, cy)) continue;
      if (meets(cx, cy) || corners.some(([ox, oy]) => onSegment(cx + ox, cy + oy))) paintPixel(xMajor ? p : q, xMajor ? q : p);
    }
  };

  const outlineRect = (x: number, y: number, w: number, h: number): void => {
    if (![x, y, w, h].every(Number.isFinite)) return;
    drawLine(x, y, x + w, y);
    drawLine(x + w, y, x + w, y + h);
    drawLine(x + w, y + h, x, y + h);
    drawLine(x, y + h, x, y);
  };

  const fillConvexPolygon = (points: readonly [number, number][], yOffset: number, ySign: number): void => {
    if (points.length < 3) return;
    const snapped = points.map(([x, y]) => [Math.round(x * 256) / 256, Math.round(y * 256) / 256] as [number, number]);
    let doubledArea = 0;
    for (let index = 0; index < snapped.length; index += 1) {
      const [ax, ay] = snapped[index] as [number, number];
      const [bx, by] = snapped[(index + 1) % snapped.length] as [number, number];
      doubledArea += ax * by - ay * bx;
    }
    if (doubledArea === 0) return;
    const yValues = snapped.map(([, y]) => y);
    const top = Math.max(0, Math.floor(Math.min(...yValues) - yOffset));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(...yValues) - yOffset));
    for (let py = top; py <= bottom; py += 1) {
      const sampleY = py + yOffset;
      let left = Infinity, right = -Infinity;
      for (let index = 0; index < snapped.length; index += 1) {
        const [ax, ay] = snapped[index] as [number, number];
        const [bx, by] = snapped[(index + 1) % snapped.length] as [number, number];
        const low = Math.min(ay, by), high = Math.max(ay, by);
        if (low === high || sampleY < low || sampleY > high || (sampleY === low && ySign < 0) || (sampleY === high && ySign > 0)) continue;
        const x = ax + (bx - ax) * ((sampleY - ay) / (by - ay));
        if (x < left) left = x;
        if (x > right) right = x;
      }
      // Ported from PhySim2/media/raster.js (MIT, © Shannon-Toppo):
      // px + ε is inside exactly for ceil(left) <= px < ceil(right).
      // Do not pass an empty half-open interval through clippedRange: it
      // normalises endpoint order and would turn a boundary tie into pixels.
      if (left >= right) continue;
      const from = Math.max(0, Math.ceil(left));
      const to = Math.min(width, Math.ceil(right));
      for (let px = from; px < to; px += 1) paintPixel(px, py);
    }
  };

  const drawTriangle = (op: Extract<DrawOp, { type: 'triangle' | 'triangleF' }>): void => {
    if (op.type === 'triangle') {
      drawLine(op.x1, op.y1, op.x2, op.y2); drawLine(op.x2, op.y2, op.x3, op.y3); drawLine(op.x3, op.y3, op.x1, op.y1);
      return;
    }
    fillConvexPolygon([[op.x1, op.y1], [op.x2, op.y2], [op.x3, op.y3]], 1, -1);
  };

  const circleSegments = (radius: number): number => {
    return Math.min(16, Math.max(8, Math.floor(Math.abs(radius) / 2)));
  };

  const drawCircle = (op: Extract<DrawOp, { type: 'circle' | 'circleF' }>): void => {
    if (![op.x, op.y, op.radius].every(Number.isFinite)) return;
    const points: [number, number][] = [];
    const segments = circleSegments(Math.abs(op.radius));
    for (let index = 0; index < segments; index += 1) {
      const angle = index * Math.PI * 2 / segments;
      points.push([Math.fround(op.x + Math.cos(angle) * Math.abs(op.radius)), Math.fround(op.y + Math.sin(angle) * Math.abs(op.radius))]);
    }
    if (op.type === 'circleF') fillConvexPolygon(points, 0, 1);
    else for (let index = 0; index < points.length; index += 1) {
      const start = points[index] as [number, number];
      const end = points[(index + 1) % points.length] as [number, number];
      drawLine(start[0], start[1], end[0], end[1]);
    }
  };

  const drawText = (x: number, y: number, text: string): void => {
    const originX = Math.floor(x);
    let cursorX = originX;
    let cursorY = Math.floor(y);
    for (const character of text) {
      if (character === '\n') { cursorX = originX; cursorY += 6; continue; }
      const glyph = PIXEL_FONT[character] ?? PIXEL_FONT[character.toUpperCase()] ?? TOFU_GLYPH;
      for (let row = 0; row < 5; row += 1) for (let column = 0; column < 4; column += 1) if (glyph[row]?.[column] === '#') paintPixel(cursorX + column, cursorY + row);
      cursorX += 5;
    }
  };

  const drawTextBox = (op: Extract<DrawOp, { type: 'textBox' }>): void => {
    const capacity = Math.max(1, Math.floor(op.w / 5));
    const lines: string[] = [];
    for (const paragraph of op.text.split('\n')) {
      let position = 0;
      do {
        let end = Math.min(paragraph.length, position + capacity);
        if (end < paragraph.length && paragraph[end] !== ' ') {
          const space = paragraph.lastIndexOf(' ', end - 1);
          if (space >= position) end = space + 1;
        }
        lines.push(paragraph.slice(position, end));
        position = end;
      } while (position < paragraph.length);
    }
    const blockHeight = lines.length * 6 - 1;
    const top = op.verticalAlign < 0 ? op.y : op.verticalAlign > 0 ? op.y + op.h - blockHeight : op.y + (op.h - blockHeight) / 2;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      const lineWidth = line.length === 0 ? 0 : line.length * 5 - 1;
      const left = op.horizontalAlign < 0 ? op.x : op.horizontalAlign > 0 ? op.x + op.w - lineWidth : op.x + (op.w - lineWidth) / 2;
      drawText(Math.floor(left), Math.floor(top) + index * 6, line);
    }
  };

  for (const op of ops) {
    switch (op.type) {
      case 'setColour': colour = { r: op.r, g: op.g, b: op.b, a: op.a ?? 255 }; break;
      case 'rectF': fillRect(op.x, op.y, op.w, op.h); break;
      case 'rect': outlineRect(op.x, op.y, op.w, op.h); break;
      case 'line': drawLine(op.x1, op.y1, op.x2, op.y2); break;
      case 'triangle': case 'triangleF': drawTriangle(op); break;
      case 'circle': case 'circleF': drawCircle(op); break;
      case 'text': drawText(op.x, op.y, op.text); break;
      case 'textBox': drawTextBox(op); break;
    }
  }
  const bitmap = { width, height, data };
  return { bitmap, certainty, mask: certainty };
}

export function renderWithMask(ops: readonly DrawOp[], width: number, height: number): RenderedWithMask { return renderInternal(ops, width, height); }
export function render(ops: readonly DrawOp[], width: number, height: number): Bitmap { return renderInternal(ops, width, height).bitmap; }
export { CERTAIN, UNCERTAIN };
