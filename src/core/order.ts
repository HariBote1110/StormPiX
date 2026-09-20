import type { DrawOp } from './types.ts';

function colourKey(r: number, g: number, b: number): string {
  return `${r},${g},${b}`;
}

/** Group rectangles by colour so one setColor serves every rectangle in that group. */
export function orderOps(ops: readonly DrawOp[]): DrawOp[] {
  const groups = new Map<string, { colour: Extract<DrawOp, { type: 'setColour' }>; rects: DrawOp[]; area: number }>();
  let current: Extract<DrawOp, { type: 'setColour' }> | undefined;
  for (const op of ops) {
    if (op.type === 'setColour') {
      current = op;
    } else if (op.type === 'rectF' && current) {
      const key = colourKey(current.r, current.g, current.b);
      const group = groups.get(key) ?? { colour: current, rects: [], area: 0 };
      group.rects.push(op);
      group.area += Math.max(0, op.w) * Math.max(0, op.h);
      groups.set(key, group);
    } else {
      return [...ops];
    }
  }
  const ordered = [...groups.values()].sort((a, b) => b.area - a.area || colourKey(a.colour.r, a.colour.g, a.colour.b).localeCompare(colourKey(b.colour.r, b.colour.g, b.colour.b)));
  return ordered.flatMap((group) => [group.colour, ...group.rects]);
}
