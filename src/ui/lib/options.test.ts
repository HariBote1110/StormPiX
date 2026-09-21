import { describe, expect, it } from 'vitest';
import { normaliseOptions, toConvertOptions } from './options.ts';

describe('normaliseOptions', () => {
  it('fills in defaults for an empty input', () => {
    expect(normaliseOptions({})).toEqual({
      budget: 8192,
      maxColours: 16,
      dither: 'none',
      strategy: 'auto',
      timeBudgetMs: 5000,
      mode: 'lossless',
    });
  });

  it('clamps budget to the contract ceiling of 8192', () => {
    expect(normaliseOptions({ budget: 999999 }).budget).toBe(8192);
  });

  it('clamps budget to a minimum of 1', () => {
    expect(normaliseOptions({ budget: -10 }).budget).toBe(1);
  });

  it('rejects an unknown dither value back to none', () => {
    // @ts-expect-error deliberately invalid input from an untyped source
    expect(normaliseOptions({ dither: 'bogus' }).dither).toBe('none');
  });

  it('rejects an unknown strategy back to auto', () => {
    // @ts-expect-error deliberately invalid input from an untyped source
    expect(normaliseOptions({ strategy: 'bogus' }).strategy).toBe('auto');
  });

  it('defaults mode to lossless', () => {
    expect(normaliseOptions({}).mode).toBe('lossless');
  });

  it('accepts fit mode and rejects an unknown mode back to lossless', () => {
    expect(normaliseOptions({ mode: 'fit' }).mode).toBe('fit');
    // @ts-expect-error deliberately invalid input from an untyped source
    expect(normaliseOptions({ mode: 'bogus' }).mode).toBe('lossless');
  });
});

describe('toConvertOptions', () => {
  it('expands "auto" strategy into all three concrete strategies', () => {
    const opts = toConvertOptions(normaliseOptions({ strategy: 'auto' }));
    expect(opts.strategies).toEqual(['direct', 'table', 'packed']);
  });

  it('keeps a concrete strategy as a single-element list', () => {
    const opts = toConvertOptions(normaliseOptions({ strategy: 'packed' }));
    expect(opts.strategies).toEqual(['packed']);
  });

  it('passes the mode through unchanged', () => {
    expect(toConvertOptions(normaliseOptions({ mode: 'fit' })).mode).toBe('fit');
    expect(toConvertOptions(normaliseOptions({})).mode).toBe('lossless');
  });
});
