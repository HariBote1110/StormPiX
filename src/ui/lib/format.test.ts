import { describe, expect, it } from 'vitest';
import { formatFrameRange, scriptUsages, totalChars } from './format.ts';

describe('scriptUsages', () => {
  it('computes per-script percentage and over-budget flag', () => {
    const usages = scriptUsages(['a'.repeat(10), 'b'.repeat(20)], 15);
    expect(usages).toEqual([
      { index: 0, charCount: 10, budget: 15, pct: (10 / 15) * 100, over: false },
      { index: 1, charCount: 20, budget: 15, pct: 100, over: true },
    ]);
  });

  it('returns an empty list for no scripts', () => {
    expect(scriptUsages([], 8192)).toEqual([]);
  });
});

describe('totalChars', () => {
  it('sums the length of every script', () => {
    expect(totalChars(['abc', 'de', ''])).toBe(5);
  });
});

describe('formatFrameRange', () => {
  it('collapses a single-frame range to one number', () => {
    expect(formatFrameRange([3, 3])).toBe('3');
  });

  it('renders a multi-frame range with an en dash', () => {
    expect(formatFrameRange([0, 5])).toBe('0–5');
  });
});
