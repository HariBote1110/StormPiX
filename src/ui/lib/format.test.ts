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
  // scriptFrameRanges is half-open [start, end): a range covering exactly one frame is
  // [n, n+1), and must render as a single number, not "n-n+1" (see tests/phase5.test.ts,
  // which computes frameCount as range[1] - range[0]).
  it('renders a single-frame half-open range ([0,1)) as one number', () => {
    expect(formatFrameRange([0, 1])).toBe('0');
  });

  it('renders a single-frame half-open range elsewhere in the sequence ([3,4))', () => {
    expect(formatFrameRange([3, 4])).toBe('3');
  });

  it('renders a multi-frame half-open range ([0,8)) as an inclusive-looking span', () => {
    expect(formatFrameRange([0, 8])).toBe('0–7');
  });

  it('renders a mid-sequence multi-frame range ([2,4)) correctly', () => {
    expect(formatFrameRange([2, 4])).toBe('2–3');
  });
});
