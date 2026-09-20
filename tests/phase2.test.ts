import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  cover,
  coverScanline,
  convert,
  costOf,
  emitLua,
  quantise,
  type Bitmap,
  type DrawOp,
} from '../src/core/index';

function solid(width: number, height: number, r: number, g: number, b: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

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

const ops: DrawOp[] = [
  { type: 'setColour', r: 20, g: 30, b: 40 },
  { type: 'rectF', x: 0, y: 0, w: 4, h: 3 },
];

describe('Phase 2 emit strategies', () => {
  it('measures every strategy from the exact emitted Lua', () => {
    for (const strategy of ['direct', 'table', 'packed'] as const) {
      const lua = emitLua(ops, strategy);
      expect(lua.length).toBe(costOf(ops, strategy));
      expect(lua).toContain('screen.setColor');
    }
  });

  it('beats unmerged scanlines on a four-colour quadrant image', () => {
    const data = new Uint8ClampedArray(16 * 16 * 4);
    const colours = [[220, 40, 40], [40, 180, 80], [50, 90, 220], [220, 190, 40]];
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
      const colour = colours[(x < 8 ? 0 : 1) + (y < 8 ? 0 : 2)] as number[];
      const offset = (y * 16 + x) * 4;
      data[offset] = colour[0] ?? 0;
      data[offset + 1] = colour[1] ?? 0;
      data[offset + 2] = colour[2] ?? 0;
      data[offset + 3] = 255;
    }
    const source: Bitmap = { width: 16, height: 16, data };
    const quantised = quantise(source, 4);
    const image = { width: source.width, height: source.height, indices: quantised.indices };
    expect(costOf(cover(image, quantised.palette), 'direct')).toBeLessThan(costOf(coverScanline(image, quantised.palette), 'direct'));
  });

  it('produces syntactically valid Lua when an interpreter is available', () => {
    const source = solid(4, 4, 20, 30, 40);
    for (const strategy of ['direct', 'table', 'packed'] as const) {
      const result = convert(source, { budget: 8192, strategies: [strategy] });
      const parsed = spawnSync('lua', ['-e', 'local f,e=load(io.read("*a"));assert(f,e)'], { input: result.lua, encoding: 'utf8' });
      if (parsed.error?.code === 'ENOENT') return;
      expect(parsed.status, parsed.stderr).toBe(0);
    }
  });
});

describe('convert', () => {
  it('returns a compact exact result for a flat bitmap', () => {
    const source = solid(32, 32, 38, 120, 210);
    const result = convert(source, { budget: 8192, seed: 7 });

    expect(result.charCount).toBe(result.lua.length);
    expect(result.withinBudget).toBe(true);
    expect(result.metrics.ssim).toBeGreaterThanOrEqual(0.999);
    expect(result.charCount).toBeLessThanOrEqual(120);
    expect(result.rendered.data).toEqual(source.data);
  });

  it('is byte deterministic for a fixed seed', () => {
    const source = solid(8, 8, 80, 90, 100);
    const first = convert(source, { seed: 11, maxColours: 2 });
    const second = convert(source, { seed: 11, maxColours: 2 });
    expect(second.lua).toBe(first.lua);
    expect(Array.from(second.rendered.data)).toEqual(Array.from(first.rendered.data));
  });

  it('does not spend more characters or claim higher quality at a lower budget', () => {
    const source = solid(16, 16, 80, 90, 100);
    const generous = convert(source, { budget: 8192, seed: 3 });
    const constrained = convert(source, { budget: 120, seed: 3 });
    expect(constrained.charCount).toBeLessThanOrEqual(generous.charCount);
    expect(constrained.metrics.ssim).toBeLessThanOrEqual(generous.metrics.ssim + 1e-12);
  });

  it('uses the budget or reaches visually exact quality across the photo budget sweep', () => {
    const source = photoLike();
    const budgets = [60, 100, 200, 300, 500, 1000, 2000, 4000, 8192];
    const results = budgets.map((budget) => convert(source, { budget, seed: 0, timeBudgetMs: 5000 }));

    for (const [index, result] of results.entries()) {
      const budget = budgets[index] as number;
      expect(result.charCount / budget >= 0.85 || result.metrics.ssim >= 0.999).toBe(true);
      expect(result.charCount).toBeLessThanOrEqual(budget);
      expect(result.stats.elapsedMs).toBeLessThanOrEqual(5000);
    }
  }, 60000);

  it('makes a strict quality gain at the required doubled budgets', () => {
    const source = photoLike();
    const results = new Map([100, 200, 500, 1000, 2000, 4000].map((budget) => [budget, convert(source, { budget, seed: 0, timeBudgetMs: 5000 })]));

    expect(results.get(200)?.metrics.ssim).toBeGreaterThan(results.get(100)?.metrics.ssim ?? 0);
    expect(results.get(1000)?.metrics.ssim).toBeGreaterThan(results.get(500)?.metrics.ssim ?? 0);
    expect(results.get(4000)?.metrics.ssim).toBeGreaterThan(results.get(2000)?.metrics.ssim ?? 0);
  }, 60000);

  it('emits the best fitting partial programme at a tiny budget', () => {
    const result = convert(photoLike(), { budget: 60, seed: 0, timeBudgetMs: 5000 });

    expect(result.charCount).toBeGreaterThan(20);
    expect(result.charCount).toBeLessThanOrEqual(60);
    expect(result.metrics.ssim).toBeGreaterThanOrEqual(0.5);
  });
});
