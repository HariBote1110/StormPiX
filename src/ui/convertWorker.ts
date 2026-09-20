/// <reference lib="webworker" />
import type { Bitmap, ConvertOptions, ConvertResult } from '../core/index.ts';

export interface ConvertRequest {
  readonly kind: 'convert';
  readonly requestId: number;
  readonly frames: readonly Bitmap[];
  readonly options: ConvertOptions & { readonly ticksPerFrame?: number };
}

export type ConvertResponse =
  | { readonly kind: 'result'; readonly requestId: number; readonly result: ConvertResult }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string; readonly notImplemented: boolean };

type CoreModule = {
  convert?: (source: Bitmap, options?: ConvertOptions) => ConvertResult;
  convertFrames?: (
    frames: readonly Bitmap[],
    options?: ConvertOptions & { readonly ticksPerFrame?: number },
  ) => ConvertResult;
};

self.addEventListener('message', (event: MessageEvent<ConvertRequest>) => {
  void handle(event.data);
});

async function handle(request: ConvertRequest): Promise<void> {
  const { requestId, frames, options } = request;
  try {
    // Imported dynamically and typed loosely: the core's convert/convertFrames
    // are being implemented in parallel and may not exist yet.
    const core = (await import('../core/index.ts')) as unknown as CoreModule;

    let result: ConvertResult;
    if (frames.length > 1) {
      if (typeof core.convertFrames !== 'function') {
        throw new NotImplementedSignal('convertFrames は未実装です');
      }
      result = core.convertFrames(frames, options);
    } else {
      if (typeof core.convert !== 'function') {
        throw new NotImplementedSignal('convert は未実装です');
      }
      const first = frames[0];
      if (!first) throw new Error('入力画像がありません');
      result = core.convert(first, options);
    }

    const response: ConvertResponse = { kind: 'result', requestId, result };
    postMessage(response);
  } catch (error) {
    const notImplemented = error instanceof NotImplementedSignal;
    const message = error instanceof Error ? error.message : String(error);
    const response: ConvertResponse = { kind: 'error', requestId, message, notImplemented };
    postMessage(response);
  }
}

class NotImplementedSignal extends Error {}
