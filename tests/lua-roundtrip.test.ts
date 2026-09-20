import { describe, expect, it } from 'vitest';
import { convert, convertFrames, replayLuaFrames, type Bitmap, type EmitStrategy } from '../src/core/index';
import { executeLua } from './lua-executor';

function frame(width: number, height: number, shift: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const active = x >= shift && x < shift + 3 && y >= 2 && y < 6;
    const offset = (y * width + x) * 4;
    data[offset] = active ? 230 : 15;
    data[offset + 1] = active ? 170 : 25;
    data[offset + 2] = active ? 40 : 45;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

describe('Lua round-trip verification', () => {
  it.each(['direct', 'table', 'packed'] as const)('executes the %s emitter and reproduces rectangles', (strategy: EmitStrategy) => {
    const source = frame(8, 8, 2);
    const result = convert(source, { mode: 'fit', budget: 8192, maxColours: 2, strategies: [strategy], seed: 0 });
    const execution = executeLua(result.lua, { frameCount: 1 });
    if (execution.skipped) return;
    expect(execution.skipped).toBe(false);
    const [rendered] = replayLuaFrames(execution.frames, source.width, source.height);
    expect(rendered?.data).toEqual(source.data);
  });

  it.each(['direct', 'table', 'packed'] as const)('executes %s convertFrames playback across ticks', (strategy: EmitStrategy) => {
    const frames = [frame(8, 8, 0), frame(8, 8, 2), frame(8, 8, 4)];
    const result = convertFrames(frames, { mode: 'fit', budget: 8192, maxColours: 2, strategies: [strategy], ticksPerFrame: 2, seed: 0 });
    const execution = executeLua(result.lua, { frameCount: frames.length, ticksPerFrame: 2, drawInitialFrame: true });
    if (execution.skipped) return;
    expect(execution.skipped).toBe(false);
    const rendered = replayLuaFrames(execution.frames, 8, 8);
    expect(rendered).toHaveLength(frames.length);
    for (let index = 0; index < frames.length; index += 1) expect(rendered[index]?.data).toEqual(frames[index]?.data);
  });
});
