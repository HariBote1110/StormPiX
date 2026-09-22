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

export function emitDirectBody(ops: readonly DrawOp[], names: { readonly colour: string; readonly rectF: string; readonly rect: string; readonly line: string; readonly triangle?: string; readonly triangleF?: string; readonly circle?: string; readonly circleF?: string; readonly text?: string }): string {
  let currentColour: string | undefined;
  const statements: string[] = [];
  for (const op of ops) {
    switch (op.type) {
      case 'setColour': {
        const alpha = op.a === undefined ? '' : `,${numberText(op.a)}`;
        const statement = `${names.colour}(${numberText(op.r)},${numberText(op.g)},${numberText(op.b)}${alpha})`;
        if (statement !== currentColour) statements.push(statement);
        currentColour = statement;
        break;
      }
      case 'rectF': statements.push(`${names.rectF}(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`); break;
      case 'rect': statements.push(`${names.rect}(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`); break;
      case 'line': statements.push(`${names.line}(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)})`); break;
      case 'triangle': statements.push(`${names.triangle ?? 'screen.drawTriangle'}(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)},${numberText(op.x3)},${numberText(op.y3)})`); break;
      case 'triangleF': statements.push(`${names.triangleF ?? 'screen.drawTriangleF'}(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)},${numberText(op.x3)},${numberText(op.y3)})`); break;
      case 'circle': statements.push(`${names.circle ?? 'screen.drawCircle'}(${numberText(op.x)},${numberText(op.y)},${numberText(op.radius)})`); break;
      case 'circleF': statements.push(`${names.circleF ?? 'screen.drawCircleF'}(${numberText(op.x)},${numberText(op.y)},${numberText(op.radius)})`); break;
      case 'text': statements.push(`${names.text ?? 'screen.drawText'}(${numberText(op.x)},${numberText(op.y)},${JSON.stringify(op.text)})`); break;
    }
  }
  return statements.join('');
}

function directInline(ops: readonly DrawOp[]): string {
  return `function onDraw()${emitDirectBody(ops, { colour: 'screen.setColor', rectF: 'screen.drawRectF', rect: 'screen.drawRect', line: 'screen.drawLine', triangle: 'screen.drawTriangle', triangleF: 'screen.drawTriangleF', circle: 'screen.drawCircle', circleF: 'screen.drawCircleF', text: 'screen.drawText' })}end`;
}

function directHoisted(ops: readonly DrawOp[]): string {
  const extended = ops.some((op) => op.type === 'triangle' || op.type === 'triangleF' || op.type === 'circle' || op.type === 'circleF' || op.type === 'text' || (op.type === 'setColour' && op.a !== undefined));
  const prefix = extended ? 'local S=screen local C=S.setColor local F=S.drawRectF local R=S.drawRect local L=S.drawLine local T=S.drawTriangle local U=S.drawTriangleF local O=S.drawCircle local P=S.drawCircleF local X=S.drawText ' : 'local S=screen local C=S.setColor local F=S.drawRectF local R=S.drawRect local L=S.drawLine ';
  return `${prefix}function onDraw()${emitDirectBody(ops, { colour: 'C', rectF: 'F', rect: 'R', line: 'L', triangle: 'T', triangleF: 'U', circle: 'O', circleF: 'P', text: 'X' })}end`;
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

function deltaPackedDecoder(width: number, height: number, colourCount: number, data: string, palette: string, paletteMode: 'colour' | 'greyscale' | 'mixed'): string {
  const firstWidth = Math.max(1, Math.ceil(Math.log2(colourCount)));
  const setColour = paletteMode === 'greyscale'
    ? 'screen.setColor(e,e,e)'
    : paletteMode === 'mixed'
      ? 'if type(e)=="number"then screen.setColor(e,e,e)else screen.setColor(e[1],e[2],e[3])end'
      : 'screen.setColor(e[1],e[2],e[3])';
  return `function onDraw()local a="${BASE64_ALPHABET}"local d="${data}"local p={${palette}}local k=1 local j=5 local q=0 local function b()if j==5 then q=string.find(a,string.sub(d,k,k),1,true)-1 end local v=math.floor(q/2^j)%2 j=j-1 if j<0 then j=5 k=k+1 end return v end local function r(n)local v=0 for i=1,n do v=v*2+b()end return v end local function g()local z=0 while b()==0 do z=z+1 end local v=0 for i=0,z do v=v*2+b()end return v-1 end local c=0 local f=0 for y=0,${height - 1} do if y==0 then c=r(${firstWidth})else local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(f+q)%${colourCount} end f=c for x=0,${width - 1} do if x>0 then local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(c+q)%${colourCount} end local e=p[c+1]${setColour}screen.drawRectF(x,y,1,1)end end end`;
}

function emitDeltaPacked(width: number, height: number, colours: readonly string[], pixels: readonly number[]): string {
  if (colours.length < 2 || colours.length > 256) return '';
  const values = colours.map((colour) => colour.split(',').map((value) => Number(value)));
  const greyscale = values.map((colour) => colour[0] === colour[1] && colour[1] === colour[2]);
  const paletteMode = greyscale.every(Boolean) ? 'greyscale' : greyscale.some(Boolean) ? 'mixed' : 'colour';
  const palette = values.map((colour, index) => greyscale[index] ? String(colour[0]) : `{${colour.join(',')}}`).join(',');
  const data = encodeDeltaPixels(pixels, width, height, colours.length);
  return deltaPackedDecoder(width, height, colours.length, data, palette, paletteMode);
}

/** Pack up to two indexed frames with one shared palette and one decoder. */
export function emitAnimationLuaSharedPacked(
  frameIndices: readonly Uint16Array[],
  width: number,
  height: number,
  colours: readonly string[],
  ticksPerFrame = 6,
): string {
  if (frameIndices.length === 0 || frameIndices.length > 2 || width <= 0 || height <= 0) return '';
  const used = new Set<number>();
  for (const indices of frameIndices) for (const index of indices) used.add(index);
  if (used.size < 2 || used.size > 512) return '';
  const sourceIndexes = [...used].sort((left, right) => left - right);
  const compactIndexes = new Map(sourceIndexes.map((index, compact) => [index, compact] as const));
  const paletteValues = sourceIndexes.map((index) => (colours[index] ?? '0,0,0').split(',').map(Number));
  const greyscale = paletteValues.map((colour) => colour[0] === colour[1] && colour[1] === colour[2]);
  const paletteMode = greyscale.every(Boolean) ? 'greyscale' : greyscale.some(Boolean) ? 'mixed' : 'colour';
  const palette = paletteValues.map((colour, index) => greyscale[index] ? String(colour[0]) : `{${colour.join(',')}}`).join(',');
  const data = frameIndices.map((indices) => encodeDeltaPixels(Array.from(indices, (index) => compactIndexes.get(index) ?? 0), width, height, sourceIndexes.length));
  const firstWidth = Math.max(1, Math.ceil(Math.log2(sourceIndexes.length)));
  const setColour = paletteMode === 'greyscale'
    ? 'S.setColor(e,e,e)'
    : paletteMode === 'mixed'
      ? 'if type(e)=="number"then S.setColor(e,e,e)else S.setColor(e[1],e[2],e[3])end'
      : 'S.setColor(e[1],e[2],e[3])';
  const decoder = `function D(d)local k=1 local j=5 local q=0 local function b()if j==5 then q=A:find(d:sub(k,k),1,true)-1 end local v=math.floor(q/2^j)%2 j=j-1 if j<0 then j=5 k=k+1 end return v end local function r(n)local v=0 for i=1,n do v=v*2+b()end return v end local function g()local z=0 while b()==0 do z=z+1 end local v=0 for i=0,z do v=v*2+b()end return v-1 end local c=0 local f=0 for y=0,${height - 1} do if y==0 then c=r(${firstWidth})else local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(f+q)%${sourceIndexes.length} end f=c for x=0,${width - 1} do if x>0 then local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(c+q)%${sourceIndexes.length} end local e=p[c+1]${setColour}F(x,y,1,1)end end end `;
  const playback = `d={${data.map((value) => JSON.stringify(value)).join(',')}}function onDraw()D(d[f+1])end`;
  return `S=screen A="${BASE64_ALPHABET}"p={${palette}}F=S.drawRectF ${decoder}${compactAnimationTick(ticksPerFrame, frameIndices.length)}${playback}`;
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
    if (deltaPacked) return deltaPacked;
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

function compactAnimationBody(ops: readonly DrawOp[], palette: readonly string[] | undefined): { readonly body: string; readonly uses: Set<string> } {
  let currentColour: string | undefined;
  const statements: string[] = [];
  const uses = new Set<string>();
  for (const op of ops) {
    switch (op.type) {
      case 'setColour': {
        const paletteIndex = palette?.indexOf(`${op.r},${op.g},${op.b}`) ?? -1;
        const statement = paletteIndex >= 0 && op.a === undefined ? `C(${paletteIndex + 1})` : `C(${numberText(op.r)},${numberText(op.g)},${numberText(op.b)}${op.a === undefined ? '' : `,${numberText(op.a)}`})`;
        if (statement !== currentColour) statements.push(statement);
        currentColour = statement;
        break;
      }
      case 'rectF': uses.add('F'); statements.push(`F(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`); break;
      case 'rect': uses.add('R'); statements.push(`R(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`); break;
      case 'line': uses.add('L'); statements.push(`L(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)})`); break;
      case 'triangle': uses.add('T'); statements.push(`T(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)},${numberText(op.x3)},${numberText(op.y3)})`); break;
      case 'triangleF': uses.add('U'); statements.push(`U(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)},${numberText(op.x3)},${numberText(op.y3)})`); break;
      case 'circle': uses.add('O'); statements.push(`O(${numberText(op.x)},${numberText(op.y)},${numberText(op.radius)})`); break;
      case 'circleF': uses.add('P'); statements.push(`P(${numberText(op.x)},${numberText(op.y)},${numberText(op.radius)})`); break;
      case 'text': uses.add('X'); statements.push(`X(${numberText(op.x)},${numberText(op.y)},${JSON.stringify(op.text)})`); break;
    }
  }
  return { body: statements.join(''), uses };
}

function compactAnimationPrefix(uses: ReadonlySet<string>, palette: readonly string[] | undefined, greyscale = false): string {
  const aliases = ['F', 'R', 'L', 'T', 'U', 'O', 'P', 'X'].filter((name) => uses.has(name)).map((name) => {
    const api = { F: 'drawRectF', R: 'drawRect', L: 'drawLine', T: 'drawTriangle', U: 'drawTriangleF', O: 'drawCircle', P: 'drawCircleF', X: 'drawText' }[name] as string;
    return `${name}=S.${api}`;
  });
  const colour = palette
    ? greyscale
      ? `p={${palette.map((value) => value.split(',')[0]).join(',')}}function C(i)local c=p[i]S.setColor(c,c,c)end`
      : `p={${palette.map((value) => `{${value}}`).join(',')}}function C(i)local c=p[i]S.setColor(c[1],c[2],c[3])end`
    : 'C=S.setColor';
  return `S=screen ${colour}${aliases.length > 0 ? ` ${aliases.join(' ')}` : ''} `;
}

function compactAnimationTick(ticksPerFrame: number, frameCount: number, frameChannel?: number): string {
  if (frameChannel !== undefined) return `f=0 function onTick()f=input.getNumber(${frameChannel})end `;
  return `f=0 t=0 function onTick()t=t+1 if t==${ticksPerFrame} then t=0 f=(f+1)%${frameCount} end end `;
}

function compactAnimationBranches(bodies: readonly { readonly body: string }[], frameOffset = 0): string {
  return bodies.map((entry, index) => `${index === 0 ? 'if' : 'elseif'} f==${frameOffset + index} then ${entry.body}`).join('');
}

/** Emit a compact, self-contained animation used by lossless multi-script output. */
export function emitAnimationLuaCompact(frameOps: readonly (readonly DrawOp[])[], ticksPerFrame = 6, frameChannel?: number, frameOffset = 0): string {
  if (frameOps.length === 0) return 'function onDraw()end';
  const plainBodies = frameOps.map((ops) => compactAnimationBody(ops, undefined));
  const uses = new Set<string>(plainBodies.flatMap((entry) => [...entry.uses]));
  const plain = `${compactAnimationPrefix(uses, undefined)}${compactAnimationTick(ticksPerFrame, frameOps.length, frameChannel)}function onDraw()${compactAnimationBranches(plainBodies, frameOffset)}end end`;
  const colours = [...new Set(frameOps.flatMap((ops) => ops.filter((op): op is Extract<DrawOp, { type: 'setColour' }> => op.type === 'setColour' && op.a === undefined).map((op) => `${op.r},${op.g},${op.b}`)))];
  if (colours.length === 0) return plain;
  const paletteBodies = frameOps.map((ops) => compactAnimationBody(ops, colours));
  const paletteUses = new Set<string>(paletteBodies.flatMap((entry) => [...entry.uses]));
  const palette = `${compactAnimationPrefix(paletteUses, colours)}${compactAnimationTick(ticksPerFrame, frameOps.length, frameChannel)}function onDraw()${compactAnimationBranches(paletteBodies, frameOffset)}end end`;
  const greyscale = colours.every((value) => {
    const channels = value.split(',');
    return channels[0] === channels[1] && channels[1] === channels[2];
  });
  const greyPalette = greyscale
    ? `${compactAnimationPrefix(paletteUses, colours, true)}${compactAnimationTick(ticksPerFrame, frameOps.length, frameChannel)}function onDraw()${compactAnimationBranches(paletteBodies, frameOffset)}end end`
    : '';
  return [plain, palette, greyPalette].filter((candidate) => candidate !== '').sort((left, right) => left.length - right.length)[0] as string;
}

const COMPACT_RECT_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/';

function encodeCompactRectangles(ops: readonly DrawOp[], colours: readonly string[]): string {
  const indexes = new Map(colours.map((colour, index) => [colour, index] as const));
  let currentColour = 0;
  let result = '';
  for (const op of ops) {
    if (op.type === 'setColour') {
      currentColour = indexes.get(`${op.r},${op.g},${op.b}`) ?? 0;
      continue;
    }
    if (op.type !== 'rectF') continue;
    const value = (Math.trunc(op.x) * 2 ** 24)
      + (Math.trunc(op.y) * 2 ** 19)
      + (Math.trunc(op.w) * 2 ** 13)
      + (Math.trunc(op.h) * 2 ** 8)
      + currentColour;
    let encoded = '';
    for (let shift = 24; shift >= 0; shift -= 6) encoded += COMPACT_RECT_ALPHABET[Math.floor(value / 2 ** shift) % 64] ?? '0';
    result += encoded;
  }
  return result;
}

function compactRectanglePrefix(colours: readonly string[], greyscale: boolean): string {
  const palette = greyscale
    ? `p={${colours.map((colour) => colour.split(',')[0]).join(',')}}`
    : `p={${colours.map((colour) => `{${colour}}`).join(',')}}`;
  const colour = greyscale
    ? 'local e=p[c+1]S.setColor(e,e,e)'
    : 'local e=p[c+1]S.setColor(e[1],e[2],e[3])';
  return `S=screen A="${COMPACT_RECT_ALPHABET}"${palette}F=S.drawRectF function D(d)local i=1 local q=-1 while i<=#d do local v=(string.find(A,string.sub(d,i,i),1,true)-1)*2^24+(string.find(A,string.sub(d,i+1,i+1),1,true)-1)*2^18+(string.find(A,string.sub(d,i+2,i+2),1,true)-1)*2^12+(string.find(A,string.sub(d,i+3,i+3),1,true)-1)*2^6+string.find(A,string.sub(d,i+4,i+4),1,true)-1 i=i+5 local x=math.floor(v/2^24)%64 local y=math.floor(v/2^19)%32 local w=math.floor(v/2^13)%64 local h=math.floor(v/2^8)%32 local c=v%256 if c~=q then ${colour} q=c end F(x,y,w,h)end end `;
}

/** Pack rectangle records while preserving their draw order and exact colours. */
export function emitAnimationLuaCompactRectangles(
  frameOps: readonly (readonly DrawOp[])[],
  colours: readonly string[],
  ticksPerFrame = 6,
  frameChannel?: number,
  frameOffset = 0,
): string {
  if (frameOps.length === 0) return 'function onDraw()end';
  const greyscale = colours.every((value) => {
    const channels = value.split(',');
    return channels[0] === channels[1] && channels[1] === channels[2];
  });
  const prefix = compactRectanglePrefix(colours, greyscale);
  const data = frameOps.map((ops) => encodeCompactRectangles(ops, colours));
  const branches = data.map((value, index) => `${index === 0 ? 'if' : 'elseif'} f==${frameOffset + index} then${value === '' ? '' : `D("${value}")`}`).join('');
  return `${prefix}${compactAnimationTick(ticksPerFrame, frameOps.length, frameChannel)}function onDraw()${branches}end end`;
}

const COLUMN_DICTIONARY_HIGH_ALPHABET = '#$%&()*,-.:;<=>?@[]^_`{|}~';
const COLUMN_REFERENCE_RUN_MARKER = '!';

function encodeColumnPattern(values: readonly number[], colourCount: number): string {
  let result = '';
  let colour = values[0] ?? 0;
  let height = 0;
  const flush = (): void => {
    const value = colour * 32 + height - 1;
    result += COMPACT_RECT_ALPHABET[Math.floor(value / 64)] ?? '0';
    result += COMPACT_RECT_ALPHABET[value % 64] ?? '0';
  };
  for (const value of values) {
    if (value === colour && height < 32) {
      height += 1;
      continue;
    }
    if (height > 0) flush();
    colour = value;
    height = 1;
  }
  if (height > 0) flush();
  return colourCount <= 128 ? result : '';
}

function columnReference(index: number): string {
  if (index < COMPACT_RECT_ALPHABET.length) return COMPACT_RECT_ALPHABET[index] as string;
  const high = index - COMPACT_RECT_ALPHABET.length;
  const prefix = COLUMN_DICTIONARY_HIGH_ALPHABET[Math.floor(high / COMPACT_RECT_ALPHABET.length)];
  const suffix = COMPACT_RECT_ALPHABET[high % COMPACT_RECT_ALPHABET.length];
  return prefix && suffix ? `${prefix}${suffix}` : '';
}

function runReference(index: number, extended: boolean): string {
  if (index < COMPACT_RECT_ALPHABET.length) return COMPACT_RECT_ALPHABET[index] as string;
  const high = COLUMN_DICTIONARY_HIGH_ALPHABET[index - COMPACT_RECT_ALPHABET.length];
  if (high) return high;
  return extended ? `'${COMPACT_RECT_ALPHABET[index - COMPACT_RECT_ALPHABET.length - COLUMN_DICTIONARY_HIGH_ALPHABET.length] ?? ''}` : '';
}

function encodeRunPattern(pattern: string, indexes: ReadonlyMap<string, number>, extended: boolean): string {
  let result = '';
  for (let offset = 0; offset < pattern.length; offset += 2) result += runReference(indexes.get(pattern.slice(offset, offset + 2)) as number, extended);
  return result;
}

function encodeColumnReferences(keys: readonly string[], indexes: ReadonlyMap<string, number>): string {
  let result = '';
  for (let start = 0; start < keys.length;) {
    const index = indexes.get(keys[start] as string) as number;
    const reference = columnReference(index);
    let end = start + 1;
    while (end < keys.length && end - start < COMPACT_RECT_ALPHABET.length && keys[end] === keys[start]) end += 1;
    const count = end - start;
    const repeated = `${reference}${COLUMN_REFERENCE_RUN_MARKER}${COMPACT_RECT_ALPHABET[count - 1] ?? ''}`;
    const plain = reference.repeat(count);
    result += repeated.length < plain.length ? repeated : plain;
    start = end;
  }
  return result;
}

/** Encode repeated animation columns as a shared vertical-run dictionary. */
export function emitAnimationLuaColumnDictionary(
  frameIndices: readonly Uint16Array[],
  width: number,
  height: number,
  colours: readonly string[],
  ticksPerFrame = 6,
  frameChannel?: number,
  frameOffset = 0,
): string {
  if (frameIndices.length === 0 || width <= 0 || height <= 0 || colours.length > 128) return '';
  const frameKeys: string[][] = [];
  const frequencies = new Map<string, number>();
  for (const indices of frameIndices) {
    const keys: string[] = [];
    for (let x = 0; x < width; x += 1) {
      const values: number[] = [];
      for (let y = 0; y < height; y += 1) values.push(indices[y * width + x] ?? 0);
      const key = values.join(',');
      keys.push(key);
      frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
    frameKeys.push(keys);
  }
  const orderedKeys = [...frequencies.keys()].sort((left, right) => {
    const frequencyDifference = (frequencies.get(right) ?? 0) - (frequencies.get(left) ?? 0);
    return frequencyDifference !== 0 ? frequencyDifference : left.localeCompare(right);
  });
  const indexes = new Map(orderedKeys.map((key, index) => [key, index] as const));
  const rawPatterns = orderedKeys.map((key) => encodeColumnPattern(key.split(',').map(Number), colours.length));
  const runFrequencies = new Map<string, number>();
  for (const pattern of rawPatterns) for (let offset = 0; offset < pattern.length; offset += 2) {
    const run = pattern.slice(offset, offset + 2);
    runFrequencies.set(run, (runFrequencies.get(run) ?? 0) + 1);
  }
  const runs = [...runFrequencies.keys()].sort((left, right) => {
    const frequencyDifference = (runFrequencies.get(right) ?? 0) - (runFrequencies.get(left) ?? 0);
    return frequencyDifference !== 0 ? frequencyDifference : left.localeCompare(right);
  });
  const runIndexes = new Map(runs.map((run, index) => [run, index] as const));
  const extendedRuns = runs.length > COMPACT_RECT_ALPHABET.length + COLUMN_DICTIONARY_HIGH_ALPHABET.length;
  const patterns = rawPatterns.map((pattern) => encodeRunPattern(pattern, runIndexes, extendedRuns));
  if (patterns.some((pattern) => pattern === '') || orderedKeys.some((_, index) => columnReference(index) === '') || runs.some((_, index) => runReference(index, extendedRuns) === '')) return '';
  const data = frameKeys.map((keys) => encodeColumnReferences(keys, indexes));
  const greyscale = colours.every((value) => {
    const channels = value.split(',');
    return channels[0] === channels[1] && channels[1] === channels[2];
  });
  const palette = greyscale
    ? `p={${colours.map((colour) => colour.split(',')[0]).join(',')}`
    : `p={${colours.map((colour) => `{${colour}}`).join(',')}`;
  const colour = greyscale ? 'S.setColor(e,e,e)' : 'S.setColor(e[1],e[2],e[3])';
  const runDecoder = extendedRuns
    ? `if z=="'"then u=${COMPACT_RECT_ALPHABET.length + COLUMN_DICTIONARY_HIGH_ALPHABET.length}+A:find(s:sub(j+1,j+1),1,true)-1 j=j+1 else u=${COMPACT_RECT_ALPHABET.length}+H:find(z,1,true)-1 end`
    : `u=${COMPACT_RECT_ALPHABET.length}+H:find(z,1,true)-1`;
  const prefix = `S=screen A="${COMPACT_RECT_ALPHABET}" H="${COLUMN_DICTIONARY_HIGH_ALPHABET}" M="${COLUMN_REFERENCE_RUN_MARKER}" B="${runs.join('')}" ${palette}} q="${patterns.join(COLUMN_REFERENCE_RUN_MARKER)}"local Q={}for z in q:gmatch("[^!]+")do Q[#Q+1]=z end F=S.drawRectF function D(d)local x=0 local i=1 while i<=#d do local z=d:sub(i,i)local n=A:find(z,1,true)if n then n=n-1 else local h=H:find(z,1,true)if not h then return end n=${COMPACT_RECT_ALPHABET.length}+(h-1)*${COMPACT_RECT_ALPHABET.length}+A:find(d:sub(i+1,i+1),1,true)-1 i=i+1 end i=i+1 local k=1 if d:sub(i,i)==M then k=A:find(d:sub(i+1,i+1),1,true)i=i+2 end local s=Q[n+1]for r=1,k do local j=1 local y=0 while j<=#s do local z=s:sub(j,j)local u=A:find(z,1,true)if u then u=u-1 else ${runDecoder} end local v=(A:find(B:sub(u*2+1,u*2+1),1,true)-1)*64+A:find(B:sub(u*2+2,u*2+2),1,true)-1 local c=math.floor(v/32)local h=v%32+1 local e=p[c+1]${colour} F(x,y,1,h)y=y+h j=j+1 end x=x+1 end end end `;
  const branches = data.map((value, index) => `${index === 0 ? 'if' : 'elseif'} f==${frameOffset + index} then D("${value}")`).join('');
  const branchPlayback = `function onDraw()${branches}end end`;
  const frameIndex = frameOffset === 0 ? 'f+1' : `f-${frameOffset - 1}`;
  const tableData = `d={${data.map((value) => JSON.stringify(value)).join(',')}}`;
  const tablePlayback = frameChannel === undefined
    ? `${tableData}function onDraw()D(d[${frameIndex}])end`
    : `${tableData}function onDraw()if d[${frameIndex}]then D(d[${frameIndex}])end end`;
  const playback = tablePlayback.length < branchPlayback.length ? tablePlayback : branchPlayback;
  return `${prefix}${compactAnimationTick(ticksPerFrame, frameIndices.length, frameChannel)}${playback}`;
}
