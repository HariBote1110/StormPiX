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
});
