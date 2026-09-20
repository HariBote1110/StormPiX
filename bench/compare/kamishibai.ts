import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { columnMajorCardOrder, renderIndexedRectangles, type IndexedRectangle } from './model.ts';
import type { Bitmap, Rgb } from '../../src/core/index.ts';

function stripTypes(source: string): string {
  return stripTypeScriptTypes(source);
}

export interface KamishibaiCard {
  readonly picture: Uint16Array;
  readonly layers: readonly (readonly IndexedRectangle[])[];
}

export interface KamishibaiResult {
  readonly cards: readonly KamishibaiCard[];
  readonly scripts: readonly string[];
  readonly charCount: number;
  readonly scriptCount: number;
  readonly palette: readonly Rgb[];
  readonly lossless: boolean;
  readonly reconstructionMismatches: number;
  readonly firstMismatch?: { readonly frame: number; readonly pixel: number; readonly got: number; readonly expected: number };
  readonly overrun: boolean;
  readonly colourDivided: boolean;
}

interface CompetitorRuntime {
  readonly convertLayer: (picture: Uint32Array, width: number, height: number, targetColour: number) => Uint32Array;
  readonly colour: (r: number, g: number, b: number, a: number, raw: number) => { convertedR: number; convertedG: number; convertedB: number };
  readonly finalise: (sn: string[][], colours: readonly unknown[], convertOption: Record<string, unknown>, luaOption: Record<string, unknown>) => { codes: string[]; overrun: boolean; samecolordiv: boolean };
  readonly lut: readonly number[];
}

// These adapters execute the function bodies from the clone verbatim after Node strips TypeScript syntax:
// src/gencode/GenCode.ts (convertLayer), src/Color.ts, and src/gencode/FinalizeLuaCode.ts.

function sourceWithoutImports(path: string): string {
  return readFileSync(path, 'utf8').replace(/^import[^\n]*\n/gm, '');
}

function loadClass(path: string, exportedName: string, parameters: string, argumentsList: readonly unknown[] = []): unknown {
  const source = stripTypes(sourceWithoutImports(path).replace(`export default class ${exportedName}`, `class ${exportedName}`));
  const factory = new Function(parameters, `${source}; return ${exportedName};`) as (...args: unknown[]) => unknown;
  return factory(...argumentsList);
}

function extractFunctions(path: string): string {
  const source = readFileSync(path, 'utf8');
  const convertStart = source.indexOf('function convertLayer');
  const makeIndexerStart = source.indexOf('function makeIndexer');
  if (convertStart < 0 || makeIndexerStart < 0) throw new Error(`kamishibai GenCode.ts no longer contains the expected functions: ${path}`);
  return stripTypes(source.slice(convertStart));
}

async function loadRuntime(root: string): Promise<CompetitorRuntime> {
  const lutModule = await import(pathToFileURL(`${root}/src/Lut.ts`).href);
  const lut = lutModule.default as readonly number[];
  const vectorClass = loadClass(`${root}/src/Vector2D.ts`, 'Vector2D', '');
  const vector = vectorClass as new (x: number, y: number) => { x: number; y: number };
  const layerSource = extractFunctions(`${root}/src/gencode/GenCode.ts`);
  const convertLayer = new Function('Vector2D', `${layerSource}; return convertLayer;`)(vector) as (picture: Uint32Array, width: number, height: number, targetColour: number) => Uint32Array;
  const colourClass = loadClass(`${root}/src/Color.ts`, 'Color', 'Lut, colorParse', [lut, () => null]);
  const colourConstructor = colourClass as new (r: number, g: number, b: number, a: number, raw: number) => { convertedR: number; convertedG: number; convertedB: number };
  const colour = (r: number, g: number, b: number, a: number, raw: number) => new colourConstructor(r, g, b, a, raw);
  const finalLuaCodeSource = stripTypes(sourceWithoutImports(`${root}/src/gencode/FinalLuaCode.ts`)
    .replace('export default class FinalLuaCode', 'class FinalLuaCode')
    .replace('constructor(public codes: string[], public overrun: boolean = false, public samecolordiv: boolean = false) {};', 'constructor(codes, overrun = false, samecolordiv = false) { this.codes = codes; this.overrun = overrun; this.samecolordiv = samecolordiv; }'));
  const finalLuaCode = new Function(`${finalLuaCodeSource}; return FinalLuaCode;`)() as new (codes: string[], overrun?: boolean, samecolordiv?: boolean) => unknown;
  const finaliserSource = stripTypes(sourceWithoutImports(`${root}/src/gencode/FinalizeLuaCode.ts`).replace('export default function FinalizeLuaCode', 'function FinalizeLuaCode'));
  const finalise = new Function('FinalLuaCode', `${finaliserSource}; return FinalizeLuaCode;`)(finalLuaCode) as CompetitorRuntime['finalise'];
  return { convertLayer, colour, finalise, lut };
}

function uint32Pixels(bitmap: Bitmap): Uint32Array {
  if (bitmap.data.byteOffset !== 0 || bitmap.data.byteLength % 4 !== 0) throw new Error('PNG data must be a tightly packed RGBA buffer');
  return new Uint32Array(bitmap.data.buffer, bitmap.data.byteOffset, bitmap.data.byteLength / 4);
}

function makeSheet(frames: readonly Bitmap[]): { readonly sheet: Bitmap; readonly columns: number; readonly rows: number } {
  const columns = Math.min(8, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const width = columns * (frames[0]?.width ?? 0);
  const height = rows * (frames[0]?.height ?? 0);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let frame = 0; frame < frames.length; frame += 1) {
    const source = frames[frame] as Bitmap;
    const x = Math.floor(frame / rows) * source.width;
    const y = (frame % rows) * source.height;
    for (let row = 0; row < source.height; row += 1) {
      const sourceStart = row * source.width * 4;
      const targetStart = ((y + row) * width + x) * 4;
      data.set(source.data.subarray(sourceStart, sourceStart + source.width * 4), targetStart);
    }
  }
  return { sheet: { width, height, data }, columns, rows };
}

function samePixels(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function firstMismatch(a: ArrayLike<number>, b: ArrayLike<number>): number {
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return index;
  return -1;
}

function colourText(colour: { convertedR: number; convertedG: number; convertedB: number }): Rgb {
  return [colour.convertedR, colour.convertedG, colour.convertedB];
}

function layerRectangles(numbers: Uint32Array, colour: number): IndexedRectangle[] {
  const rectangles: IndexedRectangle[] = [];
  for (let index = 0; index < numbers.length; index += 4) {
    const x = numbers[index] ?? 0;
    const y = numbers[index + 1] ?? 0;
    const w = numbers[index + 2] ?? 0;
    const h = numbers[index + 3] ?? 0;
    if (w === 1) rectangles.push({ kind: 'V', x, y, h, colour });
    else if (h === 1) rectangles.push({ kind: 'H', x, y, w, colour });
    else rectangles.push({ kind: 'R', x, y, w, h, colour });
  }
  return rectangles;
}

export async function compareKamishibai(frames: readonly Bitmap[], root: string, luaMaxLength: number): Promise<KamishibaiResult> {
  if (!existsSync(`${root}/src/gencode/GenCode.ts`)) throw new Error(`kamishibai source is missing: ${root}`);
  const runtime = await loadRuntime(root);
  const { sheet, columns, rows } = makeSheet(frames);
  const sheetWords = uint32Pixels(sheet);
  const frameOrder = columnMajorCardOrder(frames.length, columns, rows);
  if (!samePixels(frameOrder, Array.from({ length: frames.length }, (_, index) => index))) throw new Error('internal error: column-major card order is not sequential');

  const orderedRaw = Uint32Array.from(new Set(sheetWords)).reverse();
  const colours: Rgb[] = [];
  const colourObjects: unknown[] = [];
  const colourBytes = new Uint8ClampedArray(orderedRaw.buffer);
  for (let index = 0; index < orderedRaw.length; index += 1) {
    const offset = index * 4;
    const generated = runtime.colour(colourBytes[offset] ?? 0, colourBytes[offset + 1] ?? 0, colourBytes[offset + 2] ?? 0, colourBytes[offset + 3] ?? 0, orderedRaw[index] ?? 0);
    colourObjects.push(generated);
    colours.push(colourText(generated));
  }

  const cards: KamishibaiCard[] = [];
  const snippets: string[][] = [];
  let reconstructionMismatches = 0;
  let firstReconstructionMismatch: KamishibaiResult['firstMismatch'];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const source = frames[frameIndex] as Bitmap;
    const sheetX = Math.floor(frameIndex / rows) * source.width;
    const sheetY = (frameIndex % rows) * source.height;
    const picture = new Uint32Array(source.width * source.height);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        picture[x + y * source.width] = orderedRaw.indexOf(sheetWords[sheetX + x + (sheetY + y) * sheet.width] ?? 0);
      }
    }
    const sourceWords = uint32Pixels(source);
    const expectedPicture = Uint32Array.from(sourceWords, (word) => orderedRaw.indexOf(word));
    if (!samePixels(picture, expectedPicture)) throw new Error(`sprite-sheet card order mismatch at frame ${frameIndex}`);

    const layers: IndexedRectangle[][] = [];
    const luaLayers: string[] = [];
    for (let target = 0; target < orderedRaw.length; target += 1) {
      const rawRectangles = runtime.convertLayer(picture, source.width, source.height, target);
      const rectangles = layerRectangles(rawRectangles, target);
      layers.push(rectangles);
      luaLayers.push(rectangles.map((rectangle) => rectangle.kind === 'V' ? `V(${rectangle.x},${rectangle.y},${rectangle.h})` : rectangle.kind === 'H' ? `H(${rectangle.x},${rectangle.y},${rectangle.w})` : `R(${rectangle.x},${rectangle.y},${rectangle.w},${rectangle.h})`).join(''));
    }
    const emittedOrder = layers.slice().reverse().flat();
    const reconstructed = renderIndexedRectangles(source.width, source.height, emittedOrder, 0);
    if (!samePixels(reconstructed, picture)) {
      const mismatch = firstMismatch(reconstructed, picture);
      for (let index = 0; index < picture.length; index += 1) if (reconstructed[index] !== picture[index]) reconstructionMismatches += 1;
      firstReconstructionMismatch ??= { frame: frameIndex, pixel: mismatch, got: reconstructed[mismatch] ?? -1, expected: picture[mismatch] ?? -1 };
    }
    cards.push({ picture: Uint16Array.from(picture), layers });
    snippets.push(luaLayers);
  }

  const convertOption = { luaVCompress: true, luaHCompress: true, luaCardWidth: frames[0]?.width ?? 0, luaCardHeight: frames[0]?.height ?? 0 };
  const luaOption = { isRollSign: false, luaRollSignGap: 0, luaOffsetX: 0, luaOffsetY: 0, luaScaleH: 1, luaScaleV: 1, luaRotate: 0, luaCardIndexStartWith: 1, luaReadChannel: 1, luaMaxLength };
  const final = runtime.finalise(snippets, colourObjects, convertOption, luaOption);
  return {
    cards,
    scripts: final.codes,
    charCount: final.codes.reduce((sum, code) => sum + code.length, 0),
    scriptCount: final.codes.length,
    palette: colours,
    lossless: reconstructionMismatches === 0,
    reconstructionMismatches,
    firstMismatch: firstReconstructionMismatch,
    overrun: final.overrun,
    colourDivided: final.samecolordiv,
  };
}

export async function loadKamishibaiRuntime(root: string): Promise<{ readonly lut: readonly number[] }> {
  const runtime = await loadRuntime(root);
  return { lut: runtime.lut };
}
