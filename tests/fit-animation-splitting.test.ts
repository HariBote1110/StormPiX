import { describe, expect, it } from 'vitest';
import { convertFrames, render, type Bitmap } from '../src/core/index';
import { executeLuaScripts } from './lua-executor';

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

function splitPlaybackFrames(): Bitmap[] {
  return Array.from({ length: 8 }, (_, frame) => {
    const width = 16;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const active = (x + frame) % width < 8;
      data[offset] = active ? 255 : 0;
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

  it('外部フレーム番号指定時だけ、収まらない fit アニメーションを分割する', () => {
    const budget = 200;
    const result = convertFrames(patternedFrames(12, 24, 16), { mode: 'fit', budget, seed: 0, ticksPerFrame: 2, frameChannel: 1 });

    expect(result.scripts.length).toBeGreaterThan(1);
    expect(result.scripts.every((script) => script.length <= budget)).toBe(true);
    expect(result.withinBudget).toBe(true);
    expect(result.totalCharCount).toBe(result.scripts.reduce((sum, script) => sum + script.length, 0));
  });

  it('単一スクリプトより SSIM が高い複数スクリプト候補を選ぶ', () => {
    const frames = patternedFrames(12, 24, 16);
    const lowerQualitySingle = convertFrames(frames, { mode: 'fit', budget: 500, maxColours: 16, seed: 0, ticksPerFrame: 2 });
    const split = convertFrames(frames, { mode: 'fit', budget: 1500, maxColours: 16, seed: 0, ticksPerFrame: 2, frameChannel: 1 });

    expect(lowerQualitySingle.scripts).toHaveLength(1);
    expect(lowerQualitySingle.scripts[0]?.length).toBeLessThanOrEqual(1500);
    expect(split.scripts.length).toBeGreaterThan(1);
    expect(split.scripts.every((script) => script.length <= 1500)).toBe(true);
    expect(split.metrics.ssim).toBeGreaterThan(lowerQualitySingle.metrics.ssim);
  });

  it('分割 fit は実 Lua で共通入力の各フレームだけを任意順に描画する', () => {
    const frames = splitPlaybackFrames();
    const result = convertFrames(frames, { mode: 'fit', budget: 400, ticksPerFrame: 1, seed: 0, frameChannel: 1 });
    expect(result.scripts.length).toBeGreaterThan(1);
    expect(result.scripts.every((script) => script.length <= 400)).toBe(true);
    const frameNumbers = [3, 0, 7, 2, 6, 1, 5, 4];
    const execution = executeLuaScripts(result.scripts, { frameCount: frames.length, inputChannel: 1, frameNumbers });
    if (execution.skipped) return;
    expect(execution.frames).toHaveLength(frameNumbers.length);
    for (let index = 0; index < frameNumbers.length; index += 1) {
      const frame = frameNumbers[index] as number;
      expect(execution.scriptIndexes[index]).toBe(result.stats.scriptFrameRanges?.findIndex(([start, end]) => frame >= start && frame < end));
      expect(render(execution.frames[index] ?? [], 16, 16).data).toEqual(frames[frame]?.data);
    }
  });

  it('外部フレーム番号なしでは、分割可能でも単一スクリプトを返し品質不足を知らせる', () => {
    const result = convertFrames(splitPlaybackFrames(), { mode: 'fit', budget: 400, ticksPerFrame: 1, seed: 0 });

    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]?.length).toBeLessThanOrEqual(400);
    expect(result.stats.splittingRequiresFrameChannel).toBe(true);
  });

  it('単一スクリプトに収まる場合は外部フレーム番号不要を報告しない', () => {
    const frames = patternedFrames(2, 8, 8);
    const withoutChannel = convertFrames(frames, { mode: 'fit', budget: 8192, seed: 0, ticksPerFrame: 2 });

    expect(withoutChannel.scripts).toHaveLength(1);
    expect(withoutChannel.stats.splittingRequiresFrameChannel).toBeFalsy();
    expect(withoutChannel.lua).toContain('t=t+1');
  });

  it('reports failure when an individual fit frame cannot fit', () => {
    const budget = 60;
    const result = convertFrames(patternedFrames(2, 24, 16), { mode: 'fit', budget, seed: 0, ticksPerFrame: 2 });

    expect(result.withinBudget).toBe(false);
    expect(result.scripts.some((script) => script.length > budget)).toBe(true);
  });
});
