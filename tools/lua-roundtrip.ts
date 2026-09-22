import { replayLuaFrames, type Bitmap, type ConvertResult } from '../src/core/index.ts';
import { executeLua } from '../tests/lua-executor.ts';

export type LuaRoundTripVerification =
  | { readonly status: 'passed'; readonly verifiedFrames: number }
  | { readonly status: 'skipped'; readonly message: string }
  | { readonly status: 'failed'; readonly scriptIndex: number; readonly frame: number; readonly message: string };

function equalPixels(left: Bitmap, right: Bitmap): boolean {
  if (left.width !== right.width || left.height !== right.height || left.data.length !== right.data.length) return false;
  for (let index = 0; index < left.data.length; index += 1) if (left.data[index] !== right.data[index]) return false;
  return true;
}

/** Execute every generated script and compare the accumulated monitor pixels with its source frames. */
export function verifyLuaRoundTrip(frames: readonly Bitmap[], result: ConvertResult, ticksPerFrame: number): LuaRoundTripVerification {
  const first = frames[0];
  if (!first) throw new RangeError('at least one frame is required');
  const ranges = result.stats.scriptFrameRanges ?? result.scripts.map(() => [0, frames.length] as const);
  let verifiedFrames = 0;
  for (let scriptIndex = 0; scriptIndex < result.scripts.length; scriptIndex += 1) {
    const source = result.scripts[scriptIndex] as string;
    const range = ranges[scriptIndex] ?? [0, frames.length];
    const frameCount = range[1] - range[0];
    const execution = executeLua(source, { frameCount, ticksPerFrame, drawInitialFrame: true, width: first.width, height: first.height });
    if (execution.skipped) return { status: 'skipped', message: execution.message ?? 'Lua 実行環境がありません' };
    const rendered = replayLuaFrames(execution.frames, first.width, first.height);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const expected = frames[range[0] + frame];
      const actual = rendered[frame];
      if (!expected || !actual || !equalPixels(actual, expected)) {
        return { status: 'failed', scriptIndex, frame: range[0] + frame, message: 'Lua 実行結果が入力フレームと一致しません' };
      }
      verifiedFrames += 1;
    }
  }
  return { status: 'passed', verifiedFrames };
}
