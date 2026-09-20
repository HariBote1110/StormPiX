/** RGBA, row-major, length = width*height*4. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

export type PixelCertainty = 0 | 1;
export const UNCERTAIN: PixelCertainty = 0;
export const CERTAIN: PixelCertainty = 1;

export type EmitStrategy = 'direct' | 'table' | 'packed';

export type ConvertMode = 'lossless' | 'fit';

export interface ConvertOptions {
  readonly mode?: ConvertMode;
  readonly budget?: number;
  readonly maxColours?: number;
  readonly dither?: 'none' | 'floyd-steinberg';
  readonly strategies?: readonly EmitStrategy[];
  readonly timeBudgetMs?: number;
  readonly seed?: number;
}

export interface QualityMetrics {
  readonly ssim: number;
  readonly psnr: number;
  readonly rmse: number;
}

export interface ConvertStats {
  readonly ops: number;
  readonly setColourCalls: number;
  readonly rects: number;
  readonly elapsedMs: number;
  readonly frameCount?: number;
  readonly frameOps?: readonly number[];
  readonly encoding?: 'full' | 'keyframe-diff';
  readonly fullFrameChars?: number;
  /** True when the safety time cap stopped deterministic work early. */
  readonly timeBudgetTruncated?: boolean;
  readonly scriptFrameRanges?: readonly (readonly [number, number])[];
}

export interface ConvertResult {
  readonly lua: string;
  readonly scripts: readonly string[];
  readonly charCount: number;
  readonly totalCharCount: number;
  readonly withinBudget: boolean;
  readonly strategy: EmitStrategy;
  readonly palette: readonly Rgb[];
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
  readonly stats: ConvertStats;
}

/** One opaque Stormworks drawing command. */
export type DrawOp =
  | { readonly type: 'setColour'; readonly r: number; readonly g: number; readonly b: number; readonly a?: number }
  | { readonly type: 'rectF'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly type: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly type: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly type: 'triangle'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x3: number; readonly y3: number }
  | { readonly type: 'triangleF'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number; readonly x3: number; readonly y3: number }
  | { readonly type: 'circle'; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly type: 'circleF'; readonly x: number; readonly y: number; readonly radius: number }
  | { readonly type: 'text'; readonly x: number; readonly y: number; readonly text: string };
