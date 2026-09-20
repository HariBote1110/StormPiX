import { existsSync, readdirSync } from 'node:fs';
import { readPng } from './compare/png.ts';
import {
  convert,
  convertFrames,
  costOf,
  cover,
  coverScanline,
  psnr,
  quantise,
  render,
  ssim,
  type Bitmap,
  type DrawOp,
  type Rgb,
} from '../src/core/index.ts';

const REAL_ASSET_PATH = '/Users/yuki/doc/al/pngX';

const BUDGET = 8192;
const BUDGET_SWEEP = [60, 100, 200, 300, 500, 1000, 2000, 4000, 8192] as const;
const DENSE_BUDGET_SWEEP = [...Array.from({ length: Math.floor((8100 - 500) / 100) + 1 }, (_, index) => 500 + index * 100), 8192];

function bitmapFromPixels(width: number, height: number, colourAt: (x: number, y: number) => Rgb): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colourAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function baselineOps(source: Bitmap): DrawOp[] {
  const ops: DrawOp[] = [];
  for (let y = 0; y < source.height; y += 1) {
    let x = 0;
    while (x < source.width) {
      const offset = (y * source.width + x) * 4;
      const r = source.data[offset] ?? 0;
      const g = source.data[offset + 1] ?? 0;
      const b = source.data[offset + 2] ?? 0;
      let runWidth = 1;
      while (x + runWidth < source.width) {
        const next = (y * source.width + x + runWidth) * 4;
        if (source.data[next] !== r || source.data[next + 1] !== g || source.data[next + 2] !== b) break;
        runWidth += 1;
      }
      ops.push({ type: 'setColour', r, g, b });
      ops.push({ type: 'rectF', x, y, w: runWidth, h: 1 });
      x += runWidth;
    }
  }
  return ops;
}

function photoLike(): Bitmap {
  return bitmapFromPixels(96, 96, (x, y) => {
    const gradient = (x + y) / 190;
    let r = Math.round(40 + 215 * gradient);
    let g = Math.round(90 + 160 * gradient);
    let b = Math.round(180 - 90 * gradient);
    if ((x - 64) ** 2 + (y - 32) ** 2 <= 18 ** 2) [r, g, b] = [255, 255, 255];
    if (x >= 8 && x < 48 && y >= 70 && y < 88) [r, g, b] = [15, 15, 15];
    return [r, g, b];
  });
}

function fixtures(): readonly [string, Bitmap][] {
  return [
    ['flat-32', bitmapFromPixels(32, 32, () => [38, 120, 210])],
    ['gradient-32', bitmapFromPixels(32, 32, (x, y) => [x * 8, y * 8, 128])],
    ['quadrants-96', bitmapFromPixels(96, 96, (x, y) => {
      if (x < 48 && y < 48) return [224, 64, 64];
      if (x >= 48 && y < 48) return [64, 192, 96];
      if (x < 48) return [64, 112, 224];
      return [224, 192, 64];
    })],
    ['checker-32', bitmapFromPixels(32, 32, (x, y) => ((x + y) % 2 === 0 ? [245, 245, 245] : [20, 20, 20]))],
    ['photo-96', photoLike()],
  ];
}

function animationFixtures(): readonly [string, readonly Bitmap[]][] {
  const slide: Bitmap[] = [];
  for (let frame = 0; frame < 8; frame += 1) {
    slide.push(bitmapFromPixels(32, 32, (x, y) => {
      if (x >= 3 + frame * 3 && x < 8 + frame * 3 && y >= 13 && y < 19) return [235, 190, 55];
      return [18, 24, 36];
    }));
  }

  const fade: Bitmap[] = [];
  for (let frame = 0; frame < 8; frame += 1) {
    const amount = frame / 7;
    fade.push(bitmapFromPixels(32, 32, () => [
      Math.round(20 + (230 - 20) * amount),
      Math.round(45 + (180 - 45) * amount),
      Math.round(100 + (55 - 100) * amount),
    ]));
  }

  const spin: Bitmap[] = [];
  for (let frame = 0; frame < 16; frame += 1) {
    const angle = frame * Math.PI / 8;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    spin.push(bitmapFromPixels(64, 64, (x, y) => {
      const centredX = x - 31.5;
      const centredY = y - 31.5;
      const localX = centredX * cosine + centredY * sine;
      const localY = -centredX * sine + centredY * cosine;
      if (Math.abs(localX) < 13 && Math.abs(localY) < 4) return [220, 80, 45];
      return [14, 20, 30];
    }));
  }
  return [['slide-8', slide], ['fade-8', fade], ['spin-16', spin]];
}

console.log('image\tnaiveChars\tconvertChars\twithinBudget\tstrategy\tssim\tpsnr\telapsedMs\tcoverScanline\tcoverOptimised');
for (const [name, source] of fixtures()) {
  const naive = baselineOps(source);
  const quantised = quantise(source, 16);
  const labels = { width: source.width, height: source.height, indices: quantised.indices };
  const scanlineCost = costOf(coverScanline(labels, quantised.palette), 'direct');
  const optimisedCost = costOf(cover(labels, quantised.palette), 'direct');
  const result = convert(source, { mode: 'fit', budget: BUDGET, seed: 0, timeBudgetMs: 5000 });
  console.log(`${name}\t${costOf(naive, 'direct')}\t${result.charCount}\t${result.withinBudget}\t${result.strategy}\t${result.metrics.ssim.toFixed(6)}\t${result.metrics.psnr === Infinity ? 'Infinity' : result.metrics.psnr.toFixed(2)}\t${result.stats.elapsedMs.toFixed(2)}\t${scanlineCost}\t${optimisedCost}`);
  // Keep these calls in the benchmark so its measured quality is visibly tied to render().
  void render(naive, source.width, source.height);
  void ssim(source, result.rendered);
  void psnr(source, result.rendered);
}

const photo = fixtures().find(([name]) => name === 'photo-96')?.[1];
if (photo) {
  console.log('\nBUDGET SWEEP (photo-96)');
  console.log('budget\tcharCount\tutilisation\tstrategy\tssim\telapsedMs');
  for (const budget of BUDGET_SWEEP) {
    const result = convert(photo, { mode: 'fit', budget, seed: 0, timeBudgetMs: 5000 });
    console.log(`${budget}\t${result.charCount}\t${((result.charCount / budget) * 100).toFixed(1)}%\t${result.strategy}\t${result.metrics.ssim.toFixed(6)}\t${result.stats.elapsedMs.toFixed(2)}`);
  }

  const denseResults = DENSE_BUDGET_SWEEP.map((budget) => ({ budget, result: convert(photo, { mode: 'fit', budget, seed: 0, timeBudgetMs: 5000 }) }));
  let minimumSsimDelta = Infinity;
  let worstSsimPair: readonly [number, number] = [0, 0];
  let minimumCharDelta = Infinity;
  let worstCharPair: readonly [number, number] = [0, 0];
  let ssimViolations = 0;
  let charViolations = 0;
  let maximumElapsedMs = 0;
  for (let index = 1; index < denseResults.length; index += 1) {
    const previous = denseResults[index - 1] as { budget: number; result: ReturnType<typeof convert> };
    const current = denseResults[index] as { budget: number; result: ReturnType<typeof convert> };
    const ssimDelta = current.result.metrics.ssim - previous.result.metrics.ssim;
    const charDelta = current.result.charCount - previous.result.charCount;
    maximumElapsedMs = Math.max(maximumElapsedMs, current.result.stats.elapsedMs);
    if (ssimDelta < -0.0005) ssimViolations += 1;
    if (charDelta < 0) charViolations += 1;
    if (ssimDelta < minimumSsimDelta) {
      minimumSsimDelta = ssimDelta;
      worstSsimPair = [previous.budget, current.budget];
    }
    if (charDelta < minimumCharDelta) {
      minimumCharDelta = charDelta;
      worstCharPair = [previous.budget, current.budget];
    }
  }
  let noPaddingViolations = 0;
  for (let lower = 0; lower < denseResults.length; lower += 1) {
    for (let higher = lower + 1; higher < denseResults.length; higher += 1) {
      const previous = denseResults[lower] as { budget: number; result: ReturnType<typeof convert> };
      const current = denseResults[higher] as { budget: number; result: ReturnType<typeof convert> };
      if (current.result.metrics.ssim <= previous.result.metrics.ssim + 0.0005 && current.result.charCount !== previous.result.charCount) noPaddingViolations += 1;
    }
  }
  console.log('\nDENSE MONOTONICITY (photo-96)');
  console.log(`budgets\t${DENSE_BUDGET_SWEEP[0]}..${DENSE_BUDGET_SWEEP[DENSE_BUDGET_SWEEP.length - 1]} step 100`);
  console.log(`minimumConsecutiveSsimDelta\t${minimumSsimDelta.toFixed(6)}\tworstPair\t${worstSsimPair[0]}->${worstSsimPair[1]}`);
  console.log(`minimumConsecutiveCharDelta\t${minimumCharDelta}\tworstPair\t${worstCharPair[0]}->${worstCharPair[1]}`);
  console.log(`ssimViolations\t${ssimViolations}\tcharViolations\t${charViolations}\tmaximumElapsedMs\t${maximumElapsedMs.toFixed(2)}`);
  console.log(`noPaddingViolations\t${noPaddingViolations}`);
}

console.log('\nANIMATION');
console.log('animation\tframeCount\tnaiveChars\tcharCount\twithinBudget\tstrategy\tmeanSsim\tfullFrameChars\tsaving\telapsedMs');
for (const [name, frames] of animationFixtures()) {
  const naiveStarted = performance.now();
  const naiveChars = frames.reduce((sum, frame) => sum + convert(frame, { mode: 'fit', budget: BUDGET, seed: 0, timeBudgetMs: 5000 }).charCount, 0);
  void (performance.now() - naiveStarted);
  const result = convertFrames(frames, { mode: 'fit', budget: BUDGET, seed: 0, timeBudgetMs: 5000, ticksPerFrame: 6 });
  const saving = naiveChars === 0 ? 0 : 1 - result.charCount / naiveChars;
  console.log(`${name}\t${frames.length}\t${naiveChars}\t${result.charCount}\t${result.withinBudget}\t${result.strategy}\t${result.metrics.ssim.toFixed(6)}\t${result.stats.fullFrameChars ?? '-'}\t${saving.toFixed(3)}\t${result.stats.elapsedMs.toFixed(2)}`);
}

if (!existsSync(REAL_ASSET_PATH)) {
  console.log(`\nREAL ASSET: SKIP: asset path is absent: ${REAL_ASSET_PATH}`);
} else {
  const names = readdirSync(REAL_ASSET_PATH).filter((name) => /^\d{3}\.png$/.test(name)).sort();
  if (names.length !== 40) throw new Error(`expected 40 PNG frames in ${REAL_ASSET_PATH}, found ${names.length}`);
  const realFrames = names.map((name) => readPng(`${REAL_ASSET_PATH}/${name}`));
  console.log('\nREAL ASSET (/Users/yuki/doc/al/pngX)');
  console.log('frames\tlosslessChars\tlosslessScripts\tlosslessSsim\tfitChars\tfitSsim\tfitStrategy');
  for (const frameCount of [4, 8, 16, 24, 40] as const) {
    const subset = realFrames.slice(0, frameCount);
    const lossless = convertFrames(subset, { mode: 'lossless', budget: 8192, seed: 0, ticksPerFrame: 6, timeBudgetMs: 5000 });
    const fit = convertFrames(subset, { mode: 'fit', budget: 8192, seed: 0, ticksPerFrame: 6, timeBudgetMs: 5000 });
    console.log(`${frameCount}\t${lossless.totalCharCount}\t${lossless.scripts.length}\t${lossless.metrics.ssim.toFixed(6)}\t${fit.charCount}\t${fit.metrics.ssim.toFixed(6)}\t${fit.strategy}`);
  }
}
