import {
  convert,
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

const BUDGET = 8192;

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
    const wave = Math.sin(x / 13) * 10 + Math.cos(y / 17) * 9;
    const diagonal = (x + y) * 0.72;
    let r = 45 + diagonal + wave;
    let g = 70 + y * 0.85 - wave * 0.35;
    let b = 115 + x * 0.45 + wave * 0.8;
    if ((x - 27) ** 2 + (y - 34) ** 2 < 17 ** 2) {
      r = 210 + wave;
      g = 90 + wave * 0.25;
      b = 55;
    }
    if (x > 57 && x < 84 && y > 53 && y < 82 && (x + y) % 5 < 3) {
      r = 45;
      g = 165 + wave;
      b = 92;
    }
    const noise = ((x * 17 + y * 31 + x * y * 7) % 11) - 5;
    return [Math.max(0, Math.min(255, Math.round(r + noise))), Math.max(0, Math.min(255, Math.round(g + noise))), Math.max(0, Math.min(255, Math.round(b + noise)))];
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

console.log('image\tnaiveChars\tconvertChars\twithinBudget\tstrategy\tssim\tpsnr\telapsedMs\tcoverScanline\tcoverOptimised');
for (const [name, source] of fixtures()) {
  const naive = baselineOps(source);
  const quantised = quantise(source, 16);
  const labels = { width: source.width, height: source.height, indices: quantised.indices };
  const scanlineCost = costOf(coverScanline(labels, quantised.palette), 'direct');
  const optimisedCost = costOf(cover(labels, quantised.palette), 'direct');
  const result = convert(source, { budget: BUDGET, seed: 0, timeBudgetMs: 5000 });
  console.log(`${name}\t${costOf(naive, 'direct')}\t${result.charCount}\t${result.withinBudget}\t${result.strategy}\t${result.metrics.ssim.toFixed(6)}\t${result.metrics.psnr === Infinity ? 'Infinity' : result.metrics.psnr.toFixed(2)}\t${result.stats.elapsedMs.toFixed(2)}\t${scanlineCost}\t${optimisedCost}`);
  // Keep these calls in the benchmark so its measured quality is visibly tied to render().
  void render(naive, source.width, source.height);
  void ssim(source, result.rendered);
  void psnr(source, result.rendered);
}
