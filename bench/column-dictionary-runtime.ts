import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { convertFrames } from '../src/core/index.ts';
import { readPng } from './compare/png.ts';

const assetPath = '/Users/yuki/doc/al/pngX';
const frameCount = 2400;
const ticksPerFrame = 6;
const splitAtLoad = 'local Q={}for z in string.gmatch(q,"[^!]+")do Q[#Q+1]=z end ';
const scanAtDraw = 'local s for z in string.gmatch(q,"[^!]+")do if n<1 then s=z break end n=n-1 end ';

function run(source: string): { readonly chars: number; readonly calls: number; readonly millisecondsPerFrame: number } {
  const harness = `
local calls=0
screen=setmetatable({},{__index=function()return function(...)calls=calls+1 end end})
${source}
local started=os.clock()
for frame=1,${frameCount} do for tick=1,${ticksPerFrame} do onTick()end onDraw()end
local elapsed=(os.clock()-started)*1000/${frameCount}
io.write(#${JSON.stringify(source)},"\\t",calls,"\\t",string.format("%.6f",elapsed))
`;
  const result = spawnSync('lua', ['-e', 'local f,e=load(io.read("*a"));assert(f,e);f()'], { input: harness, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  const [chars, calls, milliseconds] = (result.stdout ?? '').trim().split('\t').map(Number);
  return { chars: chars ?? 0, calls: calls ?? 0, millisecondsPerFrame: milliseconds ?? 0 };
}

const names = readdirSync(assetPath).filter((name) => /^\d{3}\.png$/.test(name)).sort();
const frames = names.map((name) => readPng(`${assetPath}/${name}`));
const indexed = convertFrames(frames, { mode: 'lossless', budget: 8192, ticksPerFrame });
const scanned = indexed.lua.replace(splitAtLoad, '').replace('local s=Q[n+1]', scanAtDraw);

console.log('decoder\tchars\tdrawCalls\tmsPerFrame');
for (const [name, lua] of [['scan', scanned], ['indexed', indexed.lua]] as const) {
  const result = run(lua);
  console.log(`${name}\t${result.chars}\t${result.calls}\t${result.millisecondsPerFrame.toFixed(6)}`);
}
