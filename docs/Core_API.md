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
  /** 探索の打ち切り時間 (ms)。既定 5000 */
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
2. `result.withinBudget === (result.charCount <= (options.budget ?? 8192))`
3. `render(ops)` の出力は `result.rendered` と完全一致（メトリクスが嘘をつかない）
4. 同一入力・同一 seed で `convert` の出力 Lua はバイト単位で同一（決定性）
5. `budget` を下げたとき `charCount` は単調非増加、`metrics.ssim` は単調非増加
6. `costOf` は実際に emit した Lua の長さと完全一致

## 段階

- **Phase 1**: 足場、型、`render`、`costOf`、`ssim`/`psnr`、ベンチ土台
- **Phase 2**: 量子化 → 矩形被覆 → 順序最適化 → emit 3 戦略 → 予算探索
- **Phase 3**: `convertFrames`（アニメーション）
- **Phase 4**: UI
