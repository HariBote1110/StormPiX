import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { convertFrames, render, replayLuaFrames, type Bitmap } from '../src/core/index';
import { readPng } from '../bench/compare/png';
import { executeLua } from './lua-executor';

function frame(shift: number): Bitmap {
  const width = 8;
  const height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const active = x >= shift && x < shift + 2 && y >= 2 && y < 6;
    data[offset] = active ? 240 : 12;
    data[offset + 1] = active ? 180 : 24;
    data[offset + 2] = active ? 60 : 36;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

describe('外部フレーム番号', () => {
  it('astral_opening の圧縮Lua成果物を生成結果と同期する', () => {
    const artifact = 'artifacts/astral_opening.lua';
    expect(existsSync(artifact)).toBe(true);
    const root = '/Users/yuki/doc/astral_opening';
    if (!existsSync(root)) return;
    const frames = readdirSync(root).filter((name) => name.endsWith('.png')).sort().slice(0, 30).map((name) => readPng(`${root}/${name}`));
    const generated = convertFrames(frames, { mode: 'lossless', budget: 8_192, seed: 0 });
    expect(readFileSync(artifact, 'utf8').trimEnd()).toBe(generated.lua);
  });

  it('未指定時は従来の自動再生 Lua をバイト単位で維持する', () => {
    const frames = [frame(0), frame(2), frame(4), frame(6)];
    const omitted = convertFrames(frames, { mode: 'lossless', budget: 300, ticksPerFrame: 2, seed: 0 });
    const undefinedChannel = convertFrames(frames, { mode: 'lossless', budget: 300, ticksPerFrame: 2, frameChannel: undefined, seed: 0 });

    expect(undefinedChannel.scripts).toEqual(omitted.scripts);
    expect(undefinedChannel.totalCharCount).toBe(omitted.totalCharCount);
  });

  it('astral_opening を単一のlossless Lua 8,192文字以内で再生する', () => {
    const root = '/Users/yuki/doc/astral_opening';
    if (!existsSync(root)) return;
    const frames = readdirSync(root).filter((name) => name.endsWith('.png')).sort().slice(0, 30).map((name) => readPng(`${root}/${name}`));
    const result = convertFrames(frames, { mode: 'lossless', budget: 8_192, seed: 0 });
    expect(result.withinBudget).toBe(true);
    expect(result.scripts).toHaveLength(1);
    expect(result.totalCharCount).toBeLessThanOrEqual(5_730);
    expect(result.lua).toContain('function R(k)');
    expect(result.lua).not.toContain('function W(s,i)');
    expect(result.lua).not.toContain('seen={}');
    const palette = result.lua.match(/P="([^"]*)"/)?.[1] ?? '';
    expect(palette).toMatch(/^[0-9A-Za-z>?]+$/);
    expect(palette.length).toBeLessThan(300);
    expect(result.lua.match(/d="([^"]*)"/)?.[1]).toMatch(/^[0-9A-Za-z>?!]+$/);
    const execution = executeLua(result.lua, { frameCount: frames.length, ticksPerFrame: 6, drawInitialFrame: true, width: 96, height: 32 });
    if (execution.skipped) return;
    expect(execution.frames).toHaveLength(frames.length);
    const rendered = replayLuaFrames(execution.frames, 96, 32);
    for (let index = 0; index < frames.length; index += 1) expect(rendered[index]?.data).toEqual(frames[index]?.data);
  });

  it('Lua で順不同のグローバル添字を完全フレームとして描画し、範囲外と小数は何も描かない', () => {
    const frames = [frame(0), frame(2), frame(4), frame(6)];
    const result = convertFrames(frames, { mode: 'lossless', budget: 300, ticksPerFrame: 2, frameChannel: 7, seed: 0 });

    expect(result.scripts.length).toBeGreaterThan(1);
    expect(result.scripts.every((script) => script.includes('function onTick()f=input.getNumber(7)end'))).toBe(true);
    expect(result.stats.encoding).toBe('full');

    for (const frameNumber of [3, 0, 2, 1]) {
      const scriptIndex = result.stats.scriptFrameRanges?.findIndex(([start, end]) => frameNumber >= start && frameNumber < end) ?? -1;
      expect(scriptIndex).toBeGreaterThanOrEqual(0);
      const execution = executeLua(result.scripts[scriptIndex] as string, { frameCount: 1, inputNumbers: [0, 0, 0, 0, 0, 0, frameNumber] });
      if (execution.skipped) return;
      expect(render(execution.frames[0] ?? [], 8, 8).data).toEqual(frames[frameNumber]?.data);
    }

    const first = result.scripts[0] as string;
    for (const input of [-1, 0.5, 4]) {
      const execution = executeLua(first, { frameCount: 1, inputNumbers: [0, 0, 0, 0, 0, 0, input] });
      if (execution.skipped) return;
      expect(execution.frames).toEqual([]);
    }
  });
});
