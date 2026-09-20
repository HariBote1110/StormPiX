import { render } from './render.ts';
import type { DrawOp, EmitStrategy } from './types.ts';

export class NotImplementedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

function numberText(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

export function emitDirectBody(ops: readonly DrawOp[], names: { readonly colour: string; readonly rectF: string; readonly rect: string; readonly line: string }): string {
  let currentColour: string | undefined;
  const statements: string[] = [];
  for (const op of ops) {
    switch (op.type) {
      case 'setColour': {
        const statement = `${names.colour}(${numberText(op.r)},${numberText(op.g)},${numberText(op.b)})`;
        if (statement !== currentColour) statements.push(statement);
        currentColour = statement;
        break;
      }
      case 'rectF': statements.push(`${names.rectF}(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`); break;
      case 'rect': statements.push(`${names.rect}(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`); break;
      case 'line': statements.push(`${names.line}(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)})`); break;
    }
  }
  return statements.join('');
}

function directInline(ops: readonly DrawOp[]): string {
  return `function onDraw()${emitDirectBody(ops, { colour: 'screen.setColor', rectF: 'screen.drawRectF', rect: 'screen.drawRect', line: 'screen.drawLine' })}end`;
}

function directHoisted(ops: readonly DrawOp[]): string {
  const prefix = 'local S=screen local C=S.setColor local F=S.drawRectF local R=S.drawRect local L=S.drawLine ';
  return `${prefix}function onDraw()${emitDirectBody(ops, { colour: 'C', rectF: 'F', rect: 'R', line: 'L' })}end`;
}

/** Minified direct emitter. The shortest semantically equivalent form wins. */
export function emitDirect(ops: readonly DrawOp[]): string {
  const inline = directInline(ops);
  const hoisted = directHoisted(ops);
  return hoisted.length < inline.length ? hoisted : inline;
}

function isRectProgram(ops: readonly DrawOp[]): boolean {
  return ops.every((op) => op.type === 'setColour' || op.type === 'rectF');
}

const BASE64_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';

function gammaBits(value: number): number[] {
  const binary = (value + 1).toString(2);
  const bits = Array.from({ length: binary.length - 1 }, () => 0);
  for (const character of binary) bits.push(character === '1' ? 1 : 0);
  return bits;
}

function appendBits(target: number[], value: number, width: number): void {
  for (let bit = width - 1; bit >= 0; bit -= 1) target.push((value >> bit) & 1);
}

function encodeDeltaPixels(pixels: readonly number[], width: number, height: number, colourCount: number): string {
  const bits: number[] = [];
  const firstWidth = Math.max(1, Math.ceil(Math.log2(colourCount)));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width;
    if (y === 0) appendBits(bits, pixels[rowStart] ?? 0, firstWidth);
    else {
      let delta = (pixels[rowStart] ?? 0) - (pixels[rowStart - width] ?? 0);
      if (delta > colourCount / 2) delta -= colourCount;
      if (delta <= -colourCount / 2) delta += colourCount;
      const zigzag = delta > 0 ? delta * 2 - 1 : -delta * 2;
      bits.push(...gammaBits(zigzag));
    }
    for (let x = 1; x < width; x += 1) {
      const current = pixels[rowStart + x] ?? 0;
      const previous = pixels[rowStart + x - 1] ?? 0;
      let delta = current - previous;
      if (delta > colourCount / 2) delta -= colourCount;
      if (delta <= -colourCount / 2) delta += colourCount;
      const zigzag = delta > 0 ? delta * 2 - 1 : -delta * 2;
      bits.push(...gammaBits(zigzag));
    }
  }
  let result = '';
  for (let index = 0; index < bits.length; index += 6) {
    let value = 0;
    for (let bit = 0; bit < 6; bit += 1) value = value * 2 + (bits[index + bit] ?? 0);
    result += BASE64_ALPHABET[value] ?? '0';
  }
  return result;
}

function deltaPackedDecoder(width: number, height: number, colourCount: number, data: string, palette: string): string {
  const firstWidth = Math.max(1, Math.ceil(Math.log2(colourCount)));
  return `function onDraw()local a="${BASE64_ALPHABET}"local d="${data}"local p={${palette}}local k=1 local j=5 local q=0 local function b()if j==5 then q=string.find(a,string.sub(d,k,k),1,true)-1 end local v=math.floor(q/2^j)%2 j=j-1 if j<0 then j=5 k=k+1 end return v end local function r(n)local v=0 for i=1,n do v=v*2+b()end return v end local function g()local z=0 while b()==0 do z=z+1 end local v=0 for i=0,z do v=v*2+b()end return v-1 end local c=0 local f=0 for y=0,${height - 1} do if y==0 then c=r(${firstWidth})else local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(f+q)%${colourCount} end f=c for x=0,${width - 1} do if x>0 then local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(c+q)%${colourCount} end local e=p[c+1]screen.setColor(e[1],e[2],e[3])screen.drawRectF(x,y,1,1)end end end`;
}

function emitDeltaPacked(width: number, height: number, colours: readonly string[], pixels: readonly number[]): string {
  if (colours.length < 2 || colours.length > 16) return '';
  const palette = colours.map((colour) => colour.split(',').map((value) => Number(value))).map((colour) => `{${colour.join(',')}}`).join(',');
  const data = encodeDeltaPixels(pixels, width, height, colours.length);
  return deltaPackedDecoder(width, height, colours.length, data, palette);
}

function emitTable(ops: readonly DrawOp[]): string {
  if (!isRectProgram(ops)) return emitDirect(ops);
  let colour: Extract<DrawOp, { type: 'setColour' }> | undefined;
  const values: string[] = [];
  for (const op of ops) {
    if (op.type === 'setColour') colour = op;
    else if (op.type === 'rectF' && colour) values.push(numberText(colour.r), numberText(colour.g), numberText(colour.b), numberText(op.x), numberText(op.y), numberText(op.w), numberText(op.h));
  }
  return `function onDraw()local d={${values.join(',')}}for i=1,#d,7 do screen.setColor(d[i],d[i+1],d[i+2])screen.drawRectF(d[i+3],d[i+4],d[i+5],d[i+6])end end`;
}

function emitPacked(ops: readonly DrawOp[]): string {
  if (!isRectProgram(ops)) return emitDirect(ops);
  let width = 0;
  let height = 0;
  for (const op of ops) {
    if (op.type === 'rectF') {
      width = Math.max(width, Math.trunc(op.x + op.w));
      height = Math.max(height, Math.trunc(op.y + op.h));
    }
  }
  if (width <= 0 || height <= 0) return 'function onDraw()end';
  const bitmap = render(ops, width, height);
  const colours: string[] = [];
  const colourMap = new Map<string, number>();
  const pixels: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const key = `${bitmap.data[offset] ?? 0},${bitmap.data[offset + 1] ?? 0},${bitmap.data[offset + 2] ?? 0}`;
    let index = colourMap.get(key);
    if (index === undefined) {
      index = colours.length;
      colourMap.set(key, index);
      colours.push(key);
    }
    pixels.push(index);
  }
  const deltaPacked = emitDeltaPacked(width, height, colours, pixels);
  // Decimal glyphs keep the decoder tiny. For small images, raw RGB nibbles
  // are still cheaper than a very large per-pixel table and retain the source
  // gradient exactly.
  if (colours.length > 16) {
    if (width * height > 2048) return emitTable(ops);
    let data = '';
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      for (let channel = 0; channel < 3; channel += 1) data += (bitmap.data[offset + channel] ?? 0).toString(16).padStart(2, '0');
    }
    return `function onDraw()local d="${data}"for i=1,#d,6 do local z=(i-1)/6 screen.setColor(tonumber(string.sub(d,i,i+1),16),tonumber(string.sub(d,i+2,i+3),16),tonumber(string.sub(d,i+4,i+5),16))screen.drawRectF(z%${width},math.floor(z/${width}),1,1)end end`;
  }
  const palette = colours.map((colour) => `{${colour}}`).join(',');
  if (colours.length <= 10) {
    const data = pixels.join('');
    const legacy = `function onDraw()local p={${palette}}local d="${data}"for i=1,#d do local c=p[string.byte(d,i)-47]local z=i-1 screen.setColor(c[1],c[2],c[3])screen.drawRectF(z%${width},math.floor(z/${width}),1,1)end end`;
    return deltaPacked && deltaPacked.length < legacy.length ? deltaPacked : legacy;
  }
  let data = '';
  for (let pixel = 0; pixel < pixels.length; pixel += 4) {
    const value = (pixels[pixel] ?? 0) * 4096 + (pixels[pixel + 1] ?? 0) * 256 + (pixels[pixel + 2] ?? 0) * 16 + (pixels[pixel + 3] ?? 0);
    data += BASE64_ALPHABET[Math.floor(value / 4096)] ?? '0';
    data += BASE64_ALPHABET[Math.floor(value / 64) % 64] ?? '0';
    data += BASE64_ALPHABET[value % 64] ?? '0';
  }
  const legacy = `function onDraw()local a="${BASE64_ALPHABET}"local p={${palette}}local d="${data}"local i=0 local t=${pixels.length} for k=1,#d,3 do local v=(string.find(a,string.sub(d,k,k),1,true)-1)*4096+(string.find(a,string.sub(d,k+1,k+1),1,true)-1)*64+string.find(a,string.sub(d,k+2,k+2),1,true)-1 for j=1,4 do if i<t then local n=math.floor(v/4096)local c=p[n+1]local z=i i=i+1 screen.setColor(c[1],c[2],c[3])screen.drawRectF(z%${width},math.floor(z/${width}),1,1)v=(v-n*4096)*16 end end end end`;
  return deltaPacked && deltaPacked.length < legacy.length ? deltaPacked : legacy;
}

export function emitLua(ops: readonly DrawOp[], strategy: EmitStrategy): string {
  if (strategy === 'direct') return emitDirect(ops);
  if (strategy === 'table') return emitTable(ops);
  return emitPacked(ops);
}

export function costOf(ops: readonly DrawOp[], strategy: EmitStrategy): number {
  return emitLua(ops, strategy).length;
}

const DIRECT_PREFIX = 'local S=screen local C=S.setColor local F=S.drawRectF local R=S.drawRect local L=S.drawLine ';

function functionBody(lua: string): string {
  const marker = 'function onDraw()';
  const start = lua.indexOf(marker);
  if (start < 0) return lua;
  return lua.slice(start + marker.length, -3).trimEnd();
}

function animationTick(ticksPerFrame: number, frameCount: number): string {
  return `local f=0 local t=0 function onTick()t=t+1 if t>=${ticksPerFrame} then t=0 f=f+1 if f>=${frameCount} then f=0 end end end `;
}

function animationBody(bodies: readonly string[], ticksPerFrame: number, prefix = ''): string {
  const branches = bodies.map((body, index) => `${index === 0 ? 'if' : 'elseif'} f==${index} then ${body} `).join('');
  return `${prefix}${animationTick(ticksPerFrame, bodies.length)}function onDraw()${branches}end end`;
}

function emitAnimationDirect(frameOps: readonly (readonly DrawOp[])[], ticksPerFrame: number): string {
  const inlineBodies = frameOps.map((ops) => emitDirectBody(ops, { colour: 'screen.setColor', rectF: 'screen.drawRectF', rect: 'screen.drawRect', line: 'screen.drawLine' }));
  const hoistedBodies = frameOps.map((ops) => emitDirectBody(ops, { colour: 'C', rectF: 'F', rect: 'R', line: 'L' }));
  const inline = animationBody(inlineBodies, ticksPerFrame);
  const hoisted = animationBody(hoistedBodies, ticksPerFrame, DIRECT_PREFIX);
  return hoisted.length < inline.length ? hoisted : inline;
}

/** Emit a tick-driven animation while reusing the three existing frame emitters. */
export function emitAnimationLua(
  frameOps: readonly (readonly DrawOp[])[],
  strategy: EmitStrategy,
  ticksPerFrame = 6,
  keyframeDiff = false,
): string {
  if (frameOps.length === 0) return animationBody([''], ticksPerFrame);
  if (strategy === 'direct') return emitAnimationDirect(frameOps, ticksPerFrame);
  const bodies = frameOps.map((ops, index) => {
    // Packed pixels have no transparent value. A sparse diff therefore uses
    // the table emitter, which preserves the unchanged pixels on screen.
    const frameStrategy = keyframeDiff && index > 0 && strategy === 'packed' ? 'table' : strategy;
    return functionBody(emitLua(ops, frameStrategy));
  });
  return animationBody(bodies, ticksPerFrame);
}
