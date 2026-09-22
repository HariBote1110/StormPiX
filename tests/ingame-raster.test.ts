import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, type DrawOp } from '../src/core/index';
import { executeLua } from './lua-executor.ts';

const PHY_SIM_ROOT = process.env.STORMPIX_PHYSIM_ROOT ?? '/private/tmp/claude-501/-Users-yuki-GitHub-StormPiX/18cbb2fa-b395-45ff-b183-1e4ba30c4512/scratchpad/PhySim2';
const fixturePath = join(PHY_SIM_ROOT, 'test/fixtures/ingame-raster.json');
const cards: Record<string, string> = {
  A: 'verifyA_shapes.lua', B: 'verifyB_color.lua', C: 'verifyC_circle.lua', D: 'verifyD_open.lua', E: 'verifyE_sizes.lua',
};

function pageDetails(page: string): { card: string; pageNumber: number; width: number; height: number } {
  const match = /^([A-Z])(\d+)(?:_(\d+)x(\d+))?$/.exec(page);
  if (!match) throw new Error(`invalid in-game fixture page ${page}`);
  return { card: match[1] as string, pageNumber: Number(match[2]), width: 32 * Number(match[3] ?? 3), height: 32 * Number(match[4] ?? 3) };
}

function fixturePixels(runs: readonly (readonly number[])[]): Set<string> {
  const pixels = new Set<string>();
  for (const [y, start, end] of runs) for (let x = start as number; x <= (end as number); x += 1) pixels.add(`${x},${y}`);
  return pixels;
}

describe.skipIf(!existsSync(fixturePath))('実機スクリーン検証フィクスチャ', () => {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { readonly pages: Record<string, readonly (readonly number[])[]> };
  for (const [page, runs] of Object.entries(fixture.pages)) {
    it(`${page}: 輝度しきい値 150 の実機 lit pixels と一致する`, () => {
      const { card, pageNumber, width, height } = pageDetails(page);
      const source = readFileSync(join(PHY_SIM_ROOT, 'tools/ingame', cards[card] as string), 'utf8');
      const execution = executeLua(source, { width, height, inputNumbers: Array.from({ length: 32 }, (_, index) => index === 31 ? pageNumber : 0) });
      if (execution.skipped) {
        console.warn(`SKIP: ${execution.message}`);
        return;
      }
      let bright = false;
      const brightOps: DrawOp[] = [];
      for (const op of execution.frames[0] ?? []) {
        if (op.type === 'setColour') {
          bright = op.r >= 200 && op.g >= 200 && op.b >= 200;
          continue;
        }
        if (bright) brightOps.push({ type: 'setColour', r: 255, g: 255, b: 255 }, op);
      }
      const bitmap = render(brightOps, width, height);
      const actual = new Set<string>();
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const luminance = 0.299 * (bitmap.data[offset] ?? 0) + 0.587 * (bitmap.data[offset + 1] ?? 0) + 0.114 * (bitmap.data[offset + 2] ?? 0);
        if (luminance > 150) actual.add(`${x},${y}`);
      }
      expect(actual).toEqual(fixturePixels(runs));
    });
  }
});
