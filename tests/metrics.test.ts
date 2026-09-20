import { describe, expect, it } from 'vitest';
import { psnr, psnrMasked, ssim, ssimMasked, type Bitmap } from '../src/core/index';

function solid(r: number, g: number, b: number, width = 16, height = 16): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

describe('quality metrics', () => {
  it('returns perfect scores for identical bitmaps', () => {
    const bitmap = solid(80, 90, 100);
    expect(ssim(bitmap, bitmap)).toBe(1);
    expect(psnr(bitmap, bitmap)).toBe(Infinity);
  });

  it('uses local windows so a small defect is not treated as global identity', () => {
    const source = solid(120, 120, 120);
    const altered = solid(120, 120, 120);
    for (let y = 7; y < 9; y += 1) {
      for (let x = 7; x < 9; x += 1) {
        const offset = (y * altered.width + x) * 4;
        altered.data[offset] = 255;
        altered.data[offset + 1] = 255;
        altered.data[offset + 2] = 255;
      }
    }

    expect(ssim(source, altered)).toBeLessThan(1);
    expect(ssim(source, altered)).toBeGreaterThan(0.6);
    expect(psnr(source, altered)).toBeGreaterThan(10);
  });

  it('ignores uncertain pixels in masked metrics', () => {
    const source = solid(4, 1, 20, 20, 20);
    const altered = solid(4, 1, 20, 20, 20);
    altered.data[0] = 255;
    altered.data[1] = 255;
    altered.data[2] = 255;
    const certainty = Uint8Array.from([0, 1, 1, 1]);

    expect(ssimMasked(source, altered, certainty)).toBe(1);
    expect(psnrMasked(source, altered, certainty)).toBe(Infinity);
    expect(ssimMasked(source, altered, Uint8Array.from([1, 1, 1, 1]))).toBeLessThan(1);
  });
});
