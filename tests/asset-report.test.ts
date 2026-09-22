import { describe, expect, it } from 'vitest';
import { createAssetReport } from '../tools/asset-report.ts';
import { verifyLuaRoundTrip } from '../tools/lua-roundtrip.ts';
import { convertFrames } from '../src/core/index.ts';
import type { Bitmap } from '../src/core/index.ts';

function frame(colour: readonly [number, number, number]): Bitmap {
  const data = new Uint8ClampedArray(4 * 2 * 4);
  for (let pixel = 0; pixel < 8; pixel += 1) {
    const offset = pixel * 4;
    data.set([colour[0], colour[1], colour[2], 255], offset);
  }
  return { width: 4, height: 2, data };
}

describe('asset report', () => {
  it('records source complexity, script budget status, and reproducible conversion facts', () => {
    const report = createAssetReport([frame([10, 20, 30]), frame([30, 20, 10])], {
      source: 'fixtures/two-frames',
      mode: 'lossless',
      budget: 8192,
      ticksPerFrame: 2,
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.source).toMatchObject({ path: 'fixtures/two-frames', frameCount: 2, width: 4, height: 2, distinctColours: 2 });
    expect(report.source.frameColours).toEqual([1, 1]);
    expect(report.conversion).toMatchObject({ mode: 'lossless', budget: 8192, exact: true, charCountMatchesLua: true, totalCharCountMatchesScripts: true });
    expect(report.conversion.scripts).toHaveLength(1);
    expect(report.conversion.scripts[0]).toMatchObject({ startFrame: 0, endFrame: 2, withinBudget: true });
  });

  it('replays generated Lua and compares every source frame', () => {
    const frames = [frame([10, 20, 30]), frame([30, 20, 10])];
    const result = convertFrames(frames, { mode: 'lossless', budget: 8192, ticksPerFrame: 2, seed: 0 });
    const verification = verifyLuaRoundTrip(frames, result, 2);

    if (verification.status === 'skipped') return;
    expect(verification).toEqual({ status: 'passed', verifiedFrames: 2 });
  });
});
