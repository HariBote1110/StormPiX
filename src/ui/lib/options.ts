import type { ConvertMode, ConvertOptions, EmitStrategy } from '../../core/index.ts';

/** UI-level emit strategy choice: 'auto' means "let the core try everything". */
export type EmitChoice = 'auto' | EmitStrategy;

export interface UiConvertOptions {
  readonly budget: number;
  readonly maxColours: number;
  readonly dither: 'none' | 'floyd-steinberg';
  readonly strategy: EmitChoice;
  readonly timeBudgetMs: number;
  /** 既定は 'lossless'（コアの既定値と一致させる） */
  readonly mode: ConvertMode;
}

export const DEFAULT_OPTIONS: UiConvertOptions = {
  budget: 8192,
  maxColours: 16,
  dither: 'none',
  strategy: 'auto',
  timeBudgetMs: 5000,
  mode: 'lossless',
};

const ALL_STRATEGIES: readonly EmitStrategy[] = ['direct', 'table', 'packed'];

/** Clamp/validate raw UI input into a well-formed options object. */
export function normaliseOptions(raw: Partial<UiConvertOptions>): UiConvertOptions {
  const budget = clampInt(raw.budget ?? DEFAULT_OPTIONS.budget, 1, 8192);
  const maxColours = clampInt(raw.maxColours ?? DEFAULT_OPTIONS.maxColours, 1, 256);
  const timeBudgetMs = clampInt(raw.timeBudgetMs ?? DEFAULT_OPTIONS.timeBudgetMs, 100, 60000);
  const dither = raw.dither === 'floyd-steinberg' ? 'floyd-steinberg' : 'none';
  const strategy: EmitChoice =
    raw.strategy === 'direct' || raw.strategy === 'table' || raw.strategy === 'packed' ? raw.strategy : 'auto';
  const mode: ConvertMode = raw.mode === 'fit' ? 'fit' : 'lossless';
  return { budget, maxColours, dither, strategy, timeBudgetMs, mode };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Converts UI options into the core's ConvertOptions contract. */
export function toConvertOptions(ui: UiConvertOptions, seed = 0): ConvertOptions {
  return {
    budget: ui.budget,
    maxColours: ui.maxColours,
    dither: ui.dither,
    strategies: ui.strategy === 'auto' ? ALL_STRATEGIES : [ui.strategy],
    timeBudgetMs: ui.timeBudgetMs,
    mode: ui.mode,
    seed,
  };
}
