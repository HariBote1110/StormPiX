/** Pure formatting/maths helpers for the result & code panels. No DOM here. */

export interface ScriptUsage {
  readonly index: number;
  readonly charCount: number;
  readonly budget: number;
  readonly pct: number;
  readonly over: boolean;
}

/** Per-script usage against the budget, for the multi-script gauge. */
export function scriptUsages(scripts: readonly string[], budget: number): readonly ScriptUsage[] {
  return scripts.map((s, index) => {
    const charCount = s.length;
    return {
      index,
      charCount,
      budget,
      pct: budget > 0 ? Math.min(100, (charCount / budget) * 100) : 0,
      over: charCount > budget,
    };
  });
}

/** Total character count across every script. */
export function totalChars(scripts: readonly string[]): number {
  return scripts.reduce((n, s) => n + s.length, 0);
}

/**
 * Formats a half-open frame range `[start, end)` (as `stats.scriptFrameRanges` uses) as a
 * human label with an inclusive-looking endpoint, e.g. [0,8) -> "0–7", [0,1) -> "0".
 */
export function formatFrameRange(range: readonly [number, number]): string {
  const [start, end] = range;
  const lastFrame = end - 1;
  return lastFrame <= start ? `${start}` : `${start}–${lastFrame}`;
}
