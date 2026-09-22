# 列辞書デコーダの文字列メソッド短縮

## Decision

- 列辞書デコーダ内の `string.find`、`string.sub`、`string.gmatch` を、対象文字列の `:find`、`:sub`、`:gmatch` 呼び出しへ置換する。
- 出力文字列だけを短縮し、アルファベット参照・RLE・高位run IDの構文と描画順は変更しない。

## Measurement

- `/Users/yuki/doc/al/pngX` の40フレームlosslessは、配列ディスパッチ後の4,752文字から4,640文字へ112文字減った。

## Constraints / Gotchas

- 拡張run IDの分岐も同じメソッド形式にする。通常runだけを置換すると、入力によっては `string.find` が残り、固定費の削減が不完全になる。
