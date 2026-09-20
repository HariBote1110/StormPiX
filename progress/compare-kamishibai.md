# storm-kamishibai 比較ベンチマーク

Git: 最初の TDD テストコミット（`08748ea`）は成功した。その後のコミットは `.git/index.lock` を作成できない権限エラーで失敗したため、変更は未コミットで残っている。

## 実行条件

- 実行日: 2026-09-21
- 資産: `/Users/yuki/doc/al/pngX` の `000.png`〜`039.png`、64x32 RGBA8、12 distinct RGBA values
- 競合 clone: `KAMISHIBAI_PATH`（既定値は指定された clone path）
- `luaMaxLength`: 比較の主値は 8192、脚注だけ shipped default の 4090
- StormPiX: `convertFrames`、seed 0、ticksPerFrame 6、timeBudgetMs 5000。Axis A は SSIM 1.000000 を初めて満たす予算を整数二分探索した。
- 追加依存なし。PNG は内蔵 zlib で復号し、asset と clone は読み取り専用で扱う。

## 重要な検証結果

correctness gate の再構成検証は全 subset で一致し、kamishibai はこの資産に対して lossless だった。`src/gencode/GenCode.ts` の `convertLayer` をソースから実行時に読み込み、worker の `R`/`V`/`H` 変換と同じ filled-rectangle semantics で palette index を再構成して検証している。

途中の初回実行では、比較側の `loadClass` がクラス factory を評価せず `Vector2D` と `Color` に渡していたこと、さらに finaliser に表示用 RGB tuple を渡していたことが判明した。いずれも競合側の欠陥ではなくハーネスのバグである。依存引数（LUT と `colorParse` stub）を渡して factory を評価し、finaliser には実際の `Color` オブジェクトを渡すよう修正した。以下の数値は修正後に再実行したものだけを採用している。

## Axis A — equal fidelity

StormPiX は mean SSIM 1.000000 に到達する最小 budget と、そのときの実測 characters。kamishibai は実測した script 数・characters と、再構成検証結果を併記した。`kamLossless=false` の行は equal-fidelity 比較として成立していない。

| frames | kam scripts | kam chars | kam lossless | kam mismatches | StormPiX budget | StormPiX chars | ratio |
|---:|---:|---:|:---:|---:|---:|---:|:---:|
| 4 | 1 | 673 | true | 0 | 723 | 723 | 0.931 |
| 8 | 1 | 1,357 | true | 0 | 1,497 | 1,497 | 0.906 |
| 16 | 2 | 10,097 | true | 0 | 7,165 | 7,165 | 1.409 |
| 24 | 3 | 17,526 | true | 0 | 12,426 | 12,426 | 1.410 |
| 40 | 10 | 70,321 | true | 0 | 23,970 | 23,970 | 2.934 |

## Axis B — 固定 8192 characters

ここでは StormPiX は自分の single-script mode、kamishibai は `luaMaxLength=8192` で分割する mode である。同じ 8192 という上限から、異なる製品の成果（StormPiX は品質を落として一 script、kamishibai は本来複数 script）を得るため、単一の数字で勝敗を表す比較ではない。

| frames | StormPiX chars | mean SSIM | strategy | kam scripts | kam chars | kam lossless | kam mismatches |
|---:|---:|---:|:---|---:|---:|:---:|---:|
| 4 | 723 | 1.000000 | direct | 1 | 673 | true | 0 |
| 8 | 1,497 | 1.000000 | direct | 1 | 1,357 | true | 0 |
| 16 | 7,165 | 1.000000 | direct | 2 | 10,097 | true | 0 |
| 24 | 8,172 | 0.945913 | direct | 3 | 17,526 | true | 0 |
| 40 | 7,709 | 0.402426 | direct | 10 | 70,321 | true | 0 |

### 1 frame の lossless cost

| tool | characters | fidelity | strategy / scripts |
|:---|---:|:---:|:---|
| StormPiX frame 0 | 219 | SSIM 1.000000 | direct |
| kamishibai first card | 266 | lossless | 1 script |

kamishibai の shipped default `luaMaxLength=4090` では、40 frames は `25 scripts / 73,286 characters / lossless=true`、`haveOverRun=true`、`haveColorDiv=false` だった。従って、旧上限では finaliser が overrun を報告していることも脚注として残す。

## Gamma

kamishibai は `src/Color.ts` から `src/Lut.ts` の monitor gamma LUT を適用して、source RGB が実モニター上で見える値になるよう `setColor` の数値を変換する。StormPiX は gamma correction を適用しない。このため、両者の emitted colour numbers を pixel equality で比較するのは無意味であり、各ツールの出力をそれぞれの intended target と比較する。

この資産の 12 色、RGB 36 channel samples では、source channel と kamishibai の LUT-mapped channel の絶対差は次のとおりだった。

| 指標 | 値 |
|:---|---:|
| maximum absolute difference | 142 |
| mean absolute difference | 65.166667 |

このタスクでは StormPiX への gamma correction は実装していない。採用するかどうかは別の product decision とする。

## 実装と検証

- `bench/compare/run.ts`: asset 読み込み、Axis A/B、gamma 集計、skip 動作
- `bench/compare/png.ts`: colour type 6 / bit depth 8 / non-interlaced PNG decoder
- `bench/compare/kamishibai.ts`: clone の `Color`、`GenCode.convertLayer`、`FinalizeLuaCode` を読み込み、worker のカード順を再現
- `bench/compare/model.ts`: 列優先カード順、`R`/`V`/`H` の palette-index renderer
- `tests/compare.test.ts`: 列優先順と矩形再構成の検証

sprite sheet は column-major に配置し、`x` outer / `y` inner の `makeNextConvertData` の順が frame 0..N-1 になることを assert している。kamishibai の再構成が一致しない場合も処理を止めず、mismatch 件数と最初の mismatch を表示して欠陥として記録する。今回の修正後の mismatch は全 subset で 0 だった。

資産または clone がなければ `SKIP: ...` を出して正常終了する。確認済みの skip 出力は次のとおり。

```text
SKIP: asset path is absent: /private/tmp/no-such-stormpix-asset (set ASSET_PATH to override)
SKIP: kamishibai clone is absent: /private/tmp/no-such-kamishibai (set KAMISHIBAI_PATH to override)
```

## 検証結果

- `pnpm test`: 43 tests passed（既存 41 tests + 比較モデル 2 tests）
- `pnpm build`: passed
- `pnpm bench`: passed
- `pnpm bench:compare`: passed（kamishibai の再構成 lossless 検証を含む）
- `src/core/**`、`index.html`、`src/ui/**`、`src/main.ts`、`vite.config.ts`、`vitest.config.ts`、`docs/**` は変更していない。
