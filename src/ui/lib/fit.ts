/** How a source image maps onto the target resolution when sizes don't match. */
export type FitMode = 'contain' | 'cover' | 'stretch' | 'nearest';

/** Source-rect / destination-rect pair for a canvas drawImage call. */
export interface FitRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  readonly dx: number;
  readonly dy: number;
  readonly dw: number;
  readonly dh: number;
}

/**
 * Computes the source/destination rectangles for drawing a `sw0`x`sh0` source
 * image into a `tw`x`th` target canvas under the given fit mode.
 *
 * - contain: whole source visible, letterboxed, centred.
 * - cover: target fully filled, source cropped, centred.
 * - stretch: whole source, whole target, aspect ratio ignored.
 * - nearest: same geometry as contain; the caller is responsible for using
 *   nearest-neighbour (pixelated) scaling rather than smoothing.
 */
export function computeFitRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: FitMode,
): FitRect {
  if (mode === 'stretch') {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: 0, dy: 0, dw: targetWidth, dh: targetHeight };
  }

  const scaleContain = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const scaleCover = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);

  if (mode === 'contain' || mode === 'nearest') {
    const dw = Math.round(sourceWidth * scaleContain);
    const dh = Math.round(sourceHeight * scaleContain);
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: Math.round((targetWidth - dw) / 2),
      dy: Math.round((targetHeight - dh) / 2),
      dw,
      dh,
    };
  }

  // cover
  const sw = Math.round(targetWidth / scaleCover);
  const sh = Math.round(targetHeight / scaleCover);
  return {
    sx: Math.round((sourceWidth - sw) / 2),
    sy: Math.round((sourceHeight - sh) / 2),
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: targetWidth,
    dh: targetHeight,
  };
}
