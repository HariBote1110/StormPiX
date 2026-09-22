import { rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { DrawOp } from '../src/core/index';
import type { LuaExecution, LuaExecutor } from '../src/core/lua';

function numberOrText(value: string): number | string {
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

function parseFrame(line: string): DrawOp[] {
  if (line.length === 0) return [];
  const ops: DrawOp[] = [];
  for (const encoded of line.split('\u001e')) {
    const fields = encoded.split('|');
    const name = fields.shift();
    const values = fields.map(numberOrText);
    if (name === 'setColor' && typeof values[0] === 'number' && typeof values[1] === 'number' && typeof values[2] === 'number') ops.push({ type: 'setColour', r: values[0], g: values[1], b: values[2], ...(typeof values[3] === 'number' ? { a: values[3] } : {}) });
    else if (name === 'drawRectF' && values.every((value) => typeof value === 'number')) ops.push({ type: 'rectF', x: values[0] as number, y: values[1] as number, w: values[2] as number, h: values[3] as number });
    else if (name === 'drawRect' && values.every((value) => typeof value === 'number')) ops.push({ type: 'rect', x: values[0] as number, y: values[1] as number, w: values[2] as number, h: values[3] as number });
    else if (name === 'drawLine' && values.every((value) => typeof value === 'number')) ops.push({ type: 'line', x1: values[0] as number, y1: values[1] as number, x2: values[2] as number, y2: values[3] as number });
    else if (name === 'drawTriangle' && values.every((value) => typeof value === 'number')) ops.push({ type: 'triangle', x1: values[0] as number, y1: values[1] as number, x2: values[2] as number, y2: values[3] as number, x3: values[4] as number, y3: values[5] as number });
    else if (name === 'drawTriangleF' && values.every((value) => typeof value === 'number')) ops.push({ type: 'triangleF', x1: values[0] as number, y1: values[1] as number, x2: values[2] as number, y2: values[3] as number, x3: values[4] as number, y3: values[5] as number });
    else if (name === 'drawCircle' && values.every((value) => typeof value === 'number')) ops.push({ type: 'circle', x: values[0] as number, y: values[1] as number, radius: values[2] as number });
    else if (name === 'drawCircleF' && values.every((value) => typeof value === 'number')) ops.push({ type: 'circleF', x: values[0] as number, y: values[1] as number, radius: values[2] as number });
    else if (name === 'drawText' && typeof values[0] === 'number' && typeof values[1] === 'number' && typeof values[2] === 'string') ops.push({ type: 'text', x: values[0], y: values[1], text: values[2].replace(/\\\\n/g, '\n') });
    else if (name === 'drawTextBox' && typeof values[0] === 'number' && typeof values[1] === 'number' && typeof values[2] === 'number' && typeof values[3] === 'number' && typeof values[4] === 'string' && typeof values[5] === 'number' && typeof values[6] === 'number') ops.push({ type: 'textBox', x: values[0], y: values[1], w: values[2], h: values[3], text: values[4].replace(/\\\\n/g, '\n'), horizontalAlign: values[5], verticalAlign: values[6] });
  }
  return ops;
}

export class ShellLuaExecutor implements LuaExecutor {
  public constructor(private readonly command = 'lua') {}

  public execute(source: string, options: { readonly frameCount?: number; readonly ticksPerFrame?: number; readonly drawInitialFrame?: boolean; readonly width?: number; readonly height?: number; readonly inputNumbers?: readonly number[] } = {}): LuaExecution {
    const frameCount = Math.max(1, Math.floor(options.frameCount ?? 1));
    const ticksPerFrame = Math.max(1, Math.floor(options.ticksPerFrame ?? 1));
    const initial = options.drawInitialFrame === true;
    const inputNumbers = options.inputNumbers ?? [];
    const width = Math.max(0, Math.floor(options.width ?? 96));
    const height = Math.max(0, Math.floor(options.height ?? 96));
    const inputTable = inputNumbers.map((value, index) => `[${index + 1}]=${Number.isFinite(value) ? value : 0}`).join(',');
    const harness = `
local current={}
local function capture(name,...)
  local fields={name}
  local args={...}
  for i=1,#args do fields[#fields+1]=(tostring(args[i]):gsub("\\n", "\\\\n")) end
  current[#current+1]=table.concat(fields,"|")
end
screen=setmetatable({getWidth=function()return ${width} end,getHeight=function()return ${height} end}, {__index=function(_,name)return function(...)capture(name,...)end end})
input={getBool=function()return false end,getNumber=function(channel)return ({${inputTable}})[channel] or 0 end}
${source}
local function draw()
  io.write(table.concat(current,"\\x1e"),"\\n")
  current={}
end
if ${initial ? 'true' : 'false'} then
  if onDraw then onDraw() end
  draw()
  for frame=2,${frameCount} do
    for tick=1,${ticksPerFrame} do if onTick then onTick() end end
    if onDraw then onDraw() end
    draw()
  end
else
  for frame=1,${frameCount} do
    if onTick then onTick() end
    if onDraw then onDraw() end
    draw()
  end
end
`;
    const path = `/private/tmp/stormpix-lua-${Date.now()}-${Math.floor(Math.random() * 1000000)}.lua`;
    writeFileSync(path, harness, 'utf8');
    try {
      const result = spawnSync(this.command, [path], { input: '', encoding: 'utf8' });
      if (result.error?.code === 'ENOENT') {
        const message = 'SKIP: lua executable is absent; Lua round-trip verification was skipped';
        console.warn(message);
        return { frames: [], skipped: true, message };
      }
      if (result.status !== 0) throw new Error(`Lua execution failed: ${result.stderr}`);
      return { frames: (result.stdout ?? '').split(/\r?\n/).filter((line) => line.length > 0).map(parseFrame), skipped: false };
    } finally {
      rmSync(path, { force: true });
    }
  }
}

export const shellLuaExecutor: LuaExecutor = new ShellLuaExecutor();
export function executeLua(source: string, options?: Parameters<LuaExecutor['execute']>[1]): LuaExecution { return shellLuaExecutor.execute(source, options); }
