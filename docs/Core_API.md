# StormPiX Core API 契約（凍結）

変換コアは DOM に一切依存しない純粋関数群。UI はこの契約のみに依存する。
実装者はこの契約のシグネチャを変更してはならない（変更が必要なら停止して報告）。

## 型

```ts
/** RGBA, row-major, length = width*height*4 */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];

export type EmitStrategy = 'direct' | 'table' | 'packed';

export interface ConvertOptions {
  /** 文字数上限。既定 8192 */
  budget?: number;
  /** 最大パレット色数。既定 16 */
  maxColours?: number;
  dither?: 'none' | 'floyd-steinberg';
  /** 試行する emit 戦略。既定は全部試して最安を採る */
  strategies?: readonly EmitStrategy[];
  /**
   * 探索の強さ。既定 5000。
   *
   * 名前は歴史的経緯であり、実時間ではない。探索はカウント式の作業予算だけで
   * 打ち切られ、変換経路は一切時計を読まない。この値は作業予算の倍率
   * `sqrt(min(1, timeBudgetMs / 5000))` として決定的に効く。したがって
   * 実効範囲は 1〜5000 であり、5000 を超える値は 5000 と同一の出力になる。
   */
  timeBudgetMs?: number;
  /** 決定性のための乱数種。既定 0 */
  seed?: number;
}

export interface QualityMetrics {
  /** 0..1, 1 が完全一致 */
  readonly ssim: number;
  /** dB, Infinity が完全一致 */
  readonly psnr: number;
  readonly rmse: number;
}

export interface ConvertStats {
  readonly ops: number;
  readonly setColourCalls: number;
  readonly rects: number;
  readonly elapsedMs: number;
}

export interface ConvertResult {
  /** 生成された Lua。onDraw 本体を含む完全なスクリプト */
  readonly lua: string;
  /** lua.length。必ず実測値 */
  readonly charCount: number;
  readonly withinBudget: boolean;
  readonly strategy: EmitStrategy;
  readonly palette: readonly Rgb[];
  /** 生成 Lua が実際に描画する結果。metrics とプレビューの真値 */
  readonly rendered: Bitmap;
  readonly metrics: QualityMetrics;
  readonly stats: ConvertStats;
}
```

## 関数

```ts
/** 単一画像 → Lua */
export function convert(source: Bitmap, options?: ConvertOptions): ConvertResult;

/** 複数フレーム → Lua（フレーム間差分・共通パレット・tick 再生） */
export function convertFrames(
  frames: readonly Bitmap[],
  options?: ConvertOptions & { readonly ticksPerFrame?: number },
): ConvertResult;

/** 描画命令列を実行してビットマップを得る。metrics の土台 */
export function render(ops: readonly DrawOp[], width: number, height: number): Bitmap;

/** 命令列を Lua にした場合の正確な文字数。推定ではなく実測ベース */
export function costOf(ops: readonly DrawOp[], strategy: EmitStrategy): number;

export function ssim(a: Bitmap, b: Bitmap): number;
export function psnr(a: Bitmap, b: Bitmap): number;
```

## 不変条件（テストで守る）

1. `result.charCount === result.lua.length`
2. 単一スクリプトの結果では
   `result.withinBudget === (result.charCount <= (options.budget ?? 8192))`。
   複数スクリプトになり得る結果では不変条件 9 が優先する（`charCount` は
   先頭スクリプトの長さでしかないため、この形は成り立たない）
3. `render(ops)` の出力は `result.rendered` と完全一致（メトリクスが嘘をつかない）
4. 同一入力・同一 seed で `convert` の出力 Lua はバイト単位で同一（決定性）。これは
   マシン負荷に依らない。変換経路に実時間による判断は存在せず、`performance.now()`
   の使用は `stats.elapsedMs` の報告のみである
5. `budget` を下げたとき `charCount` は単調非増加、`metrics.ssim` は単調非増加
6. `costOf` は実際に emit した Lua の長さと完全一致

## 段階

- **Phase 1**: 足場、型、`render`、`costOf`、`ssim`/`psnr`、ベンチ土台
- **Phase 2**: 量子化 → 矩形被覆 → 順序最適化 → emit 3 戦略 → 予算探索
- **Phase 3**: `convertFrames`（アニメーション）
- **Phase 4**: UI

## `convertFrames` の意味論

`convertFrames` は、同じ幅・高さのフレーム列を一つの画素母集団として量子化し、全フレームで共有するパレットを作る。生成 Lua は `onTick()` の tick カウンタで現在フレームを進め、`onDraw()` でそのフレームを描画する。`ticksPerFrame` の既定値は 6（毎秒 10 フレーム）で、最終フレームの次はフレーム 0 に戻る。

エンコーディングは、全フレームを描く形式と、フレーム 0 を完全描画して以降のフレームを直前との差分だけ描く形式を実測比較し、文字数の短い方を選ぶ。差分形式ではループ境界でフレーム 0 を完全描画するため、最後のフレームから最初のフレームへ戻っても状態が壊れない。差分が有利でないアニメーションは全フレーム形式にフォールバックする。

複数フレームの `result.rendered` は生成コードが最初に描くフレームのプレビューであり、`result.metrics` の `ssim`、`psnr`、`rmse` は各フレームを個別に計測した値の算術平均である。`ConvertStats` の `frameCount`、`frameOps`、`encoding`、`fullFrameChars` はアニメーション時だけ提供される任意フィールドで、既存フィールドの意味は単一画像と同じである。

## 複数スクリプト出力（Phase 5 で追加）

既定の目的関数を「予算内で品質最大化」から「**可逆性を保ったまま文字数最小化**」へ変更する。
収まらない場合は品質ではなくスクリプト数を増やす（storm-kamishibai と同じ設計判断）。

```ts
export type ConvertMode =
  /** 1スクリプトに収める。収まらなければ品質を落とす（Phase 1〜4 の挙動） */
  | 'fit'
  /** 品質を保つ。収まらなければ複数スクリプトに分割する */
  | 'lossless';

export interface ConvertOptions {
  // ...既存のフィールド
  /** 既定は 'lossless' */
  mode?: ConvertMode;
}

export interface ConvertResult {
  // ...既存のフィールド

  /** 生成された全スクリプト。各要素は budget 以内。単一スクリプトなら長さ1 */
  readonly scripts: readonly string[];
  /** scripts の文字数合計 */
  readonly totalCharCount: number;
}
```

### 後方互換の規約

- `lua` は常に `scripts[0]` と同一
- `charCount` は常に `lua.length`（＝ `scripts[0].length`）であり、合計ではない
- `withinBudget` は**全スクリプト**が budget 以内であることを意味する
- 単一スクリプトの結果では `scripts.length === 1` かつ `totalCharCount === charCount`

既存の UI とテストは `lua` / `charCount` / `withinBudget` のみを参照するため、この規約により無改修で動作する。

### 不変条件（追加）

7. `result.lua === result.scripts[0]`
8. `result.totalCharCount === scripts.reduce((n, s) => n + s.length, 0)`
9. `result.withinBudget === scripts.every((s) => s.length <= budget)`
10. `mode: 'lossless'` のとき `metrics.ssim === 1` （分割してでも可逆を守る）
11. スクリプト数は最小であること — 同じ可逆出力をより少ないスクリプト数で表現できてはならない
