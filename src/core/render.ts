import type { Bitmap, DrawOp } from './types.ts';

function coordinate(value: number): number {
  return Math.trunc(value);
}

function validateDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

/** Execute drawing operations using the opaque pixel semantics of Stormworks. */
export function render(ops: readonly DrawOp[], width: number, height: number): Bitmap {
  validateDimension(width, 'width');
  validateDimension(height, 'height');

  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) {
    data[index] = 255;
  }

  let colour: readonly [number, number, number] = [0, 0, 0];

  const paintPixel = (x: number, y: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = colour[0];
    data[offset + 1] = colour[1];
    data[offset + 2] = colour[2];
    data[offset + 3] = 255;
  };

  const fillRect = (x: number, y: number, w: number, h: number): void => {
    const startX = Math.max(0, x);
    const endX = Math.min(width, x + w);
    const startY = Math.max(0, y);
    const endY = Math.min(height, y + h);
    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) paintPixel(px, py);
    }
  };

  const outlineRect = (x: number, y: number, w: number, h: number): void => {
    if (w <= 0 || h <= 0) return;
    for (let px = x; px < x + w; px += 1) {
      paintPixel(px, y);
      if (h > 1) paintPixel(px, y + h - 1);
    }
    for (let py = y + 1; py < y + h - 1; py += 1) {
      paintPixel(x, py);
      if (w > 1) paintPixel(x + w - 1, py);
    }
  };

  const drawLine = (x1: number, y1: number, x2: number, y2: number): void => {
    let currentX = x1;
    let currentY = y1;
    const deltaX = Math.abs(x2 - x1);
    const stepX = x1 < x2 ? 1 : -1;
    const deltaY = -Math.abs(y2 - y1);
    const stepY = y1 < y2 ? 1 : -1;
    let error = deltaX + deltaY;

    while (true) {
      paintPixel(currentX, currentY);
      if (currentX === x2 && currentY === y2) break;
      const doubleError = 2 * error;
      if (doubleError >= deltaY) {
        error += deltaY;
        currentX += stepX;
      }
      if (doubleError <= deltaX) {
        error += deltaX;
        currentY += stepY;
      }
    }
  };

  for (const op of ops) {
    switch (op.type) {
      case 'setColour':
        colour = [op.r, op.g, op.b];
        break;
      case 'rectF':
        fillRect(coordinate(op.x), coordinate(op.y), coordinate(op.w), coordinate(op.h));
        break;
      case 'rect':
        outlineRect(coordinate(op.x), coordinate(op.y), coordinate(op.w), coordinate(op.h));
        break;
      case 'line':
        drawLine(coordinate(op.x1), coordinate(op.y1), coordinate(op.x2), coordinate(op.y2));
        break;
    }
  }

  return { width, height, data };
}
