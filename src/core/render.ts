import type { Bitmap, DrawOp, PixelCertainty } from './types.ts';
import { CERTAIN, UNCERTAIN } from './types.ts';

// Rasterisation semantics ported from /Users/yuki/GitHub/storm-lua-runner/rust/lua-runtime-core/src/screen_raster.rs.

export interface RenderedWithMask {
  readonly bitmap: Bitmap;
  readonly certainty: Uint8Array;
  readonly mask: Uint8Array;
}

/** The Rust reference uses 16; keep circle evidence in one editable table. */
export const CIRCLE_SEGMENT_TABLE: readonly { readonly minimumRadius: number; readonly segments: number }[] = [
  { minimumRadius: 0, segments: 16 },
];

// CG pixel 4x5 mono glyphs (ASCII 0x20..0x7e) are kept as a compact table.
// The reference table is intentionally isolated here for a future text primitive.
const GLYPH_DATA = ["00000000000000000000","01000100010000000100","10101010000000000000","10101111101011111010","01111010011001011110","11000001011010000011","01001010010010100101","01000100000000000000","00100100010001000010","01000010001000100100","10010110111101101001","00000100111001000000","00000000000001001000","00000000111000000000","00000000000000000100","00100010010010001000","01101011110110010110","00100110001000100010","01101001001001001111","11100001011000011110","10011001111100010001","11111000111000011110","01101000111010010110","11110001001000100010","01101001011010010110","01101001011100010110","00000100000001000000","00000100000001000100","00100100100001000010","00001110000011100000","10000100001001001000","11000010010000000100","01101001101110000111","01101001111110011001","11101001111010011110","01101001100010010110","11101001100110011110","11111000111010001111","11111000111010001000","01101000101110010110","10011001111110011001","01000100010001000100","00010001000110010110","10011010110010101001","10001000100010001111","10011111100110011001","10011101101110011001","01101001100110010110","11101001111010001000","01101001100110110111","11101001111010101001","01111000011000011110","11100100010001000100","10011001100110010110","10101010101010100100","10011001100111111001","10011001011010011001","10101010010001000100","11110001011010001111","01100100010001000110","10001000010000100010","01100010001000100110","01001010000000000000","00000000000000001111","01000010000000000000","01101001111110011001","11101001111010011110","01101001100010010110","11101001100110011110","11111000111010001111","11111000111010001000","01101000101110010110","10011001111110011001","01000100010001000100","00010001000110010110","10011010110010101001","10001000100010001111","10011111100110011001","10011101101110011001","01101001100110010110","11101001111010001000","01101001100110110111","11101001111010101001","01111000011000011110","11100100010001000100","10011001100110010110","10101010101010100100","10011001100111111001","10011001011010011001","10101010010001000100","11110001011010001111","01100100110001000110","01000100000001000100","11000100011001001100","00000101101000000000"] as const;
const GLYPHS: Record<string, string[]> = {
  ' ': ['0000', '0000', '0000', '0000', '0000'],
  '0': ['1110', '1001', '1001', '1001', '0111'], '1': ['0100', '1100', '0100', '0100', '1110'],
  '2': ['1110', '0001', '0110', '1000', '1111'], '3': ['1110', '0001', '0110', '0001', '1110'],
  '4': ['1001', '1001', '1111', '0001', '0001'], '5': ['1111', '1000', '1110', '0001', '1110'],
  '6': ['0111', '1000', '1110', '1001', '0110'], '7': ['1111', '0001', '0010', '0100', '0100'],
  '8': ['0110', '1001', '0110', '1001', '0110'], '9': ['0110', '1001', '0111', '0001', '1110'],
  'A': ['0110', '1001', '1111', '1001', '1001'], 'B': ['1110', '1001', '1110', '1001', '1110'],
  'C': ['0111', '1000', '1000', '1000', '0111'], 'D': ['1110', '1001', '1001', '1001', '1110'],
  'E': ['1111', '1000', '1110', '1000', '1111'], 'F': ['1111', '1000', '1110', '1000', '1000'],
  'G': ['0111', '1000', '1011', '1001', '0111'], 'H': ['1001', '1001', '1111', '1001', '1001'],
  'I': ['1110', '0100', '0100', '0100', '1110'], 'J': ['0011', '0001', '0001', '1001', '0110'],
  'K': ['1001', '1010', '1100', '1010', '1001'], 'L': ['1000', '1000', '1000', '1000', '1111'],
  'M': ['1001', '1111', '1111', '1001', '1001'], 'N': ['1001', '1101', '1111', '1011', '1001'],
  'O': ['0110', '1001', '1001', '1001', '0110'], 'P': ['1110', '1001', '1110', '1000', '1000'],
  'Q': ['0110', '1001', '1001', '1011', '0111'], 'R': ['1110', '1001', '1110', '1010', '1001'],
  'S': ['0111', '1000', '0110', '0001', '1110'], 'T': ['1111', '0100', '0100', '0100', '0100'],
  'U': ['1001', '1001', '1001', '1001', '0110'], 'V': ['1001', '1001', '1001', '0110', '0110'],
  'W': ['1001', '1001', '1111', '1111', '0110'], 'X': ['1001', '0110', '0110', '0110', '1001'],
  'Y': ['1001', '0110', '0100', '0100', '0100'], 'Z': ['1111', '0001', '0010', '0100', '1111'],
  '.': ['0000', '0000', '0000', '0000', '0100'], ',': ['0000', '0000', '0000', '0100', '1000'],
  ':': ['0000', '0100', '0000', '0100', '0000'], '-': ['0000', '0000', '1111', '0000', '0000'],
};

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
  return Math.min(255, Math.round(source * alpha / 255) + Math.round(destination * (255 - alpha) / 255));
}

function renderInternal(ops: readonly DrawOp[], width: number, height: number): RenderedWithMask {
  validateDimension(width, 'width');
  validateDimension(height, 'height');
  const data = new Uint8ClampedArray(width * height * 4);
  const certainty = new Uint8Array(width * height);
  certainty.fill(CERTAIN);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  let colour = { r: 0, g: 0, b: 0, a: 255 };

  const paintPixel = (x: number, y: number, state: PixelCertainty = CERTAIN): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pixel = y * width + x;
    const offset = pixel * 4;
    const alpha = Math.max(0, Math.min(255, Math.round(colour.a)));
    data[offset] = alpha === 255 ? colour.r : blendChannel(colour.r, alpha, data[offset] ?? 0);
    data[offset + 1] = alpha === 255 ? colour.g : blendChannel(colour.g, alpha, data[offset + 1] ?? 0);
    data[offset + 2] = alpha === 255 ? colour.b : blendChannel(colour.b, alpha, data[offset + 2] ?? 0);
    data[offset + 3] = Math.min(255, alpha + Math.round((data[offset + 3] ?? 255) * (255 - alpha) / 255));
    certainty[pixel] = state;
  };

  const fillRect = (x: number, y: number, w: number, h: number): void => {
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;
    const rangeX = clippedRange(floorCoord(x), floorCoord(x + w) - 1, width);
    const rangeY = clippedRange(floorCoord(y), floorCoord(y + h) - 1, height);
    if (!rangeX || !rangeY) return;
    for (let py = rangeY[0]; py <= rangeY[1]; py += 1) for (let px = rangeX[0]; px <= rangeX[1]; px += 1) paintPixel(px, py);
  };

  const outlineRect = (x: number, y: number, w: number, h: number): void => {
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;
    const x0 = floorCoord(x);
    const y0 = floorCoord(y);
    const x1 = floorCoord(x + w) - 1;
    const y1 = floorCoord(y + h) - 1;
    if (x1 < x0 || y1 < y0) return;
    for (let px = x0; px <= x1; px += 1) { paintPixel(px, y0); if (y1 !== y0) paintPixel(px, y1); }
    for (let py = y0 + 1; py <= y1 - 1; py += 1) { paintPixel(x0, py); if (x1 !== x0) paintPixel(x1, py); }
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number): void => {
    if (![x1, y1, x2, y2].every(Number.isFinite)) return;
    const deltaX = x2 - x1;
    const deltaY = y2 - y1;
    if (deltaX * deltaX + deltaY * deltaY < 1) return;
    const xMajor = Math.abs(deltaX) >= Math.abs(deltaY);
    const a1 = xMajor ? x1 : y1;
    const b1 = xMajor ? y1 : x1;
    const a2 = xMajor ? x2 : y2;
    const b2 = xMajor ? y2 : x2;
    const aLow = Math.min(a1, a2);
    const aHigh = Math.max(a1, a2);
    const pLow = floorCoord(roundCoord(aLow));
    const pHigh = floorCoord(roundCoord(aHigh));
    const denominator = a2 - a1;
    for (let pixel = pLow; pixel <= pHigh; pixel += 1) {
      const ratio = Math.abs(denominator) < 1e-6 ? 0 : Math.max(0, Math.min(1, (pixel - a1) / denominator));
      const other = b1 + (b2 - b1) * ratio;
      const quantised = floorCoord(roundCoord(other));
      paintPixel(xMajor ? pixel : quantised, xMajor ? quantised : pixel, UNCERTAIN);
    }
  };

  const edgeDistance = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared));
    return Math.hypot(x - (ax + ratio * dx), y - (ay + ratio * dy));
  };

  const fillConvexPolygon = (points: readonly [number, number][]): void => {
    if (points.length < 3) return;
    const minY = floorCoord(roundCoord(Math.min(...points.map((point) => point[1]))));
    const maxY = floorCoord(roundCoord(Math.max(...points.map((point) => point[1]))));
    for (let y = minY; y <= maxY; y += 1) {
      const intersections: number[] = [];
      for (let index = 0; index < points.length; index += 1) {
        const [ax, ay] = points[index] as [number, number];
        const [bx, by] = points[(index + 1) % points.length] as [number, number];
        const low = Math.min(ay, by);
        const high = Math.max(ay, by);
        if (ay === by) {
          if (Math.abs(y - ay) <= 0.5) { intersections.push(Math.min(ax, bx)); intersections.push(Math.max(ax, bx)); }
        } else if (y >= low - 0.5 && y <= high + 0.5) intersections.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
      if (intersections.length < 2) continue;
      intersections.sort((a, b) => a - b);
      const range = clippedRange(Math.ceil(intersections[0] as number), Math.floor(intersections[intersections.length - 1] as number), width);
      if (!range) continue;
      for (let x = range[0]; x <= range[1]; x += 1) {
        let boundary = false;
        for (let index = 0; index < points.length; index += 1) {
          const point = points[index] as [number, number];
          const next = points[(index + 1) % points.length] as [number, number];
          if (edgeDistance(x, y, point[0], point[1], next[0], next[1]) <= 0.75) boundary = true;
        }
        paintPixel(x, y, boundary ? UNCERTAIN : CERTAIN);
      }
    }
  };

  const drawTriangle = (op: Extract<DrawOp, { type: 'triangle' | 'triangleF' }>): void => {
    if (op.type === 'triangle') {
      drawLine(op.x1, op.y1, op.x2, op.y2); drawLine(op.x2, op.y2, op.x3, op.y3); drawLine(op.x3, op.y3, op.x1, op.y1);
      return;
    }
    if (![op.x1, op.y1, op.x2, op.y2, op.x3, op.y3].every(Number.isFinite)) return;
    const points = [[op.x1, op.y1], [op.x2, op.y2], [op.x3, op.y3]] as [number, number][];
    points.sort((left, right) => left[1] - right[1]);
    const [top, middle, bottom] = points as [[number, number], [number, number], [number, number]];
    const yTop = floorCoord(roundCoord(top[1]));
    const yBottom = floorCoord(roundCoord(bottom[1]));
    const interpolate = (y: number, start: [number, number], end: [number, number]): number => {
      if (Math.abs(end[1] - start[1]) < Number.EPSILON) return start[0];
      const ratio = Math.max(0, Math.min(1, (y - start[1]) / (end[1] - start[1])));
      return start[0] + (end[0] - start[0]) * ratio;
    };
    for (let y = yTop; y <= yBottom; y += 1) {
      const edgeAC = interpolate(y, top, bottom);
      const other = y < middle[1] ? interpolate(y, top, middle) : interpolate(y, middle, bottom);
      const left = Math.min(edgeAC, other);
      const right = Math.max(edgeAC, other);
      const range = clippedRange(Math.ceil(left), Math.floor(right), width);
      if (!range) continue;
      for (let x = range[0]; x <= range[1]; x += 1) {
        let boundary = false;
        for (let index = 0; index < points.length; index += 1) {
          const start = points[index] as [number, number];
          const end = points[(index + 1) % points.length] as [number, number];
          if (edgeDistance(x, y, start[0], start[1], end[0], end[1]) <= 0.75) boundary = true;
        }
        paintPixel(x, y, boundary ? UNCERTAIN : CERTAIN);
      }
    }
  };

  const circleSegments = (radius: number): number => {
    let segments = CIRCLE_SEGMENT_TABLE[0]?.segments ?? 16;
    for (const entry of CIRCLE_SEGMENT_TABLE) if (radius >= entry.minimumRadius) segments = entry.segments;
    return segments;
  };

  const drawCircle = (op: Extract<DrawOp, { type: 'circle' | 'circleF' }>): void => {
    if (![op.x, op.y, op.radius].every(Number.isFinite)) return;
    const points: [number, number][] = [];
    const segments = circleSegments(Math.abs(op.radius));
    for (let index = 0; index < segments; index += 1) {
      const angle = index * Math.PI * 2 / segments;
      points.push([op.x + Math.cos(angle) * op.radius, op.y + Math.sin(angle) * op.radius]);
    }
    if (op.type === 'circleF') fillConvexPolygon(points);
    else for (let index = 0; index < points.length; index += 1) {
      const start = points[index] as [number, number];
      const end = points[(index + 1) % points.length] as [number, number];
      drawLine(start[0], start[1], end[0], end[1]);
    }
  };

  const drawText = (x: number, y: number, text: string): void => {
    let cursorX = x;
    let cursorY = y;
    for (const character of text) {
      if (character === '\n') { cursorX = x; cursorY += 6; continue; }
      const glyph = GLYPH_DATA[character.charCodeAt(0) - 32] ?? (GLYPHS[character]?.join('') ?? GLYPH_DATA[0]);
      for (let row = 0; row < 5; row += 1) for (let column = 0; column < 4; column += 1) if (glyph?.[row * 4 + column] === '1') paintPixel(floorCoord(cursorX + column), floorCoord(cursorY + row));
      cursorX += 5;
    }
  };

  for (const op of ops) {
    switch (op.type) {
      case 'setColour': colour = { r: op.r, g: op.g, b: op.b, a: op.a ?? 255 }; break;
      case 'rectF': fillRect(floorCoord(op.x), floorCoord(op.y), floorCoord(op.w), floorCoord(op.h)); break;
      case 'rect': outlineRect(floorCoord(op.x), floorCoord(op.y), floorCoord(op.w), floorCoord(op.h)); break;
      case 'line': drawLine(op.x1, op.y1, op.x2, op.y2); break;
      case 'triangle': case 'triangleF': drawTriangle(op); break;
      case 'circle': case 'circleF': drawCircle(op); break;
      case 'text': drawText(op.x, op.y, op.text); break;
    }
  }
  const bitmap = { width, height, data };
  return { bitmap, certainty, mask: certainty };
}

export function renderWithMask(ops: readonly DrawOp[], width: number, height: number): RenderedWithMask { return renderInternal(ops, width, height); }
export function render(ops: readonly DrawOp[], width: number, height: number): Bitmap { return renderInternal(ops, width, height).bitmap; }
export { CERTAIN, UNCERTAIN };
