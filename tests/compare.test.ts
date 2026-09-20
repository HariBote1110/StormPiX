import { describe, expect, it } from 'vitest';
import { columnMajorCardOrder, renderIndexedRectangles } from '../bench/compare/model.ts';

describe('compare benchmark model', () => {
  it('maps a column-major sprite sheet back to frame order', () => {
    expect(columnMajorCardOrder(40, 8, 5)).toEqual(Array.from({ length: 40 }, (_, index) => index));
  });

  it('reconstructs filled V, H and R rectangles in draw order', () => {
    const rendered = renderIndexedRectangles(4, 3, [
      { kind: 'R', x: 0, y: 0, w: 2, h: 2, colour: 1 },
      { kind: 'H', x: 1, y: 1, w: 3, colour: 2 },
      { kind: 'V', x: 3, y: 0, h: 3, colour: 3 },
    ], 0);

    expect(Array.from(rendered)).toEqual([
      1, 1, 0, 3,
      1, 2, 2, 3,
      0, 0, 0, 3,
    ]);
  });
});
