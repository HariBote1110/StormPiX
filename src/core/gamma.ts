import { render } from './render.ts';
import type { Bitmap, DrawOp, Rgb } from './types.ts';

/**
 * Stormworks monitor response LUT, credited to Ossan3's Steam guide 2569574227.
 * Community-derived and not independently verified; keep this replaceable table isolated.
 */
export const MONITOR_DISPLAY_LUT: readonly number[] = [0,14,23,31,38,45,52,58,64,70,76,81,87,92,97,102,106,111,115,119,123,127,130,134,137,140,143,146,149,152,154,157,159,162,164,166,168,170,172,174,176,178,180,181,183,185,186,187,189,190,191,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,210,211,211,212,213,213,214,215,215,216,216,217,217,218,218,219,219,220,220,221,221,222,222,223,223,223,224,224,224,225,225,225,226,226,226,227,227,227,227,228,228,229,229,229,229,230,230,230,231,231,231,231,231,232,232,232,232,233,233,233,233,233,234,234,234,234,235,235,235,235,235,235,235,236,236,236,236,236,236,237,237,237,237,237,237,237,238,238,238,238,238,238,238,238,239,239,239,239,239,239,239,239,240,240,240,240,240,240,240,240,240,240,241,241,241,241,241,241,241,241,241,241,241,242,242,242,242,242,242,242,242,242,242,242,242,243,243,243,243,243,243,243,243,243,243,243,243,243,243,243,244,244,244,244,244,244,244,244,244,244,244,244,244,244,244,244,245,245,245,245,245,245,245,245,245,245,245,245,245,245,245,245,245,245,245,245,246] as const;

export interface MonitorDeviceTarget {
  readonly bitmap: Bitmap;
  readonly maxAbsChannelDeviation: number;
  readonly meanAbsChannelDeviation: number;
}

export function monitorInputForDisplayed(value: number): number {
  const target = Math.max(0, Math.min(255, Math.round(value)));
  let best = 0;
  for (let input = 1; input < MONITOR_DISPLAY_LUT.length; input += 1) {
    const currentDifference = Math.abs((MONITOR_DISPLAY_LUT[input] ?? 0) - target);
    const bestDifference = Math.abs((MONITOR_DISPLAY_LUT[best] ?? 0) - target);
    if (currentDifference < bestDifference) best = input;
  }
  return best;
}

export function monitorDeviceTarget(source: Bitmap): MonitorDeviceTarget {
  const data = new Uint8ClampedArray(source.data);
  let maximum = 0;
  let total = 0;
  for (let offset = 0; offset < data.length; offset += 4) for (let channel = 0; channel < 3; channel += 1) {
    const sourceValue = source.data[offset + channel] ?? 0;
    const displayed = MONITOR_DISPLAY_LUT[monitorInputForDisplayed(sourceValue)] ?? 0;
    data[offset + channel] = displayed;
    const difference = Math.abs(displayed - sourceValue);
    maximum = Math.max(maximum, difference);
    total += difference;
  }
  return { bitmap: { width: source.width, height: source.height, data }, maxAbsChannelDeviation: maximum, meanAbsChannelDeviation: data.length === 0 ? 0 : total / (source.width * source.height * 3) };
}

export function monitorInputOps(ops: readonly DrawOp[]): DrawOp[] {
  return ops.map((op) => op.type === 'setColour'
    ? { ...op, r: monitorInputForDisplayed(op.r), g: monitorInputForDisplayed(op.g), b: monitorInputForDisplayed(op.b) }
    : op);
}

export function renderMonitor(ops: readonly DrawOp[], width: number, height: number): Bitmap {
  const displayed = ops.map((op) => op.type === 'setColour'
    ? { ...op, r: MONITOR_DISPLAY_LUT[Math.max(0, Math.min(255, Math.round(op.r)))] ?? 0, g: MONITOR_DISPLAY_LUT[Math.max(0, Math.min(255, Math.round(op.g)))] ?? 0, b: MONITOR_DISPLAY_LUT[Math.max(0, Math.min(255, Math.round(op.b)))] ?? 0 }
    : op);
  return render(displayed, width, height);
}

export function monitorInputPalette(palette: readonly Rgb[]): Rgb[] {
  return palette.map((colour) => [monitorInputForDisplayed(colour[0]), monitorInputForDisplayed(colour[1]), monitorInputForDisplayed(colour[2])]);
}
