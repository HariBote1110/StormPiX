import type { Bitmap, ConvertOptions, ConvertResult } from '../core/index.ts';
import type { ConvertRequest, ConvertResponse } from './convertWorker.ts';

export interface ConvertOutcome {
  readonly ok: boolean;
  readonly result?: ConvertResult;
  readonly message?: string;
  readonly notImplemented?: boolean;
  readonly cancelled?: boolean;
}

/** Manages the single conversion Web Worker: run one job at a time, allow cancellation. */
export class ConvertWorkerClient {
  private worker: Worker | undefined;
  private nextRequestId = 1;
  private activeRequestId: number | undefined;
  private activeResolve: ((outcome: ConvertOutcome) => void) | undefined;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./convertWorker.ts', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', (event: MessageEvent<ConvertResponse>) => {
        this.onMessage(event.data);
      });
    }
    return this.worker;
  }

  private onMessage(response: ConvertResponse): void {
    if (response.requestId !== this.activeRequestId) return; // stale response from a cancelled/superseded run
    const resolve = this.activeResolve;
    this.activeRequestId = undefined;
    this.activeResolve = undefined;
    if (!resolve) return;
    if (response.kind === 'result') {
      resolve({ ok: true, result: response.result });
    } else {
      resolve({ ok: false, message: response.message, notImplemented: response.notImplemented });
    }
  }

  /** Cancels any in-flight run without waiting for its result. */
  cancel(): void {
    if (this.activeRequestId !== undefined) {
      this.activeRequestId = undefined;
      this.activeResolve = undefined;
    }
    // Terminate + drop the worker so a slow/stuck run cannot report late.
    this.worker?.terminate();
    this.worker = undefined;
  }

  async run(frames: readonly Bitmap[], options: ConvertOptions & { readonly ticksPerFrame?: number }): Promise<ConvertOutcome> {
    this.worker?.terminate();
    this.worker = undefined;
    const worker = this.ensureWorker();
    const requestId = this.nextRequestId++;
    this.activeRequestId = requestId;

    return new Promise<ConvertOutcome>((resolve) => {
      this.activeResolve = resolve;
      const request: ConvertRequest = { kind: 'convert', requestId, frames, options };
      worker.postMessage(request);
    });
  }
}
