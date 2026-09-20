import { describe, expect, it, vi } from 'vitest';
import { convert, type Bitmap } from '../src/core/index';

function photoLike(): Bitmap {
  const width = 96;
  const height = 96;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const gradient = (x + y) / 190;
    let r = Math.round(40 + 215 * gradient);
    let g = Math.round(90 + 160 * gradient);
    let b = Math.round(180 - 90 * gradient);
    if ((x - 64) ** 2 + (y - 32) ** 2 <= 18 ** 2) [r, g, b] = [255, 255, 255];
    if (x >= 8 && x < 48 && y >= 70 && y < 88) [r, g, b] = [15, 15, 15];
    const offset = (y * width + x) * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function runWithClock(source: Bitmap, timeBudgetMs: number, clock: () => number): ReturnType<typeof convert> {
  const spy = vi.spyOn(performance, 'now').mockImplementation(clock);
  try {
    return convert(source, { budget: 8192, seed: 0, timeBudgetMs });
  } finally {
    spy.mockRestore();
  }
}

describe('deterministic conversion work', () => {
  it('does not depend on wall-clock progress across mapped work-budget tiers', () => {
    const source = photoLike();
    for (const timeBudgetMs of [2500, 3000, 3500]) {
      const idle = runWithClock(source, timeBudgetMs, () => 0);
      let ticks = 0;
      const loaded = runWithClock(source, timeBudgetMs, () => { ticks += 1; return ticks <= 2 ? 0 : 1000; });
      expect(loaded.lua).toBe(idle.lua);
      expect(loaded.stats.timeBudgetTruncated).toBe(false);
    }
  }, 30000);
});
