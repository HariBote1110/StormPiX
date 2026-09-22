import { convertFrames, type Bitmap, type ConvertMode, type ConvertResult } from '../src/core/index.ts';

export interface AssetReportOptions {
  readonly source: string;
  readonly mode?: ConvertMode;
  readonly budget?: number;
  readonly ticksPerFrame?: number;
}

export interface AssetReport {
  readonly schemaVersion: 1;
  readonly source: {
    readonly path: string;
    readonly frameCount: number;
    readonly width: number;
    readonly height: number;
    readonly distinctColours: number;
    readonly frameColours: readonly number[];
    readonly changedPixelsFromPrevious: readonly number[];
  };
  readonly conversion: {
    readonly mode: ConvertMode;
    readonly budget: number;
    readonly exact: boolean;
    readonly charCount: number;
    readonly totalCharCount: number;
    readonly withinBudget: boolean;
    readonly charCountMatchesLua: boolean;
    readonly totalCharCountMatchesScripts: boolean;
    readonly strategy: ConvertResult['strategy'];
    readonly encoding: ConvertResult['stats']['encoding'];
    readonly metrics: ConvertResult['metrics'];
    readonly scripts: readonly {
      readonly index: number;
      readonly startFrame: number;
      readonly endFrame: number;
      readonly charCount: number;
      readonly withinBudget: boolean;
    }[];
  };
}

function colourKey(frame: Bitmap, pixel: number): string {
  const offset = pixel * 4;
  return `${frame.data[offset] ?? 0},${frame.data[offset + 1] ?? 0},${frame.data[offset + 2] ?? 0},${frame.data[offset + 3] ?? 0}`;
}

function distinctColours(frame: Bitmap): Set<string> {
  const colours = new Set<string>();
  for (let pixel = 0; pixel < frame.width * frame.height; pixel += 1) colours.add(colourKey(frame, pixel));
  return colours;
}

function changedPixels(previous: Bitmap | undefined, current: Bitmap): number {
  if (!previous) return current.width * current.height;
  let changed = 0;
  for (let pixel = 0; pixel < current.width * current.height; pixel += 1) if (colourKey(previous, pixel) !== colourKey(current, pixel)) changed += 1;
  return changed;
}

function ensureFrames(frames: readonly Bitmap[]): { readonly width: number; readonly height: number } {
  const first = frames[0];
  if (!first) throw new RangeError('at least one frame is required');
  if (frames.some((frame) => frame.width !== first.width || frame.height !== first.height)) throw new RangeError('all frames must have matching dimensions');
  return { width: first.width, height: first.height };
}

export function createAssetReport(frames: readonly Bitmap[], options: AssetReportOptions): AssetReport {
  const { width, height } = ensureFrames(frames);
  const budget = options.budget ?? 8192;
  const mode = options.mode ?? 'lossless';
  const result = convertFrames(frames, { mode, budget, ticksPerFrame: options.ticksPerFrame ?? 6, seed: 0 });
  const sourceColours = new Set<string>();
  const frameColours = frames.map((frame) => {
    const colours = distinctColours(frame);
    for (const colour of colours) sourceColours.add(colour);
    return colours.size;
  });
  const ranges = result.stats.scriptFrameRanges ?? result.scripts.map(() => [0, frames.length] as const);

  return {
    schemaVersion: 1,
    source: {
      path: options.source,
      frameCount: frames.length,
      width,
      height,
      distinctColours: sourceColours.size,
      frameColours,
      changedPixelsFromPrevious: frames.map((frame, index) => changedPixels(frames[index - 1], frame)),
    },
    conversion: {
      mode,
      budget,
      exact: result.metrics.ssim === 1 && result.metrics.rmse === 0,
      charCount: result.charCount,
      totalCharCount: result.totalCharCount,
      withinBudget: result.withinBudget,
      charCountMatchesLua: result.charCount === result.lua.length,
      totalCharCountMatchesScripts: result.totalCharCount === result.scripts.reduce((sum, script) => sum + script.length, 0),
      strategy: result.strategy,
      encoding: result.stats.encoding,
      metrics: result.metrics,
      scripts: result.scripts.map((script, index) => {
        const range = ranges[index] ?? [0, frames.length];
        return {
          index,
          startFrame: range[0],
          endFrame: range[1],
          charCount: script.length,
          withinBudget: script.length <= budget,
        };
      }),
    },
  };
}

export interface VerificationPolicy {
  readonly maxTotalCharCount?: number;
  readonly requireExact?: boolean;
  readonly requireWithinBudget?: boolean;
}

export interface VerificationReport {
  readonly passed: boolean;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly actual: number | boolean;
    readonly expected?: number | boolean;
  }[];
}

export function verifyAssetReport(report: AssetReport, policy: VerificationPolicy = {}): VerificationReport {
  const checks = [
    { name: 'charCountMatchesLua', passed: report.conversion.charCountMatchesLua, actual: report.conversion.charCountMatchesLua, expected: true },
    { name: 'totalCharCountMatchesScripts', passed: report.conversion.totalCharCountMatchesScripts, actual: report.conversion.totalCharCountMatchesScripts, expected: true },
    ...(policy.requireExact === true ? [{ name: 'exact', passed: report.conversion.exact, actual: report.conversion.exact, expected: true }] : []),
    ...(policy.requireWithinBudget === true ? [{ name: 'withinBudget', passed: report.conversion.withinBudget, actual: report.conversion.withinBudget, expected: true }] : []),
    ...(policy.maxTotalCharCount === undefined ? [] : [{ name: 'maxTotalCharCount', passed: report.conversion.totalCharCount <= policy.maxTotalCharCount, actual: report.conversion.totalCharCount, expected: policy.maxTotalCharCount }]),
  ];
  return { passed: checks.every((check) => check.passed), checks };
}
