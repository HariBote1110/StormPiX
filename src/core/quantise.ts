import type { Bitmap, Rgb } from './types.ts';

export interface QuantiseOptions {
  readonly dither?: 'none' | 'floyd-steinberg';
  readonly seed?: number;
}

export interface QuantisedImage {
  readonly palette: readonly Rgb[];
  readonly indices: Uint16Array;
}

interface Sample {
  r: number;
  g: number;
  b: number;
  count: number;
  lab: [number, number, number];
}

interface Box {
  samples: Sample[];
}

/** Convert an sRGB channel to linear light. */
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Oklab is used for both splitting and nearest-palette assignment. */
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const red = linear(r);
  const green = linear(g);
  const blue = linear(b);
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(Math.max(0, l));
  const mRoot = Math.cbrt(Math.max(0, m));
  const sRoot = Math.cbrt(Math.max(0, s));
  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

function distanceSquared(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

function splitBox(box: Box): [Box, Box] | undefined {
  if (box.samples.length < 2) return undefined;
  const ranges = [0, 1, 2].map((channel) => {
    const values = box.samples.map((sample) => sample.lab[channel] ?? 0);
    return Math.max(...values) - Math.min(...values);
  });
  const channel = ranges.indexOf(Math.max(...ranges));
  const sorted = [...box.samples].sort((a, b) => {
    const difference = (a.lab[channel] ?? 0) - (b.lab[channel] ?? 0);
    return difference || a.r - b.r || a.g - b.g || a.b - b.b;
  });
  const total = sorted.reduce((sum, sample) => sum + sample.count, 0);
  let accumulated = 0;
  let splitAt = 1;
  for (; splitAt < sorted.length; splitAt += 1) {
    accumulated += sorted[splitAt - 1]?.count ?? 0;
    if (accumulated * 2 >= total) break;
  }
  if (splitAt >= sorted.length) splitAt = sorted.length - 1;
  return [{ samples: sorted.slice(0, splitAt) }, { samples: sorted.slice(splitAt) }];
}

function representative(samples: readonly Sample[]): Rgb {
  const total = samples.reduce((sum, sample) => sum + sample.count, 0);
  const red = samples.reduce((sum, sample) => sum + sample.r * sample.count, 0) / total;
  const green = samples.reduce((sum, sample) => sum + sample.g * sample.count, 0) / total;
  const blue = samples.reduce((sum, sample) => sum + sample.b * sample.count, 0) / total;
  return [Math.round(red), Math.round(green), Math.round(blue)];
}

function nearestIndex(r: number, g: number, b: number, paletteLab: readonly (readonly [number, number, number])[]): number {
  const lab = rgbToOklab(r, g, b);
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < paletteLab.length; index += 1) {
    const distance = distanceSquared(lab, paletteLab[index] ?? [0, 0, 0]);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function nearestLumaIndex(r: number, g: number, b: number, palette: readonly Rgb[]): number {
  const target = luma(r, g, b);
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < palette.length; index += 1) {
    const colour = palette[index] ?? [0, 0, 0];
    const distance = (target - luma(colour[0], colour[1], colour[2])) ** 2;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function quantiseLuma(source: Bitmap, maxColours: number): QuantisedImage {
  const colourCount = Math.max(1, Math.floor(maxColours));
  const base = quantise(source, colourCount);
  let palette = base.palette.map((colour) => [...colour] as Rgb);
  const pixels = source.width * source.height;
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const offset = pixel * 4;
      const index = nearestLumaIndex(source.data[offset] ?? 0, source.data[offset + 1] ?? 0, source.data[offset + 2] ?? 0, palette);
      const sum = sums[index] ?? [0, 0, 0, 0];
      sum[0] = (sum[0] ?? 0) + (source.data[offset] ?? 0);
      sum[1] = (sum[1] ?? 0) + (source.data[offset + 1] ?? 0);
      sum[2] = (sum[2] ?? 0) + (source.data[offset + 2] ?? 0);
      sum[3] = (sum[3] ?? 0) + 1;
      sums[index] = sum;
    }
    const next = palette.map((colour, index) => {
      const sum = sums[index] ?? [0, 0, 0, 0];
      const count = sum[3] ?? 0;
      return count === 0 ? colour : [Math.round((sum[0] ?? 0) / count), Math.round((sum[1] ?? 0) / count), Math.round((sum[2] ?? 0) / count)] as Rgb;
    });
    if (next.every((colour, index) => colour[0] === palette[index]?.[0] && colour[1] === palette[index]?.[1] && colour[2] === palette[index]?.[2])) break;
    palette = next;
  }
  const indices = new Uint16Array(pixels);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    indices[pixel] = nearestLumaIndex(source.data[offset] ?? 0, source.data[offset + 1] ?? 0, source.data[offset + 2] ?? 0, palette);
  }
  return { palette, indices };
}

/** Conversion-only palette reduction tuned to the luma-based SSIM objective. */
export function quantiseForQuality(source: Bitmap, maxColours = 16, options: QuantiseOptions = {}): QuantisedImage {
  if (options.dither === 'floyd-steinberg') return quantise(source, maxColours, options);
  return quantiseLuma(source, maxColours);
}

/** Deterministic weighted median-cut palette reduction with optional error diffusion. */
export function quantise(source: Bitmap, maxColours = 16, options: QuantiseOptions = {}): QuantisedImage {
  const colourCount = Math.max(1, Math.floor(maxColours));
  const histogram = new Map<string, Sample>();
  for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
    const offset = pixel * 4;
    const r = source.data[offset] ?? 0;
    const g = source.data[offset + 1] ?? 0;
    const b = source.data[offset + 2] ?? 0;
    const key = `${r},${g},${b}`;
    const existing = histogram.get(key);
    if (existing) existing.count += 1;
    else histogram.set(key, { r, g, b, count: 1, lab: rgbToOklab(r, g, b) });
  }

  const samples = [...histogram.values()].sort((a, b) => a.r - b.r || a.g - b.g || a.b - b.b);
  const boxes: Box[] = samples.length === 0 ? [] : [{ samples }];
  while (boxes.length < colourCount) {
    let target = -1;
    let targetWeight = -1;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (!box) continue;
      const weight = box.samples.reduce((sum, sample) => sum + sample.count, 0);
      if (box.samples.length > 1 && weight > targetWeight) {
        target = index;
        targetWeight = weight;
      }
    }
    if (target < 0) break;
    const split = splitBox(boxes[target] as Box);
    if (!split) break;
    boxes.splice(target, 1, split[0], split[1]);
  }

  let palette = boxes.map((box) => representative(box.samples));
  if (palette.length === 0) palette.push([0, 0, 0]);
  // Median cut gives stable seeds; a few weighted Lloyd steps remove the
  // diagonal bias that is particularly visible in two-dimensional gradients.
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const sums: number[][] = palette.map(() => [0, 0, 0, 0]);
    const paletteLab = palette.map(([r, g, b]) => rgbToOklab(r, g, b));
    for (const sample of samples) {
      const index = nearestIndex(sample.r, sample.g, sample.b, paletteLab);
      const sum = sums[index] ?? [0, 0, 0, 0];
      sum[0] = (sum[0] ?? 0) + sample.r * sample.count;
      sum[1] = (sum[1] ?? 0) + sample.g * sample.count;
      sum[2] = (sum[2] ?? 0) + sample.b * sample.count;
      sum[3] = (sum[3] ?? 0) + sample.count;
      sums[index] = sum;
    }
    const next = palette.map((colour, index) => {
      const sum = sums[index] ?? [0, 0, 0, 0];
      const total = sum[3] ?? 0;
      return total === 0 ? colour : [Math.round((sum[0] ?? 0) / total), Math.round((sum[1] ?? 0) / total), Math.round((sum[2] ?? 0) / total)] as Rgb;
    });
    if (next.every((colour, index) => colour[0] === palette[index]?.[0] && colour[1] === palette[index]?.[1] && colour[2] === palette[index]?.[2])) break;
    palette = next;
  }
  const paletteLab = palette.map(([r, g, b]) => rgbToOklab(r, g, b));
  const indices = new Uint16Array(source.width * source.height);
  const useDither = options.dither === 'floyd-steinberg';
  const errors = useDither ? new Float64Array((source.width + 2) * 3) : undefined;
  const nextErrors = useDither ? new Float64Array((source.width + 2) * 3) : undefined;
  for (let y = 0; y < source.height; y += 1) {
    if (errors && nextErrors) nextErrors.fill(0);
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const errorOffset = (x + 1) * 3;
      const r = Math.max(0, Math.min(255, (source.data[offset] ?? 0) + (errors?.[errorOffset] ?? 0)));
      const g = Math.max(0, Math.min(255, (source.data[offset + 1] ?? 0) + (errors?.[errorOffset + 1] ?? 0)));
      const b = Math.max(0, Math.min(255, (source.data[offset + 2] ?? 0) + (errors?.[errorOffset + 2] ?? 0)));
      const index = nearestIndex(r, g, b, paletteLab);
      indices[y * source.width + x] = index;
      if (errors && nextErrors) {
        const colour = palette[index] ?? [0, 0, 0];
        const er = r - colour[0];
        const eg = g - colour[1];
        const eb = b - colour[2];
        const spread = (target: Float64Array, at: number, factor: number): void => {
          target[at] = (target[at] ?? 0) + er * factor;
          target[at + 1] = (target[at + 1] ?? 0) + eg * factor;
          target[at + 2] = (target[at + 2] ?? 0) + eb * factor;
        };
        spread(errors, errorOffset + 3, 7 / 16);
        spread(nextErrors, errorOffset - 3, 3 / 16);
        spread(nextErrors, errorOffset, 5 / 16);
        spread(nextErrors, errorOffset + 3, 1 / 16);
      }
    }
    if (errors && nextErrors) errors.set(nextErrors);
  }
  // Reading the seed is intentional API surface: palette construction itself is deterministic.
  void options.seed;
  return { palette, indices };
}

export function nearestPaletteIndex(r: number, g: number, b: number, palette: readonly Rgb[]): number {
  return nearestIndex(r, g, b, palette.map(([red, green, blue]) => rgbToOklab(red, green, blue)));
}

/** Replace each block by its mean colour mapped to the existing palette. */
export function blockify(source: Bitmap, palette: readonly Rgb[], blockSize: number): Uint16Array {
  const size = Math.max(1, Math.floor(blockSize));
  const indices = new Uint16Array(source.width * source.height);
  for (let top = 0; top < source.height; top += size) {
    for (let left = 0; left < source.width; left += size) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let y = top; y < Math.min(source.height, top + size); y += 1) {
        for (let x = left; x < Math.min(source.width, left + size); x += 1) {
          const offset = (y * source.width + x) * 4;
          red += source.data[offset] ?? 0;
          green += source.data[offset + 1] ?? 0;
          blue += source.data[offset + 2] ?? 0;
          count += 1;
        }
      }
      const index = nearestPaletteIndex(red / count, green / count, blue / count, palette);
      for (let y = top; y < Math.min(source.height, top + size); y += 1) {
        for (let x = left; x < Math.min(source.width, left + size); x += 1) indices[y * source.width + x] = index;
      }
    }
  }
  return indices;
}
