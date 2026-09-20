export type IndexedRectangle =
  | { readonly kind: 'R'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly colour: number }
  | { readonly kind: 'H'; readonly x: number; readonly y: number; readonly w: number; readonly colour: number }
  | { readonly kind: 'V'; readonly x: number; readonly y: number; readonly h: number; readonly colour: number };

/** Return the frame indices visited by kamishibai's x-outer, y-inner traversal. */
export function columnMajorCardOrder(frameCount: number, columns: number, rows: number): number[] {
  const order: number[] = [];
  for (let x = 0; x < columns; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      const frame = x * rows + y;
      if (frame < frameCount) order.push(frame);
    }
  }
  return order;
}

/** Render kamishibai's filled rectangle calls as palette-index pixels. */
export function renderIndexedRectangles(
  width: number,
  height: number,
  rectangles: readonly IndexedRectangle[],
  background: number,
): Uint16Array {
  const pixels = new Uint16Array(width * height);
  pixels.fill(background);
  for (const rectangle of rectangles) {
    const right = rectangle.x + (rectangle.kind === 'V' ? 1 : rectangle.w);
    const bottom = rectangle.y + (rectangle.kind === 'H' ? 1 : rectangle.h);
    for (let y = rectangle.y; y < bottom; y += 1) {
      for (let x = rectangle.x; x < right; x += 1) {
        if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * width + x] = rectangle.colour;
      }
    }
  }
  return pixels;
}
