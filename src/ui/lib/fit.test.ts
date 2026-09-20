import { describe, expect, it } from 'vitest';
import { computeFitRect } from './fit.ts';

describe('computeFitRect', () => {
  it('contain: fits the whole source inside, letterboxed, centred', () => {
    // source 200x100 into 100x100 target -> width-limited, height 50, centred vertically
    const r = computeFitRect(200, 100, 100, 100, 'contain');
    expect(r).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 25, dw: 100, dh: 50 });
  });

  it('cover: fills the target, cropping the source, centred', () => {
    // source 200x100 into 100x100 target -> height-limited, crop width to 100 (centred)
    const r = computeFitRect(200, 100, 100, 100, 'cover');
    expect(r).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100 });
  });

  it('stretch: uses the whole source and whole target, no crop, no letterbox', () => {
    const r = computeFitRect(200, 100, 50, 80, 'stretch');
    expect(r).toEqual({ sx: 0, sy: 0, sw: 200, sh: 100, dx: 0, dy: 0, dw: 50, dh: 80 });
  });

  it('nearest: same maths as contain (scaling algorithm differs, not geometry)', () => {
    const contain = computeFitRect(200, 100, 100, 100, 'contain');
    const nearest = computeFitRect(200, 100, 100, 100, 'nearest');
    expect(nearest).toEqual(contain);
  });

  it('handles an already-matching size as a no-op', () => {
    const r = computeFitRect(64, 32, 64, 32, 'contain');
    expect(r).toEqual({ sx: 0, sy: 0, sw: 64, sh: 32, dx: 0, dy: 0, dw: 64, dh: 32 });
  });
});
