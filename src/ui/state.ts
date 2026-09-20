import type { Bitmap, ConvertResult } from '../core/index.ts';
import { DEFAULT_OPTIONS, type UiConvertOptions } from './lib/options.ts';
import type { FitMode } from './lib/fit.ts';
import { MONITOR_PRESETS } from './lib/monitors.ts';

export interface FrameEntry {
  readonly id: number;
  readonly name: string;
  readonly bitmap: Bitmap;
}

export type Theme = 'system' | 'light' | 'dark';

export interface ConvertError {
  readonly message: string;
  readonly notImplemented: boolean;
}

export interface AppState {
  readonly frames: readonly FrameEntry[];
  readonly monitorPresetId: string;
  readonly fitMode: FitMode;
  readonly options: UiConvertOptions;
  readonly ticksPerFrame: number;
  readonly theme: Theme;
  readonly dragActive: boolean;
  readonly busy: boolean;
  readonly result: ConvertResult | undefined;
  readonly error: ConvertError | undefined;
  readonly showDiff: boolean;
  readonly playing: boolean;
  readonly runNonce: number;
}

export function initialState(): AppState {
  return {
    frames: [],
    monitorPresetId: MONITOR_PRESETS[0]!.id,
    fitMode: 'contain',
    options: DEFAULT_OPTIONS,
    ticksPerFrame: 6,
    theme: 'system',
    dragActive: false,
    busy: false,
    result: undefined,
    error: undefined,
    showDiff: false,
    playing: false,
    runNonce: 0,
  };
}
