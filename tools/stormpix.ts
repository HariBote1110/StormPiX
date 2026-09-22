import { existsSync, readdirSync } from 'node:fs';
import { readPng } from '../bench/compare/png.ts';
import { convertAsset, verifyAssetReport, type AssetReportOptions, type VerificationPolicy } from './asset-report.ts';
import { verifyLuaRoundTrip } from './lua-roundtrip.ts';

interface ParsedOptions {
  source: string;
  mode?: AssetReportOptions['mode'];
  budget?: number;
  ticksPerFrame?: number;
  maxTotalCharCount?: number;
  requireExact?: boolean;
  requireWithinBudget?: boolean;
  requireLuaRoundTrip?: boolean;
}

interface Arguments {
  readonly command: 'report' | 'verify';
  readonly path: string;
  readonly options: ParsedOptions;
}

function usage(): string {
  return [
    '使用法: stormpix <report|verify> <PNGフレームディレクトリ> [オプション]',
    '  --mode lossless|fit',
    '  --budget <文字数>',
    '  --ticks <フレーム当たりtick数>',
    '  --max-total-chars <合計文字数上限>',
    '  --require-exact',
    '  --require-within-budget',
    '  --require-lua-roundtrip',
  ].join('\n');
}

function positiveInteger(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new RangeError(`${option} は正の整数で指定してください`);
  return number;
}

function parseArguments(argv: readonly string[]): Arguments {
  const [command, path, ...rest] = argv;
  if ((command !== 'report' && command !== 'verify') || !path) throw new Error(usage());
  const options: ParsedOptions = { source: path };
  for (let index = 0; index < rest.length; index += 1) {
    const option = rest[index];
    if (option === '--require-exact') {
      options.requireExact = true;
      continue;
    }
    if (option === '--require-within-budget') {
      options.requireWithinBudget = true;
      continue;
    }
    if (option === '--require-lua-roundtrip') {
      options.requireLuaRoundTrip = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option ?? 'option'} の値がありません\n${usage()}`);
    index += 1;
    if (option === '--mode') {
      if (value !== 'lossless' && value !== 'fit') throw new RangeError('--mode は lossless または fit です');
      options.mode = value;
    } else if (option === '--budget') options.budget = positiveInteger(value, '--budget');
    else if (option === '--ticks') options.ticksPerFrame = positiveInteger(value, '--ticks');
    else if (option === '--max-total-chars') options.maxTotalCharCount = positiveInteger(value, '--max-total-chars');
    else throw new Error(`不明なオプション: ${option}\n${usage()}`);
  }
  return { command, path, options };
}

function loadFrames(path: string) {
  if (!existsSync(path)) throw new Error(`入力ディレクトリが存在しません: ${path}`);
  const names = readdirSync(path).filter((name) => name.toLowerCase().endsWith('.png')).sort();
  if (names.length === 0) throw new Error(`PNGフレームがありません: ${path}`);
  return names.map((name) => readPng(`${path}/${name}`));
}

function main(argv: readonly string[]): void {
  const arguments_ = parseArguments(argv);
  const frames = loadFrames(arguments_.path);
  const { report, result } = convertAsset(frames, arguments_.options);
  if (arguments_.command === 'verify') {
    const verification = verifyAssetReport(report, arguments_.options);
    const luaRoundTrip = verifyLuaRoundTrip(frames, result, arguments_.options.ticksPerFrame ?? 6);
    process.stdout.write(`${JSON.stringify({ ...report, verification, luaRoundTrip }, null, 2)}\n`);
    if (!verification.passed || luaRoundTrip.status === 'failed' || (arguments_.options.requireLuaRoundTrip === true && luaRoundTrip.status !== 'passed')) process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
