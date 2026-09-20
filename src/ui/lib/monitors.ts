/** Stormworks monitor presets. 1 block = 32x32px. */
export interface MonitorPreset {
  readonly id: string;
  readonly label: string;
  readonly blocksX: number;
  readonly blocksY: number;
}

export const BLOCK_SIZE = 32;

export const MONITOR_PRESETS: readonly MonitorPreset[] = [
  { id: '1x1', label: '1x1', blocksX: 1, blocksY: 1 },
  { id: '2x1', label: '2x1', blocksX: 2, blocksY: 1 },
  { id: '2x2', label: '2x2', blocksX: 2, blocksY: 2 },
  { id: '3x2', label: '3x2', blocksX: 3, blocksY: 2 },
  { id: '3x3', label: '3x3', blocksX: 3, blocksY: 3 },
  { id: '5x3', label: '5x3', blocksX: 5, blocksY: 3 },
  { id: '9x5', label: '9x5', blocksX: 9, blocksY: 5 },
];

export function resolutionOf(preset: MonitorPreset): { width: number; height: number } {
  return { width: preset.blocksX * BLOCK_SIZE, height: preset.blocksY * BLOCK_SIZE };
}
