import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { convert, convertFrames, ssim, type Bitmap } from '../src/core/index';

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

function dictionaryFrame(width: number, height: number, shift: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const light = (x + shift + y) % 3 === 0;
    data[offset] = light ? 220 : 20;
    data[offset + 1] = light ? 120 : 30;
    data[offset + 2] = light ? 40 : 50;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function highColourAnimation(): Bitmap[] {
  const frames: Bitmap[] = [];
  for (let frame = 0; frame < 30; frame += 1) {
    const width = 96;
    const height = 32;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const colour = ((Math.floor(x / 8) + Math.floor(y / 8) * 12 + frame * 48) % 256) as number;
      data[offset] = (colour * 47) % 256;
      data[offset + 1] = (colour * 83) % 256;
      data[offset + 2] = (colour * 131) % 256;
      data[offset + 3] = 255;
    }
    frames.push({ width, height, data });
  }
  return frames;
}

function convertFramesWithClock(frames: readonly Bitmap[], mode: 'fit' | 'lossless', clock: () => number): ReturnType<typeof convertFrames> {
  const spy = vi.spyOn(performance, 'now').mockImplementation(clock);
  try {
    return convertFrames(frames, { budget: 8192, maxColours: 256, mode, seed: 0, ticksPerFrame: 6 });
  } finally {
    spy.mockRestore();
  }
}

function luaAvailable(): boolean {
  const result = spawnSync('lua', ['-e', ''], { input: '', encoding: 'utf8' });
  return result.error?.code !== 'ENOENT';
}

describe('convertFrames', () => {
  it('stores variable-length column patterns in one delimiter-separated dictionary string', () => {
    const frames = [
      dictionaryFrame(8, 8, 0),
      dictionaryFrame(8, 8, 2),
      dictionaryFrame(8, 8, 4),
      dictionaryFrame(8, 8, 1),
    ];
    const result = convertFrames(frames, { mode: 'lossless', budget: 8192, ticksPerFrame: 2 });

    expect(result.lua).toContain('q="');
    expect(result.lua).not.toContain('q={');
    expect(result.lua).toContain('local Q={}for z in string.gmatch(q,"[^!]+")do Q[#Q+1]=z end');
    expect(result.lua).toContain('local s=Q[n+1]');
    expect(result.lua).not.toContain('local s for z in string.gmatch');
  });

  it('is byte deterministic and reports exact character and budget invariants', () => {
    const frames = [solid(8, 8, 20, 30, 40), solid(8, 8, 40, 50, 60)];
    const first = convertFrames(frames, { mode: 'fit', seed: 17, budget: 8192, ticksPerFrame: 3 });
    const second = convertFrames(frames, { mode: 'fit', seed: 17, budget: 8192, ticksPerFrame: 3 });

    expect(second.lua).toBe(first.lua);
    expect(first.charCount).toBe(first.lua.length);
    expect(first.withinBudget).toBe(first.charCount <= 8192);
  });

  it('is byte deterministic for a high-colour animation regardless of clock progress', () => {
    const frames = highColourAnimation();
    for (const mode of ['fit', 'lossless'] as const) {
      const idle = convertFramesWithClock(frames, mode, () => 0);
      let calls = 0;
      const loaded = convertFramesWithClock(frames, mode, () => {
        calls += 1;
        return calls <= 2 ? 0 : 10_000;
      });
      expect(loaded.lua).toBe(idle.lua);
      expect(loaded.stats.timeBudgetTruncated).toBe(mode === 'fit');
      expect(idle.stats.timeBudgetTruncated).toBe(mode === 'fit');
    }
  }, 30000);

  it('uses the first frame for the preview and averages metrics across frames', () => {
    const first = solid(16, 16, 20, 30, 40);
    const second = solid(16, 16, 240, 230, 220);
    const result = convertFrames([first, second], { mode: 'fit', maxColours: 1, budget: 8192 });

    expect(result.rendered.data[0]).toBe(130);
    expect(result.rendered.data[1]).toBe(130);
    expect(result.rendered.data[2]).toBe(130);
    expect(result.metrics.ssim).toBeCloseTo((ssim(first, result.rendered) + ssim(second, result.rendered)) / 2, 12);
    expect(result.metrics.ssim).not.toBeCloseTo(ssim(first, result.rendered), 12);
  });

  it('matches convert for a single-frame input', () => {
    const source = solid(12, 10, 80, 90, 100);
    const single = convert(source, { mode: 'fit', seed: 4, budget: 8192, maxColours: 2 });
    const animated = convertFrames([source], { mode: 'fit', seed: 4, budget: 8192, maxColours: 2, ticksPerFrame: 9 });

    expect(animated.lua).toBe(single.lua);
    expect(animated.charCount).toBe(single.charCount);
    expect(animated.strategy).toBe(single.strategy);
    expect(Array.from(animated.rendered.data)).toEqual(Array.from(single.rendered.data));
    expect(animated.metrics).toEqual(single.metrics);
  });

  it('keeps the generated frame sequence identical across two complete cycles', () => {
    const frames = [solid(8, 8, 20, 30, 40), solid(8, 8, 40, 50, 60), solid(8, 8, 20, 30, 40)];
    const result = convertFrames(frames, { mode: 'fit', budget: 8192, ticksPerFrame: 2 });
    const syntax = spawnSync('lua', ['-e', 'local f,e=load(io.read("*a"));assert(f,e)'], { input: result.lua, encoding: 'utf8' });
    if (syntax.error?.code === 'ENOENT' || !luaAvailable()) return;
    expect(syntax.status, syntax.stderr).toBe(0);

    const harness = `
screen={}
local canvas={}
local colour={0,0,0}
function screen.setColor(r,g,b) colour={r,g,b} end
function screen.drawRectF(x,y,w,h)
  for y0=math.floor(y),math.floor(y+h)-1 do for x0=math.floor(x),math.floor(x+w)-1 do canvas[y0..":"..x0]={colour[1],colour[2],colour[3]} end end
end
function screen.drawRect(...) end
function screen.drawLine(...) end
local function snapshot()
  local keys={}
  for key,value in pairs(canvas) do keys[#keys+1]=key..":"..value[1]..","..value[2]..","..value[3] end
  table.sort(keys)
  return table.concat(keys,"|")
end
${result.lua}
local frames=${result.stats.frameCount ?? frames.length}
local ticks=${2}
local snapshots={}
onDraw(); snapshots[1]=snapshot()
for tick=1,(frames*ticks*2) do
  onTick()
  if tick%ticks==0 then onDraw(); snapshots[#snapshots+1]=snapshot() end
end
for index=1,frames do assert(snapshots[index] == snapshots[index+frames], "loop seam at "..index) end
`;
    const simulated = spawnSync('lua', ['-e', 'local f,e=load(io.read("*a"));assert(f,e);f()'], { input: harness, encoding: 'utf8' });
    expect(simulated.status, simulated.stderr).toBe(0);
  });

  it('is syntactically valid Lua', () => {
    const result = convertFrames([solid(4, 4, 20, 30, 40), solid(4, 4, 40, 50, 60)], { mode: 'fit', budget: 8192 });
    const parsed = spawnSync('lua', ['-e', 'local f,e=load(io.read("*a"));assert(f,e)'], { input: result.lua, encoding: 'utf8' });
    if (parsed.error?.code === 'ENOENT') return;
    expect(parsed.status, parsed.stderr).toBe(0);
  });
});
