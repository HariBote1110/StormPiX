import type { DrawOp, EmitStrategy } from './types.ts';

export class NotImplementedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

function numberText(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

/** Emit the complete direct onDraw Lua script used by the Phase 1 cost model. */
export function emitDirect(ops: readonly DrawOp[]): string {
  const lines = ['function onDraw()'];
  for (const op of ops) {
    switch (op.type) {
      case 'setColour':
        lines.push(`screen.setColor(${numberText(op.r)},${numberText(op.g)},${numberText(op.b)})`);
        break;
      case 'rectF':
        lines.push(`screen.drawRectF(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`);
        break;
      case 'rect':
        lines.push(`screen.drawRect(${numberText(op.x)},${numberText(op.y)},${numberText(op.w)},${numberText(op.h)})`);
        break;
      case 'line':
        lines.push(`screen.drawLine(${numberText(op.x1)},${numberText(op.y1)},${numberText(op.x2)},${numberText(op.y2)})`);
        break;
    }
  }
  lines.push('end');
  return `${lines.join('\n')}\n`;
}

export function emitLua(ops: readonly DrawOp[], strategy: EmitStrategy): string {
  if (strategy === 'direct') return emitDirect(ops);
  throw new NotImplementedError(`NotImplementedError: emit strategy "${strategy}" is not implemented in Phase 1`);
}

export function costOf(ops: readonly DrawOp[], strategy: EmitStrategy): number {
  return emitLua(ops, strategy).length;
}
