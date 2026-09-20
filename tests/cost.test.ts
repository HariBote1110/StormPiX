import { describe, expect, it } from 'vitest';
import { costOf, emitDirect, type DrawOp } from '../src/core/index';

const ops: DrawOp[] = [
  { type: 'setColour', r: 1, g: 2, b: 3 },
  { type: 'rectF', x: 0, y: 0, w: 2, h: 1 },
  { type: 'rect', x: 1, y: 1, w: 3, h: 2 },
  { type: 'line', x1: 0, y1: 0, x2: 4, y2: 4 },
];

describe('direct Lua cost', () => {
  it('measures exactly the exported emitter output', () => {
    const lua = emitDirect(ops);
    expect(costOf(ops, 'direct')).toBe(lua.length);
    expect(lua).toContain('screen.setColor(1,2,3)');
    expect(lua).toContain('screen.drawRectF(0,0,2,1)');
  });

  it('keeps the conversion character-count invariant explicit', () => {
    const lua = emitDirect(ops);
    const conversionArtifact = { lua, charCount: costOf(ops, 'direct') };
    expect(conversionArtifact.charCount).toBe(conversionArtifact.lua.length);
  });

  it('rejects strategies that are not implemented in Phase 1', () => {
    expect(() => costOf(ops, 'table')).toThrowError(/NotImplemented/);
    expect(() => costOf(ops, 'packed')).toThrowError(/NotImplemented/);
  });
});
