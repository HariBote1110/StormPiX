import { describe, expect, it } from 'vitest';
import { convertFrames, type Bitmap } from '../src/core/index';

function patternedFrames(frameCount: number, width: number, height: number): Bitmap[] {
  return Array.from({ length: frameCount }, (_, frame) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 31 + y * 17 + frame * 13) % 256;
      data[offset + 1] = (x * 19 + y * 37 + frame * 29) % 256;
      data[offset + 2] = (x * 43 + y * 11 + frame * 7) % 256;
      data[offset + 3] = 255;
    }
    return { width, height, data };
  });
}

function dictionaryFavouringFrames(): Bitmap[] {
  const width = 96;
  const height = 32;
  const colours = Array.from({ length: 16 }, (_, index) => [
    (index * 47) % 256,
    (index * 83) % 256,
    (index * 131) % 256,
  ] as const);
  const columns = Array.from({ length: 48 }, (_, column) => Array.from({ length: height }, (_, row) => (column * 11 + row * 7 + row * row) % colours.length));
  return Array.from({ length: 8 }, (_, frame) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const colour = colours[columns[(x + frame * 13) % columns.length]?.[y] ?? 0] as readonly [number, number, number];
      const offset = (y * width + x) * 4;
      data[offset] = colour[0];
      data[offset + 1] = colour[1];
      data[offset + 2] = colour[2];
      data[offset + 3] = 255;
    }
    return { width, height, data };
  });
}

describe('fit animation splitting', () => {
  it('chooses a high-quality dictionary fit over a lower-quality plain fit', () => {
    const result = convertFrames(dictionaryFavouringFrames(), { mode: 'fit', budget: 8192, maxColours: 16, seed: 0, ticksPerFrame: 6 });

    expect(result.scripts).toHaveLength(1);
    expect(result.withinBudget).toBe(true);
    expect(result.metrics.ssim).toBeGreaterThanOrEqual(0.99);
    expect(result.lua).toContain('q="');
  }, 120000);

  it('keeps a one-script fit result as one script when it fits', () => {
    const result = convertFrames(patternedFrames(2, 8, 8), { mode: 'fit', budget: 8192, seed: 0, ticksPerFrame: 2 });

    expect(result.scripts).toHaveLength(1);
    expect(result.lua).toBe(result.scripts[0]);
    expect(result.totalCharCount).toBe(result.lua.length);
    expect(result.withinBudget).toBe(true);
  });

  it('splits the selected fit animation when no one-script candidate fits', () => {
    const budget = 200;
    const result = convertFrames(patternedFrames(12, 24, 16), { mode: 'fit', budget, seed: 0, ticksPerFrame: 2 });

    expect(result.scripts.length).toBeGreaterThan(1);
    expect(result.scripts.every((script) => script.length <= budget)).toBe(true);
    expect(result.withinBudget).toBe(true);
    expect(result.totalCharCount).toBe(result.scripts.reduce((sum, script) => sum + script.length, 0));
  });

  it('reports failure when an individual fit frame cannot fit', () => {
    const budget = 60;
    const result = convertFrames(patternedFrames(2, 24, 16), { mode: 'fit', budget, seed: 0, ticksPerFrame: 2 });

    expect(result.withinBudget).toBe(false);
    expect(result.scripts.some((script) => script.length > budget)).toBe(true);
  });
});
