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
const LZ_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz>?';
const LZ_LITERAL_RUN_LIMIT = 12;

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

/** Pack up to three indexed frames with one shared palette and one decoder. */
export function emitAnimationLuaSharedPacked(
  frameIndices: readonly Uint16Array[],
  width: number,
  height: number,
  colours: readonly string[],
  ticksPerFrame = 6,
  frameCount = frameIndices.length,
): string {
  if (frameIndices.length === 0 || frameIndices.length > 3 || frameCount < frameIndices.length || width <= 0 || height <= 0) return '';
  const used = new Set<number>();
  for (const indices of frameIndices) for (const index of indices) used.add(index);
  if (used.size < 2 || used.size > 512) return '';
  const sourceOrder = [...used].sort((left, right) => left - right);
  const colourOrder = [...sourceOrder].sort((left, right) => {
    const leftColour = (colours[left] ?? '0,0,0').split(',').map(Number);
    const rightColour = (colours[right] ?? '0,0,0').split(',').map(Number);
    return ((leftColour[0] ?? 0) * 65_536 + (leftColour[1] ?? 0) * 256 + (leftColour[2] ?? 0)) - ((rightColour[0] ?? 0) * 65_536 + (rightColour[1] ?? 0) * 256 + (rightColour[2] ?? 0));
  });
  const luminanceOrder = [...sourceOrder].sort((left, right) => {
    const leftColour = (colours[left] ?? '0,0,0').split(',').map(Number);
    const rightColour = (colours[right] ?? '0,0,0').split(',').map(Number);
    return ((leftColour[0] ?? 0) * 299 + (leftColour[1] ?? 0) * 587 + (leftColour[2] ?? 0) * 114) - ((rightColour[0] ?? 0) * 299 + (rightColour[1] ?? 0) * 587 + (rightColour[2] ?? 0) * 114);
  });
  const encode = (sourceIndexes: readonly number[]): readonly string[] => {
    const compactIndexes = new Map(sourceIndexes.map((index, compact) => [index, compact] as const));
    return frameIndices.map((indices) => encodeDeltaPixels(Array.from(indices, (index) => compactIndexes.get(index) ?? 0), width, height, sourceIndexes.length));
  };
  const sourceData = encode(sourceOrder);
  const colourData = encode(colourOrder);
  const luminanceData = encode(luminanceOrder);
  const candidates = [
    { indexes: sourceOrder, data: sourceData },
    { indexes: colourOrder, data: colourData },
    { indexes: luminanceOrder, data: luminanceData },
  ];
  const selected = candidates.reduce((best, candidate) => candidate.data.reduce((total, value) => total + value.length, 0) < best.data.reduce((total, value) => total + value.length, 0) ? candidate : best);
  const sourceIndexes = selected.indexes;
  const paletteValues = sourceIndexes.map((index) => (colours[index] ?? '0,0,0').split(',').map(Number));
  const greyscale = paletteValues.map((colour) => colour[0] === colour[1] && colour[1] === colour[2]);
  const paletteMode = greyscale.every(Boolean) ? 'greyscale' : greyscale.some(Boolean) ? 'mixed' : 'colour';
  const palette = paletteValues.map((colour, index) => greyscale[index] ? String(colour[0]) : `{${colour.join(',')}}`).join(',');
  const data = selected.data;
  const firstWidth = Math.max(1, Math.ceil(Math.log2(sourceIndexes.length)));
  const setColour = paletteMode === 'greyscale'
    ? 'S.setColor(e,e,e)'
    : paletteMode === 'mixed'
      ? 'if type(e)=="number"then S.setColor(e,e,e)else S.setColor(e[1],e[2],e[3])end'
      : 'S.setColor(e[1],e[2],e[3])';
  const decoder = `function D(d)local k=1 local j=5 local q=0 local function b()if j==5 then q=A:find(d:sub(k,k),1,true)-1 end local v=math.floor(q/2^j)%2 j=j-1 if j<0 then j=5 k=k+1 end return v end local function r(n)local v=0 for i=1,n do v=v*2+b()end return v end local function g()local z=0 while b()==0 do z=z+1 end local v=0 for i=0,z do v=v*2+b()end return v-1 end local c=0 local f=0 for y=0,${height - 1} do if y==0 then c=r(${firstWidth})else local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(f+q)%${sourceIndexes.length} end f=c for x=0,${width - 1} do if x>0 then local v=g()local q=math.floor((v+1)/2)if v%2==0 then q=-q end c=(c+q)%${sourceIndexes.length} end local e=p[c+1]${setColour}F(x,y,1,1)end end end `;
  const playback = `d={${data.map((value) => JSON.stringify(value)).join(',')}}function onDraw()${frameCount === 1 ? 'D(d[1])' : frameIndices.length === 1 ? 'if f==0 then D(d[1])end' : 'D(d[f+1])'}end`;
  return `S=screen A="${BASE64_ALPHABET}"p={${palette}}F=S.drawRectF ${decoder}${compactAnimationTick(ticksPerFrame, frameCount)}${playback}`;
}

function encodeLzFrameStream(values: readonly number[], compactLiterals: boolean, offsets: readonly number[]): { readonly data: string; readonly literalFrequencies: ReadonlyMap<number, number>; readonly matchFrequencies: ReadonlyMap<number, number> } {
  const references = new Map<string, number[]>();
  const keyAt = (index: number): string => index + 2 < values.length ? `${values[index]},${values[index + 1]},${values[index + 2]}` : '';
  const addReference = (index: number): void => {
    const key = keyAt(index);
    if (key === '') return;
    const indexes = references.get(key) ?? [];
    indexes.push(index);
    if (indexes.length > 4096) indexes.shift();
    references.set(key, indexes);
  };
  const pair = (value: number): string => `${LZ_ALPHABET[Math.floor(value / 64)] ?? ''}${LZ_ALPHABET[value % 64] ?? ''}`;
  const literalFrequencies = new Map<number, number>();
  const matchFrequencies = new Map<number, number>();
  const literal = (value: number): string => {
    literalFrequencies.set(value, (literalFrequencies.get(value) ?? 0) + 1);
    if (!compactLiterals) return pair(value);
    if (value < 58) return LZ_ALPHABET[value] ?? '';
    const offset = value - 58;
    return `${LZ_ALPHABET[58 + Math.floor(offset / 64)] ?? ''}${LZ_ALPHABET[offset % 64] ?? ''}`;
  };
  let result = '';
  let index = 0;
  while (index < values.length) {
    const candidates = references.get(keyAt(index)) ?? [];
    let length = 0;
    let distance = 0;
    for (let candidateIndex = candidates.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = candidates[candidateIndex] as number;
      const candidateDistance = index - candidate;
      if (candidateDistance > 4096) continue;
      let candidateLength = 0;
      while (candidateLength < 4098 && index + candidateLength < values.length && values[candidate + candidateLength] === values[index + candidateLength]) candidateLength += 1;
      if (candidateLength > length) {
        length = candidateLength;
        distance = candidateDistance;
        if (length === 4098) break;
      }
    }
    if (length >= 3) {
      matchFrequencies.set(distance, (matchFrequencies.get(distance) ?? 0) + 1);
      const specialIndex = offsets.indexOf(distance);
      result += distance === 1 && length <= 66 - offsets.length - LZ_LITERAL_RUN_LIMIT ? LZ_ALPHABET[length + LZ_LITERAL_RUN_LIMIT - 3] ?? '' : specialIndex >= 0 ? `${LZ_ALPHABET[64 - offsets.length + specialIndex] ?? ''}${pair(length - 3)}` : `!${pair(distance - 1)}${pair(length - 3)}`;
      for (let offset = 0; offset < length; offset += 1) addReference(index + offset);
      index += length;
      continue;
    }
    const start = index;
    do {
      addReference(index);
      index += 1;
      if (index - start === LZ_LITERAL_RUN_LIMIT || index >= values.length) break;
      const lookahead = references.get(keyAt(index)) ?? [];
      length = 0;
      for (let candidateIndex = lookahead.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        const candidate = lookahead[candidateIndex] as number;
        if (index - candidate > 4096) continue;
        let candidateLength = 0;
        while (candidateLength < 4098 && index + candidateLength < values.length && values[candidate + candidateLength] === values[index + candidateLength]) candidateLength += 1;
        if (candidateLength > length) length = candidateLength;
      }
    } while (length < 3);
    result += LZ_ALPHABET[index - start - 1] ?? '';
    for (let offset = start; offset < index; offset += 1) result += literal(values[offset] as number);
  }
  return { data: result, literalFrequencies, matchFrequencies };
}

function encodeCostedLzFrameStream(values: readonly number[], compactLiterals: boolean, offsets: readonly number[]): { readonly data: string; readonly literalFrequencies: ReadonlyMap<number, number> } {
  const count = values.length;
  const repeats = offsets.map((distance) => {
    const lengths = new Uint16Array(count + 1);
    for (let index = count - 1; index >= distance; index -= 1) {
      if (values[index] === values[index - distance]) lengths[index] = Math.min(4098, (lengths[index + 1] ?? 0) + 1);
    }
    return lengths;
  });
  const repeatMaximum = new Uint16Array(count);
  for (const run of repeats) for (let index = 0; index < count; index += 1) repeatMaximum[index] = Math.max(repeatMaximum[index] ?? 0, run[index] ?? 0);
  const matchLengths = new Uint16Array(count);
  const matchDistances = new Uint16Array(count);
  const references = new Map<string, number[]>();
  for (let index = 0; index + 2 < count; index += 1) {
    const key = `${values[index]},${values[index + 1]},${values[index + 2]}`;
    const candidates = references.get(key) ?? [];
    let length = 0;
    let distance = 0;
    if ((repeatMaximum[index] ?? 0) < 4098) {
      for (let candidateIndex = candidates.length - 1, checked = 0; candidateIndex >= 0 && (checked < 4 || checked < 64 && length < LZ_LITERAL_RUN_LIMIT); candidateIndex -= 1) {
        const candidate = candidates[candidateIndex] as number;
        const offset = index - candidate;
        if (offset > 4096) break;
        checked += 1;
        let matched = 3;
        while (matched < 4098 && index + matched < count && values[candidate + matched] === values[index + matched]) matched += 1;
        if (matched > length) { length = matched; distance = offset; }
        if (length === 4098) break;
      }
    }
    matchLengths[index] = length;
    matchDistances[index] = distance;
    candidates.push(index);
    references.set(key, candidates);
  }

  let size = 1;
  while (size <= count) size *= 2;
  const minimum = new Float64Array(size * 2).fill(Number.POSITIVE_INFINITY);
  const positions = new Int32Array(size * 2);
  const costs = new Float64Array(count + 1);
  const chosenLength = new Uint16Array(count);
  const chosenDistance = new Uint16Array(count);
  const chosenKind = new Uint8Array(count);
  const update = (index: number, cost: number): void => {
    let node = index + size;
    minimum[node] = cost;
    positions[node] = index;
    while (node > 1) {
      node = Math.floor(node / 2);
      const left = node * 2;
      const right = left + 1;
      const selected = (minimum[left] ?? Infinity) <= (minimum[right] ?? Infinity) ? left : right;
      minimum[node] = minimum[selected] as number;
      positions[node] = positions[selected] as number;
    }
  };
  const query = (start: number, end: number): number => {
    let left = start + size;
    let right = end + size;
    let best = Number.POSITIVE_INFINITY;
    let position = start;
    while (left < right) {
      if (left % 2 === 1) {
        if ((minimum[left] ?? Infinity) < best) { best = minimum[left] as number; position = positions[left] as number; }
        left += 1;
      }
      if (right % 2 === 1) {
        right -= 1;
        if ((minimum[right] ?? Infinity) < best) { best = minimum[right] as number; position = positions[right] as number; }
      }
      left = Math.floor(left / 2);
      right = Math.floor(right / 2);
    }
    return position;
  };
  update(count, 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    let literalCost = 1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let length = 1; length <= LZ_LITERAL_RUN_LIMIT && index + length <= count; length += 1) {
      const value = values[index + length - 1] as number;
      literalCost += !compactLiterals || value >= 58 ? 2 : 1;
      const cost = literalCost + (costs[index + length] ?? 0);
      if (cost < bestCost) { bestCost = cost; chosenLength[index] = length; chosenKind[index] = 0; }
    }
    const consider = (first: number, last: number, tokenCost: number, kind: number, distance: number): void => {
      if (last < first) return;
      const finish = query(index + first, Math.min(count, index + last) + 1);
      const cost = tokenCost + (costs[finish] ?? 0);
      if (cost < bestCost) {
        bestCost = cost;
        chosenLength[index] = finish - index;
        chosenKind[index] = kind;
        chosenDistance[index] = distance;
      }
    };
    const generalLength = matchLengths[index] ?? 0;
    consider(3, generalLength, 5, 1, matchDistances[index] ?? 0);
    const specialLength = repeatMaximum[index] ?? 0;
    consider(3, specialLength, 3, 2, 0);
    consider(3, Math.min(66 - offsets.length - LZ_LITERAL_RUN_LIMIT, repeats[0]?.[index] ?? 0), 1, 3, 1);
    costs[index] = bestCost;
    update(index, bestCost);
  }

  const pair = (value: number): string => `${LZ_ALPHABET[Math.floor(value / 64)] ?? ''}${LZ_ALPHABET[value % 64] ?? ''}`;
  let result = '';
  const literalFrequencies = new Map<number, number>();
  for (let index = 0; index < count;) {
    const length = chosenLength[index] ?? 0;
    const kind = chosenKind[index] ?? 0;
    if (kind === 0) {
      result += LZ_ALPHABET[length - 1] ?? '';
      for (let offset = 0; offset < length; offset += 1) {
        const value = values[index + offset] as number;
        literalFrequencies.set(value, (literalFrequencies.get(value) ?? 0) + 1);
        result += !compactLiterals ? pair(value) : value >= 58 ? `${LZ_ALPHABET[58 + Math.floor((value - 58) / 64)] ?? ''}${LZ_ALPHABET[(value - 58) % 64] ?? ''}` : LZ_ALPHABET[value] ?? '';
      }
    } else if (kind === 3) {
      result += LZ_ALPHABET[length + LZ_LITERAL_RUN_LIMIT - 3] ?? '';
    } else if (kind === 2) {
      const specialIndex = repeats.findIndex((run) => (run[index] ?? 0) >= length);
      result += `${LZ_ALPHABET[64 - offsets.length + specialIndex] ?? ''}${pair(length - 3)}`;
    } else {
      const distance = chosenDistance[index] ?? 0;
      result += `!${pair(distance - 1)}${pair(length - 3)}`;
    }
    index += length;
  }
  return { data: result, literalFrequencies };
}

function encodeLzPalette(colours: readonly string[], indexes: readonly number[], allowBinary = false): { readonly data: string; readonly nearGreyscale: boolean; readonly binaryGreyscale: boolean } {
  const values = indexes.map((index) => (colours[index] ?? '0,0,0').split(',').map(Number));
  const nearGreyscale = values.every((channels) => Math.abs((channels[0] ?? 0) - (channels[1] ?? 0)) <= 1 && Math.abs((channels[2] ?? 0) - (channels[1] ?? 0)) <= 1);
  const binaryGreyscale = allowBinary && nearGreyscale && values.every((channels) => (channels[0] ?? 0) <= (channels[1] ?? 0) && (channels[2] ?? 0) <= (channels[1] ?? 0));
  if (binaryGreyscale) {
    const bits: number[] = [];
    for (const channels of values) {
      const base = channels[1] ?? 0;
      appendBits(bits, base * 4 + ((channels[0] ?? 0) - base + 1) * 2 + ((channels[2] ?? 0) - base + 1), 10);
    }
    let data = '';
    for (let index = 0; index < bits.length; index += 6) {
      let value = 0;
      for (let bit = 0; bit < 6; bit += 1) value = value * 2 + (bits[index + bit] ?? 0);
      data += LZ_ALPHABET[value] ?? '';
    }
    return { data: `${data}0`, nearGreyscale, binaryGreyscale };
  }
  let result = '';
  for (const channels of values) {
    if (nearGreyscale) {
      const base = channels[1] ?? 0;
      const value = base * 16 + ((channels[0] ?? 0) - base + 1) * 4 + ((channels[2] ?? 0) - base + 1);
      result += LZ_ALPHABET[Math.floor(value / 64)] ?? '';
      result += LZ_ALPHABET[value % 64] ?? '';
      continue;
    }
    const value = ((channels[0] ?? 0) * 65_536) + ((channels[1] ?? 0) * 256) + (channels[2] ?? 0);
    result += LZ_ALPHABET[Math.floor(value / 262_144)] ?? '';
    result += LZ_ALPHABET[Math.floor(value / 4096) % 64] ?? '';
    result += LZ_ALPHABET[Math.floor(value / 64) % 64] ?? '';
    result += LZ_ALPHABET[value % 64] ?? '';
  }
  return { data: result, nearGreyscale, binaryGreyscale };
}

/** Encode all animation frames as one LZ stream with a compact RGB palette. */
export function emitAnimationLuaLzFrames(
  frameIndices: readonly Uint16Array[],
  width: number,
  height: number,
  colours: readonly string[],
  ticksPerFrame = 6,
): string {
  if (frameIndices.length === 0 || width <= 0 || height <= 0) return '';
  const sourceOrder = [...new Set(frameIndices.flatMap((indices) => Array.from(indices)))];
  if (sourceOrder.length === 0 || sourceOrder.length > 512) return '';
  const sourceMap = new Map(sourceOrder.map((index, compact) => [index, compact] as const));
  const preliminaryValues = frameIndices.flatMap((indices) => Array.from(indices, (index) => sourceMap.get(index) ?? 0));
  const pixels = width * height;
  const baseOffsets = [...new Set([1, width, pixels])].filter((distance) => distance <= 4096);
  const preliminary = encodeLzFrameStream(preliminaryValues, false, baseOffsets);
  const rankedOffsets = [...preliminary.matchFrequencies.entries()]
    .filter(([distance]) => distance <= 4096 && !baseOffsets.includes(distance))
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .map(([distance]) => distance);
  const initialIndexes = [...sourceOrder].sort((left, right) => {
    const frequencyDifference = (preliminary.literalFrequencies.get(sourceMap.get(right) ?? 0) ?? 0) - (preliminary.literalFrequencies.get(sourceMap.get(left) ?? 0) ?? 0);
    return frequencyDifference !== 0 ? frequencyDifference : (sourceMap.get(left) ?? 0) - (sourceMap.get(right) ?? 0);
  });
  const compactLiterals = initialIndexes.length <= 442;
  const build = (offsets: readonly number[]): string => {
    let sourceIndexes = initialIndexes;
    const encode = (indexes: readonly number[]) => {
      const compactIndexes = new Map(indexes.map((index, compact) => [index, compact] as const));
      const values = frameIndices.flatMap((indices) => Array.from(indices, (index) => compactIndexes.get(index) ?? 0));
      const greedy = encodeLzFrameStream(values, compactLiterals, offsets);
      const costed = encodeCostedLzFrameStream(values, compactLiterals, offsets);
      return costed.data.length < greedy.data.length
        ? { data: costed.data, frequencies: costed.literalFrequencies }
        : { data: greedy.data, frequencies: greedy.literalFrequencies };
    };
    let encoded = encode(sourceIndexes);
    if (compactLiterals) {
      const currentOrder = new Map(sourceIndexes.map((index, position) => [index, position] as const));
      const frequencyBySource = new Map(sourceIndexes.map((index, position) => [index, encoded.frequencies.get(position) ?? 0] as const));
      const reordered = [...sourceIndexes].sort((left, right) => (frequencyBySource.get(right) ?? 0) - (frequencyBySource.get(left) ?? 0) || (currentOrder.get(left) ?? 0) - (currentOrder.get(right) ?? 0));
      const revised = encode(reordered);
      if (revised.data.length < encoded.data.length) { sourceIndexes = reordered; encoded = revised; }
    }
    const data = encoded.data;
    const literalDecoder = compactLiterals
      ? `local v=V(B(d,i))i=i+1 if v>57 then v=58+(v-58)*64+V(B(d,i))i=i+1 end o[#o+1]=v `
      : `o[#o+1]=V(B(d,i))*64+V(B(d,i+1))i=i+2 `;
    const emitPalette = (palette: ReturnType<typeof encodeLzPalette>): string => {
      const decoder = `S=screen P="${palette.data}"d="${data}"o={}B=string.byte function V(n)return n-(n>96 and 61 or n>64 and 55 or n<58 and 48 or 0)end i=1 while i<=#d do z=B(d,i)i=i+1 if z==33 then x=V(B(d,i))*64+V(B(d,i+1))+1 i=i+2 n=64 else n=V(z) if n<${LZ_LITERAL_RUN_LIMIT} then for j=1,n+1 do ${literalDecoder}end n=0 elseif n<${64 - offsets.length} then x=1 n=n-${LZ_LITERAL_RUN_LIMIT - 3} else x=({${offsets.join(',')}})[n-${63 - offsets.length}]end end if n>=${64 - offsets.length} then n=V(B(d,i))*64+V(B(d,i+1))+3 i=i+2 end for j=1,n do o[#o+1]=o[#o-x+1]end end F=S.drawRectF `;
      const colour = palette.binaryGreyscale
        ? `p=c*10 k=p//6+1 v=V(B(P,k))*4096+V(B(P,k+1))*64+V(B(P,k+2))v=v>>8-p%6&1023 g=v//4 S.setColor(g+v//2%2-1,g,g+v%2-1)`
        : palette.nearGreyscale
        ? `v=V(B(P,c*2+1))*64+V(B(P,c*2+2))g=v//16 S.setColor(g+v//4%4-1,g,g+v%4-1)`
        : `local i=c*4+1 local v=V(B(P,i))*262144+V(B(P,i+1))*4096+V(B(P,i+2))*64+V(B(P,i+3))S.setColor(v//65536,v//256%256,v%256)`;
      const draw = `function onDraw()q=nil for z=0,${pixels - 1} do c=o[f*${pixels}+z+1]if c~=q then ${colour}q=c end F(z%${width},z//${width},1,1)end end`;
      return `${decoder}f=0 t=0 function onTick()t=(t+1)%${ticksPerFrame * frameIndices.length} f=t//${ticksPerFrame} end ${draw}`;
    };
    const normal = emitPalette(encodeLzPalette(colours, sourceIndexes));
    const binaryPalette = encodeLzPalette(colours, sourceIndexes, true);
    if (!binaryPalette.binaryGreyscale) return normal;
    const binary = emitPalette(binaryPalette);
    return binary.length < normal.length ? binary : normal;
  };
  let best = build(baseOffsets);
  for (let count = 1; count <= Math.min(6 - baseOffsets.length, rankedOffsets.length); count += 1) {
    const candidate = build([...baseOffsets, ...rankedOffsets.slice(0, count)]);
    if (candidate.length < best.length) best = candidate;
  }
  return best;
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

/** Use packed pixels for a segment keyframe and direct rectangles for its sparse later diffs. */
export function emitAnimationLuaPackedKeyframe(
  fullKeyframeOps: readonly DrawOp[],
  diffOps: readonly (readonly DrawOp[])[],
  ticksPerFrame = 6,
): string {
  if (diffOps.length === 0) return animationBody([''], ticksPerFrame);
  const keyframe = functionBody(emitLua(fullKeyframeOps, 'packed'));
  const bodies = [keyframe, ...diffOps.slice(1).map((ops) => emitDirectBody(ops, { colour: 'screen.setColor', rectF: 'screen.drawRectF', rect: 'screen.drawRect', line: 'screen.drawLine' }))];
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
  return `f=0 t=0 function onTick()t=t+1 if t>${ticksPerFrame - 1} then t=0 f=(f+1)%${frameCount} end end `;
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
  const width = colourCount <= 128 ? 2 : colourCount <= 512 ? 3 : 0;
  if (width === 0) return '';
  let result = '';
  let colour = values[0] ?? 0;
  let height = 0;
  const flush = (): void => {
    const value = colour * 32 + height - 1;
    if (width === 2) {
      result += COMPACT_RECT_ALPHABET[Math.floor(value / 64)] ?? '0';
      result += COMPACT_RECT_ALPHABET[value % 64] ?? '0';
    } else {
      result += COMPACT_RECT_ALPHABET[Math.floor(value / 4096)] ?? '0';
      result += COMPACT_RECT_ALPHABET[Math.floor(value / 64) % 64] ?? '0';
      result += COMPACT_RECT_ALPHABET[value % 64] ?? '0';
    }
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
  return result;
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

function encodeWideRunPattern(pattern: string, indexes: ReadonlyMap<string, number>): string {
  let result = '';
  for (let offset = 0; offset < pattern.length; offset += 3) {
    const index = indexes.get(pattern.slice(offset, offset + 3)) as number;
    result += COMPACT_RECT_ALPHABET[Math.floor(index / COMPACT_RECT_ALPHABET.length)] ?? '';
    result += COMPACT_RECT_ALPHABET[index % COMPACT_RECT_ALPHABET.length] ?? '';
  }
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
  if (frameIndices.length === 0 || width <= 0 || height <= 0 || colours.length > 512) return '';
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
  const wideRuns = colours.length > 128;
  const runWidth = wideRuns ? 3 : 2;
  const runFrequencies = new Map<string, number>();
  for (const pattern of rawPatterns) for (let offset = 0; offset < pattern.length; offset += runWidth) {
    const run = pattern.slice(offset, offset + runWidth);
    runFrequencies.set(run, (runFrequencies.get(run) ?? 0) + 1);
  }
  const runs = [...runFrequencies.keys()].sort((left, right) => {
    const frequencyDifference = (runFrequencies.get(right) ?? 0) - (runFrequencies.get(left) ?? 0);
    return frequencyDifference !== 0 ? frequencyDifference : left.localeCompare(right);
  });
  const runIndexes = new Map(runs.map((run, index) => [run, index] as const));
  const extendedRuns = runs.length > COMPACT_RECT_ALPHABET.length + COLUMN_DICTIONARY_HIGH_ALPHABET.length;
  const patterns = rawPatterns.map((pattern) => wideRuns ? encodeWideRunPattern(pattern, runIndexes) : encodeRunPattern(pattern, runIndexes, extendedRuns));
  if (patterns.some((pattern) => pattern === '') || orderedKeys.some((_, index) => columnReference(index) === '') || (!wideRuns && runs.some((_, index) => runReference(index, extendedRuns) === '')) || (wideRuns && runs.length > COMPACT_RECT_ALPHABET.length ** 2)) return '';
  const data = frameKeys.map((keys) => encodeColumnReferences(keys, indexes));
  const greyscale = colours.map((value) => {
    const channels = value.split(',');
    return channels[0] === channels[1] && channels[1] === channels[2];
  });
  const palette = greyscale.every(Boolean)
    ? `p={${colours.map((colour) => colour.split(',')[0]).join(',')}`
    : `p={${colours.map((colour, index) => greyscale[index] ? colour.split(',')[0] : `{${colour}}`).join(',')}`;
  const colour = greyscale.every(Boolean) ? 'S.setColor(e,e,e)' : 'if type(e)=="number"then S.setColor(e,e,e)else S.setColor(e[1],e[2],e[3])end';
  const runDecoder = extendedRuns
    ? `if z=="'"then u=${COMPACT_RECT_ALPHABET.length + COLUMN_DICTIONARY_HIGH_ALPHABET.length}+A:find(s:sub(j+1,j+1),1,true)-1 j=j+1 else u=${COMPACT_RECT_ALPHABET.length}+H:find(z,1,true)-1 end`
    : `u=${COMPACT_RECT_ALPHABET.length}+H:find(z,1,true)-1`;
  const widePrefix = `S=screen A="${COMPACT_RECT_ALPHABET}" M="${COLUMN_REFERENCE_RUN_MARKER}" B="${runs.join('')}" ${palette}} q="${patterns.join(COLUMN_REFERENCE_RUN_MARKER)}"local Q={}for z in q:gmatch("[^!]+")do Q[#Q+1]=z end F=S.drawRectF function D(d)local x=0 local i=1 while i<=#d do local n=(A:find(d:sub(i,i),1,true)-1)*64+A:find(d:sub(i+1,i+1),1,true)-1 i=i+2 local k=1 if d:sub(i,i)==M then k=A:find(d:sub(i+1,i+1),1,true)i=i+2 end local s=Q[n+1]for r=1,k do local j=1 local y=0 while j<=#s do local u=(A:find(s:sub(j,j),1,true)-1)*64+A:find(s:sub(j+1,j+1),1,true)-1 local v=(A:find(B:sub(u*3+1,u*3+1),1,true)-1)*4096+(A:find(B:sub(u*3+2,u*3+2),1,true)-1)*64+A:find(B:sub(u*3+3,u*3+3),1,true)-1 local c=math.floor(v/32)local h=v%32+1 local e=p[c+1]${colour} F(x,y,1,h)y=y+h j=j+2 end x=x+1 end end end `;
  const prefix = wideRuns ? widePrefix : `S=screen A="${COMPACT_RECT_ALPHABET}" H="${COLUMN_DICTIONARY_HIGH_ALPHABET}" M="${COLUMN_REFERENCE_RUN_MARKER}" B="${runs.join('')}" ${palette}} q="${patterns.join(COLUMN_REFERENCE_RUN_MARKER)}"local Q={}for z in q:gmatch("[^!]+")do Q[#Q+1]=z end F=S.drawRectF function D(d)local x=0 local i=1 while i<=#d do local z=d:sub(i,i)local n=A:find(z,1,true)if n then n=n-1 else local h=H:find(z,1,true)if not h then return end n=${COMPACT_RECT_ALPHABET.length}+(h-1)*${COMPACT_RECT_ALPHABET.length}+A:find(d:sub(i+1,i+1),1,true)-1 i=i+1 end i=i+1 local k=1 if d:sub(i,i)==M then k=A:find(d:sub(i+1,i+1),1,true)i=i+2 end local s=Q[n+1]for r=1,k do local j=1 local y=0 while j<=#s do local z=s:sub(j,j)local u=A:find(z,1,true)if u then u=u-1 else ${runDecoder} end local v=(A:find(B:sub(u*2+1,u*2+1),1,true)-1)*64+A:find(B:sub(u*2+2,u*2+2),1,true)-1 local c=math.floor(v/32)local h=v%32+1 local e=p[c+1]${colour} F(x,y,1,h)y=y+h j=j+1 end x=x+1 end end end `;
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
