import { costOf, psnr, render, ssim, type Bitmap, type DrawOp, type Rgb } from '../src/core/index.ts';

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
  ];
}

console.log('image\tcharCount\tssim\tpsnr\telapsedMs');
for (const [name, source] of fixtures()) {
  const started = performance.now();
  const ops = baselineOps(source);
  const rendered = render(ops, source.width, source.height);
  const elapsedMs = performance.now() - started;
  console.log(`${name}\t${costOf(ops, 'direct')}\t${ssim(source, rendered).toFixed(6)}\t${psnr(source, rendered).toFixed(2)}\t${elapsedMs.toFixed(2)}`);
}
