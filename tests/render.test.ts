import { describe, expect, it } from 'vitest';
import { render, type DrawOp } from '../src/core/index';

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
    expect(pixel(bitmap, 2, 1)).toEqual([0, 0, 0, 255]);
    expect(pixel(bitmap, 0, 0)).toEqual([0, 0, 0, 255]);
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
    expect(pixel(bitmap, 0, 3)).toEqual([0, 0, 0, 255]);
  });

  it('provides the exact rendered bitmap used as a conversion result', () => {
    const ops: DrawOp[] = [
      { type: 'setColour', r: 12, g: 34, b: 56 },
      { type: 'rectF', x: 0, y: 0, w: 1, h: 1 },
    ];
    const conversionArtifact = { rendered: render(ops, 1, 1) };
    expect(Array.from(conversionArtifact.rendered.data)).toEqual([12, 34, 56, 255]);
  });

  it('starts with opaque black pixels', () => {
    const bitmap = render([], 2, 1);
    expect(Array.from(bitmap.data)).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
  });
});
