import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { readPng } from '../bench/compare/png';
import { convert, convertFrames, monitorDeviceTarget, replayLuaFrames, type Bitmap } from '../src/core/index';
import { executeLua } from './lua-executor';

function bitmap(values: readonly [number, number, number][]): Bitmap {
  const data = new Uint8ClampedArray(values.length * 4);
  for (let index = 0; index < values.length; index += 1) data.set([...(values[index] as [number, number, number]), 255], index * 4);
  return { width: values.length, height: 1, data };
}

describe('monitor gamma', () => {
  it('keeps gamma disabled byte-identical to the existing output', () => {
    const source = bitmap([[21, 100, 255]]);
    expect(convert(source, { mode: 'lossless', budget: 8192, seed: 0 }).lua)
      .toBe(convert(source, { mode: 'lossless', gamma: false, budget: 8192, seed: 0 }).lua);
  });

  it('emits monitor-input colours and measures losslessness against the reachable device target', () => {
    const source = bitmap([[21, 100, 255]]);
    const target = monitorDeviceTarget(source);
    const result = convert(source, { mode: 'lossless', gamma: true, budget: 8192, seed: 0 });

    expect(Array.from(target.bitmap.data)).toEqual([23, 102, 246, 255]);
    expect(result.lua).toContain('screen.setColor(2,15,255)');
    expect(result.rendered.data).toEqual(target.bitmap.data);
    expect(result.metrics.ssim).toBe(1);
    expect(result.stats.deviceMaxAbsChannelDeviation).toBe(9);
    expect(result.stats.deviceMeanAbsChannelDeviation).toBeCloseTo(13 / 3, 12);

    const execution = executeLua(result.lua, { frameCount: 1 });
    expect(execution.skipped).toBe(false);
    const [displayed] = replayLuaFrames(execution.frames, source.width, source.height, true);
    expect(displayed?.data).toEqual(target.bitmap.data);
  });

  it('replays every gamma-corrected real-asset frame as its displayed device target', () => {
    const root = '/Users/yuki/doc/al/pngX';
    if (!existsSync(root)) return;
    const frames = readdirSync(root).filter((name) => /^\d{3}\.png$/.test(name)).sort().map((name) => readPng(`${root}/${name}`));
    const result = convertFrames(frames, { mode: 'lossless', gamma: true, budget: 8192, ticksPerFrame: 6, seed: 0 });
    const execution = executeLua(result.lua, { frameCount: frames.length, ticksPerFrame: 6, drawInitialFrame: true });

    expect(execution.skipped).toBe(false);
    const displayed = replayLuaFrames(execution.frames, 64, 32, true);
    for (let index = 0; index < displayed.length; index += 1) expect(displayed[index]?.data).toEqual(monitorDeviceTarget(frames[index] as Bitmap).bitmap.data);
    expect(result.metrics.ssim).toBe(1);
  });
});
