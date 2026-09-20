import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { Bitmap } from '../../src/core/index.ts';

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readUint32(data: Uint8Array, offset: number): number {
  return (((data[offset] ?? 0) << 24) | ((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0)) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const estimate = a + b - c;
  const pa = Math.abs(estimate - a);
  const pb = Math.abs(estimate - b);
  const pc = Math.abs(estimate - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode the asset's colour-type 6, 8-bit, non-interlaced PNGs without a dependency. */
export function readPng(path: string): Bitmap {
  const input = readFileSync(path);
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (input[index] !== PNG_SIGNATURE[index]) throw new Error(`${path}: invalid PNG signature`);
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= input.length) {
    const length = readUint32(input, offset);
    const type = String.fromCharCode(input[offset + 4] ?? 0, input[offset + 5] ?? 0, input[offset + 6] ?? 0, input[offset + 7] ?? 0);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    if (chunkEnd + 4 > input.length) throw new Error(`${path}: truncated ${type} chunk`);
    if (type === 'IHDR') {
      width = readUint32(input, chunkStart);
      height = readUint32(input, chunkStart + 4);
      bitDepth = input[chunkStart + 8] ?? 0;
      colourType = input[chunkStart + 9] ?? 0;
      if ((input[chunkStart + 10] ?? 0) !== 0 || (input[chunkStart + 11] ?? 0) !== 0) throw new Error(`${path}: unsupported PNG compression/filter method`);
      interlace = input[chunkStart + 12] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(input.slice(chunkStart, chunkEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = chunkEnd + 4;
  }
  if (width === 0 || height === 0 || bitDepth !== 8 || colourType !== 6 || interlace !== 0) throw new Error(`${path}: expected 8-bit RGBA non-interlaced PNG`);

  const compressedLength = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }
  const filtered = inflateSync(compressed);
  const rowBytes = width * 4;
  const expectedLength = height * (rowBytes + 1);
  if (filtered.length !== expectedLength) throw new Error(`${path}: unexpected inflated PNG length`);

  const pixels = new Uint8ClampedArray(width * height * 4);
  const previous = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (rowBytes + 1);
    const filter = filtered[sourceOffset] ?? 0;
    const row = new Uint8Array(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + 1 + x] ?? 0;
      const left = x >= 4 ? row[x - 4] ?? 0 : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= 4 ? previous[x - 4] ?? 0 : 0;
      row[x] = filter === 0 ? raw : filter === 1 ? (raw + left) & 255 : filter === 2 ? (raw + above) & 255 : filter === 3 ? (raw + Math.floor((left + above) / 2)) & 255 : filter === 4 ? (raw + paeth(left, above, upperLeft)) & 255 : (() => { throw new Error(`${path}: unsupported PNG filter ${filter}`); })();
    }
    pixels.set(row, y * rowBytes);
    previous.set(row);
  }
  return { width, height, data: pixels };
}
