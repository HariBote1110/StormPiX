import type { Bitmap } from '../../core/index.ts';

/** Builds a per-pixel error heat map (black = match, red-hot = large error) between two same-sized bitmaps. */
export function diffHeatmap(a: Bitmap, b: Bitmap): Bitmap {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ai = (y * a.width + x) * 4;
      const bi = (y * b.width + x) * 4;
      const dr = Math.abs(a.data[ai]! - b.data[bi]!);
      const dg = Math.abs(a.data[ai + 1]! - b.data[bi + 1]!);
      const db = Math.abs(a.data[ai + 2]! - b.data[bi + 2]!);
      const err = (dr + dg + db) / 3;
      const oi = (y * width + x) * 4;
      // heat: black -> red -> yellow -> white as error grows
      data[oi] = Math.min(255, err * 3);
      data[oi + 1] = Math.max(0, Math.min(255, err * 3 - 255));
      data[oi + 2] = Math.max(0, Math.min(255, err * 3 - 510));
      data[oi + 3] = 255;
    }
  }
  return { width, height, data };
}
