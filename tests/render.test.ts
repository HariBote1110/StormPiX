import { describe, expect, it } from 'vitest';
import { render, renderWithMask, type DrawOp } from '../src/core/index';

function pixel(bitmap: ReturnType<typeof render>, x: number, y: number): number[] {
  const offset = (y * bitmap.width + x) * 4;
  return Array.from(bitmap.data.slice(offset, offset + 4));
}

describe('render', () => {
  it('paints rectF with half-open bounds and clips out of bounds', () => {
    const ops: DrawOp[] = [
      { type: 'setColour', r: 10, g: 20, b: 30 },
      { type: 'rectF', x: -1, y: 1, w: 3, h: 2 },
    ];

    const bitmap = render(ops, 3, 3);

    expect(pixel(bitmap, 0, 1)).toEqual([10, 20, 30, 255]);
    expect(pixel(bitmap, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(pixel(bitmap, 0, 2)).toEqual([10, 20, 30, 255]);
    expect(pixel(bitmap, 2, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(bitmap, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('draws one-pixel outlines and lines in order', () => {
    const ops: DrawOp[] = [
      { type: 'setColour', r: 255, g: 0, b: 0 },
      { type: 'rect', x: 1, y: 1, w: 3, h: 3 },
      { type: 'setColour', r: 0, g: 255, b: 0 },
      { type: 'line', x1: 0, y1: 0, x2: 3, y2: 3 },
    ];

    const bitmap = render(ops, 4, 4);

    expect(pixel(bitmap, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(pixel(bitmap, 2, 2)).toEqual([0, 255, 0, 255]);
    expect(pixel(bitmap, 3, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(bitmap, 0, 3)).toEqual([0, 0, 0, 0]);
  });

  it('provides the exact rendered bitmap used as a conversion result', () => {
    const ops: DrawOp[] = [
      { type: 'setColour', r: 12, g: 34, b: 56 },
      { type: 'rectF', x: 0, y: 0, w: 1, h: 1 },
    ];
    const conversionArtifact = { rendered: render(ops, 1, 1) };
    expect(Array.from(conversionArtifact.rendered.data)).toEqual([12, 34, 56, 255]);
  });

  it('starts with transparent black pixels as documented in §6', () => {
    const bitmap = render([], 2, 1);
    expect(Array.from(bitmap.data)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('uses the documented B6/D7 fractional drawRectF sampling rule', () => {
    const output = render([
      { type: 'setColour', r: 255, g: 255, b: 255 },
      { type: 'rectF', x: 2.75, y: 2.25, w: 0.4, h: 1.4 },
    ], 6, 6);
    expect(pixel(output, 3, 2)).toEqual([255, 255, 255, 255]);
    expect(pixel(output, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(pixel(output, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it('uses the documented A5/D12 diamond-exit line rule without a length threshold', () => {
    const output = render([
      { type: 'setColour', r: 255, g: 255, b: 255 },
      { type: 'line', x1: 12, y1: 7, x2: 12.5, y2: 7 },
      { type: 'line', x1: 20, y1: 12, x2: 20.3, y2: 12.3 },
    ], 24, 16);
    expect(pixel(output, 12, 7)).toEqual([255, 255, 255, 255]);
    expect(pixel(output, 20, 12)).toEqual([255, 255, 255, 255]);
  });

  it('supports reference primitive semantics and reports edge certainty', () => {
    const output = renderWithMask([
      { type: 'setColour', r: 255, g: 0, b: 0 },
      { type: 'triangle', x1: 1, y1: 1, x2: 6, y2: 1, x3: 3, y3: 6 },
      { type: 'setColour', r: 0, g: 255, b: 0 },
      { type: 'circle', x: 10, y: 5, radius: 3 },
    ], 14, 10);

    expect(output.bitmap.data.some((value) => value === 255)).toBe(true);
    expect(output.certainty.length).toBe(14 * 10);
    expect(Array.from(output.certainty).every((value) => value === 1)).toBe(true);
    expect(Array.from(output.certainty).some((value) => value === 1)).toBe(true);
  });

  it('blends all four channels with the documented §6 formula', () => {
    const output = render([
      { type: 'setColour', r: 255, g: 0, b: 0, a: 128 },
      { type: 'rectF', x: 0, y: 0, w: 1, h: 1 },
    ], 1, 1);
    expect(Array.from(output.data)).toEqual([128, 0, 0, 64]);
  });
});
