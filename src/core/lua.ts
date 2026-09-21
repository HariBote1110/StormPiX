import { render } from './render.ts';
import { renderMonitor } from './gamma.ts';
import type { Bitmap, DrawOp } from './types.ts';

export interface LuaExecutor {
  execute(source: string, options?: { readonly frameCount?: number; readonly ticksPerFrame?: number; readonly drawInitialFrame?: boolean }): LuaExecution;
}

export interface LuaExecution {
  readonly frames: readonly (readonly DrawOp[])[];
  readonly skipped: boolean;
  readonly message?: string;
}

/** Replay captured screen calls cumulatively, as the monitor does between frames. */
export function replayLuaFrames(frames: readonly (readonly DrawOp[])[], width: number, height: number, gamma = false): Bitmap[] {
  const result: Bitmap[] = [];
  let operations: DrawOp[] = [];
  for (const frame of frames) {
    operations = [...operations, ...frame];
    result.push(gamma ? renderMonitor(operations, width, height) : render(operations, width, height));
  }
  return result;
}
