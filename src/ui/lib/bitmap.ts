import type { Bitmap } from '../../core/index.ts';
import { computeFitRect, type FitMode } from './fit.ts';

/** Decodes an image File/Blob into an HTMLImageElement. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像の読み込みに失敗しました'));
    };
    img.src = url;
  });
}

function canvasToBitmap(canvas: HTMLCanvasElement): Bitmap {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context を取得できません');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: image.data };
}

/** Draws `source` onto a `targetWidth`x`targetHeight` canvas under `mode` and reads it back as a Bitmap. */
export function drawFitted(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  mode: FitMode,
): Bitmap {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context を取得できません');
  ctx.imageSmoothingEnabled = mode !== 'nearest';
  ctx.clearRect(0, 0, targetWidth, targetHeight);
  const rect = computeFitRect(sourceWidth, sourceHeight, targetWidth, targetHeight, mode);
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  return canvasToBitmap(canvas);
}

/** Decodes a File/Blob to a Bitmap sized to (targetWidth, targetHeight) under the given fit mode. */
export async function fileToBitmap(
  file: Blob,
  targetWidth: number,
  targetHeight: number,
  mode: FitMode,
): Promise<{ bitmap: Bitmap; naturalWidth: number; naturalHeight: number }> {
  const img = await loadImage(file);
  const bitmap = drawFitted(img, img.naturalWidth, img.naturalHeight, targetWidth, targetHeight, mode);
  return { bitmap, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
}

/** Renders a Bitmap onto a canvas element with nearest-neighbour scaling (crisp pixels). */
export function paintBitmap(canvas: HTMLCanvasElement, bitmap: Bitmap): void {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const imageData = new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height);
  ctx.putImageData(imageData, 0, 0);
}
