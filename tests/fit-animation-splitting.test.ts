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

describe('fit animation splitting', () => {
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
