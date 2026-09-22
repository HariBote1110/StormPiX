import { convert, convertFrames, cover, orderOps, render, type Bitmap, type DrawOp, type Rgb } from '../src/core/index.ts';

/*
 * Read-only experiment. It deliberately does not participate in conversion:
 * candidates are only accepted when render() reproduces their intended pixels
 * exactly. A packed rectangle record is 30 bits / 5 base-64 glyphs; retaining
 * the same coordinate ranges, a triangle needs x1,y1,x2,y2,x3,y3,colour
 * (41 bits), hence 7 glyphs.
 */

const RECTANGLE_RECORD_CHARS = 5;
const TRIANGLE_RECORD_CHARS = 7;

function bitmapFromPixels(width: number, height: number, colourAt: (x: number, y: number) => Rgb): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const colour = colourAt(x, y);
    data[offset] = colour[0]; data[offset + 1] = colour[1]; data[offset + 2] = colour[2]; data[offset + 3] = 255;
  }
  return { width, height, data };
}

function exactLabels(source: Bitmap): { palette: Rgb[]; indices: Uint16Array } {
  const palette: Rgb[] = [];
  const indexes = new Map<string, number>();
  const indices = new Uint16Array(source.width * source.height);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    const offset = pixel * 4;
    const colour: Rgb = [source.data[offset] ?? 0, source.data[offset + 1] ?? 0, source.data[offset + 2] ?? 0];
    const key = colour.join(',');
    let index = indexes.get(key);
    if (index === undefined) { index = palette.length; indexes.set(key, index); palette.push(colour); }
    indices[pixel] = index;
  }
  return { palette, indices };
}

interface Rectangle { readonly colour: Rgb; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

function rectangles(source: Bitmap): Rectangle[] {
  const labels = exactLabels(source);
  const operations = orderOps(cover({ width: source.width, height: source.height, indices: labels.indices }, labels.palette));
  const result: Rectangle[] = [];
  let colour: Rgb = [0, 0, 0];
  for (const operation of operations) {
    if (operation.type === 'setColour') colour = [operation.r, operation.g, operation.b];
    if (operation.type === 'rectF') result.push({ colour, x: operation.x, y: operation.y, w: operation.w, h: operation.h });
  }
  return result;
}

function samePixels(left: Bitmap, right: Bitmap): boolean {
  if (left.width !== right.width || left.height !== right.height) return false;
  for (let index = 0; index < left.data.length; index += 4) {
    if (left.data[index] !== right.data[index] || left.data[index + 1] !== right.data[index + 1] || left.data[index + 2] !== right.data[index + 2]) return false;
  }
  return true;
}

function pairTriangleCandidates(source: Bitmap, records: readonly Rectangle[]): number {
  let accepted = 0;
  for (let leftIndex = 0; leftIndex < records.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < records.length; rightIndex += 1) {
    const left = records[leftIndex] as Rectangle;
    const right = records[rightIndex] as Rectangle;
    if (left.colour.join(',') !== right.colour.join(',')) continue;
    const separated = left.x + left.w < right.x || right.x + right.w < left.x || left.y + left.h < right.y || right.y + right.h < left.y;
    if (separated) continue;
    const corners: readonly (readonly [number, number])[] = [
      [left.x, left.y], [left.x + left.w, left.y], [left.x, left.y + left.h], [left.x + left.w, left.y + left.h],
      [right.x, right.y], [right.x + right.w, right.y], [right.x, right.y + right.h], [right.x + right.w, right.y + right.h],
    ];
    const expected = render([
      { type: 'setColour', r: left.colour[0], g: left.colour[1], b: left.colour[2] },
      { type: 'rectF', x: left.x, y: left.y, w: left.w, h: left.h },
      { type: 'rectF', x: right.x, y: right.y, w: right.w, h: right.h },
    ], source.width, source.height);
    for (let a = 0; a < corners.length; a += 1) for (let b = a + 1; b < corners.length; b += 1) for (let c = b + 1; c < corners.length; c += 1) {
      const first = corners[a] as readonly [number, number], second = corners[b] as readonly [number, number], third = corners[c] as readonly [number, number];
      const candidate = render([{ type: 'setColour', r: left.colour[0], g: left.colour[1], b: left.colour[2] }, { type: 'triangleF', x1: first[0], y1: first[1], x2: second[0], y2: second[1], x3: third[0], y3: third[1] }], source.width, source.height);
      if (samePixels(expected, candidate)) { accepted += 1; a = corners.length; b = corners.length; break; }
    }
  }
  return accepted;
}

function photoLike(): Bitmap {
  return bitmapFromPixels(96, 96, (x, y) => {
    const gradient = (x + y) / 190;
    let colour: Rgb = [Math.round(40 + 215 * gradient), Math.round(90 + 160 * gradient), Math.round(180 - 90 * gradient)];
    if ((x - 64) ** 2 + (y - 32) ** 2 <= 18 ** 2) colour = [255, 255, 255];
    if (x >= 8 && x < 48 && y >= 70 && y < 88) colour = [15, 15, 15];
    return colour;
  });
}

const fixtures: readonly [string, readonly Bitmap[]][] = [
  ['photo-96', [photoLike()]],
  ['gradient-32', [bitmapFromPixels(32, 32, (x, y) => [x * 8, y * 8, 128])]],
  ['checker-32', [bitmapFromPixels(32, 32, (x, y) => (x + y) % 2 === 0 ? [245, 245, 245] : [20, 20, 20])]],
  ['quadrants-96', [bitmapFromPixels(96, 96, (x, y) => x < 48 && y < 48 ? [224, 64, 64] : x >= 48 && y < 48 ? [64, 192, 96] : x < 48 ? [64, 112, 224] : [224, 192, 64])]],
  ['spin-16', Array.from({ length: 16 }, (_, frame) => bitmapFromPixels(64, 64, (x, y) => {
    const angle = frame * Math.PI / 8, cosine = Math.cos(angle), sine = Math.sin(angle);
    const centreX = x - 31.5, centreY = y - 31.5;
    return Math.abs(centreX * cosine + centreY * sine) < 13 && Math.abs(-centreX * sine + centreY * cosine) < 4 ? [220, 80, 45] : [14, 20, 30];
  }))],
];

console.log('fixture\trectangleOnlyChars\ttriangleAwareChars\tdelta\tacceptedTriangles\trectRecordChars\ttriangleRecordChars\tverifiedPairCandidates');
for (const [name, frames] of fixtures) {
  const baseline = frames.length === 1 ? convert(frames[0] as Bitmap, { mode: 'lossless', budget: 8192 }) : convertFrames(frames, { mode: 'lossless', budget: 8192, ticksPerFrame: 6 });
  const accepted = frames.reduce((total, frame) => total + pairTriangleCandidates(frame, rectangles(frame)), 0);
  // The current shipped record decoder has no triangle tag or triangle decoder.
  // Keeping the full decoder cost in the comparison therefore accepts no change.
  const triangleAwareChars = baseline.totalCharCount;
  console.log(`${name}\t${baseline.totalCharCount}\t${triangleAwareChars}\t${triangleAwareChars - baseline.totalCharCount}\t0\t${RECTANGLE_RECORD_CHARS}\t${TRIANGLE_RECORD_CHARS}\t${accepted}`);
}
