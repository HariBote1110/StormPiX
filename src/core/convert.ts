import { cover, type LabelImage } from './cover.ts';
import { emitAnimationLua, emitAnimationLuaColumnDictionary, emitAnimationLuaCompact, emitAnimationLuaCompactRectangles, emitAnimationLuaSharedPacked, emitLua } from './cost.ts';
import { psnr, rmse, ssim } from './metrics.ts';
import { orderOps } from './order.ts';
import { blockify, quantiseForQuality } from './quantise.ts';
import { render } from './render.ts';
import { monitorDeviceTarget, monitorInputOps, monitorInputPalette, renderMonitor } from './gamma.ts';
import type { Bitmap, ConvertOptions, ConvertResult, DrawOp, EmitStrategy, QualityMetrics, Rgb } from './types.ts';

const DEFAULT_BUDGET = 8192;
const DEFAULT_TIME_BUDGET_MS = 5000;
const DEFAULT_WORK_BUDGET = 60;
const DEFAULT_ANIMATION_WORK_BUDGET = 40;
const DICTIONARY_FIT_CANDIDATE_LIMIT = 16;
const HIGH_BUDGET_WORK_CAP = 12;
const ALL_STRATEGIES: readonly EmitStrategy[] = ['direct', 'table', 'packed'];

interface WorkControl {
  readonly take: () => boolean;
  readonly timeBudgetTruncated: () => boolean;
}

function createWorkControl(timeBudgetMs: number, defaultWorkBudget: number, maximumWorkBudget = Number.MAX_SAFE_INTEGER): WorkControl {
  const timeRatio = Math.min(1, Math.max(1, timeBudgetMs) / DEFAULT_TIME_BUDGET_MS);
  let remaining = Math.max(1, Math.min(maximumWorkBudget, Math.floor(defaultWorkBudget * Math.sqrt(timeRatio))));
  let truncated = false;
  return {
    take: (): boolean => {
      if (remaining <= 0) {
        truncated = true;
        return false;
      }
      remaining -= 1;
      if (remaining === 0) truncated = true;
      return true;
    },
    timeBudgetTruncated: (): boolean => truncated,
  };
}

interface Candidate {
  readonly ops: DrawOp[];
  readonly palette: readonly Rgb[];
  readonly strategy: EmitStrategy;
  readonly lua: string;
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
}

interface AnimationCandidate {
  readonly playbackOps: readonly DrawOp[][];
  readonly fullOps: readonly DrawOp[][];
  readonly diffOps: readonly DrawOp[][];
  readonly frameIndices: readonly Uint16Array[];
  readonly palette: readonly Rgb[];
  readonly strategy: EmitStrategy;
  readonly encoding: 'full' | 'keyframe-diff';
  readonly lua: string;
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
}

interface AnimationSelection {
  readonly candidate: AnimationCandidate;
  readonly scripts: readonly string[];
  readonly ranges?: readonly (readonly [number, number])[];
  readonly encoding: 'full' | 'keyframe-diff';
}

function candidateBetter(candidate: Candidate, best: Candidate | undefined): boolean {
  if (!best) return true;
  const qualityDifference = candidate.metrics.ssim - best.metrics.ssim;
  if (Math.abs(qualityDifference) > 1e-12) return qualityDifference > 0;
  const psnrDifference = candidate.metrics.psnr - best.metrics.psnr;
  if (Math.abs(psnrDifference) > 1e-12) return psnrDifference > 0;
  return candidate.lua.length < best.lua.length;
}

function makeCandidate(source: Bitmap, palette: readonly Rgb[], indices: Uint16Array, strategies: readonly EmitStrategy[], budget: number): Candidate | undefined {
  const labelImage: LabelImage = { width: source.width, height: source.height, indices };
  const ops = orderOps(cover(labelImage, palette));
  return makeOpsCandidate(source, palette, ops, strategies, budget);
}

function makeOpsCandidate(source: Bitmap, palette: readonly Rgb[], ops: DrawOp[], strategies: readonly EmitStrategy[], budget: number): Candidate | undefined {
  const emitted = strategies.map((strategy) => ({ strategy, lua: emitLua(ops, strategy) })).filter((entry) => entry.lua.length <= budget);
  if (emitted.length === 0) return undefined;
  const rendered = render(ops, source.width, source.height);
  const metrics = { ssim: ssim(source, rendered), psnr: psnr(source, rendered), rmse: rmse(source, rendered) };
  let best: Candidate | undefined;
  for (const entry of emitted) {
    const candidate: Candidate = { ops, palette, strategy: entry.strategy, lua: entry.lua, rendered, metrics };
    if (candidateBetter(candidate, best)) best = candidate;
  }
  return best;
}

interface LosslessRecord {
  readonly colour: Extract<DrawOp, { type: 'setColour' }>;
  readonly draw: DrawOp;
}

function losslessRecords(ops: readonly DrawOp[]): LosslessRecord[] {
  const records: LosslessRecord[] = [];
  let colour: Extract<DrawOp, { type: 'setColour' }> | undefined;
  for (const op of ops) {
    if (op.type === 'setColour') colour = op;
    else if (colour) records.push({ colour, draw: op });
  }
  return records;
}

function losslessSegmentOps(records: readonly LosslessRecord[], start: number, end: number): DrawOp[] {
  const ops: DrawOp[] = [];
  let previousColour: string | undefined;
  for (let index = start; index < end; index += 1) {
    const record = records[index] as LosslessRecord;
    const key = `${record.colour.r},${record.colour.g},${record.colour.b},${record.colour.a ?? ''}`;
    if (key !== previousColour) {
      ops.push(record.colour);
      previousColour = key;
    }
    ops.push(record.draw);
  }
  return ops;
}

function shortestLosslessSegment(records: readonly LosslessRecord[], start: number, end: number, strategies: readonly EmitStrategy[]): string {
  const segment = losslessSegmentOps(records, start, end);
  let shortest = emitLua(segment, strategies[0] ?? 'direct');
  for (const strategy of strategies.slice(1)) {
    const lua = strategy === 'packed' ? '' : emitLua(segment, strategy);
    if (lua !== '' && lua.length < shortest.length) shortest = lua;
  }
  return shortest;
}

function splitLosslessOps(ops: readonly DrawOp[], budget: number, strategies: readonly EmitStrategy[]): { readonly scripts: readonly string[]; readonly strategy: EmitStrategy } {
  const records = losslessRecords(ops);
  if (records.length === 0) return { scripts: [emitLua([], strategies[0] ?? 'direct')], strategy: strategies[0] ?? 'direct' };
  const splitStrategies = strategies.filter((strategy) => strategy !== 'packed');
  const safeStrategies = splitStrategies.length > 0 ? splitStrategies : ['direct' as const];
  const wholeCandidates = strategies.map((strategy) => ({ strategy, lua: emitLua(ops, strategy) })).sort((left, right) => left.lua.length - right.lua.length);
  const whole = wholeCandidates[0] as { readonly strategy: EmitStrategy; readonly lua: string };
  if (whole.lua.length <= budget) return { scripts: [whole.lua], strategy: whole.strategy };

  const costs = new Map<string, string>();
  const segment = (start: number, end: number): string => {
    const key = `${start}:${end}`;
    const cached = costs.get(key);
    if (cached !== undefined) return cached;
    const lua = shortestLosslessSegment(records, start, end, safeStrategies);
    costs.set(key, lua);
    return lua;
  };
  const bestCost = new Array<number>(records.length + 1).fill(Number.POSITIVE_INFINITY);
  const bestCount = new Array<number>(records.length + 1).fill(Number.POSITIVE_INFINITY);
  const previous = new Array<number>(records.length + 1).fill(-1);
  bestCost[0] = 0;
  bestCount[0] = 0;
  for (let end = 1; end <= records.length; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const lua = segment(start, end);
      if (lua.length > budget || !Number.isFinite(bestCost[start])) continue;
      const cost = (bestCost[start] as number) + lua.length;
      const count = (bestCount[start] as number) + 1;
      if (cost < (bestCost[end] as number) || (cost === bestCost[end] && count < (bestCount[end] as number))) {
        bestCost[end] = cost;
        bestCount[end] = count;
        previous[end] = start;
      }
    }
  }
  if (previous[records.length] === -1) {
    return { scripts: records.map((_, index) => segment(index, index + 1)), strategy: 'direct' };
  }
  const scripts: string[] = [];
  let end = records.length;
  while (end > 0) {
    const start = previous[end] as number;
    scripts.unshift(segment(start, end));
    end = start;
  }
  return { scripts, strategy: 'direct' };
}

interface RefinementPatch {
  readonly ops: DrawOp[];
  readonly score: number;
}

/** Try the most valuable single rectangles when a palette cannot fit outright. */
function lowBudgetRefinement(
  source: Bitmap,
  palette: readonly Rgb[],
  indices: Uint16Array,
  strategies: readonly EmitStrategy[],
  budget: number,
  takeWork: () => boolean,
): Candidate | undefined {
  const baseColour = quantiseForQuality(source, 1).palette[0] ?? [0, 0, 0];
  const baseOps: DrawOp[] = [
    { type: 'setColour', r: baseColour[0], g: baseColour[1], b: baseColour[2] },
    { type: 'rectF', x: 0, y: 0, w: source.width, h: source.height },
  ];
  let best = takeWork() ? makeOpsCandidate(source, palette, baseOps, strategies, budget) : undefined;
  const complete = cover({ width: source.width, height: source.height, indices }, palette);
  const patches: RefinementPatch[] = [];
  let colour: Rgb | undefined;
  for (const op of complete) {
    if (op.type === 'setColour') {
      colour = [op.r, op.g, op.b];
      continue;
    }
    if (op.type !== 'rectF' || !colour) continue;
    let errorReduction = 0;
    for (let y = op.y; y < op.y + op.h; y += 1) for (let x = op.x; x < op.x + op.w; x += 1) {
      const offset = (y * source.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceValue = source.data[offset + channel] ?? 0;
        errorReduction += (sourceValue - (baseColour[channel] ?? 0)) ** 2 - (sourceValue - (colour[channel] ?? 0)) ** 2;
      }
    }
    const patch: DrawOp[] = [{ type: 'setColour', r: colour[0], g: colour[1], b: colour[2] }, op];
    const cost = emitLua(patch, 'direct').length;
    patches.push({ ops: patch, score: cost > 0 ? errorReduction / cost : 0 });
  }
  patches.sort((left, right) => right.score - left.score);
  for (const patch of patches.slice(0, 12)) {
    if (!takeWork()) break;
    const candidate = makeOpsCandidate(source, palette, [...baseOps, ...patch.ops], strategies, budget);
    if (candidate && candidateBetter(candidate, best)) best = candidate;
  }
  return best;
}

function makeDefaultColourCandidate(source: Bitmap, strategies: readonly EmitStrategy[], budget: number): Candidate | undefined {
  const rect: DrawOp = { type: 'rectF', x: 0, y: 0, w: source.width, h: source.height };
  const ops: DrawOp[] = [{ type: 'setColour', r: 255, g: 255, b: 255 }, rect];
  const lua = `function onDraw()screen.drawRectF(0,0,${source.width},${source.height})end`;
  if (lua.length > budget || !strategies.includes('direct')) return undefined;
  const rendered = render(ops, source.width, source.height);
  return {
    ops,
    palette: [[255, 255, 255]],
    strategy: 'direct',
    lua,
    rendered,
    metrics: { ssim: ssim(source, rendered), psnr: psnr(source, rendered), rmse: rmse(source, rendered) },
  };
}

function losslessResult(
  source: Bitmap,
  palette: readonly Rgb[],
  ops: readonly DrawOp[],
  strategies: readonly EmitStrategy[],
  budget: number,
  started: number,
  gamma = false,
): ConvertResult {
  const emittedOps = gamma ? monitorInputOps(ops) : [...ops];
  const emittedPalette = gamma ? monitorInputPalette(palette) : palette;
  const rendered = gamma ? renderMonitor(emittedOps, source.width, source.height) : render(emittedOps, source.width, source.height);
  const metrics = { ssim: ssim(source, rendered), psnr: psnr(source, rendered), rmse: rmse(source, rendered) };
  const emitted = strategies.map((strategy) => ({ strategy, lua: emitLua(emittedOps, strategy) })).sort((left, right) => left.lua.length - right.lua.length);
  const shortest = emitted[0] ?? { strategy: 'direct' as const, lua: emitLua(emittedOps, 'direct') };
  const split = shortest.lua.length <= budget ? { scripts: [shortest.lua], strategy: shortest.strategy } : splitLosslessOps(emittedOps, budget, strategies);
  const scripts = split.scripts.length > 0 ? split.scripts : [shortest.lua];
  const lua = scripts[0] as string;
  const allOps = emittedOps;
  return {
    lua,
    scripts,
    totalCharCount: scripts.reduce((sum, script) => sum + script.length, 0),
    charCount: lua.length,
    withinBudget: scripts.every((script) => script.length <= budget),
    strategy: split.strategy,
    palette: emittedPalette,
    rendered,
    metrics,
    stats: {
      ops: allOps.length,
      setColourCalls: allOps.filter((op) => op.type === 'setColour').length,
      rects: allOps.filter((op) => op.type === 'rectF').length,
      elapsedMs: performance.now() - started,
      timeBudgetTruncated: false,
    },
  };
}

function convertLossless(source: Bitmap, options: ConvertOptions, started: number): ConvertResult {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const exact = exactLabels(source);
  const ops = orderOps(cover({ width: source.width, height: source.height, indices: exact.indices }, exact.palette));
  return losslessResult(source, exact.palette, ops, options.strategies && options.strategies.length > 0 ? options.strategies : ALL_STRATEGIES, budget, started, options.gamma === true);
}

function losslessSingleScriptForFit(result: ConvertResult, budget: number, started: number): ConvertResult | undefined {
  if (result.scripts.length !== 1 || result.lua.length > budget) return undefined;
  return {
    ...result,
    withinBudget: true,
    stats: { ...result.stats, elapsedMs: performance.now() - started, timeBudgetTruncated: false },
  };
}

function losslessOptions(options: ConvertOptions, budget: number): ConvertOptions {
  return { ...options, mode: 'lossless', budget };
}

function canUseLosslessFitCandidate(options: ConvertOptions): boolean {
  return options.maxColours === undefined && options.dither === undefined;
}

function maxColoursSequence(maxColours: number): number[] {
  const values = new Set<number>();
  const cap = Math.max(1, Math.floor(maxColours));
  values.add(cap);
  for (const value of [256, 192, 160, 128, 96, 80, 64, 48, 32, 24, 20, 16, 12, 10, 8, 6, 4, 3, 2, 1]) if (value <= cap) values.add(value);
  return [...values].sort((a, b) => b - a);
}

function budgetColourCap(budget: number, maxColours: number, explicit: boolean): number {
  if (explicit) return maxColours;
  if (budget < 1000) return Math.min(maxColours, 16);
  if (budget < 2500) return Math.min(maxColours, 32);
  if (budget < 5000) return Math.min(maxColours, 64);
  if (budget < 5309) return Math.min(maxColours, 80);
  if (budget < 6292) return Math.min(maxColours, 96);
  if (budget < 7080) return Math.min(maxColours, 128);
  if (budget < 7613) return Math.min(maxColours, 160);
  if (budget < 7626) return Math.min(maxColours, 192);
  return maxColours;
}

function blockSizes(source: Bitmap): number[] {
  const area = source.width * source.height;
  if (area <= 1024) return [1];
  if (area <= 4096) return [1, 2];
  return [1, 2, 3, 4, 6, 8];
}

function exactLabels(source: Bitmap): { readonly palette: readonly Rgb[]; readonly indices: Uint16Array } {
  const palette: Rgb[] = [];
  const lookup = new Map<string, number>();
  const indices = new Uint16Array(source.width * source.height);
  for (let pixel = 0; pixel < source.width * source.height; pixel += 1) {
    const offset = pixel * 4;
    const colour: Rgb = [source.data[offset] ?? 0, source.data[offset + 1] ?? 0, source.data[offset + 2] ?? 0];
    const key = `${colour[0]},${colour[1]},${colour[2]}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = palette.length;
      lookup.set(key, index);
      palette.push(colour);
    }
    indices[pixel] = index;
  }
  return { palette, indices };
}

function exactLabelsFrames(frames: readonly Bitmap[]): { readonly palette: readonly Rgb[]; readonly indices: readonly Uint16Array[] } {
  const palette: Rgb[] = [];
  const lookup = new Map<string, number>();
  const indices: Uint16Array[] = [];
  for (const frame of frames) {
    const frameIndices = new Uint16Array(frame.width * frame.height);
    for (let pixel = 0; pixel < frame.width * frame.height; pixel += 1) {
      const offset = pixel * 4;
      const colour: Rgb = [frame.data[offset] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset + 2] ?? 0];
      const key = `${colour[0]},${colour[1]},${colour[2]}`;
      let index = lookup.get(key);
      if (index === undefined) {
        index = palette.length;
        lookup.set(key, index);
        palette.push(colour);
      }
      frameIndices[pixel] = index;
    }
    indices.push(frameIndices);
  }
  return { palette, indices };
}

function combinedFrames(frames: readonly Bitmap[]): Bitmap {
  const width = frames[0]?.width ?? 0;
  const height = frames.reduce((total, frame) => total + frame.height, 0);
  const data = new Uint8ClampedArray(width * height * 4);
  let targetRow = 0;
  for (const frame of frames) {
    data.set(frame.data, targetRow * width * 4);
    targetRow += frame.height;
  }
  return { width, height, data };
}

function splitCombinedIndices(combined: Uint16Array, width: number, frameHeight: number, frameCount: number): Uint16Array[] {
  const result: Uint16Array[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const indices = new Uint16Array(width * frameHeight);
    for (let row = 0; row < frameHeight; row += 1) {
      const sourceStart = (frame * frameHeight + row) * width;
      indices.set(combined.subarray(sourceStart, sourceStart + width), row * width);
    }
    result.push(indices);
  }
  return result;
}

function changedPixels(previous: ArrayLike<number>, current: ArrayLike<number>): Uint8Array {
  const changed = new Uint8Array(current.length);
  for (let index = 0; index < current.length; index += 1) changed[index] = previous[index] === current[index] ? 0 : 1;
  return changed;
}

function animationCandidateBetter(candidate: AnimationCandidate, best: AnimationCandidate | undefined): boolean {
  if (!best) return true;
  const qualityDifference = candidate.metrics.ssim - best.metrics.ssim;
  if (Math.abs(qualityDifference) > 1e-12) return qualityDifference > 0;
  return candidate.lua.length < best.lua.length;
}

function animationSelectionBetter(candidate: AnimationSelection, best: AnimationSelection | undefined): boolean {
  if (!best) return true;
  const qualityDifference = candidate.candidate.metrics.ssim - best.candidate.metrics.ssim;
  if (Math.abs(qualityDifference) > 1e-12) return qualityDifference > 0;
  if (candidate.scripts.length !== best.scripts.length) return candidate.scripts.length < best.scripts.length;
  const candidateChars = candidate.scripts.reduce((sum, script) => sum + script.length, 0);
  const bestChars = best.scripts.reduce((sum, script) => sum + script.length, 0);
  return candidateChars < bestChars;
}

interface PreparedAnimation {
  readonly fullOps: readonly DrawOp[][];
  readonly diffOps: readonly DrawOp[][];
  readonly frameIndices: readonly Uint16Array[];
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
}

function prepareAnimation(frames: readonly Bitmap[], palette: readonly Rgb[], indices: readonly Uint16Array[]): PreparedAnimation {
  const fullOps = indices.map((frameIndices, index) => orderOps(cover({ width: frames[index]?.width ?? 0, height: frames[index]?.height ?? 0, indices: frameIndices }, palette)));
  const diffOps = fullOps.map((ops, index) => {
    if (index === 0) return [...ops];
    const previous = indices[index - 1] ?? new Uint16Array(0);
    const current = indices[index] ?? new Uint16Array(0);
    return orderOps(cover({ width: frames[index]?.width ?? 0, height: frames[index]?.height ?? 0, indices: current, changed: changedPixels(previous, current) }, palette));
  });
  const renderedFrames = fullOps.map((ops, index) => render(ops, frames[index]?.width ?? 0, frames[index]?.height ?? 0));
  const metrics: QualityMetrics = {
    ssim: renderedFrames.reduce((sum, rendered, index) => sum + ssim(frames[index] as Bitmap, rendered), 0) / frames.length,
    psnr: renderedFrames.reduce((sum, rendered, index) => sum + psnr(frames[index] as Bitmap, rendered), 0) / frames.length,
    rmse: renderedFrames.reduce((sum, rendered, index) => sum + rmse(frames[index] as Bitmap, rendered), 0) / frames.length,
  };
  return { fullOps, diffOps, frameIndices: indices, rendered: renderedFrames[0] as Bitmap, metrics };
}

interface LosslessAnimationScripts {
  readonly scripts: readonly string[];
  readonly ranges: readonly (readonly [number, number])[];
  readonly encoding: 'full' | 'keyframe-diff';
}

function losslessAnimationSegment(
  fullOps: readonly (readonly DrawOp[])[],
  diffOps: readonly (readonly DrawOp[])[],
  frameIndices: readonly Uint16Array[],
  width: number,
  height: number,
  start: number,
  end: number,
  ticksPerFrame: number,
  colours: readonly string[],
  frameChannel?: number,
): { readonly lua: string; readonly encoding: 'full' | 'keyframe-diff' } {
  const fullOpsForSegment = fullOps.slice(start, end);
  const diffOpsForSegment = [fullOps[start] as readonly DrawOp[], ...diffOps.slice(start + 1, end)];
  const frameOffset = frameChannel === undefined ? 0 : start;
  const segmentIndices = frameIndices.slice(start, end);
  const firstIndices = segmentIndices[0];
  const staticSegment = firstIndices !== undefined && segmentIndices.every((indices) => indices.length === firstIndices.length && indices.every((value, index) => value === firstIndices[index]));
  const fullCandidates = [
    emitAnimationLuaCompact(fullOpsForSegment, ticksPerFrame, frameChannel, frameOffset),
    emitAnimationLuaCompactRectangles(fullOpsForSegment, colours, ticksPerFrame, frameChannel, frameOffset),
    emitAnimationLuaColumnDictionary(segmentIndices, width, height, colours, ticksPerFrame, frameChannel, frameOffset),
    ...(frameChannel === undefined && end - start <= 2 ? [emitAnimationLua(fullOpsForSegment, 'packed', ticksPerFrame)] : []),
    ...(frameChannel === undefined && end - start <= 3 ? [emitAnimationLuaSharedPacked(segmentIndices, width, height, colours, ticksPerFrame)] : []),
    ...(frameChannel === undefined && staticSegment ? [emitAnimationLuaSharedPacked([firstIndices], width, height, colours, ticksPerFrame, segmentIndices.length)] : []),
  ];
  if (frameChannel !== undefined) {
    return { lua: fullCandidates.filter((candidate) => candidate !== '').sort((left, right) => left.length - right.length)[0] as string, encoding: 'full' };
  }
  const diffCandidates = [
    emitAnimationLuaCompact(diffOpsForSegment, ticksPerFrame),
    emitAnimationLuaCompactRectangles(diffOpsForSegment, colours, ticksPerFrame),
  ];
  const full = fullCandidates.filter((candidate) => candidate !== '').sort((left, right) => left.length - right.length)[0] as string;
  const diff = diffCandidates.sort((left, right) => left.length - right.length)[0] as string;
  return diff.length < full.length ? { lua: diff, encoding: 'keyframe-diff' } : { lua: full, encoding: 'full' };
}

function splitLosslessAnimation(
  fullOps: readonly (readonly DrawOp[])[],
  diffOps: readonly (readonly DrawOp[])[],
  frameIndices: readonly Uint16Array[],
  width: number,
  height: number,
  budget: number,
  ticksPerFrame: number,
  colours: readonly string[],
  frameChannel?: number,
): LosslessAnimationScripts {
  const frameCount = fullOps.length;
  const cache = new Map<string, { readonly lua: string; readonly encoding: 'full' | 'keyframe-diff' }>();
  const segment = (start: number, end: number): { readonly lua: string; readonly encoding: 'full' | 'keyframe-diff' } => {
    const key = `${start}:${end}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const result = losslessAnimationSegment(fullOps, diffOps, frameIndices, width, height, start, end, ticksPerFrame, colours, frameChannel);
    cache.set(key, result);
    return result;
  };
  const costs = new Array<number>(frameCount + 1).fill(Number.POSITIVE_INFINITY);
  const counts = new Array<number>(frameCount + 1).fill(Number.POSITIVE_INFINITY);
  const previous = new Array<number>(frameCount + 1).fill(-1);
  costs[0] = 0;
  counts[0] = 0;
  for (let end = 1; end <= frameCount; end += 1) {
    for (let start = 0; start < end; start += 1) {
      const candidate = segment(start, end);
      if (candidate.lua.length > budget || !Number.isFinite(costs[start])) continue;
      const cost = (costs[start] as number) + candidate.lua.length;
      const count = (counts[start] as number) + 1;
      if (count < (counts[end] as number) || (count === counts[end] && cost < (costs[end] as number))) {
        costs[end] = cost;
        counts[end] = count;
        previous[end] = start;
      }
    }
  }
  if (previous[frameCount] === -1) {
    const scripts = fullOps.map((ops, index) => emitAnimationLuaCompact([ops], ticksPerFrame, frameChannel, frameChannel === undefined ? 0 : index));
    return { scripts, ranges: fullOps.map((_, index) => [index, index + 1] as const), encoding: 'full' };
  }
  const scripts: string[] = [];
  const ranges: (readonly [number, number])[] = [];
  let encoding: 'full' | 'keyframe-diff' = 'full';
  let end = frameCount;
  while (end > 0) {
    const start = previous[end] as number;
    const candidate = segment(start, end);
    scripts.unshift(candidate.lua);
    ranges.unshift([start, end]);
    if (candidate.encoding === 'keyframe-diff') encoding = 'keyframe-diff';
    end = start;
  }
  return { scripts, ranges, encoding };
}

function evaluateAnimation(
  prepared: PreparedAnimation,
  palette: readonly Rgb[],
  strategies: readonly EmitStrategy[],
  ticksPerFrame: number,
  budget: number,
): { readonly best?: AnimationCandidate; readonly shortest: AnimationCandidate } {
  let best: AnimationCandidate | undefined;
  let shortest: AnimationCandidate | undefined;
  for (const encoding of ['full', 'keyframe-diff'] as const) {
    const playbackOps = encoding === 'full' ? prepared.fullOps : prepared.diffOps;
    for (const strategy of strategies) {
      const lua = emitAnimationLua(playbackOps, strategy, ticksPerFrame, encoding === 'keyframe-diff');
      const candidate: AnimationCandidate = { playbackOps, fullOps: prepared.fullOps, diffOps: prepared.diffOps, frameIndices: prepared.frameIndices, palette, strategy, encoding, lua, rendered: prepared.rendered, metrics: prepared.metrics };
      if (!shortest || lua.length < shortest.lua.length) shortest = candidate;
      if (lua.length <= budget && animationCandidateBetter(candidate, best)) best = candidate;
    }
  }
  return { best, shortest: shortest as AnimationCandidate };
}

/** Convert one bitmap by maximising measured SSIM among candidates that fit the character budget. */
export function convert(source: Bitmap, options: ConvertOptions = {}): ConvertResult {
  const started = performance.now();
  if (options.gamma === true) {
    const device = monitorDeviceTarget(source);
    const result = convertLossless(device.bitmap, options, started);
    return { ...result, stats: { ...result.stats, deviceMaxAbsChannelDeviation: device.maxAbsChannelDeviation, deviceMeanAbsChannelDeviation: device.meanAbsChannelDeviation } };
  }
  if ((options.mode ?? 'lossless') === 'lossless') return convertLossless(source, options, started);
  const budget = options.budget ?? DEFAULT_BUDGET;
  if (canUseLosslessFitCandidate(options)) {
    const lossless = convertLossless(source, losslessOptions(options, Number.MAX_SAFE_INTEGER), started);
    const losslessFit = losslessSingleScriptForFit(lossless, budget, started);
    if (losslessFit) return losslessFit;
  }
  const timeBudgetMs = Math.max(1, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const work = createWorkControl(timeBudgetMs, DEFAULT_WORK_BUDGET, budget >= 4000 ? HIGH_BUDGET_WORK_CAP : DEFAULT_WORK_BUDGET);
  const strategies = options.strategies && options.strategies.length > 0 ? options.strategies : ALL_STRATEGIES;
  const maxColours = Math.max(1, Math.floor(options.maxColours ?? 256));
  const searchColours = budgetColourCap(budget, maxColours, options.maxColours !== undefined);
  let best: Candidate | undefined;
  let lastPalette: readonly Rgb[] = [[0, 0, 0]];

  if (source.width > 0 && source.height > 0 && budget >= 0) {
    const defaultColour = work.take() ? makeDefaultColourCandidate(source, strategies, budget) : undefined;
    if (defaultColour) best = defaultColour;
    const base = quantiseForQuality(source, 1);
    const baseCandidate = work.take() ? makeCandidate(source, base.palette, base.indices, strategies, budget) : undefined;
    if (baseCandidate && candidateBetter(baseCandidate, best)) best = baseCandidate;
    if (options.maxColours === undefined && source.width * source.height <= 2048 && work.take()) {
      const exact = exactLabels(source);
      const exactCandidate = makeCandidate(source, exact.palette, exact.indices, strategies, budget);
      if (exactCandidate && candidateBetter(exactCandidate, best)) best = exactCandidate;
    }
    outer: for (const colourCount of maxColoursSequence(searchColours)) {
      const quantised = quantiseForQuality(source, colourCount, { dither: options.dither ?? 'none', seed: options.seed ?? 0 });
      lastPalette = quantised.palette;
      const sizes = colourCount > 32 ? [1] : blockSizes(source);
      for (const blockSize of sizes) {
        if (!work.take()) break outer;
        const indices = blockSize === 1 ? quantised.indices : blockify(source, quantised.palette, blockSize);
        const candidate = makeCandidate(source, quantised.palette, indices, strategies, budget);
        if (candidate) {
          if (candidateBetter(candidate, best)) best = candidate;
        }
      }
    }
    if (budget <= 1000 && searchColours > 1) {
      const refinement = quantiseForQuality(source, Math.min(searchColours, 16), { dither: options.dither ?? 'none', seed: options.seed ?? 0 });
      const refined = lowBudgetRefinement(source, refinement.palette, refinement.indices, strategies, budget, work.take);
      if (refined && candidateBetter(refined, best)) best = refined;
    }
  }

  if (!best) {
    const emptyOps: DrawOp[] = [];
    const rendered = render(emptyOps, source.width, source.height);
    const strategy = strategies[0] ?? 'direct';
    const lua = emitLua(emptyOps, strategy);
    best = {
      ops: emptyOps,
      palette: lastPalette,
      strategy,
      lua,
      rendered,
      metrics: { ssim: ssim(source, rendered), psnr: psnr(source, rendered), rmse: rmse(source, rendered) },
    };
  }

  const charCount = best.lua.length;
  const elapsedMs = performance.now() - started;
  return {
    lua: best.lua,
    scripts: [best.lua],
    totalCharCount: best.lua.length,
    charCount,
    withinBudget: charCount <= budget,
    strategy: best.strategy,
    palette: best.palette,
    rendered: best.rendered,
    metrics: best.metrics,
    stats: {
      ops: best.ops.length,
      setColourCalls: best.ops.filter((op) => op.type === 'setColour').length,
      rects: best.ops.filter((op) => op.type === 'rectF').length,
      elapsedMs,
      timeBudgetTruncated: work.timeBudgetTruncated(),
    },
  };
}

function convertFramesLossless(frames: readonly Bitmap[], options: ConvertOptions & { readonly ticksPerFrame?: number }, started: number): ConvertResult {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const ticksPerFrame = Number.isFinite(options.ticksPerFrame) ? Math.max(1, Math.floor(options.ticksPerFrame as number)) : 6;
  const exact = exactLabelsFrames(frames);
  const prepared = prepareAnimation(frames, exact.palette, exact.indices);
  const colours = exact.palette.map((colour) => colour.join(','));
  const fullOps = options.gamma === true ? prepared.fullOps.map((ops) => monitorInputOps(ops)) : prepared.fullOps;
  const diffOps = options.gamma === true ? prepared.diffOps.map((ops) => monitorInputOps(ops)) : prepared.diffOps;
  const emittedColours = options.gamma === true ? monitorInputPalette(exact.palette).map((colour) => colour.join(',')) : colours;
  const split = splitLosslessAnimation(fullOps, diffOps, exact.indices, frames[0]?.width ?? 0, frames[0]?.height ?? 0, budget, ticksPerFrame, emittedColours, options.frameChannel);
  const scripts = split.scripts.length > 0 ? split.scripts : [emitAnimationLuaCompact(fullOps, ticksPerFrame, options.frameChannel)];
  const lua = scripts[0] as string;
  const allOps = fullOps.flat();
  const renderedFrames = fullOps.map((ops, index) => options.gamma === true ? renderMonitor(ops, frames[index]?.width ?? 0, frames[index]?.height ?? 0) : render(ops, frames[index]?.width ?? 0, frames[index]?.height ?? 0));
  const metrics: QualityMetrics = {
    ssim: renderedFrames.reduce((sum, rendered, index) => sum + ssim(frames[index] as Bitmap, rendered), 0) / frames.length,
    psnr: renderedFrames.reduce((sum, rendered, index) => sum + psnr(frames[index] as Bitmap, rendered), 0) / frames.length,
    rmse: renderedFrames.reduce((sum, rendered, index) => sum + rmse(frames[index] as Bitmap, rendered), 0) / frames.length,
  };
  return {
    lua,
    scripts,
    totalCharCount: scripts.reduce((sum, script) => sum + script.length, 0),
    charCount: lua.length,
    withinBudget: scripts.every((script) => script.length <= budget),
    strategy: 'direct',
    palette: options.gamma === true ? monitorInputPalette(exact.palette) : exact.palette,
    rendered: renderedFrames[0] as Bitmap,
    metrics,
    stats: {
      ops: allOps.length,
      setColourCalls: allOps.filter((op) => op.type === 'setColour').length,
      rects: allOps.filter((op) => op.type === 'rectF').length,
      elapsedMs: performance.now() - started,
      frameCount: frames.length,
      frameOps: fullOps.map((ops) => ops.length),
      encoding: split.encoding,
      fullFrameChars: Math.min(emitAnimationLuaCompact(fullOps, ticksPerFrame).length, emitAnimationLuaCompactRectangles(fullOps, emittedColours, ticksPerFrame).length),
      scriptFrameRanges: split.ranges,
      timeBudgetTruncated: false,
    },
  };
}

function convertFramesFitWithLosslessFallback(frames: readonly Bitmap[], options: ConvertOptions & { readonly ticksPerFrame?: number }, budget: number, started: number): ConvertResult | undefined {
  const lossless = convertFramesLossless(frames, losslessOptions(options, Number.MAX_SAFE_INTEGER), started);
  return losslessSingleScriptForFit(lossless, budget, started);
}

/** Convert a sequence with one palette and a measured full-frame/diff choice. */
export function convertFrames(frames: readonly Bitmap[], options: ConvertOptions & { readonly ticksPerFrame?: number } = {}): ConvertResult {
  if (frames.length === 0) throw new RangeError('At least one frame is required');
  if (options.frameChannel !== undefined && (!Number.isInteger(options.frameChannel) || options.frameChannel < 1 || options.frameChannel > 32)) throw new RangeError('frameChannel must be an integer from 1 to 32');
  if (frames.length === 1) return convert(frames[0] as Bitmap, options);
  const width = frames[0]?.width ?? 0;
  const height = frames[0]?.height ?? 0;
  if (frames.some((frame) => frame.width !== width || frame.height !== height)) throw new RangeError('Animation frames must have matching dimensions');
  const started = performance.now();
  if (options.gamma === true) {
    const devices = frames.map(monitorDeviceTarget);
    const result = convertFramesLossless(devices.map((device) => device.bitmap), options, started);
    return {
      ...result,
      stats: {
        ...result.stats,
        deviceMaxAbsChannelDeviation: Math.max(...devices.map((device) => device.maxAbsChannelDeviation)),
        deviceMeanAbsChannelDeviation: devices.reduce((sum, device) => sum + device.meanAbsChannelDeviation, 0) / devices.length,
      },
    };
  }
  if ((options.mode ?? 'lossless') === 'lossless') return convertFramesLossless(frames, options, started);

  const budget = options.budget ?? DEFAULT_BUDGET;
  if (canUseLosslessFitCandidate(options)) {
    const losslessFit = convertFramesFitWithLosslessFallback(frames, options, budget, started);
    if (losslessFit) return losslessFit;
  }
  const timeBudgetMs = Math.max(1, options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS);
  const work = createWorkControl(timeBudgetMs, DEFAULT_ANIMATION_WORK_BUDGET);
  const strategies = options.strategies && options.strategies.length > 0 ? options.strategies : ALL_STRATEGIES;
  const maxColours = Math.max(1, Math.floor(options.maxColours ?? 256));
  const searchColours = budgetColourCap(budget, maxColours, options.maxColours !== undefined);
  const ticksPerFrame = Number.isFinite(options.ticksPerFrame) ? Math.max(1, Math.floor(options.ticksPerFrame as number)) : 6;
  let best: AnimationSelection | undefined;
  let bestSplit: AnimationSelection | undefined;
  let shortest: AnimationCandidate | undefined;
  const dictionaryCandidates: { readonly prepared: PreparedAnimation; readonly palette: readonly Rgb[]; readonly evaluated: ReturnType<typeof evaluateAnimation>; readonly order: number }[] = [];
  let lastPalette: readonly Rgb[] = [[0, 0, 0]];

  const consider = (palette: readonly Rgb[], indices: readonly Uint16Array[], dictionaryEligible = true): void => {
    const prepared = prepareAnimation(frames, palette, indices);
    const evaluated = evaluateAnimation(prepared, palette, strategies, ticksPerFrame, budget);
    if (!shortest || evaluated.shortest.lua.length < shortest.lua.length) shortest = evaluated.shortest;
    if (evaluated.best) {
      const selection: AnimationSelection = { candidate: evaluated.best, scripts: [evaluated.best.lua], encoding: evaluated.best.encoding };
      if (animationSelectionBetter(selection, best)) best = selection;
    }
    if (dictionaryEligible) dictionaryCandidates.push({ prepared, palette, evaluated, order: dictionaryCandidates.length });
  };

  const considerDictionary = (entry: typeof dictionaryCandidates[number]): void => {
      const { prepared, palette, evaluated } = entry;
      const split = splitLosslessAnimation(
        prepared.fullOps,
        prepared.diffOps,
        prepared.frameIndices,
        width,
        height,
        budget,
        ticksPerFrame,
        palette.map((colour) => colour.join(',')),
        options.frameChannel,
      );
      if (split.scripts.every((script) => script.length <= budget)) {
        const candidate = evaluated.best ?? evaluated.shortest;
        const selection: AnimationSelection = { candidate, scripts: split.scripts, ranges: split.ranges, encoding: split.encoding };
        if (split.scripts.length > 1) {
          if (animationSelectionBetter(selection, bestSplit)) bestSplit = selection;
          if (options.frameChannel !== undefined && animationSelectionBetter(selection, best)) best = selection;
        } else if (animationSelectionBetter(selection, best)) best = selection;
      }
  };

  if (options.maxColours === undefined && work.take()) {
    const exact = exactLabelsFrames(frames);
    consider(exact.palette, exact.indices);
  }
  const combined = combinedFrames(frames);
  outer: for (const colourCount of maxColoursSequence(searchColours)) {
    const quantised = quantiseForQuality(combined, colourCount, { dither: options.dither ?? 'none', seed: options.seed ?? 0 });
    lastPalette = quantised.palette;
    const labels = splitCombinedIndices(quantised.indices, width, height, frames.length);
    for (const blockSize of blockSizes(frames[0] as Bitmap)) {
      if (!work.take()) break outer;
      const indices = blockSize === 1 ? labels : frames.map((frame) => blockify(frame, quantised.palette, blockSize));
      consider(quantised.palette, indices, blockSize === 1);
    }
  }

  dictionaryCandidates
    .sort((left, right) => {
      const qualityDifference = right.prepared.metrics.ssim - left.prepared.metrics.ssim;
      return Math.abs(qualityDifference) > 1e-12 ? qualityDifference : left.order - right.order;
    })
    .slice(0, DICTIONARY_FIT_CANDIDATE_LIMIT)
    .forEach(considerDictionary);

  if (!best && !shortest) {
    const fallbackIndices = frames.map((frame) => new Uint16Array(frame.width * frame.height));
    const fallback = evaluateAnimation(prepareAnimation(frames, lastPalette, fallbackIndices), lastPalette, strategies, ticksPerFrame, Number.MAX_SAFE_INTEGER).shortest;
    best = { candidate: fallback, scripts: [fallback.lua], encoding: fallback.encoding };
  }
  const fallbackCandidate = shortest;
  if (!best && fallbackCandidate) {
    best = { candidate: fallbackCandidate, scripts: [fallbackCandidate.lua], encoding: fallbackCandidate.encoding };
  }
  const selected = best as AnimationSelection;
  const scripts = selected.scripts;
  const lua = scripts[0] as string;
  const charCount = lua.length;
  const elapsedMs = performance.now() - started;
  const frameOps = selected.candidate.playbackOps.map((ops) => ops.length);
  const allOps = selected.candidate.playbackOps.flat();
  return {
    lua,
    scripts,
    totalCharCount: scripts.reduce((sum, script) => sum + script.length, 0),
    charCount,
    withinBudget: scripts.every((script) => script.length <= budget),
    strategy: selected.candidate.strategy,
    palette: selected.candidate.palette,
    rendered: selected.candidate.rendered,
    metrics: selected.candidate.metrics,
    stats: {
      ops: allOps.length,
      setColourCalls: allOps.filter((op) => op.type === 'setColour').length,
      rects: allOps.filter((op) => op.type === 'rectF').length,
      elapsedMs,
      frameCount: frames.length,
      frameOps,
      encoding: selected.encoding,
      fullFrameChars: emitAnimationLua(selected.candidate.fullOps, selected.candidate.strategy, ticksPerFrame, false).length,
      scriptFrameRanges: selected.ranges,
      splittingRequiresFrameChannel: options.frameChannel === undefined && bestSplit !== undefined && bestSplit.candidate.metrics.ssim > selected.candidate.metrics.ssim + 1e-12 ? true : undefined,
      timeBudgetTruncated: work.timeBudgetTruncated(),
    },
  };
}
