# Phase 2オプティマイザの設計判断

## Decision

- パレット削減は Oklab 距離の重み付き median-cut を初期値にし、6 回の Lloyd 改善を行う。Floyd–Steinberg は指定時にだけ適用し、探索は seed に依存しない決定的な順序で行う。
- 矩形被覆は行ランを縦方向に同一キーでマージし、隣接矩形の結合は `screen.drawRectF(...)` の実文字数が減る場合だけ採用する。評価値は面積ではなく、実際の引数桁数を含む rectangle call の文字数である。
- `direct` は区切り文字を省いた onDraw と、局所参照の hoist の短い方を採用する。`table` は 7 要素の平坦な数値配列、`packed` は小さいパレットなら 1 pixel 1 glyph、16 色なら 4 pixel を 3 base64 glyph に詰め、16 色を超える小画像だけ RGB nibble を使う。
- `convert` は候補を実際に `render` し、SSIM・PSNR・RMSE と emitter の実測長で評価する。予算内候補のうち SSIM、PSNR、文字数の順で選び、時間期限を候補境界で確認する。

## Alternatives considered

- 面積最大の矩形だけを選ぶ方法は、`drawRectF` の座標桁数を目的にできないため採用しなかった。
- 大きな画像を pixel 単位の packed RGB で常に出す方法は 96x96 で予算を超えるため、photo-like 候補では量子化矩形または 16 色 index packing を使う。
- table/packed の推定コストだけを返す方法は API の不変条件を壊すため採用しなかった。各戦略は同じ emitter の実測 `length` を返す。

## Constraints / Gotchas

- Stormworks API の綴りは `screen.setColor` のまま保持する。内部の英語識別子・コメントは British English に統一する。
- `result.rendered` は emitter の見積もりから作らず、最終候補の DrawOp を `render` した Bitmap そのものを返す。
- 96x96 の photo-like fixture は 16 色の 4 pixel/3 glyph packed index 表現で 8192 文字内に収まり、SSIM 0.85 を超える。Lua の parse は依存追加なしで利用可能な `lua` があればテストする。
