import { cover, type LabelImage } from './cover.ts';
import { emitAnimationLua, emitLua } from './cost.ts';
import { psnr, rmse, ssim } from './metrics.ts';
import { orderOps } from './order.ts';
import { blockify, quantise } from './quantise.ts';
import { render } from './render.ts';
import type { Bitmap, ConvertOptions, ConvertResult, DrawOp, EmitStrategy, QualityMetrics, Rgb } from './types.ts';

const DEFAULT_BUDGET = 8192;
const ALL_STRATEGIES: readonly EmitStrategy[] = ['direct', 'table', 'packed'];

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
  readonly palette: readonly Rgb[];
  readonly strategy: EmitStrategy;
  readonly encoding: 'full' | 'keyframe-diff';
  readonly lua: string;
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
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
  const rendered = render(ops, source.width, source.height);
  const metrics = { ssim: ssim(source, rendered), psnr: psnr(source, rendered), rmse: rmse(source, rendered) };
  let best: Candidate | undefined;
  for (const strategy of strategies) {
    const lua = emitLua(ops, strategy);
    if (lua.length > budget) continue;
    const candidate: Candidate = { ops, palette, strategy, lua, rendered, metrics };
    if (candidateBetter(candidate, best)) best = candidate;
  }
  return best;
}

function maxColoursSequence(maxColours: number): number[] {
  const values = new Set<number>();
  const cap = Math.max(1, Math.floor(maxColours));
  values.add(cap);
  for (const value of [16, 12, 10, 8, 6, 4, 3, 2, 1]) if (value <= cap) values.add(value);
  return [...values].sort((a, b) => b - a);
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
  const psnrDifference = candidate.metrics.psnr - best.metrics.psnr;
  if (Math.abs(psnrDifference) > 1e-12) return psnrDifference > 0;
  return candidate.lua.length < best.lua.length;
}

interface PreparedAnimation {
  readonly fullOps: readonly DrawOp[][];
  readonly diffOps: readonly DrawOp[][];
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
  return { fullOps, diffOps, rendered: renderedFrames[0] as Bitmap, metrics };
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
      const candidate: AnimationCandidate = { playbackOps, fullOps: prepared.fullOps, palette, strategy, encoding, lua, rendered: prepared.rendered, metrics: prepared.metrics };
      if (!shortest || lua.length < shortest.lua.length) shortest = candidate;
      if (lua.length <= budget && animationCandidateBetter(candidate, best)) best = candidate;
    }
  }
  return { best, shortest: shortest as AnimationCandidate };
}

/** Convert one bitmap by maximising measured SSIM among candidates that fit the character budget. */
export function convert(source: Bitmap, options: ConvertOptions = {}): ConvertResult {
  const started = performance.now();
  const budget = options.budget ?? DEFAULT_BUDGET;
  const timeBudgetMs = Math.max(1, options.timeBudgetMs ?? DEFAULT_BUDGET);
  const deadline = started + timeBudgetMs;
  const strategies = options.strategies && options.strategies.length > 0 ? options.strategies : ALL_STRATEGIES;
  const maxColours = Math.max(1, Math.floor(options.maxColours ?? 16));
  let best: Candidate | undefined;
  let lastPalette: readonly Rgb[] = [[0, 0, 0]];

  if (source.width > 0 && source.height > 0 && budget >= 0) {
    if (options.maxColours === undefined && source.width * source.height <= 2048 && performance.now() < deadline) {
      const exact = exactLabels(source);
      const exactCandidate = makeCandidate(source, exact.palette, exact.indices, strategies, budget);
      if (exactCandidate && candidateBetter(exactCandidate, best)) best = exactCandidate;
    }
    outer: for (const colourCount of maxColoursSequence(maxColours)) {
      if (performance.now() >= deadline) break;
      const quantised = quantise(source, colourCount, { dither: options.dither ?? 'none', seed: options.seed ?? 0 });
      lastPalette = quantised.palette;
      for (const blockSize of blockSizes(source)) {
        if (performance.now() >= deadline) break outer;
        const indices = blockSize === 1 ? quantised.indices : blockify(source, quantised.palette, blockSize);
        const candidate = makeCandidate(source, quantised.palette, indices, strategies, budget);
        if (candidate && candidateBetter(candidate, best)) best = candidate;
      }
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
    },
  };
}

/** Convert a sequence with one palette and a measured full-frame/diff choice. */
export function convertFrames(frames: readonly Bitmap[], options: ConvertOptions & { readonly ticksPerFrame?: number } = {}): ConvertResult {
  if (frames.length === 0) throw new RangeError('At least one frame is required');
  if (frames.length === 1) return convert(frames[0] as Bitmap, options);
  const width = frames[0]?.width ?? 0;
  const height = frames[0]?.height ?? 0;
  if (frames.some((frame) => frame.width !== width || frame.height !== height)) throw new RangeError('Animation frames must have matching dimensions');

  const started = performance.now();
  const budget = options.budget ?? DEFAULT_BUDGET;
  const timeBudgetMs = Math.max(1, options.timeBudgetMs ?? 5000);
  const deadline = started + timeBudgetMs;
  const strategies = options.strategies && options.strategies.length > 0 ? options.strategies : ALL_STRATEGIES;
  const maxColours = Math.max(1, Math.floor(options.maxColours ?? 16));
  const ticksPerFrame = Number.isFinite(options.ticksPerFrame) ? Math.max(1, Math.floor(options.ticksPerFrame as number)) : 6;
  let best: AnimationCandidate | undefined;
  let shortest: AnimationCandidate | undefined;
  let lastPalette: readonly Rgb[] = [[0, 0, 0]];

  const consider = (palette: readonly Rgb[], indices: readonly Uint16Array[]): void => {
    const evaluated = evaluateAnimation(prepareAnimation(frames, palette, indices), palette, strategies, ticksPerFrame, budget);
    if (!shortest || evaluated.shortest.lua.length < shortest.lua.length) shortest = evaluated.shortest;
    if (evaluated.best && animationCandidateBetter(evaluated.best, best)) best = evaluated.best;
  };

  if (options.maxColours === undefined && frames.reduce((area, frame) => area + frame.width * frame.height, 0) <= 2048 && performance.now() < deadline) {
    const exact = exactLabelsFrames(frames);
    consider(exact.palette, exact.indices);
  }
  const combined = combinedFrames(frames);
  outer: for (const colourCount of maxColoursSequence(maxColours)) {
    if (performance.now() >= deadline) break;
    const quantised = quantise(combined, colourCount, { dither: options.dither ?? 'none', seed: options.seed ?? 0 });
    lastPalette = quantised.palette;
    const labels = splitCombinedIndices(quantised.indices, width, height, frames.length);
    for (const blockSize of blockSizes(frames[0] as Bitmap)) {
      if (performance.now() >= deadline) break outer;
      const indices = blockSize === 1 ? labels : frames.map((frame) => blockify(frame, quantised.palette, blockSize));
      consider(quantised.palette, indices);
    }
  }

  const selected = best ?? shortest;
  if (!selected) {
    const fallbackIndices = frames.map((frame) => new Uint16Array(frame.width * frame.height));
    best = evaluateAnimation(prepareAnimation(frames, lastPalette, fallbackIndices), lastPalette, strategies, ticksPerFrame, Number.MAX_SAFE_INTEGER).shortest;
  } else best = selected;
  const charCount = best.lua.length;
  const elapsedMs = performance.now() - started;
  const frameOps = best.playbackOps.map((ops) => ops.length);
  const allOps = best.playbackOps.flat();
  return {
    lua: best.lua,
    charCount,
    withinBudget: charCount <= budget,
    strategy: best.strategy,
    palette: best.palette,
    rendered: best.rendered,
    metrics: best.metrics,
    stats: {
      ops: allOps.length,
      setColourCalls: allOps.filter((op) => op.type === 'setColour').length,
      rects: allOps.filter((op) => op.type === 'rectF').length,
      elapsedMs,
      frameCount: frames.length,
      frameOps,
      encoding: best.encoding,
      fullFrameChars: emitAnimationLua(best.fullOps, best.strategy, ticksPerFrame, false).length,
    },
  };
}
