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

/** Formats a frame range (inclusive, 0-indexed) as a human label, e.g. "0–5" or "3". */
export function formatFrameRange(range: readonly [number, number]): string {
  const [start, end] = range;
  return start === end ? `${start}` : `${start}–${end}`;
}
