import { existsSync, readdirSync } from 'node:fs';
import { compareKamishibai, loadKamishibaiRuntime } from './kamishibai.ts';
import { readPng } from './png.ts';
import { convert, convertFrames, type Bitmap } from '../../src/core/index.ts';

const DEFAULT_ASSET_PATH = '/Users/yuki/doc/al/pngX';
const DEFAULT_KAMISHIBAI_PATH = '/private/tmp/claude-501/-Users-yuki-GitHub-StormPiX/8ac0dcff-c3e3-426a-8bfc-f3030186cf6c/scratchpad/storm-kamishibai';
const SUBSETS = [4, 8, 16, 24, 40] as const;
const STORM_TIME_BUDGET_MS = 5000;

function skip(message: string): void {
  console.log(`SKIP: ${message}`);
}

function loadFrames(path: string): Bitmap[] {
  const names = readdirSync(path).filter((name) => /^\d{3}\.png$/.test(name)).sort();
  if (names.length !== 40 || names.some((name, index) => name !== `${String(index).padStart(3, '0')}.png`)) throw new Error(`expected exactly 000.png..039.png in ${path}, found ${names.length} numbered PNGs`);
  const frames = names.map((name) => readPng(`${path}/${name}`));
  if (frames.some((frame) => frame.width !== 64 || frame.height !== 32)) throw new Error(`expected all comparison frames to be 64x32: ${path}`);
  if (frames.some((frame) => Array.from(frame.data).some((value, index) => index % 4 === 3 && value !== 255))) throw new Error('comparison asset is not fully opaque');
  return frames;
}

function stormResult(frames: readonly Bitmap[], budget: number): ReturnType<typeof convertFrames> {
  return convertFrames(frames, { budget, seed: 0, ticksPerFrame: 6, timeBudgetMs: STORM_TIME_BUDGET_MS });
}

function isLossless(result: ReturnType<typeof convertFrames>): boolean {
  return result.metrics.ssim >= 1 - 1e-12;
}

function findLosslessStorm(frames: readonly Bitmap[]): { readonly budget: number; readonly result: ReturnType<typeof convertFrames> } {
  let lower = 0;
  let upper = 256;
  let result = stormResult(frames, upper);
  while (!isLossless(result) && upper < 262144) {
    lower = upper;
    upper *= 2;
    result = stormResult(frames, upper);
  }
  if (!isLossless(result)) throw new Error(`StormPiX did not reach mean SSIM 1.000000 by budget ${upper}`);
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    const middleResult = stormResult(frames, middle);
    if (isLossless(middleResult)) {
      upper = middle;
      result = middleResult;
    } else {
      lower = middle;
    }
  }
  return { budget: upper, result };
}

function formatStorm(result: ReturnType<typeof convertFrames>): string {
  return `${result.charCount}\t${result.metrics.ssim.toFixed(6)}\t${result.strategy}`;
}

async function main(): Promise<void> {
  const assetPath = process.env.ASSET_PATH ?? DEFAULT_ASSET_PATH;
  const kamishibaiPath = process.env.KAMISHIBAI_PATH ?? DEFAULT_KAMISHIBAI_PATH;
  if (!existsSync(assetPath)) {
    skip(`asset path is absent: ${assetPath} (set ASSET_PATH to override)`);
    return;
  }
  if (!existsSync(kamishibaiPath)) {
    skip(`kamishibai clone is absent: ${kamishibaiPath} (set KAMISHIBAI_PATH to override)`);
    return;
  }

  const allFrames = loadFrames(assetPath);
  const runtime = await loadKamishibaiRuntime(kamishibaiPath);
  const distinctColours = new Set<string>();
  for (const frame of allFrames) {
    for (let index = 0; index < frame.data.length; index += 4) distinctColours.add(`${frame.data[index] ?? 0},${frame.data[index + 1] ?? 0},${frame.data[index + 2] ?? 0},${frame.data[index + 3] ?? 0}`);
  }
  let gammaMaximum = 0;
  let gammaTotal = 0;
  let gammaCount = 0;
  for (const colour of distinctColours) {
    const [r, g, b] = colour.split(',').map(Number);
    const mapped = [r, g, b].map((value) => {
      const lut = [...runtime.lut, 256];
      const numeric = value ?? 0;
      const result = Math.max(0, lut.findIndex((entry) => numeric < entry) - 1);
      return result;
    });
    for (let index = 0; index < 3; index += 1) {
      const difference = Math.abs(([r, g, b][index] ?? 0) - (mapped[index] ?? 0));
      gammaMaximum = Math.max(gammaMaximum, difference);
      gammaTotal += difference;
      gammaCount += 1;
    }
  }

  console.log('StormPiX vs storm-kamishibai comparison');
  console.log(`asset\t${assetPath}\tframes=${allFrames.length}\tdimensions=64x32\tdistinctRGBA=${distinctColours.size}`);
  console.log(`gamma\tmaxAbsChannelDiff=${gammaMaximum}\tmeanAbsChannelDiff=${(gammaTotal / gammaCount).toFixed(6)}\tchannels=${gammaCount}`);
  console.log('gammaNote\tkamishibai applies its monitor gamma LUT; StormPiX does not. Compare each output against its own target, not emitted colour numbers.');

  console.log('\nAXIS A — equal fidelity (mean SSIM 1.000000)');
  console.log('frames\tkamScripts\tkamChars\tkamLossless\tkamMismatches\tstormBudget\tstormChars\tratioKamOverStorm');
  let firstKamishibaiFinding: { readonly frame: number; readonly pixel: number; readonly got: number; readonly expected: number } | undefined;
  for (const count of SUBSETS) {
    const frames = allFrames.slice(0, count);
    const kam = await compareKamishibai(frames, kamishibaiPath, 8192);
    const storm = findLosslessStorm(frames);
    firstKamishibaiFinding ??= kam.firstMismatch;
    const ratio = kam.lossless ? (kam.charCount / storm.result.charCount).toFixed(3) : '-';
    console.log(`${count}\t${kam.scriptCount}\t${kam.charCount}\t${kam.lossless}\t${kam.reconstructionMismatches}\t${storm.budget}\t${storm.result.charCount}\t${ratio}`);
  }
  if (firstKamishibaiFinding) console.log(`kamishibaiFinding\tframe=${firstKamishibaiFinding.frame}\tpixel=${firstKamishibaiFinding.pixel}\tgotIndex=${firstKamishibaiFinding.got}\texpectedIndex=${firstKamishibaiFinding.expected}`);

  console.log('\nAXIS B — one 8192-character StormPiX script');
  console.log('frames\tstormChars\tstormSsim\tstormStrategy\tkamScripts\tkamChars\tkamLossless\tkamMismatches');
  for (const count of SUBSETS) {
    const frames = allFrames.slice(0, count);
    const storm = stormResult(frames, 8192);
    const kam = await compareKamishibai(frames, kamishibaiPath, 8192);
    console.log(`${count}\t${formatStorm(storm)}\t${kam.scriptCount}\t${kam.charCount}\t${kam.lossless}\t${kam.reconstructionMismatches}`);
  }

  const firstFrame = allFrames[0] as Bitmap;
  const stormFirst = findLosslessStorm([firstFrame]);
  const kamFirst = await compareKamishibai([firstFrame], kamishibaiPath, 8192);
  console.log('\nSINGLE FRAME — frame 0, lossless');
  console.log('tool\tchars\tssimOrLossless\tstrategyOrScripts');
  console.log(`StormPiX\t${stormFirst.result.charCount}\t${stormFirst.result.metrics.ssim.toFixed(6)}\t${stormFirst.result.strategy}`);
  console.log(`kamishibai\t${kamFirst.charCount}\t${kamFirst.lossless}\t${kamFirst.scriptCount}`);
  const kam4090 = await compareKamishibai(allFrames, kamishibaiPath, 4090);
  console.log(`\nFOOTNOTE\tkamishibai shipped default luaMaxLength=4090: scripts=${kam4090.scriptCount}, chars=${kam4090.charCount}, lossless=${kam4090.lossless}, haveOverRun=${kam4090.overrun}, haveColorDiv=${kam4090.colourDivided}`);
}

main().catch((error: unknown) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
