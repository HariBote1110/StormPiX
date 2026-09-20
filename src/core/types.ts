/** RGBA, row-major, length = width*height*4. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

export type EmitStrategy = 'direct' | 'table' | 'packed';

export interface ConvertOptions {
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
}

export interface ConvertResult {
  readonly lua: string;
  readonly charCount: number;
  readonly withinBudget: boolean;
  readonly strategy: EmitStrategy;
  readonly palette: readonly Rgb[];
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
  readonly stats: ConvertStats;
}

/** One opaque Stormworks drawing command. */
export type DrawOp =
  | { readonly type: 'setColour'; readonly r: number; readonly g: number; readonly b: number }
  | { readonly type: 'rectF'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly type: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly type: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number };
