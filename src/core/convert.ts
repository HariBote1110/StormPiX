import { cover, type LabelImage } from './cover.ts';
import { emitLua } from './cost.ts';
import { psnr, rmse, ssim } from './metrics.ts';
import { orderOps } from './order.ts';
import { blockify, quantise } from './quantise.ts';
import { render } from './render.ts';
import type { Bitmap, ConvertOptions, ConvertResult, DrawOp, EmitStrategy, Rgb } from './types.ts';

const DEFAULT_BUDGET = 8192;
const ALL_STRATEGIES: readonly EmitStrategy[] = ['direct', 'table', 'packed'];

interface Candidate {
  readonly ops: DrawOp[];
  readonly palette: readonly Rgb[];
  readonly strategy: EmitStrategy;
  readonly lua: string;
  readonly rendered: Bitmap;
  readonly metrics: { readonly ssim: number; readonly psnr: number; readonly rmse: number };
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
