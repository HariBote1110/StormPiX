import { describe, expect, it } from 'vitest';
import { convert, convertFrames, type Bitmap } from '../src/core/index';

function blocks(shifts: readonly number[]): readonly Bitmap[] {
  return shifts.map((shift) => {
    const width = 8;
    const height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const active = x >= shift && x < shift + 2 && y >= 2 && y < 6;
      const offset = (y * width + x) * 4;
      data[offset] = active ? 240 : 12;
      data[offset + 1] = active ? 180 : 24;
      data[offset + 2] = active ? 60 : 36;
      data[offset + 3] = 255;
    }
    return { width, height, data };
  });
}

function expectLosslessContract(result: ReturnType<typeof convert>): void {
  expect(result.lua).toBe(result.scripts[0]);
  expect(result.charCount).toBe(result.lua.length);
  expect(result.totalCharCount).toBe(result.scripts.reduce((sum, script) => sum + script.length, 0));
  expect(result.withinBudget).toBe(result.scripts.every((script) => script.length <= 96));
  expect(result.metrics.ssim).toBe(1);
}

describe('Phase 5 lossless output', () => {
  it('keeps an exact single image while exposing the multi-script contract', () => {
    const result = convert(blocks([2])[0] as Bitmap, { mode: 'lossless', budget: 96, seed: 0 });
    expectLosslessContract(result);
    expect(result.scripts.length).toBeGreaterThan(1);
  });

  it('keeps every animation script exact and independently budgeted', () => {
    const result = convertFrames(blocks([0, 2, 4, 6]), { mode: 'lossless', budget: 96, ticksPerFrame: 2, seed: 0 });
    expect(result.lua).toBe(result.scripts[0]);
    expect(result.charCount).toBe(result.lua.length);
    expect(result.totalCharCount).toBe(result.scripts.reduce((sum, script) => sum + script.length, 0));
    expect(result.withinBudget).toBe(result.scripts.every((script) => script.length <= 96));
    expect(result.metrics.ssim).toBe(1);
  });

  it('uses one script when the exact output fits, satisfying the minimal-count invariant', () => {
    const result = convert(blocks([2])[0] as Bitmap, { mode: 'lossless', budget: 8192, seed: 0 });
    expectLosslessContract(result);
    expect(result.scripts).toHaveLength(1);
    expect(result.totalCharCount).toBe(result.charCount);
  });
});
