import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { readPng } from '../bench/compare/png';
import { convert, convertFrames, render, replayLuaFrames, type Bitmap } from '../src/core/index';
import { executeLua } from './lua-executor';

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

function expectLosslessContract(result: ReturnType<typeof convert>, budget: number): void {
  expect(result.lua).toBe(result.scripts[0]);
  expect(result.charCount).toBe(result.lua.length);
  expect(result.totalCharCount).toBe(result.scripts.reduce((sum, script) => sum + script.length, 0));
  expect(result.withinBudget).toBe(result.scripts.every((script) => script.length <= budget));
  expect(result.metrics.ssim).toBe(1);
}

describe('Phase 5 lossless output', () => {
  it('keeps an exact single image while exposing the multi-script contract', () => {
    const result = convert(blocks([2])[0] as Bitmap, { mode: 'lossless', budget: 96, seed: 0 });
    expectLosslessContract(result, 96);
    expect(result.scripts.length).toBeGreaterThan(1);
  });

  it('keeps every animation script exact and independently budgeted', () => {
    const frames = blocks([0, 2, 4, 6]);
    const result = convertFrames(frames, { mode: 'lossless', budget: 300, ticksPerFrame: 2, seed: 0 });
    expect(result.lua).toBe(result.scripts[0]);
    expect(result.charCount).toBe(result.lua.length);
    expect(result.totalCharCount).toBe(result.scripts.reduce((sum, script) => sum + script.length, 0));
    expect(result.withinBudget).toBe(result.scripts.every((script) => script.length <= 300));
    expect(result.metrics.ssim).toBe(1);
    for (let scriptIndex = 0; scriptIndex < result.scripts.length; scriptIndex += 1) {
      const range = result.stats.scriptFrameRanges?.[scriptIndex];
      expect(range).toBeDefined();
      const execution = executeLua(result.scripts[scriptIndex] as string, { frameCount: (range?.[1] ?? 0) - (range?.[0] ?? 0), ticksPerFrame: 2 });
      if (execution.skipped) return;
      const rendered = replayLuaFrames(execution.frames, 8, 8);
      for (let frame = 0; frame < rendered.length; frame += 1) expect(rendered[frame]?.data).toEqual(frames[(range?.[0] ?? 0) + frame]?.data);
    }
  });

  it('composes spatially split scripts back into the exact single image', () => {
    const source = blocks([2])[0] as Bitmap;
    const result = convert(source, { mode: 'lossless', budget: 96, seed: 0 });
    let operations = [] as Parameters<typeof render>[0];
    for (const script of result.scripts) {
      const execution = executeLua(script, { frameCount: 1 });
      if (execution.skipped) return;
      operations = [...operations, ...(execution.frames[0] ?? [])];
    }
    expect(render(operations, source.width, source.height).data).toEqual(source.data);
  });

  it('uses one script when the exact output fits, satisfying the minimal-count invariant', () => {
    const result = convert(blocks([2])[0] as Bitmap, { budget: 8192, seed: 0 });
    expectLosslessContract(result, 8192);
    expect(result.scripts).toHaveLength(1);
    expect(result.totalCharCount).toBe(result.charCount);
  });

  it('does not let fit be dominated by a lossless single-script candidate', () => {
    const fixtures = [blocks([0, 2, 4]), blocks([0, 2, 4, 6]), blocks([0, 1, 2, 3, 4])];
    for (const frames of fixtures) {
      for (const budget of [500, 1000, 8192]) {
        const lossless = convertFrames(frames, { mode: 'lossless', budget, ticksPerFrame: 2, seed: 0 });
        if (!lossless.withinBudget || lossless.scripts.length !== 1) continue;
        const fit = convertFrames(frames, { mode: 'fit', budget, ticksPerFrame: 2, seed: 0 });
        expect(fit.charCount).toBeLessThanOrEqual(lossless.charCount);
        expect(fit.metrics.ssim).toBeGreaterThanOrEqual(lossless.metrics.ssim - 1e-12);
      }
    }
  });

  it('does not reuse a fit candidate after the caller mutates bitmap data', () => {
    const source = blocks([2])[0] as Bitmap;
    const first = convert(source, { mode: 'fit', budget: 8192, seed: 0 });
    source.data.fill(0);
    for (let pixel = 0; pixel < source.width * source.height; pixel += 1) source.data[pixel * 4 + 3] = 255;
    const second = convert(source, { mode: 'fit', budget: 8192, seed: 0 });

    expect(second.lua).not.toBe(first.lua);
    expect(second.rendered.data).toEqual(source.data);
    expect(second.metrics.ssim).toBe(1);
  });

  it('compresses the repeated patterns in the real animation into one script', () => {
    const root = '/Users/yuki/doc/al/pngX';
    if (!existsSync(root)) return;
    const frames = readdirSync(root)
      .filter((name) => name.endsWith('.png'))
      .sort()
      .map((name) => readPng(`${root}/${name}`));
    const result = convertFrames(frames, { mode: 'lossless', budget: 8192, ticksPerFrame: 6 });

    expect(result.metrics.ssim).toBe(1);
    expect(result.scripts).toHaveLength(1);
    expect(result.totalCharCount).toBeLessThan(7979);
    for (let scriptIndex = 0; scriptIndex < result.scripts.length; scriptIndex += 1) {
      const range = result.stats.scriptFrameRanges?.[scriptIndex];
      expect(range).toBeDefined();
      const execution = executeLua(result.scripts[scriptIndex] as string, {
        frameCount: (range?.[1] ?? 0) - (range?.[0] ?? 0),
        ticksPerFrame: 6,
        drawInitialFrame: true,
      });
      if (execution.skipped) return;
      const rendered = replayLuaFrames(execution.frames, 64, 32);
      for (let frame = 0; frame < rendered.length; frame += 1) {
        expect(rendered[frame]?.data).toEqual(frames[(range?.[0] ?? 0) + frame]?.data);
      }
    }
  });
});
