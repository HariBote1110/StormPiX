import type { Bitmap } from './types.ts';

const WINDOW_RADIUS = 5;
const SIGMA = 1.5;
const K1 = 0.01;
const K2 = 0.03;
const LUMA_MAX = 255;

function checkDimensions(a: Bitmap, b: Bitmap): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError('Bitmap dimensions must match');
  }
}

function sameData(a: Bitmap, b: Bitmap): boolean {
  if (a.data.length !== b.data.length) return false;
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
}

function luma(data: Uint8ClampedArray, offset: number): number {
  return 0.2126 * (data[offset] ?? 0) + 0.7152 * (data[offset + 1] ?? 0) + 0.0722 * (data[offset + 2] ?? 0);
}

function gaussianWeights(): number[][] {
  const weights: number[][] = [];
  for (let dy = -WINDOW_RADIUS; dy <= WINDOW_RADIUS; dy += 1) {
    const row: number[] = [];
    for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx += 1) {
      row.push(Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA)));
    }
    weights.push(row);
  }
  return weights;
}

const WEIGHTS = gaussianWeights();

/** Compute windowed Gaussian SSIM over Rec. 709 luma. */
export function ssim(a: Bitmap, b: Bitmap): number {
  checkDimensions(a, b);
  if (sameData(a, b)) return 1;
  if (a.width === 0 || a.height === 0) return 1;

  const c1 = (K1 * LUMA_MAX) ** 2;
  const c2 = (K2 * LUMA_MAX) ** 2;
  let total = 0;
  const count = a.width * a.height;

  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      let weightSum = 0;
      let meanA = 0;
      let meanB = 0;
      for (let dy = -WINDOW_RADIUS; dy <= WINDOW_RADIUS; dy += 1) {
        const sampleY = Math.min(a.height - 1, Math.max(0, y + dy));
        for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx += 1) {
          const sampleX = Math.min(a.width - 1, Math.max(0, x + dx));
          const weight = WEIGHTS[dy + WINDOW_RADIUS]?.[dx + WINDOW_RADIUS] ?? 0;
          const offset = (sampleY * a.width + sampleX) * 4;
          meanA += weight * luma(a.data, offset);
          meanB += weight * luma(b.data, offset);
          weightSum += weight;
        }
      }
      meanA /= weightSum;
      meanB /= weightSum;

      let varianceA = 0;
      let varianceB = 0;
      let covariance = 0;
      for (let dy = -WINDOW_RADIUS; dy <= WINDOW_RADIUS; dy += 1) {
        const sampleY = Math.min(a.height - 1, Math.max(0, y + dy));
        for (let dx = -WINDOW_RADIUS; dx <= WINDOW_RADIUS; dx += 1) {
          const sampleX = Math.min(a.width - 1, Math.max(0, x + dx));
          const weight = (WEIGHTS[dy + WINDOW_RADIUS]?.[dx + WINDOW_RADIUS] ?? 0) / weightSum;
          const offset = (sampleY * a.width + sampleX) * 4;
          const valueA = luma(a.data, offset) - meanA;
          const valueB = luma(b.data, offset) - meanB;
          varianceA += weight * valueA * valueA;
          varianceB += weight * valueB * valueB;
          covariance += weight * valueA * valueB;
        }
      }

      const numerator = (2 * meanA * meanB + c1) * (2 * covariance + c2);
      const denominator = (meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2);
      total += denominator === 0 ? 1 : numerator / denominator;
    }
  }

  return Math.max(0, Math.min(1, total / count));
}

/** Compute RGB peak signal-to-noise ratio in dB. */
export function psnr(a: Bitmap, b: Bitmap): number {
  checkDimensions(a, b);
  if (a.width === 0 || a.height === 0) return Infinity;

  let squaredError = 0;
  const channelCount = a.width * a.height * 3;
  for (let pixel = 0; pixel < a.width * a.height; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = (a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0);
      squaredError += difference * difference;
    }
  }

  const meanSquaredError = squaredError / channelCount;
  if (meanSquaredError === 0) return Infinity;
  return 10 * Math.log10((LUMA_MAX * LUMA_MAX) / meanSquaredError);
}

export function rmse(a: Bitmap, b: Bitmap): number {
  checkDimensions(a, b);
  if (a.width === 0 || a.height === 0) return 0;
  let squaredError = 0;
  const channelCount = a.width * a.height * 3;
  for (let pixel = 0; pixel < a.width * a.height; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = (a.data[offset + channel] ?? 0) - (b.data[offset + channel] ?? 0);
      squaredError += difference * difference;
    }
  }
  return Math.sqrt(squaredError / channelCount);
}
